use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
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
        .route("/:id", patch(update_account).delete(archive_account))
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
