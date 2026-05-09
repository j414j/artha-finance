use std::collections::{BTreeMap, BTreeSet};

use axum::{
    extract::{Query, State},
    routing::{get, put},
    Json, Router,
};
use chrono::{Datelike, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{FromRow, Sqlite, Transaction};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::{
        audit::insert_audit_log,
        budget::{
            BudgetAllocationInput, BudgetBaseAllocationView, BudgetCategoryView,
            BudgetHistoryMonthView, BudgetHistoryRowView, BudgetHistoryValueView,
            BudgetHistoryView, BudgetItemView, BudgetMonthAllocationView, BudgetMonthView,
            BudgetSavingsView, BudgetSummaryView, SavingsRatePointView, UnbudgetedSpendView,
            UpdateBudgetBaseRequest, UpdateMonthlyBudgetRequest,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(month_budget))
        .route("/base", get(base_budget).put(update_base_budget))
        .route("/monthly", put(update_monthly_budget))
        .route("/override", put(update_monthly_budget))
        .route("/history", get(budget_history))
}

async fn month_budget(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<BudgetMonthQuery>,
) -> Result<Json<Value>> {
    let (year, month) = normalize_month_query(query.year, query.month)?;
    ensure_month_snapshot(&state.db, &user.id, year, month, false).await?;
    let view = build_month_view(&state.db, &user.id, year, month).await?;

    Ok(Json(json!({ "budget": view })))
}

async fn base_budget(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Value>> {
    let allocations = fetch_base_budget_view(&state.db, &user.id).await?;
    Ok(Json(json!({ "allocations": allocations })))
}

async fn update_base_budget(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<UpdateBudgetBaseRequest>,
) -> Result<Json<Value>> {
    let mut tx = state.db.begin().await?;
    let before = fetch_base_budget_view_in_tx(&mut tx, &user.id).await?;
    if before.iter().any(|allocation| allocation.amount_paise > 0) {
        materialize_existing_months_before_base_update(&mut tx, &user.id).await?;
    }

    let allocations = validate_allocation_inputs(&mut tx, &user.id, req.allocations).await?;

    for (category_id, amount_paise) in allocations {
        if amount_paise == 0 {
            sqlx::query("DELETE FROM budget_base WHERE user_id = ? AND category_id = ?")
                .bind(&user.id)
                .bind(&category_id)
                .execute(&mut *tx)
                .await?;
        } else {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO budget_base (id, user_id, category_id, amount_paise)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(user_id, category_id) DO UPDATE
                 SET amount_paise = excluded.amount_paise,
                     updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')",
            )
            .bind(&id)
            .bind(&user.id)
            .bind(&category_id)
            .bind(amount_paise)
            .execute(&mut *tx)
            .await?;
        }
    }

    let after = fetch_base_budget_view_in_tx(&mut tx, &user.id).await?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "update",
        "budget_base",
        &user.id,
        json!({ "before": before, "after": after }),
    )
    .await?;
    tx.commit().await?;

    let allocations = fetch_base_budget_view(&state.db, &user.id).await?;
    Ok(Json(json!({ "allocations": allocations })))
}

async fn update_monthly_budget(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<UpdateMonthlyBudgetRequest>,
) -> Result<Json<Value>> {
    let (year, month) = validate_year_month(req.year, req.month)?;
    let mut tx = state.db.begin().await?;
    let month_id = ensure_month_snapshot_in_tx(&mut tx, &user.id, year, month, true)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("budget month was not created")))?;
    let before = fetch_month_budget_audit_view_in_tx(&mut tx, &user.id, year, month).await?;
    let allocations = validate_allocation_inputs(&mut tx, &user.id, req.allocations).await?;

    for (category_id, amount_paise) in allocations {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO budget_month_allocations (
                id, user_id, budget_month_id, category_id, amount_paise, is_manual_override
             ) VALUES (?, ?, ?, ?, ?, 1)
             ON CONFLICT(user_id, budget_month_id, category_id) DO UPDATE
             SET amount_paise = excluded.amount_paise,
                 is_manual_override = 1,
                 updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')",
        )
        .bind(&id)
        .bind(&user.id)
        .bind(&month_id)
        .bind(&category_id)
        .bind(amount_paise)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "UPDATE budget_months
         SET updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ?",
    )
    .bind(&month_id)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let after = fetch_month_budget_audit_view_in_tx(&mut tx, &user.id, year, month).await?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "update",
        "budget_month",
        &month_id,
        json!({ "year": year, "month": month, "before": before, "after": after }),
    )
    .await?;
    tx.commit().await?;

    let view = build_month_view(&state.db, &user.id, year, month).await?;
    Ok(Json(json!({ "budget": view })))
}

async fn budget_history(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<BudgetHistoryQuery>,
) -> Result<Json<Value>> {
    let (year, month) = normalize_month_query(query.year, query.month)?;
    let count = query.months.unwrap_or(6);
    if !(1..=24).contains(&count) {
        return Err(AppError::BadRequest(
            "months must be between 1 and 24".into(),
        ));
    }

    let mut months = Vec::with_capacity(count as usize);
    for offset in (0..count).rev() {
        months.push(shift_month(year, month, -(offset as i32)));
    }

    for (month_year, month_number) in &months {
        ensure_month_snapshot(&state.db, &user.id, *month_year, *month_number, false).await?;
    }

    let views = fetch_history_month_views(&state.db, &user.id, &months).await?;
    Ok(Json(json!({ "history": views })))
}

#[derive(Debug, Deserialize, Default)]
struct BudgetMonthQuery {
    year: Option<i32>,
    month: Option<u32>,
}

#[derive(Debug, Deserialize, Default)]
struct BudgetHistoryQuery {
    year: Option<i32>,
    month: Option<u32>,
    months: Option<u32>,
}

#[derive(Debug, Clone, FromRow)]
struct ExpenseCategoryRow {
    id: String,
    parent_id: Option<String>,
    name: String,
    color_hex: String,
    icon_emoji: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct AllocationRow {
    category_id: String,
    amount_paise: i64,
    is_manual_override: bool,
}

#[derive(Debug, Clone, FromRow)]
struct BaseAllocationRow {
    category_id: String,
    amount_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
struct SpendRow {
    category_id: String,
    amount_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
struct IncomeExpenseRow {
    income_paise: i64,
    expense_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
struct MonthIdRow {
    id: String,
}

#[derive(Debug, Clone, FromRow)]
struct PeriodRow {
    year: i32,
    month: i64,
}

#[derive(Debug, Clone)]
struct MonthSpend {
    by_budget_category: BTreeMap<String, i64>,
    unbudgeted: Vec<UnbudgetedSpendView>,
}

async fn fetch_base_budget_view(
    pool: &sqlx::SqlitePool,
    user_id: &str,
) -> Result<Vec<BudgetBaseAllocationView>> {
    let categories = fetch_active_expense_categories(pool, user_id).await?;
    let base = fetch_base_amounts(pool, user_id).await?;
    Ok(build_base_view(categories, &base))
}

async fn fetch_base_budget_view_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
) -> Result<Vec<BudgetBaseAllocationView>> {
    let categories = fetch_active_expense_categories_in_tx(tx, user_id).await?;
    let base = fetch_base_amounts_in_tx(tx, user_id).await?;
    Ok(build_base_view(categories, &base))
}

fn build_base_view(
    categories: Vec<ExpenseCategoryRow>,
    base: &BTreeMap<String, i64>,
) -> Vec<BudgetBaseAllocationView> {
    categories
        .into_iter()
        .map(|category| BudgetBaseAllocationView {
            amount_paise: *base.get(&category.id).unwrap_or(&0),
            category_id: category.id.clone(),
            category: category_view(&category),
        })
        .collect()
}

async fn fetch_month_budget_audit_view_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    year: i32,
    month: u32,
) -> Result<Value> {
    let allocations = fetch_month_allocations_in_tx(tx, user_id, year, month).await?;
    Ok(json!({
        "year": year,
        "month": month,
        "allocations": allocations
            .into_iter()
            .map(|row| json!({
                "category_id": row.category_id,
                "amount_paise": row.amount_paise,
                "is_manual_override": row.is_manual_override,
            }))
            .collect::<Vec<_>>(),
    }))
}

async fn build_month_view(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    year: i32,
    month: u32,
) -> Result<BudgetMonthView> {
    let categories = fetch_active_expense_categories(pool, user_id).await?;
    let category_map = category_map(&categories);
    let allocations = fetch_month_allocations(pool, user_id, year, month).await?;
    let allocation_map: BTreeMap<String, AllocationRow> = allocations
        .into_iter()
        .map(|row| (row.category_id.clone(), row))
        .collect();
    let budgeted_categories: BTreeSet<String> = allocation_map
        .iter()
        .filter(|(_, row)| row.amount_paise > 0)
        .map(|(category_id, _)| category_id.clone())
        .collect();
    let spend = fetch_month_spend(
        pool,
        user_id,
        year,
        month,
        &category_map,
        &budgeted_categories,
    )
    .await?;
    let savings = fetch_income_expense(pool, user_id, year, month).await?;
    let timing = month_timing(year, month)?;

    let mut items: Vec<BudgetItemView> = categories
        .iter()
        .filter_map(|category| {
            let allocation = allocation_map.get(&category.id)?;
            if allocation.amount_paise <= 0 {
                return None;
            }
            let spent_paise = *spend.by_budget_category.get(&category.id).unwrap_or(&0);
            Some(build_item_view(
                category,
                allocation.amount_paise,
                spent_paise,
                allocation.is_manual_override,
                timing.expected_pct,
            ))
        })
        .collect();
    let allocations = categories
        .iter()
        .map(|category| {
            let allocation = allocation_map.get(&category.id);
            BudgetMonthAllocationView {
                category_id: category.id.clone(),
                category: category_view(category),
                amount_paise: allocation.map(|row| row.amount_paise).unwrap_or(0),
                is_manual_override: allocation
                    .map(|row| row.is_manual_override)
                    .unwrap_or(false),
            }
        })
        .collect();

    items.sort_by(|a, b| {
        b.used_pct
            .partial_cmp(&a.used_pct)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.category.name.cmp(&b.category.name))
    });

    let total_budget_paise = items.iter().map(|item| item.allocated_paise).sum::<i64>();
    let spent_paise = items.iter().map(|item| item.spent_paise).sum::<i64>();
    let used_pct = pct(spent_paise, total_budget_paise);

    Ok(BudgetMonthView {
        year,
        month,
        month_label: format!("{} {}", month_name(month), year),
        summary: BudgetSummaryView {
            total_budget_paise,
            spent_paise,
            remaining_paise: total_budget_paise - spent_paise,
            used_pct,
            expected_pct: timing.expected_pct,
            days_elapsed: timing.days_elapsed,
            days_in_month: timing.days_in_month,
        },
        savings,
        allocations,
        items,
        unbudgeted: spend.unbudgeted,
    })
}

async fn fetch_history_month_views(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    months: &[(i32, u32)],
) -> Result<BudgetHistoryView> {
    let mut month_views = Vec::with_capacity(months.len());
    for (year, month) in months {
        month_views.push(build_month_view(pool, user_id, *year, *month).await?);
    }

    let mut row_map: BTreeMap<String, (BudgetCategoryView, Vec<BudgetHistoryValueView>)> =
        BTreeMap::new();
    for view in &month_views {
        for item in &view.items {
            let entry = row_map
                .entry(item.category_id.clone())
                .or_insert_with(|| (item.category.clone(), Vec::new()));
            entry.1.push(BudgetHistoryValueView {
                year: view.year,
                month: view.month,
                allocated_paise: item.allocated_paise,
                spent_paise: item.spent_paise,
                used_pct: Some(item.used_pct),
            });
        }
    }

    for (_category_id, (_category, values)) in row_map.iter_mut() {
        for (year, month) in months {
            if !values
                .iter()
                .any(|value| value.year == *year && value.month == *month)
            {
                values.push(BudgetHistoryValueView {
                    year: *year,
                    month: *month,
                    allocated_paise: 0,
                    spent_paise: 0,
                    used_pct: None,
                });
            }
        }
        values.sort_by_key(|value| (value.year, value.month));
    }

    let mut rows: Vec<BudgetHistoryRowView> = row_map
        .into_iter()
        .map(|(category_id, (category, values))| BudgetHistoryRowView {
            category_id,
            category,
            values,
        })
        .collect();
    rows.sort_by(|a, b| a.category.name.cmp(&b.category.name));

    Ok(BudgetHistoryView {
        months: months
            .iter()
            .map(|(year, month)| BudgetHistoryMonthView {
                year: *year,
                month: *month,
                label: short_month_name(*month).to_string(),
            })
            .collect(),
        savings_rate_trend: month_views
            .iter()
            .map(|view| SavingsRatePointView {
                year: view.year,
                month: view.month,
                label: short_month_name(view.month).to_string(),
                income_paise: view.savings.income_paise,
                expense_paise: view.savings.expense_paise,
                savings_rate_pct: view.savings.savings_rate_pct,
            })
            .collect(),
        rows,
    })
}

fn build_item_view(
    category: &ExpenseCategoryRow,
    allocated_paise: i64,
    spent_paise: i64,
    is_manual_override: bool,
    expected_pct: f64,
) -> BudgetItemView {
    let used_pct = pct(spent_paise, allocated_paise);
    BudgetItemView {
        category_id: category.id.clone(),
        category: category_view(category),
        allocated_paise,
        spent_paise,
        remaining_paise: allocated_paise - spent_paise,
        used_pct,
        expected_pct,
        status: budget_status(allocated_paise, spent_paise, used_pct, expected_pct).to_string(),
        is_manual_override,
    }
}

async fn ensure_month_snapshot(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    year: i32,
    month: u32,
    allow_empty_base: bool,
) -> Result<Option<String>> {
    let mut tx = pool.begin().await?;
    let id = ensure_month_snapshot_in_tx(&mut tx, user_id, year, month, allow_empty_base).await?;
    tx.commit().await?;
    Ok(id)
}

async fn ensure_month_snapshot_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    year: i32,
    month: u32,
    allow_empty_base: bool,
) -> Result<Option<String>> {
    let base = fetch_base_amounts_in_tx(tx, user_id).await?;
    let has_base_allocations = base.values().any(|amount| *amount > 0);
    let existing_month_id = fetch_optional_month_id_in_tx(tx, user_id, year, month).await?;

    if let Some(month_id) = existing_month_id {
        if has_base_allocations && is_blank_automatic_month_in_tx(tx, user_id, &month_id).await? {
            replace_month_allocations_from_base_in_tx(tx, user_id, &month_id, &base).await?;
        }
        return Ok(Some(month_id));
    }

    if !has_base_allocations && !allow_empty_base {
        return Ok(None);
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT OR IGNORE INTO budget_months (id, user_id, year, month)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(year)
    .bind(month as i64)
    .execute(&mut **tx)
    .await?;

    let month_id = fetch_month_id_in_tx(tx, user_id, year, month).await?;
    replace_month_allocations_from_base_in_tx(tx, user_id, &month_id, &base).await?;

    Ok(Some(month_id))
}

async fn materialize_existing_months_before_base_update(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
) -> Result<()> {
    let (current_year, current_month) = current_year_month();
    let mut periods = BTreeSet::from([(current_year, current_month)]);
    let rows = sqlx::query_as::<_, PeriodRow>(
        "SELECT DISTINCT
             CAST(substr(date, 1, 4) AS INTEGER) AS year,
             CAST(substr(date, 6, 2) AS INTEGER) AS month
         FROM transactions
         WHERE user_id = ?
           AND deleted_at IS NULL
           AND date IS NOT NULL
           AND date <= date('now')",
    )
    .bind(user_id)
    .fetch_all(&mut **tx)
    .await?;

    for row in rows {
        if let Ok(month) = u32::try_from(row.month) {
            if validate_year_month(row.year, month).is_ok() {
                periods.insert((row.year, month));
            }
        }
    }

    for (year, month) in periods {
        ensure_month_snapshot_in_tx(tx, user_id, year, month, false).await?;
    }

    Ok(())
}

async fn validate_allocation_inputs(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    inputs: Vec<BudgetAllocationInput>,
) -> Result<BTreeMap<String, i64>> {
    if inputs.len() > 500 {
        return Err(AppError::BadRequest(
            "At most 500 budget allocations can be saved at once".into(),
        ));
    }

    let categories = fetch_active_expense_categories_in_tx(tx, user_id).await?;
    let active_expense_ids = categories
        .into_iter()
        .map(|category| category.id)
        .collect::<BTreeSet<_>>();
    let mut allocations = BTreeMap::new();

    for input in inputs {
        let category_id = input.category_id.trim().to_string();
        if category_id.is_empty() {
            return Err(AppError::BadRequest("category_id is required".into()));
        }
        if input.amount_paise < 0 {
            return Err(AppError::BadRequest(
                "Budget amounts cannot be negative".into(),
            ));
        }
        if !active_expense_ids.contains(&category_id) {
            return Err(AppError::BadRequest(
                "Budgets can only be assigned to active expense categories".into(),
            ));
        }
        if allocations
            .insert(category_id, input.amount_paise)
            .is_some()
        {
            return Err(AppError::BadRequest(
                "Duplicate category_id in budget allocations".into(),
            ));
        }
    }

    Ok(allocations)
}

async fn fetch_month_spend(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    year: i32,
    month: u32,
    categories: &BTreeMap<String, ExpenseCategoryRow>,
    budgeted_categories: &BTreeSet<String>,
) -> Result<MonthSpend> {
    let (start, end_exclusive, _) = month_bounds(year, month)?;
    let mut exact_spend = BTreeMap::new();

    for row in fetch_top_level_spend(pool, user_id, &start, &end_exclusive).await? {
        *exact_spend.entry(row.category_id).or_insert(0) += row.amount_paise;
    }
    for row in fetch_split_spend(pool, user_id, &start, &end_exclusive).await? {
        *exact_spend.entry(row.category_id).or_insert(0) += row.amount_paise;
    }

    let mut by_budget_category = BTreeMap::new();
    let mut unbudgeted_exact = BTreeMap::new();

    for (category_id, amount) in exact_spend {
        if let Some(budget_category_id) =
            nearest_budgeted_category(&category_id, categories, budgeted_categories)
        {
            *by_budget_category.entry(budget_category_id).or_insert(0) += amount;
        } else {
            *unbudgeted_exact.entry(category_id).or_insert(0) += amount;
        }
    }

    let mut unbudgeted = unbudgeted_exact
        .into_iter()
        .map(|(category_id, spent_paise)| {
            let category = categories.get(&category_id);
            UnbudgetedSpendView {
                category_id: Some(category_id.clone()),
                category_name: category
                    .map(|category| category.name.clone())
                    .unwrap_or_else(|| "Archived category".to_string()),
                color_hex: category
                    .map(|category| category.color_hex.clone())
                    .unwrap_or_else(|| "var(--text3)".to_string()),
                icon_emoji: category.and_then(|category| category.icon_emoji.clone()),
                spent_paise,
            }
        })
        .collect::<Vec<_>>();
    unbudgeted.sort_by(|a, b| b.spent_paise.cmp(&a.spent_paise));

    Ok(MonthSpend {
        by_budget_category,
        unbudgeted,
    })
}

async fn fetch_top_level_spend(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    start: &str,
    end_exclusive: &str,
) -> Result<Vec<SpendRow>> {
    Ok(sqlx::query_as::<_, SpendRow>(
        "SELECT t.category_id,
                COALESCE(SUM(
                    CASE WHEN a.currency = 'INR' THEN t.amount_paise
                         WHEN t.fx_rate IS NOT NULL THEN CAST(ROUND(CAST(t.amount_paise AS REAL) * t.fx_rate) AS INTEGER)
                         ELSE t.amount_paise END
                ), 0) AS amount_paise
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
         WHERE t.user_id = ?
           AND t.deleted_at IS NULL
           AND t.type = 'expense'
           AND t.category_id IS NOT NULL
           AND t.date >= ?
           AND t.date < ?
         GROUP BY t.category_id",
    )
    .bind(user_id)
    .bind(start)
    .bind(end_exclusive)
    .fetch_all(pool)
    .await?)
}

async fn fetch_split_spend(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    start: &str,
    end_exclusive: &str,
) -> Result<Vec<SpendRow>> {
    Ok(sqlx::query_as::<_, SpendRow>(
        "SELECT s.category_id,
                COALESCE(SUM(
                    CASE WHEN a.currency = 'INR' THEN s.amount_paise
                         WHEN t.fx_rate IS NOT NULL THEN CAST(ROUND(CAST(s.amount_paise AS REAL) * t.fx_rate) AS INTEGER)
                         ELSE s.amount_paise END
                ), 0) AS amount_paise
         FROM transaction_splits s
         JOIN transactions t ON t.id = s.transaction_id AND t.user_id = s.user_id
         JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
         WHERE s.user_id = ?
           AND t.deleted_at IS NULL
           AND t.type = 'expense'
           AND t.date >= ?
           AND t.date < ?
         GROUP BY s.category_id",
    )
    .bind(user_id)
    .bind(start)
    .bind(end_exclusive)
    .fetch_all(pool)
    .await?)
}

async fn fetch_income_expense(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    year: i32,
    month: u32,
) -> Result<BudgetSavingsView> {
    let (start, end_exclusive, _) = month_bounds(year, month)?;
    let row = sqlx::query_as::<_, IncomeExpenseRow>(
        "SELECT
             COALESCE(SUM(CASE WHEN t.type IN ('income', 'dividend') THEN
                 CASE WHEN a.currency = 'INR' THEN t.amount_paise
                      WHEN t.fx_rate IS NOT NULL THEN CAST(ROUND(CAST(t.amount_paise AS REAL) * t.fx_rate) AS INTEGER)
                      ELSE t.amount_paise END
             ELSE 0 END), 0) AS income_paise,
             COALESCE(SUM(CASE WHEN t.type = 'expense' THEN
                 CASE WHEN a.currency = 'INR' THEN t.amount_paise
                      WHEN t.fx_rate IS NOT NULL THEN CAST(ROUND(CAST(t.amount_paise AS REAL) * t.fx_rate) AS INTEGER)
                      ELSE t.amount_paise END
             ELSE 0 END), 0) AS expense_paise
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
         WHERE t.user_id = ?
           AND t.deleted_at IS NULL
           AND t.date >= ?
           AND t.date < ?",
    )
    .bind(user_id)
    .bind(start)
    .bind(end_exclusive)
    .fetch_one(pool)
    .await?;
    let net_paise = row.income_paise - row.expense_paise;
    let savings_rate_pct = if row.income_paise > 0 {
        Some(round1((net_paise as f64 / row.income_paise as f64) * 100.0))
    } else {
        None
    };

    Ok(BudgetSavingsView {
        income_paise: row.income_paise,
        expense_paise: row.expense_paise,
        net_paise,
        savings_rate_pct,
    })
}

async fn fetch_active_expense_categories(
    pool: &sqlx::SqlitePool,
    user_id: &str,
) -> Result<Vec<ExpenseCategoryRow>> {
    Ok(sqlx::query_as::<_, ExpenseCategoryRow>(
        "SELECT id, parent_id, name, color_hex, icon_emoji
         FROM categories
         WHERE user_id = ? AND type = 'expense' AND is_active = 1
         ORDER BY parent_id IS NOT NULL, parent_id, name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_active_expense_categories_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
) -> Result<Vec<ExpenseCategoryRow>> {
    Ok(sqlx::query_as::<_, ExpenseCategoryRow>(
        "SELECT id, parent_id, name, color_hex, icon_emoji
         FROM categories
         WHERE user_id = ? AND type = 'expense' AND is_active = 1
         ORDER BY parent_id IS NOT NULL, parent_id, name",
    )
    .bind(user_id)
    .fetch_all(&mut **tx)
    .await?)
}

async fn fetch_base_amounts(
    pool: &sqlx::SqlitePool,
    user_id: &str,
) -> Result<BTreeMap<String, i64>> {
    let rows = sqlx::query_as::<_, BaseAllocationRow>(
        "SELECT category_id, amount_paise
         FROM budget_base
         WHERE user_id = ?",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.category_id, row.amount_paise))
        .collect())
}

async fn fetch_base_amounts_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
) -> Result<BTreeMap<String, i64>> {
    let rows = sqlx::query_as::<_, BaseAllocationRow>(
        "SELECT category_id, amount_paise
         FROM budget_base
         WHERE user_id = ?",
    )
    .bind(user_id)
    .fetch_all(&mut **tx)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.category_id, row.amount_paise))
        .collect())
}

async fn fetch_month_allocations(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    year: i32,
    month: u32,
) -> Result<Vec<AllocationRow>> {
    Ok(sqlx::query_as::<_, AllocationRow>(
        "SELECT a.category_id, a.amount_paise, a.is_manual_override
         FROM budget_month_allocations a
         JOIN budget_months m
           ON m.id = a.budget_month_id
          AND m.user_id = a.user_id
         WHERE a.user_id = ?
           AND m.year = ?
           AND m.month = ?",
    )
    .bind(user_id)
    .bind(year)
    .bind(month as i64)
    .fetch_all(pool)
    .await?)
}

async fn fetch_month_allocations_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    year: i32,
    month: u32,
) -> Result<Vec<AllocationRow>> {
    Ok(sqlx::query_as::<_, AllocationRow>(
        "SELECT a.category_id, a.amount_paise, a.is_manual_override
         FROM budget_month_allocations a
         JOIN budget_months m
           ON m.id = a.budget_month_id
          AND m.user_id = a.user_id
         WHERE a.user_id = ?
           AND m.year = ?
           AND m.month = ?",
    )
    .bind(user_id)
    .bind(year)
    .bind(month as i64)
    .fetch_all(&mut **tx)
    .await?)
}

async fn fetch_month_id_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    year: i32,
    month: u32,
) -> Result<String> {
    fetch_optional_month_id_in_tx(tx, user_id, year, month)
        .await?
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("budget month was not created")))
}

async fn fetch_optional_month_id_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    year: i32,
    month: u32,
) -> Result<Option<String>> {
    Ok(sqlx::query_as::<_, MonthIdRow>(
        "SELECT id
         FROM budget_months
         WHERE user_id = ? AND year = ? AND month = ?",
    )
    .bind(user_id)
    .bind(year)
    .bind(month as i64)
    .fetch_optional(&mut **tx)
    .await?
    .map(|row| row.id))
}

async fn is_blank_automatic_month_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    month_id: &str,
) -> Result<bool> {
    #[derive(Debug, FromRow)]
    struct BlankRow {
        positive_count: i64,
        override_count: i64,
    }

    let row = sqlx::query_as::<_, BlankRow>(
        "SELECT
             COALESCE(SUM(CASE WHEN amount_paise > 0 THEN 1 ELSE 0 END), 0) AS positive_count,
             COALESCE(SUM(CASE WHEN is_manual_override = 1 THEN 1 ELSE 0 END), 0) AS override_count
         FROM budget_month_allocations
         WHERE user_id = ? AND budget_month_id = ?",
    )
    .bind(user_id)
    .bind(month_id)
    .fetch_one(&mut **tx)
    .await?;

    Ok(row.positive_count == 0 && row.override_count == 0)
}

async fn replace_month_allocations_from_base_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    month_id: &str,
    base: &BTreeMap<String, i64>,
) -> Result<()> {
    sqlx::query(
        "DELETE FROM budget_month_allocations
         WHERE user_id = ? AND budget_month_id = ?",
    )
    .bind(user_id)
    .bind(month_id)
    .execute(&mut **tx)
    .await?;

    let categories = fetch_active_expense_categories_in_tx(tx, user_id).await?;
    for category in categories {
        let allocation_id = Uuid::new_v4().to_string();
        let amount = *base.get(&category.id).unwrap_or(&0);
        sqlx::query(
            "INSERT INTO budget_month_allocations (
                id, user_id, budget_month_id, category_id, amount_paise, is_manual_override
             ) VALUES (?, ?, ?, ?, ?, 0)",
        )
        .bind(&allocation_id)
        .bind(user_id)
        .bind(month_id)
        .bind(&category.id)
        .bind(amount)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

fn category_map(categories: &[ExpenseCategoryRow]) -> BTreeMap<String, ExpenseCategoryRow> {
    categories
        .iter()
        .map(|category| (category.id.clone(), category.clone()))
        .collect()
}

fn nearest_budgeted_category(
    category_id: &str,
    categories: &BTreeMap<String, ExpenseCategoryRow>,
    budgeted_categories: &BTreeSet<String>,
) -> Option<String> {
    let mut current = Some(category_id);
    while let Some(id) = current {
        if budgeted_categories.contains(id) {
            return Some(id.to_string());
        }
        current = categories
            .get(id)
            .and_then(|category| category.parent_id.as_deref());
    }
    None
}

fn category_view(category: &ExpenseCategoryRow) -> BudgetCategoryView {
    BudgetCategoryView {
        id: category.id.clone(),
        parent_id: category.parent_id.clone(),
        name: category.name.clone(),
        color_hex: category.color_hex.clone(),
        icon_emoji: category.icon_emoji.clone(),
    }
}

fn normalize_month_query(year: Option<i32>, month: Option<u32>) -> Result<(i32, u32)> {
    match (year, month) {
        (Some(year), Some(month)) => validate_year_month(year, month),
        (None, None) => Ok(current_year_month()),
        _ => Err(AppError::BadRequest(
            "year and month must be supplied together".into(),
        )),
    }
}

fn validate_year_month(year: i32, month: u32) -> Result<(i32, u32)> {
    if !(1900..=9999).contains(&year) || !(1..=12).contains(&month) {
        return Err(AppError::BadRequest(
            "year must be 1900-9999 and month must be 1-12".into(),
        ));
    }
    NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| {
        AppError::BadRequest("year and month must form a valid calendar month".into())
    })?;
    Ok((year, month))
}

fn current_year_month() -> (i32, u32) {
    let today = Utc::now().date_naive();
    (today.year(), today.month())
}

fn shift_month(year: i32, month: u32, offset: i32) -> (i32, u32) {
    let zero_based = year * 12 + month as i32 - 1 + offset;
    let shifted_year = zero_based.div_euclid(12);
    let shifted_month = zero_based.rem_euclid(12) + 1;
    (shifted_year, shifted_month as u32)
}

#[derive(Debug, Clone, Copy)]
struct MonthTiming {
    days_elapsed: u32,
    days_in_month: u32,
    expected_pct: f64,
}

fn month_timing(year: i32, month: u32) -> Result<MonthTiming> {
    let (_, _, days_in_month) = month_bounds(year, month)?;
    let (current_year, current_month) = current_year_month();
    let current_ord = month_ordinal(current_year, current_month);
    let target_ord = month_ordinal(year, month);
    let days_elapsed = if target_ord < current_ord {
        days_in_month
    } else if target_ord > current_ord {
        0
    } else {
        Utc::now().date_naive().day().min(days_in_month)
    };

    Ok(MonthTiming {
        days_elapsed,
        days_in_month,
        expected_pct: round1((days_elapsed as f64 / days_in_month as f64) * 100.0),
    })
}

fn month_bounds(year: i32, month: u32) -> Result<(String, String, u32)> {
    validate_year_month(year, month)?;
    let start = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let next_start = NaiveDate::from_ymd_opt(next_year, next_month, 1)
        .ok_or_else(|| AppError::BadRequest("Month is out of supported range".into()))?;
    let days_in_month = next_start.pred_opt().unwrap().day();
    Ok((start.to_string(), next_start.to_string(), days_in_month))
}

fn month_ordinal(year: i32, month: u32) -> i32 {
    year * 12 + month as i32
}

fn budget_status(
    allocated_paise: i64,
    spent_paise: i64,
    used_pct: f64,
    expected_pct: f64,
) -> &'static str {
    if spent_paise > allocated_paise {
        "over_budget"
    } else if used_pct >= 90.0 {
        "near_limit"
    } else if expected_pct > 0.0 && used_pct > expected_pct + 10.0 {
        "ahead_of_pace"
    } else if used_pct <= expected_pct * 0.6 {
        "well_within"
    } else {
        "on_track"
    }
}

fn pct(numerator: i64, denominator: i64) -> f64 {
    if denominator <= 0 {
        0.0
    } else {
        round1((numerator as f64 / denominator as f64) * 100.0)
    }
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn month_name(month: u32) -> &'static str {
    match month {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        12 => "December",
        _ => "",
    }
}

fn short_month_name(month: u32) -> &'static str {
    match month {
        1 => "Jan",
        2 => "Feb",
        3 => "Mar",
        4 => "Apr",
        5 => "May",
        6 => "Jun",
        7 => "Jul",
        8 => "Aug",
        9 => "Sep",
        10 => "Oct",
        11 => "Nov",
        12 => "Dec",
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn category(id: &str, parent_id: Option<&str>) -> ExpenseCategoryRow {
        ExpenseCategoryRow {
            id: id.to_string(),
            parent_id: parent_id.map(str::to_string),
            name: id.to_string(),
            color_hex: "#3A7FFF".to_string(),
            icon_emoji: None,
        }
    }

    #[test]
    fn spend_rolls_up_to_nearest_budgeted_parent() {
        let categories = category_map(&[
            category("food", None),
            category("groceries", Some("food")),
            category("premium", Some("groceries")),
        ]);
        let budgeted = BTreeSet::from(["food".to_string()]);

        assert_eq!(
            nearest_budgeted_category("premium", &categories, &budgeted),
            Some("food".to_string())
        );
    }

    #[test]
    fn child_budget_wins_over_parent_budget() {
        let categories =
            category_map(&[category("food", None), category("groceries", Some("food"))]);
        let budgeted = BTreeSet::from(["food".to_string(), "groceries".to_string()]);

        assert_eq!(
            nearest_budgeted_category("groceries", &categories, &budgeted),
            Some("groceries".to_string())
        );
    }

    #[test]
    fn shifts_months_across_year_boundaries() {
        assert_eq!(shift_month(2026, 1, -1), (2025, 12));
        assert_eq!(shift_month(2026, 12, 1), (2027, 1));
    }

    #[tokio::test]
    async fn blank_auto_snapshot_refreshes_after_base_is_created() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        create_budget_test_schema(&pool).await;

        sqlx::query(
            "INSERT INTO categories (
                id, user_id, parent_id, name, type, color_hex, icon_emoji, is_active
             ) VALUES ('food', 'user-1', NULL, 'Food', 'expense', '#3A7FFF', 'FO', 1)",
        )
        .execute(&pool)
        .await
        .expect("insert category");

        let mut tx = pool.begin().await.expect("begin tx");
        let skipped = ensure_month_snapshot_in_tx(&mut tx, "user-1", 2026, 5, false)
            .await
            .expect("ensure without base");
        tx.commit().await.expect("commit skipped");
        assert!(skipped.is_none());

        let month_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM budget_months WHERE user_id = 'user-1'")
                .fetch_one(&pool)
                .await
                .expect("count months");
        assert_eq!(month_count.0, 0);

        let mut tx = pool.begin().await.expect("begin tx");
        let month_id = ensure_month_snapshot_in_tx(&mut tx, "user-1", 2026, 5, true)
            .await
            .expect("ensure empty month")
            .expect("month id");
        tx.commit().await.expect("commit empty month");

        let initial_amount: (i64,) = sqlx::query_as(
            "SELECT amount_paise
             FROM budget_month_allocations
             WHERE user_id = 'user-1' AND budget_month_id = ? AND category_id = 'food'",
        )
        .bind(&month_id)
        .fetch_one(&pool)
        .await
        .expect("initial amount");
        assert_eq!(initial_amount.0, 0);

        sqlx::query(
            "INSERT INTO budget_base (id, user_id, category_id, amount_paise)
             VALUES ('base-food', 'user-1', 'food', 120000)",
        )
        .execute(&pool)
        .await
        .expect("insert base");

        let mut tx = pool.begin().await.expect("begin tx");
        let refreshed = ensure_month_snapshot_in_tx(&mut tx, "user-1", 2026, 5, false)
            .await
            .expect("ensure with base")
            .expect("month id");
        tx.commit().await.expect("commit refreshed");
        assert_eq!(refreshed, month_id);

        let refreshed_amount: (i64, bool) = sqlx::query_as(
            "SELECT amount_paise, is_manual_override
             FROM budget_month_allocations
             WHERE user_id = 'user-1' AND budget_month_id = ? AND category_id = 'food'",
        )
        .bind(&month_id)
        .fetch_one(&pool)
        .await
        .expect("refreshed amount");
        assert_eq!(refreshed_amount, (120000, false));
    }

    async fn create_budget_test_schema(pool: &sqlx::SqlitePool) {
        sqlx::query(
            "CREATE TABLE categories (
                id TEXT PRIMARY KEY NOT NULL,
                user_id TEXT NOT NULL,
                parent_id TEXT,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                color_hex TEXT NOT NULL,
                icon_emoji TEXT,
                is_active INTEGER NOT NULL
            );
            CREATE TABLE budget_base (
                id TEXT PRIMARY KEY NOT NULL,
                user_id TEXT NOT NULL,
                category_id TEXT NOT NULL,
                amount_paise INTEGER NOT NULL
            );
            CREATE TABLE budget_months (
                id TEXT PRIMARY KEY NOT NULL,
                user_id TEXT NOT NULL,
                year INTEGER NOT NULL,
                month INTEGER NOT NULL,
                updated_at TEXT,
                UNIQUE(user_id, year, month)
            );
            CREATE TABLE budget_month_allocations (
                id TEXT PRIMARY KEY NOT NULL,
                user_id TEXT NOT NULL,
                budget_month_id TEXT NOT NULL,
                category_id TEXT NOT NULL,
                amount_paise INTEGER NOT NULL,
                is_manual_override INTEGER NOT NULL,
                UNIQUE(user_id, budget_month_id, category_id)
            );",
        )
        .execute(pool)
        .await
        .expect("create budget test schema");
    }
}
