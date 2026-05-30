use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::{
        account::{
            build_accounts_response, is_valid_account_type, normalize_currency, summarize_accounts,
            validate_color_hex, validate_date, Account, AccountView, CreateAccountRequest,
            UpdateAccountRequest, ACCOUNT_TYPES,
        },
        audit::insert_audit_log,
        fx_rate::FxRateMap,
    },
    routes::investments::{compute_holdings, HoldingView},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_accounts).post(create_account))
        .route("/summary", get(account_summary))
        .route(
            "/:id",
            get(get_account).patch(update_account).delete(archive_account),
        )
        .route("/:id/balance-history", get(account_balance_history))
}

async fn get_account(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let account = fetch_active_account(&state.db, &id, &user.id).await?;
    let fx_rates = FxRateMap::latest_for_user(&state.db, &user.id).await?;

    let raw_cash_paise = account.balance_paise;
    let cash_inr_paise = fx_rates
        .convert_to_inr_paise(&account.currency, raw_cash_paise)
        .unwrap_or(account.inr_value_paise);

    let mut view = serde_json::to_value(AccountView::from(account.clone()))
        .unwrap_or_else(|_| json!({}));
    view["inr_value_paise"] = json!(cash_inr_paise);

    if is_investment_account(&account.account_type) {
        let holdings = compute_holdings(&state.db, &user.id, Some(&id)).await?;
        let mut holdings_paise: i64 = 0;
        let mut holdings_inr_paise: i64 = 0;
        for h in &holdings {
            if let Some(v) =
                convert_holding_to_account_currency(&fx_rates, h, &account.currency)
            {
                holdings_paise += v;
            }
            if let Some(v) = h.current_value_inr_paise.or(h.invested_value_inr_paise) {
                holdings_inr_paise += v;
            }
        }
        view["balance_paise"] = json!(raw_cash_paise + holdings_paise);
        view["inr_value_paise"] = json!(cash_inr_paise + holdings_inr_paise);
        view["cash_balance_paise"] = json!(raw_cash_paise);
    }

    Ok(Json(json!({ "account": view })))
}

#[derive(Deserialize)]
struct BalanceHistoryQuery {
    days: Option<u32>,
}

#[derive(Debug, sqlx::FromRow)]
struct BalanceTxRow {
    date: String,
    tx_type: String,
    amount_paise: i64,
    fx_to_amount_paise: Option<i64>,
    role: String,
}

#[derive(Debug, sqlx::FromRow)]
struct InvTxHistoryRow {
    date: String,
    instrument_id: String,
    quantity: f64,
    tx_type: String,
}

async fn account_balance_history(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Query(query): Query<BalanceHistoryQuery>,
) -> Result<Json<Value>> {
    let account = fetch_active_account(&state.db, &id, &user.id).await?;
    let days = query.days.unwrap_or(30).clamp(1, 365);

    let today = Utc::now().date_naive();
    let window_start = today - Duration::days(days as i64 - 1);

    let tx_rows: Vec<BalanceTxRow> = sqlx::query_as(
        "SELECT
            t.date,
            t.type        AS tx_type,
            t.amount_paise,
            t.fx_to_amount_paise,
            CASE WHEN t.account_id = ? THEN 'primary' ELSE 'dest' END AS role
         FROM transactions t
         WHERE t.deleted_at IS NULL
           AND t.user_id = ?
           AND (t.account_id = ? OR t.transfer_account_id = ?)
         ORDER BY t.date ASC, t.created_at ASC",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&id)
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    let mut running_balance = account.opening_balance_paise;
    let mut daily_end: BTreeMap<String, i64> = BTreeMap::new();

    for row in &tx_rows {
        let delta = balance_tx_delta(row, &account.account_type, running_balance);
        running_balance += delta;
        daily_end.insert(row.date.clone(), running_balance);
    }

    // Anchor the entire curve to the current known balance (balance_paise).
    // Without this, histories go negative when opening_balance was set at account-creation
    // time but historical transactions have since been imported further back in time.
    // We shift every computed point uniformly so the curve's endpoint equals balance_paise.
    let anchor_offset = account.balance_paise - running_balance;
    if anchor_offset != 0 {
        for v in daily_end.values_mut() {
            *v += anchor_offset;
        }
    }
    let synthetic_opening = account.opening_balance_paise + anchor_offset;

    let window_start_str = window_start.format("%Y-%m-%d").to_string();
    let seed = daily_end
        .range(..window_start_str)
        .last()
        .map(|(_, &b)| b)
        .unwrap_or(synthetic_opening);

    let mut prev = seed;
    let mut series: Vec<Value> = Vec::with_capacity(days as usize);
    for i in 0..days {
        let date = window_start + Duration::days(i as i64);
        let date_str = date.format("%Y-%m-%d").to_string();
        let balance = daily_end.get(&date_str).copied().unwrap_or(prev);
        prev = balance;
        series.push(json!({ "date": date_str, "balance_paise": balance }));
    }

    // For investment accounts, augment each point with cash/holdings/total breakdown
    if is_investment_account(&account.account_type) {
        let holdings = compute_holdings(&state.db, &user.id, Some(&id)).await?;

        // Build current price map per instrument (latest snapshot, fallback to avg buy price)
        let price_map: BTreeMap<String, i64> = holdings
            .iter()
            .map(|h| {
                let price = h.latest_price_paise.unwrap_or_else(|| {
                    if h.quantity_held > 0.0 {
                        (h.invested_value_paise as f64 / h.quantity_held).round() as i64
                    } else {
                        0
                    }
                });
                (h.instrument_id.clone(), price)
            })
            .collect();

        // Fetch all investment buy/sell transactions for this account (all time)
        let inv_txs: Vec<InvTxHistoryRow> = sqlx::query_as(
            "SELECT t.date, itd.instrument_id, itd.quantity, t.type AS tx_type
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             WHERE t.user_id = ? AND t.account_id = ? AND t.deleted_at IS NULL
               AND t.type IN ('investment_buy', 'investment_sell')
             ORDER BY t.date ASC, t.created_at ASC",
        )
        .bind(&user.id)
        .bind(&id)
        .fetch_all(&state.db)
        .await?;

        // Build cumulative holdings value timeline: date -> total holdings value at end of that date
        let mut running_qty: BTreeMap<String, f64> = BTreeMap::new();
        let mut daily_holdings_end: BTreeMap<String, i64> = BTreeMap::new();
        for tx in &inv_txs {
            let delta = if tx.tx_type == "investment_buy" {
                tx.quantity
            } else {
                -tx.quantity
            };
            *running_qty.entry(tx.instrument_id.clone()).or_insert(0.0) += delta;
            let total: i64 = running_qty
                .iter()
                .map(|(iid, &qty)| {
                    let price = price_map.get(iid).copied().unwrap_or(0);
                    (qty.max(0.0) * price as f64).round() as i64
                })
                .sum();
            daily_holdings_end.insert(tx.date.clone(), total);
        }

        // Seed: last known holdings value before window start
        let inv_window_start_str = window_start.format("%Y-%m-%d").to_string();
        let seed_holdings = daily_holdings_end
            .range(..inv_window_start_str)
            .last()
            .map(|(_, &v)| v)
            .unwrap_or(0);

        let mut prev_h = seed_holdings;
        for point in &mut series {
            let date_str = point["date"].as_str().unwrap_or("").to_string();
            let h = daily_holdings_end
                .get(&date_str)
                .copied()
                .unwrap_or(prev_h);
            prev_h = h;
            let cash = point["balance_paise"].as_i64().unwrap_or(0);
            point["cash_paise"] = json!(cash);
            point["holdings_paise"] = json!(h);
            point["total_paise"] = json!(cash + h);
        }
    }

    Ok(Json(json!({ "balance_history": series })))
}

fn balance_tx_delta(row: &BalanceTxRow, account_type: &str, current_balance: i64) -> i64 {
    if row.role == "primary" {
        match row.tx_type.as_str() {
            "income" | "dividend" | "investment_sell" => row.amount_paise,
            "expense" => {
                if account_type == "credit_card" {
                    row.amount_paise
                } else {
                    -row.amount_paise
                }
            }
            "transfer" | "investment_buy" | "credit_card_payment" | "loan_repayment" => {
                -row.amount_paise
            }
            "valuation_update" => row.amount_paise - current_balance,
            _ => 0,
        }
    } else {
        match row.tx_type.as_str() {
            "transfer" => row.fx_to_amount_paise.unwrap_or(row.amount_paise),
            "credit_card_payment" | "loan_repayment" => -row.amount_paise,
            _ => 0,
        }
    }
}

async fn list_accounts(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Value>> {
    let accounts = fetch_active_accounts_with_latest_inr(&state.db, &user.id).await?;
    Ok(Json(json!(build_accounts_response(accounts))))
}

async fn account_summary(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Value>> {
    let accounts = fetch_active_accounts_with_latest_inr(&state.db, &user.id).await?;
    Ok(Json(json!({ "summary": summarize_accounts(&accounts) })))
}

async fn create_account(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateAccountRequest>,
) -> Result<(StatusCode, Json<Value>)> {
    let input = ValidatedAccountInput::from_create(req)?;
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "INSERT INTO accounts (
            id, user_id, name, type, currency, opening_balance_paise, opening_date,
            balance_paise, inr_value_paise, color_hex, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&input.name)
    .bind(&input.account_type)
    .bind(&input.currency)
    .bind(input.opening_balance_paise)
    .bind(&input.opening_date)
    .bind(input.balance_paise)
    .bind(input.inr_value_paise)
    .bind(&input.color_hex)
    .bind(&input.notes)
    .execute(&mut *tx)
    .await?;

    let account = fetch_active_account_in_tx(&mut tx, &id, &user.id).await?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "create",
        "account",
        &id,
        json!({ "after": AccountView::from(account.clone()) }),
    )
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "account": AccountView::from(account) })),
    ))
}

async fn update_account(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateAccountRequest>,
) -> Result<Json<Value>> {
    let before = fetch_active_account(&state.db, &id, &user.id).await?;
    let input = ValidatedAccountInput::from_update(req, &before)?;
    let mut tx = state.db.begin().await?;
    let blocked_paise = fetch_active_goal_blocked_total_in_tx(&mut tx, &user.id, &id).await?;
    let active_goal_count = fetch_active_goal_count_in_tx(&mut tx, &user.id, &id).await?;

    if input.balance_paise < blocked_paise {
        return Err(AppError::BadRequest(
            "Account balance cannot be set below funds blocked for goals".into(),
        ));
    }
    if active_goal_count > 0 && !matches!(input.account_type.as_str(), "savings" | "current") {
        return Err(AppError::BadRequest(
            "Accounts funding active goals must remain savings or current accounts".into(),
        ));
    }

    sqlx::query(
        "UPDATE accounts
         SET name = ?,
             type = ?,
             currency = ?,
             opening_balance_paise = ?,
             opening_date = ?,
             balance_paise = ?,
             inr_value_paise = ?,
             color_hex = ?,
             notes = ?,
             last_updated = strftime('%Y-%m-%d %H:%M:%S', 'now'),
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(&input.name)
    .bind(&input.account_type)
    .bind(&input.currency)
    .bind(input.opening_balance_paise)
    .bind(&input.opening_date)
    .bind(input.balance_paise)
    .bind(input.inr_value_paise)
    .bind(&input.color_hex)
    .bind(&input.notes)
    .bind(&id)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let after = fetch_active_account_in_tx(&mut tx, &id, &user.id).await?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "update",
        "account",
        &id,
        json!({
            "before": AccountView::from(before),
            "after": AccountView::from(after.clone()),
        }),
    )
    .await?;

    tx.commit().await?;

    Ok(Json(json!({ "account": AccountView::from(after) })))
}

async fn archive_account(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let before = fetch_active_account(&state.db, &id, &user.id).await?;
    let mut tx = state.db.begin().await?;
    let active_goal_count = fetch_active_goal_count_in_tx(&mut tx, &user.id, &id).await?;
    if active_goal_count > 0 {
        return Err(AppError::BadRequest(
            "Reassign or complete active goals before archiving this account".into(),
        ));
    }

    sqlx::query(
        "UPDATE accounts
         SET is_active = 0,
             archived_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(&id)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    insert_audit_log(
        &mut tx,
        &user.id,
        "archive",
        "account",
        &id,
        json!({
            "before": AccountView::from(before),
            "after": { "is_active": false },
        }),
    )
    .await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug)]
struct ValidatedAccountInput {
    name: String,
    account_type: String,
    currency: String,
    opening_balance_paise: i64,
    opening_date: String,
    balance_paise: i64,
    inr_value_paise: i64,
    color_hex: String,
    notes: Option<String>,
}

impl ValidatedAccountInput {
    fn from_create(req: CreateAccountRequest) -> Result<Self> {
        let currency = validate_currency(req.currency)?;
        let opening_balance_paise = validate_amount(req.opening_balance_paise, "opening balance")?;
        let inr_value_paise =
            validate_initial_inr_value(req.inr_value_paise, &currency, opening_balance_paise)?;

        Ok(ValidatedAccountInput {
            name: validate_name(req.name)?,
            account_type: validate_account_type(req.account_type)?,
            currency,
            opening_balance_paise,
            opening_date: validate_opening_date(req.opening_date)?,
            balance_paise: opening_balance_paise,
            inr_value_paise,
            color_hex: validate_color(req.color_hex)?,
            notes: normalize_notes(req.notes)?,
        })
    }

    fn from_update(req: UpdateAccountRequest, current: &Account) -> Result<Self> {
        Ok(ValidatedAccountInput {
            name: match req.name {
                Some(name) => validate_name(name)?,
                None => current.name.clone(),
            },
            account_type: match req.account_type {
                Some(account_type) => validate_account_type(account_type)?,
                None => current.account_type.clone(),
            },
            currency: match req.currency {
                Some(currency) => validate_currency(currency)?,
                None => current.currency.clone(),
            },
            opening_balance_paise: match req.opening_balance_paise {
                Some(amount) => validate_amount(amount, "opening balance")?,
                None => current.opening_balance_paise,
            },
            opening_date: match req.opening_date {
                Some(date) => validate_opening_date(date)?,
                None => current.opening_date.clone(),
            },
            balance_paise: match req.balance_paise {
                Some(amount) => validate_amount(amount, "balance")?,
                None => current.balance_paise,
            },
            inr_value_paise: match req.inr_value_paise {
                Some(amount) => validate_amount(amount, "INR value")?,
                None => current.inr_value_paise,
            },
            color_hex: match req.color_hex {
                Some(color) => validate_color(color)?,
                None => current.color_hex.clone(),
            },
            notes: match req.notes {
                Some(notes) => normalize_notes(notes)?,
                None => current.notes.clone(),
            },
        })
    }
}

fn validate_name(name: String) -> Result<String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("Account name is required".into()));
    }
    if name.len() > 100 {
        return Err(AppError::BadRequest(
            "Account name must be 100 characters or fewer".into(),
        ));
    }
    Ok(name)
}

fn validate_account_type(account_type: String) -> Result<String> {
    let account_type = account_type.trim().to_ascii_lowercase();
    if is_valid_account_type(&account_type) {
        return Ok(account_type);
    }

    Err(AppError::BadRequest(format!(
        "Account type must be one of: {}",
        ACCOUNT_TYPES.join(", ")
    )))
}

fn validate_currency(currency: String) -> Result<String> {
    normalize_currency(&currency)
        .ok_or_else(|| AppError::BadRequest("Currency must be a 3-letter ISO 4217 code".into()))
}

fn validate_opening_date(opening_date: String) -> Result<String> {
    let opening_date = opening_date.trim().to_string();
    if validate_date(&opening_date) {
        return Ok(opening_date);
    }

    Err(AppError::BadRequest(
        "Opening date must use YYYY-MM-DD format".into(),
    ))
}

fn validate_amount(amount: i64, label: &str) -> Result<i64> {
    if amount < 0 {
        return Err(AppError::BadRequest(format!("{label} cannot be negative")));
    }
    Ok(amount)
}

fn validate_initial_inr_value(
    amount: Option<i64>,
    currency: &str,
    opening_balance_paise: i64,
) -> Result<i64> {
    if currency == "INR" {
        return Ok(opening_balance_paise);
    }

    match amount {
        Some(amount) => validate_amount(amount, "INR value"),
        None => Err(AppError::BadRequest(
            "INR value is required for non-INR accounts".into(),
        )),
    }
}

fn validate_color(color_hex: String) -> Result<String> {
    let color_hex = color_hex.trim().to_string();
    if validate_color_hex(&color_hex) {
        return Ok(color_hex);
    }

    Err(AppError::BadRequest(
        "Color must be a hex value like #3A7FFF".into(),
    ))
}

fn normalize_notes(notes: Option<String>) -> Result<Option<String>> {
    let Some(notes) = notes else {
        return Ok(None);
    };

    let notes = notes.trim().to_string();
    if notes.len() > 2_000 {
        return Err(AppError::BadRequest(
            "Notes must be 2000 characters or fewer".into(),
        ));
    }
    if notes.is_empty() {
        Ok(None)
    } else {
        Ok(Some(notes))
    }
}

async fn fetch_active_accounts(pool: &SqlitePool, user_id: &str) -> Result<Vec<Account>> {
    let accounts = sqlx::query_as::<_, Account>(
        "SELECT id,
                user_id,
                name,
                type AS account_type,
                currency,
                opening_balance_paise,
                opening_date,
                balance_paise,
                inr_value_paise,
                color_hex,
                is_active,
                archived_at,
                last_updated,
                notes,
                created_at,
                updated_at
         FROM accounts
         WHERE user_id = ? AND is_active = 1",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(accounts)
}

async fn fetch_active_accounts_with_latest_inr(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<Account>> {
    let mut accounts = fetch_active_accounts(pool, user_id).await?;
    let fx_rates = FxRateMap::latest_for_user(pool, user_id).await?;
    let holdings = compute_holdings(pool, user_id, None).await?;

    for account in &mut accounts {
        let cash_balance_paise = account.balance_paise;
        let cash_inr_value_paise = fx_rates
            .convert_to_inr_paise(&account.currency, cash_balance_paise)
            .unwrap_or(account.inr_value_paise);

        account.inr_value_paise = cash_inr_value_paise;

        if is_investment_account(&account.account_type) {
            let mut holdings_value_paise = 0;
            let mut holdings_inr_value_paise = 0;

            for holding in holdings.iter().filter(|h| h.account_id == account.id) {
                if let Some(value) =
                    convert_holding_to_account_currency(&fx_rates, holding, &account.currency)
                {
                    holdings_value_paise += value;
                }
                if let Some(value) = holding
                    .current_value_inr_paise
                    .or(holding.invested_value_inr_paise)
                {
                    holdings_inr_value_paise += value;
                }
            }

            account.balance_paise = cash_balance_paise + holdings_value_paise;
            account.inr_value_paise = cash_inr_value_paise + holdings_inr_value_paise;
        }
    }

    Ok(accounts)
}

fn is_investment_account(account_type: &str) -> bool {
    matches!(account_type, "demat" | "mutual_fund")
}

fn convert_holding_to_account_currency(
    fx_rates: &FxRateMap,
    holding: &HoldingView,
    account_currency: &str,
) -> Option<i64> {
    let value = holding
        .current_value_paise
        .unwrap_or(holding.invested_value_paise);
    fx_rates
        .rate_between(&holding.instrument_currency, account_currency)
        .map(|rate| (value as f64 * rate).round() as i64)
}

async fn fetch_active_account(pool: &SqlitePool, id: &str, user_id: &str) -> Result<Account> {
    sqlx::query_as::<_, Account>(
        "SELECT id,
                user_id,
                name,
                type AS account_type,
                currency,
                opening_balance_paise,
                opening_date,
                balance_paise,
                inr_value_paise,
                color_hex,
                is_active,
                archived_at,
                last_updated,
                notes,
                created_at,
                updated_at
         FROM accounts
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Account not found".into()))
}

async fn fetch_active_account_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    user_id: &str,
) -> Result<Account> {
    sqlx::query_as::<_, Account>(
        "SELECT id,
                user_id,
                name,
                type AS account_type,
                currency,
                opening_balance_paise,
                opening_date,
                balance_paise,
                inr_value_paise,
                color_hex,
                is_active,
                archived_at,
                last_updated,
                notes,
                created_at,
                updated_at
         FROM accounts
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Account not found".into()))
}

async fn fetch_active_goal_blocked_total_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    user_id: &str,
    account_id: &str,
) -> Result<i64> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT COALESCE(SUM(current_blocked_paise), 0)
         FROM goals
         WHERE user_id = ? AND source_account_id = ? AND status = 'active'",
    )
    .bind(user_id)
    .bind(account_id)
    .fetch_one(&mut **tx)
    .await?)
}

async fn fetch_active_goal_count_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    user_id: &str,
    account_id: &str,
) -> Result<i64> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*)
         FROM goals
         WHERE user_id = ? AND source_account_id = ? AND status = 'active'",
    )
    .bind(user_id)
    .bind(account_id)
    .fetch_one(&mut **tx)
    .await?)
}
