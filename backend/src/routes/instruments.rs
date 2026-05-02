use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::{
        audit::insert_audit_log,
        instrument::{
            CorporateAction, CreateCorporateActionRequest, CreateInstrumentRequest,
            CreatePriceSnapshotRequest, Instrument, PriceSnapshot, UpdateInstrumentRequest,
            INSTRUMENT_TYPES,
        },
    },
    state::AppState,
};

// ---------------------------------------------------------------------------
// Routers
// ---------------------------------------------------------------------------

pub fn instruments_router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_instruments).post(create_instrument))
        .route(
            "/:id",
            get(get_instrument)
                .patch(update_instrument)
                .delete(archive_instrument),
        )
        .route(
            "/:id/prices",
            get(list_price_snapshots).post(create_price_snapshot),
        )
        .route(
            "/:id/prices/:pid",
            axum::routing::delete(delete_price_snapshot),
        )
}

pub fn corporate_actions_router() -> Router<AppState> {
    Router::new()
        .route(
            "/",
            get(list_corporate_actions).post(create_corporate_action),
        )
        .route("/:id", axum::routing::delete(delete_corporate_action))
}

// ---------------------------------------------------------------------------
// Instrument handlers
// ---------------------------------------------------------------------------

/// GET /api/v1/instruments
async fn list_instruments(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Value>> {
    let instruments = fetch_active_instruments(&state.db, &user.id).await?;
    Ok(Json(json!({ "instruments": instruments })))
}

/// GET /api/v1/instruments/:id
async fn get_instrument(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let instrument = fetch_instrument(&state.db, &id, &user.id).await?;
    let latest_price = fetch_latest_price(&state.db, &id, &user.id).await?;
    Ok(Json(json!({
        "instrument": {
            "id": instrument.id,
            "name": instrument.name,
            "ticker": instrument.ticker,
            "type": instrument.instrument_type,
            "currency": instrument.currency,
            "sector": instrument.sector,
            "geography": instrument.geography,
            "notes": instrument.notes,
            "is_active": instrument.is_active,
            "created_at": instrument.created_at,
            "updated_at": instrument.updated_at,
            "latest_price": latest_price,
        }
    })))
}

/// POST /api/v1/instruments
async fn create_instrument(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateInstrumentRequest>,
) -> Result<(StatusCode, Json<Value>)> {
    let name = validate_instrument_name(req.name)?;
    let instrument_type = validate_instrument_type(req.instrument_type)?;
    let ticker = validate_optional_ticker(req.ticker)?;
    let currency = validate_currency_code(req.currency.unwrap_or_else(|| "INR".into()))?;
    let sector = validate_optional_short_text(req.sector, "sector")?;
    let geography = validate_optional_short_text(req.geography, "geography")?;
    let notes = normalize_notes(req.notes)?;

    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "INSERT INTO instruments
             (id, user_id, name, ticker, type, currency, sector, geography, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&name)
    .bind(&ticker)
    .bind(&instrument_type)
    .bind(&currency)
    .bind(&sector)
    .bind(&geography)
    .bind(&notes)
    .execute(&mut *tx)
    .await?;

    let created = fetch_instrument_in_tx(&mut tx, &id, &user.id).await?;

    insert_audit_log(
        &mut tx,
        &user.id,
        "create",
        "instrument",
        &id,
        json!({ "after": created }),
    )
    .await?;

    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(json!({ "instrument": created }))))
}

/// PATCH /api/v1/instruments/:id
async fn update_instrument(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateInstrumentRequest>,
) -> Result<Json<Value>> {
    let before = fetch_instrument(&state.db, &id, &user.id).await?;

    let name = match req.name {
        Some(n) => validate_instrument_name(n)?,
        None => before.name.clone(),
    };
    let instrument_type = match req.instrument_type {
        Some(t) => validate_instrument_type(t)?,
        None => before.instrument_type.clone(),
    };
    let ticker: Option<String> = match req.ticker {
        Some(Some(t)) => Some(validate_optional_ticker(Some(t))?.unwrap()),
        Some(None) => None,
        None => before.ticker.clone(),
    };
    let currency = match req.currency {
        Some(c) => validate_currency_code(c)?,
        None => before.currency.clone(),
    };
    let sector: Option<String> = match req.sector {
        Some(Some(s)) => validate_optional_short_text(Some(s), "sector")?,
        Some(None) => None,
        None => before.sector.clone(),
    };
    let geography: Option<String> = match req.geography {
        Some(Some(g)) => validate_optional_short_text(Some(g), "geography")?,
        Some(None) => None,
        None => before.geography.clone(),
    };
    let notes: Option<String> = match req.notes {
        Some(Some(n)) => normalize_notes(Some(n))?,
        Some(None) => None,
        None => before.notes.clone(),
    };

    let mut tx = state.db.begin().await?;

    sqlx::query(
        "UPDATE instruments
         SET name = ?, type = ?, ticker = ?, currency = ?,
             sector = ?, geography = ?, notes = ?,
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(&name)
    .bind(&instrument_type)
    .bind(&ticker)
    .bind(&currency)
    .bind(&sector)
    .bind(&geography)
    .bind(&notes)
    .bind(&id)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let after = fetch_instrument_in_tx(&mut tx, &id, &user.id).await?;

    insert_audit_log(
        &mut tx,
        &user.id,
        "update",
        "instrument",
        &id,
        json!({ "before": before, "after": after }),
    )
    .await?;

    tx.commit().await?;

    Ok(Json(json!({ "instrument": after })))
}

/// DELETE /api/v1/instruments/:id  (soft delete: is_active = 0)
async fn archive_instrument(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let before = fetch_instrument(&state.db, &id, &user.id).await?;
    ensure_instrument_has_no_active_holdings(&state.db, &user.id, &id).await?;
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "UPDATE instruments
         SET is_active = 0, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
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
        "instrument",
        &id,
        json!({ "before": before, "after": { "is_active": false } }),
    )
    .await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn ensure_instrument_has_no_active_holdings(
    pool: &SqlitePool,
    user_id: &str,
    instrument_id: &str,
) -> Result<()> {
    #[derive(sqlx::FromRow)]
    struct CountRow {
        count: i64,
    }

    let row = sqlx::query_as::<_, CountRow>(
        "WITH txn_positions AS (
            SELECT t.account_id AS account_id,
                   SUM(CASE
                           WHEN t.type = 'investment_buy' THEN itd.quantity
                           WHEN t.type = 'investment_sell' THEN -itd.quantity
                           ELSE 0
                       END) AS quantity
            FROM investment_transaction_details itd
            JOIN transactions t
              ON t.id = itd.transaction_id
             AND t.user_id = itd.user_id
            WHERE itd.user_id = ?
              AND itd.instrument_id = ?
              AND t.deleted_at IS NULL
              AND t.type IN ('investment_buy', 'investment_sell')
            GROUP BY t.account_id
        ),
        ca_positions AS (
            SELECT account_id, SUM(quantity_delta) AS quantity
            FROM corporate_actions
            WHERE user_id = ? AND instrument_id = ?
            GROUP BY account_id
        ),
        combined AS (
            SELECT account_id, quantity FROM txn_positions
            UNION ALL
            SELECT account_id, quantity FROM ca_positions
        )
        SELECT COUNT(*) AS count
        FROM (
            SELECT account_id, SUM(quantity) AS quantity_held
            FROM combined
            GROUP BY account_id
            HAVING quantity_held > 0.0001
        ) active_holdings",
    )
    .bind(user_id)
    .bind(instrument_id)
    .bind(user_id)
    .bind(instrument_id)
    .fetch_one(pool)
    .await?;

    if row.count > 0 {
        return Err(AppError::BadRequest(
            "Instrument has active holdings and cannot be archived".into(),
        ));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Price snapshot handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PriceListQuery {
    // Reserved for future cursor pagination; unused for now.
    #[allow(dead_code)]
    cursor: Option<String>,
}

/// GET /api/v1/instruments/:id/prices
async fn list_price_snapshots(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Query(_q): Query<PriceListQuery>,
) -> Result<Json<Value>> {
    // Verify instrument exists and belongs to user
    fetch_instrument(&state.db, &id, &user.id).await?;

    let prices = sqlx::query_as::<_, PriceSnapshot>(
        "SELECT id, user_id, instrument_id, price_paise, date, notes, created_at
         FROM price_snapshots
         WHERE user_id = ? AND instrument_id = ?
         ORDER BY date DESC, created_at DESC",
    )
    .bind(&user.id)
    .bind(&id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "prices": prices })))
}

/// POST /api/v1/instruments/:id/prices
async fn create_price_snapshot(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(req): Json<CreatePriceSnapshotRequest>,
) -> Result<(StatusCode, Json<Value>)> {
    // Verify instrument exists and belongs to user
    fetch_instrument(&state.db, &id, &user.id).await?;

    if req.price_paise < 0 {
        return Err(AppError::BadRequest("price_paise must be >= 0".into()));
    }
    validate_date_format(&req.date)?;

    let notes = normalize_notes(req.notes)?;
    let pid = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "INSERT INTO price_snapshots (id, user_id, instrument_id, price_paise, date, notes)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&pid)
    .bind(&user.id)
    .bind(&id)
    .bind(req.price_paise)
    .bind(&req.date)
    .bind(&notes)
    .execute(&mut *tx)
    .await?;

    let created = sqlx::query_as::<_, PriceSnapshot>(
        "SELECT id, user_id, instrument_id, price_paise, date, notes, created_at
         FROM price_snapshots WHERE id = ?",
    )
    .bind(&pid)
    .fetch_one(&mut *tx)
    .await?;

    insert_audit_log(
        &mut tx,
        &user.id,
        "create",
        "price_snapshot",
        &pid,
        json!({ "after": created }),
    )
    .await?;

    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(json!({ "price": created }))))
}

/// DELETE /api/v1/instruments/:id/prices/:pid
async fn delete_price_snapshot(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path((id, pid)): Path<(String, String)>,
) -> Result<StatusCode> {
    // Verify instrument belongs to user
    fetch_instrument(&state.db, &id, &user.id).await?;

    let existing = sqlx::query_as::<_, PriceSnapshot>(
        "SELECT id, user_id, instrument_id, price_paise, date, notes, created_at
         FROM price_snapshots WHERE id = ? AND user_id = ? AND instrument_id = ?",
    )
    .bind(&pid)
    .bind(&user.id)
    .bind(&id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Price snapshot not found".into()))?;

    let mut tx = state.db.begin().await?;

    sqlx::query("DELETE FROM price_snapshots WHERE id = ? AND user_id = ? AND instrument_id = ?")
        .bind(&pid)
        .bind(&user.id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    insert_audit_log(
        &mut tx,
        &user.id,
        "delete",
        "price_snapshot",
        &pid,
        json!({ "before": existing }),
    )
    .await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Corporate action handlers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CorporateActionListQuery {
    instrument_id: Option<String>,
}

const CORPORATE_ACTION_TYPES: &[&str] = &["split", "bonus", "dividend_reinvested"];

/// GET /api/v1/investments/corporate-actions
async fn list_corporate_actions(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(q): Query<CorporateActionListQuery>,
) -> Result<Json<Value>> {
    let actions: Vec<CorporateAction> = match &q.instrument_id {
        Some(iid) => {
            sqlx::query_as::<_, CorporateAction>(
                "SELECT id, user_id, instrument_id, account_id,
                    type AS action_type, date, quantity_delta,
                    split_ratio, price_per_unit_paise, notes, created_at
             FROM corporate_actions
             WHERE user_id = ? AND instrument_id = ?
             ORDER BY date DESC, created_at DESC",
            )
            .bind(&user.id)
            .bind(iid)
            .fetch_all(&state.db)
            .await?
        }

        None => {
            sqlx::query_as::<_, CorporateAction>(
                "SELECT id, user_id, instrument_id, account_id,
                    type AS action_type, date, quantity_delta,
                    split_ratio, price_per_unit_paise, notes, created_at
             FROM corporate_actions
             WHERE user_id = ?
             ORDER BY date DESC, created_at DESC",
            )
            .bind(&user.id)
            .fetch_all(&state.db)
            .await?
        }
    };

    Ok(Json(json!({ "corporate_actions": actions })))
}

/// POST /api/v1/investments/corporate-actions
async fn create_corporate_action(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateCorporateActionRequest>,
) -> Result<(StatusCode, Json<Value>)> {
    // Validate instrument ownership
    fetch_instrument(&state.db, &req.instrument_id, &user.id).await?;

    // Validate account ownership
    let account_exists = sqlx::query_scalar::<_, String>(
        "SELECT id FROM accounts WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(&req.account_id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await?;

    if account_exists.is_none() {
        return Err(AppError::NotFound("Account not found".into()));
    }

    // Validate action type
    let action_type = req.action_type.trim().to_ascii_lowercase();
    if !CORPORATE_ACTION_TYPES.contains(&action_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "type must be one of: {}",
            CORPORATE_ACTION_TYPES.join(", ")
        )));
    }

    validate_date_format(&req.date)?;

    if req.quantity_delta == 0.0 {
        return Err(AppError::BadRequest(
            "quantity_delta must be non-zero".into(),
        ));
    }

    // price_per_unit_paise required for dividend_reinvested
    if action_type == "dividend_reinvested" {
        match req.price_per_unit_paise {
            None => {
                return Err(AppError::BadRequest(
                    "price_per_unit_paise is required for dividend_reinvested".into(),
                ))
            }
            Some(p) if p < 0 => {
                return Err(AppError::BadRequest(
                    "price_per_unit_paise must be >= 0".into(),
                ))
            }
            _ => {}
        }
    }

    let notes = normalize_notes(req.notes)?;
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "INSERT INTO corporate_actions
             (id, user_id, instrument_id, account_id, type, date,
              quantity_delta, split_ratio, price_per_unit_paise, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&req.instrument_id)
    .bind(&req.account_id)
    .bind(&action_type)
    .bind(&req.date)
    .bind(req.quantity_delta)
    .bind(&req.split_ratio)
    .bind(req.price_per_unit_paise)
    .bind(&notes)
    .execute(&mut *tx)
    .await?;

    let created = sqlx::query_as::<_, CorporateAction>(
        "SELECT id, user_id, instrument_id, account_id,
                type AS action_type, date, quantity_delta,
                split_ratio, price_per_unit_paise, notes, created_at
         FROM corporate_actions WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    insert_audit_log(
        &mut tx,
        &user.id,
        "create",
        "corporate_action",
        &id,
        json!({ "after": created }),
    )
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "corporate_action": created })),
    ))
}

/// DELETE /api/v1/investments/corporate-actions/:id
async fn delete_corporate_action(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let existing = sqlx::query_as::<_, CorporateAction>(
        "SELECT id, user_id, instrument_id, account_id,
                type AS action_type, date, quantity_delta,
                split_ratio, price_per_unit_paise, notes, created_at
         FROM corporate_actions WHERE id = ? AND user_id = ?",
    )
    .bind(&id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Corporate action not found".into()))?;

    let mut tx = state.db.begin().await?;

    sqlx::query("DELETE FROM corporate_actions WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

    insert_audit_log(
        &mut tx,
        &user.id,
        "delete",
        "corporate_action",
        &id,
        json!({ "before": existing }),
    )
    .await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async fn fetch_active_instruments(pool: &SqlitePool, user_id: &str) -> Result<Vec<Instrument>> {
    let instruments = sqlx::query_as::<_, Instrument>(
        "SELECT id, user_id, name, ticker,
                type AS instrument_type,
                currency, sector, geography, notes,
                is_active, created_at, updated_at
         FROM instruments
         WHERE user_id = ? AND is_active = 1
         ORDER BY name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(instruments)
}

async fn fetch_instrument(pool: &SqlitePool, id: &str, user_id: &str) -> Result<Instrument> {
    sqlx::query_as::<_, Instrument>(
        "SELECT id, user_id, name, ticker,
                type AS instrument_type,
                currency, sector, geography, notes,
                is_active, created_at, updated_at
         FROM instruments
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Instrument not found".into()))
}

async fn fetch_instrument_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    user_id: &str,
) -> Result<Instrument> {
    sqlx::query_as::<_, Instrument>(
        "SELECT id, user_id, name, ticker,
                type AS instrument_type,
                currency, sector, geography, notes,
                is_active, created_at, updated_at
         FROM instruments
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Instrument not found".into()))
}

async fn fetch_latest_price(
    pool: &SqlitePool,
    instrument_id: &str,
    user_id: &str,
) -> Result<Option<PriceSnapshot>> {
    let price = sqlx::query_as::<_, PriceSnapshot>(
        "SELECT id, user_id, instrument_id, price_paise, date, notes, created_at
         FROM price_snapshots
         WHERE user_id = ? AND instrument_id = ?
         ORDER BY date DESC, created_at DESC
         LIMIT 1",
    )
    .bind(user_id)
    .bind(instrument_id)
    .fetch_optional(pool)
    .await?;

    Ok(price)
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

fn validate_instrument_name(name: String) -> Result<String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("Instrument name is required".into()));
    }
    if name.len() > 200 {
        return Err(AppError::BadRequest(
            "Instrument name must be 200 characters or fewer".into(),
        ));
    }
    Ok(name)
}

fn validate_instrument_type(t: String) -> Result<String> {
    let t = t.trim().to_ascii_lowercase();
    if crate::models::instrument::is_valid_instrument_type(&t) {
        return Ok(t);
    }
    Err(AppError::BadRequest(format!(
        "type must be one of: {}",
        INSTRUMENT_TYPES.join(", ")
    )))
}

fn validate_optional_ticker(ticker: Option<String>) -> Result<Option<String>> {
    let Some(t) = ticker else { return Ok(None) };
    let t = t.trim().to_uppercase();
    if t.is_empty() {
        return Ok(None);
    }
    if t.len() > 20 {
        return Err(AppError::BadRequest(
            "Ticker must be 20 characters or fewer".into(),
        ));
    }
    Ok(Some(t))
}

fn validate_currency_code(raw: String) -> Result<String> {
    let code = raw.trim().to_uppercase();
    if code.len() < 2 || code.len() > 10 {
        return Err(AppError::BadRequest(
            "Currency must be a 2–10 character code".into(),
        ));
    }
    if !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::BadRequest("Currency must be alphanumeric".into()));
    }
    Ok(code)
}

fn validate_optional_short_text(val: Option<String>, field: &str) -> Result<Option<String>> {
    let Some(v) = val else { return Ok(None) };
    let v = v.trim().to_string();
    if v.is_empty() {
        return Ok(None);
    }
    if v.len() > 100 {
        return Err(AppError::BadRequest(format!(
            "{field} must be 100 characters or fewer"
        )));
    }
    Ok(Some(v))
}

fn validate_date_format(date: &str) -> Result<()> {
    let date = date.trim();
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3
        || parts[0].len() != 4
        || parts[1].len() != 2
        || parts[2].len() != 2
        || parts.iter().any(|p| p.chars().any(|c| !c.is_ascii_digit()))
    {
        return Err(AppError::BadRequest(
            "date must be in YYYY-MM-DD format".into(),
        ));
    }
    Ok(())
}

fn normalize_notes(notes: Option<String>) -> Result<Option<String>> {
    let Some(n) = notes else { return Ok(None) };
    let n = n.trim().to_string();
    if n.len() > 2000 {
        return Err(AppError::BadRequest(
            "Notes must be 2000 characters or fewer".into(),
        ));
    }
    Ok(if n.is_empty() { None } else { Some(n) })
}
