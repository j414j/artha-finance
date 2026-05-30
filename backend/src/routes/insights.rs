use std::collections::{BTreeSet, HashMap};

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use chrono::{Datelike, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::FromRow;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::insights::InsightView,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/", get(get_insights))
}

// ── Query params ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct InsightsQuery {
    year: Option<i32>,
    month: Option<u32>,
}

// ── DB row types ──────────────────────────────────────────────────────────────

#[derive(Debug, FromRow, Clone)]
struct CategoryRow {
    id: String,
    parent_id: Option<String>,
    name: String,
}

#[derive(Debug, FromRow)]
struct SpendRow {
    category_id: String,
    amount_paise: i64,
}

#[derive(Debug, FromRow)]
struct MonthlySpendRow {
    category_id: String,
    ym: String,
    amount_paise: i64,
}

#[derive(Debug, FromRow)]
struct BudgetAllocationRow {
    category_id: String,
    amount_paise: i64,
}

#[derive(Debug, FromRow)]
struct AvgTxRow {
    category_id: String,
    avg_paise: f64,
}

#[derive(Debug, FromRow)]
struct TxRow {
    category_id: Option<String>,
    description: String,
    amount_paise: i64,
}

// ── Handler ───────────────────────────────────────────────────────────────────

async fn get_insights(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<InsightsQuery>,
) -> Result<Json<Value>> {
    let now = Utc::now().naive_utc().date();
    let year = query.year.unwrap_or_else(|| now.year());
    let month = query.month.unwrap_or_else(|| now.month());

    if !(1900..=9999).contains(&year) || !(1..=12).contains(&month) {
        return Err(AppError::BadRequest("Invalid year or month".into()));
    }

    let (cur_start, cur_end) = month_bounds(year, month)?;
    let (prior_start, _) = month_bounds_n_back(year, month, 3)?;

    // Days progress for burn-risk (only meaningful for the current month)
    let month_progress = {
        let cur_start_date = NaiveDate::parse_from_str(&cur_start, "%Y-%m-%d").unwrap();
        let cur_end_date = NaiveDate::parse_from_str(&cur_end, "%Y-%m-%d").unwrap();
        let days_in_month = (cur_end_date - cur_start_date).num_days() as f64;
        let today =
            NaiveDate::from_ymd_opt(now.year(), now.month(), now.day()).unwrap_or(cur_start_date);
        let elapsed = if today >= cur_end_date {
            days_in_month
        } else if today <= cur_start_date {
            0.0
        } else {
            (today - cur_start_date).num_days() as f64
        };
        (elapsed / days_in_month, days_in_month - elapsed)
    };
    let (progress_frac, days_remaining) = month_progress;
    let is_current_month = year == now.year() && month == now.month();

    let pool = &state.db;

    // Shared data fetches (run concurrently where possible)
    let categories = fetch_categories(pool, &user.id).await?;
    let cat_map: HashMap<String, CategoryRow> = categories
        .into_iter()
        .map(|c| (c.id.clone(), c))
        .collect();
    let parent_map: HashMap<String, Option<String>> = cat_map
        .iter()
        .map(|(id, c)| (id.clone(), c.parent_id.clone()))
        .collect();

    let (cur_spend, prior_monthly) = tokio::try_join!(
        fetch_category_spend(pool, &user.id, &cur_start, &cur_end),
        fetch_category_spend_by_month(pool, &user.id, &prior_start, &cur_start),
    )?;

    let mut insights: Vec<InsightView> = Vec::new();

    // ── 1. Spend Spike ────────────────────────────────────────────────────────
    // Category spend this month > 1.5× trailing 3M average AND delta > ₹500
    {
        // Build per-category monthly spend maps: cat_id -> { ym -> amount }
        let mut monthly_by_cat: HashMap<String, HashMap<String, i64>> = HashMap::new();
        for row in &prior_monthly {
            monthly_by_cat
                .entry(row.category_id.clone())
                .or_default()
                .insert(row.ym.clone(), row.amount_paise);
        }

        let mut spikes: Vec<InsightView> = Vec::new();
        for (cat_id, &cur_amount) in &cur_spend {
            if let Some(monthly) = monthly_by_cat.get(cat_id) {
                if monthly.is_empty() {
                    continue;
                }
                let total: i64 = monthly.values().sum();
                let avg = total as f64 / monthly.len() as f64;
                if avg <= 0.0 {
                    continue;
                }
                let ratio = cur_amount as f64 / avg;
                let delta = cur_amount - avg as i64;
                if ratio > 1.5 && delta > 50_000 {
                    let cat_name = cat_map
                        .get(cat_id)
                        .map(|c| c.name.as_str())
                        .unwrap_or("Unknown");
                    spikes.push(InsightView {
                        insight_type: "spend_spike".into(),
                        severity: "warning".into(),
                        title: format!("{cat_name} spend spike"),
                        body: format!(
                            "{} this month vs {} avg (3M) — {:.1}× above normal",
                            fmt_paise(cur_amount),
                            fmt_paise(avg as i64),
                            ratio
                        ),
                        category_id: Some(cat_id.clone()),
                        amount_paise: Some(cur_amount),
                    });
                }
            }
        }
        // Largest delta first, cap at 3
        spikes.sort_by(|a, b| b.amount_paise.cmp(&a.amount_paise));
        spikes.truncate(3);
        insights.extend(spikes);
    }

    // ── 2. Budget Burn Risk ───────────────────────────────────────────────────
    // >80% budget used with >40% of month remaining; only for the current month
    if is_current_month && progress_frac > 0.0 && progress_frac < 1.0 {
        let allocations = fetch_budget_allocations(pool, &user.id, year, month).await?;
        for alloc in &allocations {
            if alloc.amount_paise == 0 {
                continue;
            }
            let spent = cur_spend.get(&alloc.category_id).copied().unwrap_or(0);
            let used_pct = spent as f64 / alloc.amount_paise as f64;
            let remaining_frac = 1.0 - progress_frac;
            if used_pct > 0.80 && remaining_frac > 0.40 {
                let cat_name = cat_map
                    .get(&alloc.category_id)
                    .map(|c| c.name.as_str())
                    .unwrap_or("Unknown");
                insights.push(InsightView {
                    insight_type: "budget_burn_risk".into(),
                    severity: "warning".into(),
                    title: format!("{cat_name} budget nearly exhausted"),
                    body: format!(
                        "{:.0}% used with {:.0} days remaining in the month",
                        used_pct * 100.0,
                        days_remaining
                    ),
                    category_id: Some(alloc.category_id.clone()),
                    amount_paise: Some(spent),
                });
            }
        }
    }

    // ── 3. Unbudgeted High Spend ──────────────────────────────────────────────
    // Categories with ≥ ₹1,000 spend but no budget allocation (after parent rollup)
    {
        let budgeted_ids: BTreeSet<String> = if is_current_month {
            fetch_budget_allocations(pool, &user.id, year, month)
                .await?
                .into_iter()
                .filter(|a| a.amount_paise > 0)
                .map(|a| a.category_id)
                .collect()
        } else {
            fetch_base_budget_ids(pool, &user.id).await?
        };

        let mut unbudgeted: Vec<InsightView> = Vec::new();
        for (cat_id, &amount) in &cur_spend {
            if amount < 100_000 {
                continue;
            }
            if !is_covered_by_budget(cat_id, &budgeted_ids, &parent_map) {
                let cat_name = cat_map
                    .get(cat_id)
                    .map(|c| c.name.as_str())
                    .unwrap_or("Uncategorized");
                unbudgeted.push(InsightView {
                    insight_type: "unbudgeted_high_spend".into(),
                    severity: "info".into(),
                    title: format!("Unbudgeted: {cat_name}"),
                    body: format!("{} spent with no budget allocation", fmt_paise(amount)),
                    category_id: Some(cat_id.clone()),
                    amount_paise: Some(amount),
                });
            }
        }
        unbudgeted.sort_by(|a, b| b.amount_paise.cmp(&a.amount_paise));
        unbudgeted.truncate(5);
        insights.extend(unbudgeted);
    }

    // ── 4. Large Transaction ──────────────────────────────────────────────────
    // Single expense > 3× that category's avg transaction size in the prior 3M
    {
        let (avg_rows, tx_rows) = tokio::try_join!(
            fetch_avg_tx_size(pool, &user.id, &prior_start, &cur_start),
            fetch_current_txs(pool, &user.id, &cur_start, &cur_end),
        )?;

        let avg_by_cat: HashMap<String, f64> = avg_rows
            .into_iter()
            .map(|r| (r.category_id, r.avg_paise))
            .collect();

        let mut large: Vec<InsightView> = Vec::new();
        for tx in &tx_rows {
            if tx.amount_paise < 50_000 {
                continue; // skip < ₹500
            }
            let cat_id = tx.category_id.as_deref().unwrap_or("");
            if let Some(&avg) = avg_by_cat.get(cat_id) {
                if avg > 0.0 {
                    let ratio = tx.amount_paise as f64 / avg;
                    if ratio > 3.0 {
                        let cat_name = cat_map
                            .get(cat_id)
                            .map(|c| c.name.as_str())
                            .unwrap_or("Expense");
                        large.push(InsightView {
                            insight_type: "large_transaction".into(),
                            severity: "info".into(),
                            title: format!("Large {cat_name} transaction"),
                            body: format!(
                                "{} — {:.1}× your typical spend in this category",
                                tx.description,
                                ratio
                            ),
                            category_id: tx.category_id.clone(),
                            amount_paise: Some(tx.amount_paise),
                        });
                    }
                }
            }
        }
        large.sort_by(|a, b| b.amount_paise.cmp(&a.amount_paise));
        large.truncate(3);
        insights.extend(large);
    }

    // Sort: warnings first, then by amount descending
    insights.sort_by(|a, b| {
        let sev = |s: &str| if s == "warning" { 0u8 } else { 1 };
        sev(&a.severity)
            .cmp(&sev(&b.severity))
            .then(b.amount_paise.unwrap_or(0).cmp(&a.amount_paise.unwrap_or(0)))
    });

    Ok(Json(json!({ "insights": insights })))
}

// ── SQL helpers ───────────────────────────────────────────────────────────────

async fn fetch_categories(pool: &sqlx::SqlitePool, user_id: &str) -> Result<Vec<CategoryRow>> {
    Ok(sqlx::query_as::<_, CategoryRow>(
        "SELECT id, parent_id, name FROM categories
         WHERE user_id = ? AND type = 'expense' AND is_active = 1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

/// Total spend per category in [start, end).
async fn fetch_category_spend(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    start: &str,
    end: &str,
) -> Result<HashMap<String, i64>> {
    let rows = sqlx::query_as::<_, SpendRow>(
        "SELECT category_id, SUM(amount_inr) AS amount_paise
         FROM (
             SELECT t.category_id,
                    CASE WHEN a.currency = 'INR' THEN t.amount_paise
                         WHEN t.fx_rate IS NOT NULL
                              THEN CAST(ROUND(CAST(t.amount_paise AS REAL) * t.fx_rate) AS INTEGER)
                         ELSE t.amount_paise END AS amount_inr
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
             WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.type = 'expense'
               AND t.date >= ? AND t.date < ? AND t.category_id IS NOT NULL
             UNION ALL
             SELECT s.category_id,
                    CASE WHEN a.currency = 'INR' THEN s.amount_paise
                         WHEN t.fx_rate IS NOT NULL
                              THEN CAST(ROUND(CAST(s.amount_paise AS REAL) * t.fx_rate) AS INTEGER)
                         ELSE s.amount_paise END AS amount_inr
             FROM transaction_splits s
             JOIN transactions t ON t.id = s.transaction_id AND t.user_id = s.user_id
             JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
             WHERE s.user_id = ? AND t.deleted_at IS NULL AND t.type = 'expense'
               AND t.date >= ? AND t.date < ?
         )
         GROUP BY category_id",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|r| (r.category_id, r.amount_paise)).collect())
}

/// Monthly spend per category broken down by YYYY-MM in [start, end).
async fn fetch_category_spend_by_month(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    start: &str,
    end: &str,
) -> Result<Vec<MonthlySpendRow>> {
    Ok(sqlx::query_as::<_, MonthlySpendRow>(
        "SELECT category_id, ym, SUM(amount_inr) AS amount_paise
         FROM (
             SELECT t.category_id,
                    strftime('%Y-%m', t.date) AS ym,
                    CASE WHEN a.currency = 'INR' THEN t.amount_paise
                         WHEN t.fx_rate IS NOT NULL
                              THEN CAST(ROUND(CAST(t.amount_paise AS REAL) * t.fx_rate) AS INTEGER)
                         ELSE t.amount_paise END AS amount_inr
             FROM transactions t
             JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
             WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.type = 'expense'
               AND t.date >= ? AND t.date < ? AND t.category_id IS NOT NULL
             UNION ALL
             SELECT s.category_id,
                    strftime('%Y-%m', t.date) AS ym,
                    CASE WHEN a.currency = 'INR' THEN s.amount_paise
                         WHEN t.fx_rate IS NOT NULL
                              THEN CAST(ROUND(CAST(s.amount_paise AS REAL) * t.fx_rate) AS INTEGER)
                         ELSE s.amount_paise END AS amount_inr
             FROM transaction_splits s
             JOIN transactions t ON t.id = s.transaction_id AND t.user_id = s.user_id
             JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
             WHERE s.user_id = ? AND t.deleted_at IS NULL AND t.type = 'expense'
               AND t.date >= ? AND t.date < ?
         )
         GROUP BY category_id, ym",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?)
}

/// Budget allocations for a given month (from the materialized snapshot).
async fn fetch_budget_allocations(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    year: i32,
    month: u32,
) -> Result<Vec<BudgetAllocationRow>> {
    Ok(sqlx::query_as::<_, BudgetAllocationRow>(
        "SELECT a.category_id, a.amount_paise
         FROM budget_month_allocations a
         JOIN budget_months m ON m.id = a.budget_month_id AND m.user_id = a.user_id
         WHERE a.user_id = ? AND m.year = ? AND m.month = ?",
    )
    .bind(user_id)
    .bind(year)
    .bind(month as i64)
    .fetch_all(pool)
    .await?)
}

/// Category IDs present in the base budget with amount > 0.
async fn fetch_base_budget_ids(
    pool: &sqlx::SqlitePool,
    user_id: &str,
) -> Result<BTreeSet<String>> {
    #[derive(FromRow)]
    struct IdRow {
        category_id: String,
    }
    let rows = sqlx::query_as::<_, IdRow>(
        "SELECT category_id FROM budget_base WHERE user_id = ? AND amount_paise > 0",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.category_id).collect())
}

/// Average individual transaction size per category in [start, end) (top-level only).
async fn fetch_avg_tx_size(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    start: &str,
    end: &str,
) -> Result<Vec<AvgTxRow>> {
    Ok(sqlx::query_as::<_, AvgTxRow>(
        "SELECT t.category_id,
                AVG(CASE WHEN a.currency = 'INR' THEN CAST(t.amount_paise AS REAL)
                         WHEN t.fx_rate IS NOT NULL
                              THEN CAST(t.amount_paise AS REAL) * t.fx_rate
                         ELSE CAST(t.amount_paise AS REAL) END) AS avg_paise
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
         WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.type = 'expense'
           AND t.date >= ? AND t.date < ? AND t.category_id IS NOT NULL
         GROUP BY t.category_id",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?)
}

/// Top-level expense transactions in [start, end) sorted by amount desc.
async fn fetch_current_txs(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    start: &str,
    end: &str,
) -> Result<Vec<TxRow>> {
    Ok(sqlx::query_as::<_, TxRow>(
        "SELECT t.category_id,
                t.description,
                CASE WHEN a.currency = 'INR' THEN t.amount_paise
                     WHEN t.fx_rate IS NOT NULL
                          THEN CAST(ROUND(CAST(t.amount_paise AS REAL) * t.fx_rate) AS INTEGER)
                     ELSE t.amount_paise END AS amount_paise
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
         WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.type = 'expense'
           AND t.date >= ? AND t.date < ?
         ORDER BY amount_paise DESC",
    )
    .bind(user_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?)
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

fn month_bounds(year: i32, month: u32) -> Result<(String, String)> {
    let start = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| AppError::BadRequest("Invalid year/month".into()))?;
    let (ny, nm) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let end = NaiveDate::from_ymd_opt(ny, nm, 1)
        .ok_or_else(|| AppError::BadRequest("Invalid next month".into()))?;
    Ok((
        start.format("%Y-%m-%d").to_string(),
        end.format("%Y-%m-%d").to_string(),
    ))
}

fn month_bounds_n_back(year: i32, month: u32, n: u32) -> Result<(String, String)> {
    let mut y = year;
    let mut m = month;
    for _ in 0..n {
        if m == 1 {
            m = 12;
            y -= 1;
        } else {
            m -= 1;
        }
    }
    month_bounds(y, m)
}

fn is_covered_by_budget(
    cat_id: &str,
    budgeted: &BTreeSet<String>,
    parent_map: &HashMap<String, Option<String>>,
) -> bool {
    let mut current = Some(cat_id);
    while let Some(id) = current {
        if budgeted.contains(id) {
            return true;
        }
        current = parent_map
            .get(id)
            .and_then(|p| p.as_deref());
    }
    false
}

/// Simple paise → "₹1,23,456" formatter for insight body text.
fn fmt_paise(paise: i64) -> String {
    let rupees = paise / 100;
    let s = rupees.abs().to_string();
    let n = s.len();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        let from_right = n - i;
        // Indian grouping: comma at 3 from right, then every 2 (1,00,000)
        if i > 0 && (from_right == 3 || (from_right > 3 && (from_right - 3) % 2 == 0)) {
            out.push(',');
        }
        out.push(c);
    }
    if rupees < 0 {
        format!("-₹{out}")
    } else {
        format!("₹{out}")
    }
}
