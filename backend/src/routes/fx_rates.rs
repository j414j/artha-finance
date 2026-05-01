use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::{
        audit::insert_audit_log,
        fx_rate::{CreateFxRateRequest, FxRate, LatestFxRate},
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_fx_rates).post(create_fx_rate))
        .route("/latest", get(latest_fx_rates))
        .route("/:id", axum::routing::delete(delete_fx_rate))
}

#[derive(Deserialize)]
struct FxRateListQuery {
    from_currency: Option<String>,
    to_currency: Option<String>,
}

/// GET /api/v1/fx-rates?from_currency=USD&to_currency=INR
async fn list_fx_rates(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<FxRateListQuery>,
) -> Result<Json<Value>> {
    // Build dynamic filter — sqlx doesn't support dynamic WHERE easily so we use four
    // separate queries for the four filter combinations.
    let from = query
        .from_currency
        .as_deref()
        .map(|s| s.trim().to_uppercase());
    let to = query
        .to_currency
        .as_deref()
        .map(|s| s.trim().to_uppercase());

    let fx_rates: Vec<FxRate> = match (&from, &to) {
        (Some(f), Some(t)) => {
            sqlx::query_as::<_, FxRate>(
                "SELECT id, user_id, from_currency, to_currency, rate, date, notes, created_at
             FROM fx_rates
             WHERE user_id = ? AND from_currency = ? AND to_currency = ?
             ORDER BY date DESC, created_at DESC",
            )
            .bind(&user.id)
            .bind(f)
            .bind(t)
            .fetch_all(&state.db)
            .await?
        }

        (Some(f), None) => {
            sqlx::query_as::<_, FxRate>(
                "SELECT id, user_id, from_currency, to_currency, rate, date, notes, created_at
             FROM fx_rates
             WHERE user_id = ? AND from_currency = ?
             ORDER BY date DESC, created_at DESC",
            )
            .bind(&user.id)
            .bind(f)
            .fetch_all(&state.db)
            .await?
        }

        (None, Some(t)) => {
            sqlx::query_as::<_, FxRate>(
                "SELECT id, user_id, from_currency, to_currency, rate, date, notes, created_at
             FROM fx_rates
             WHERE user_id = ? AND to_currency = ?
             ORDER BY date DESC, created_at DESC",
            )
            .bind(&user.id)
            .bind(t)
            .fetch_all(&state.db)
            .await?
        }

        (None, None) => {
            sqlx::query_as::<_, FxRate>(
                "SELECT id, user_id, from_currency, to_currency, rate, date, notes, created_at
             FROM fx_rates
             WHERE user_id = ?
             ORDER BY date DESC, created_at DESC",
            )
            .bind(&user.id)
            .fetch_all(&state.db)
            .await?
        }
    };

    Ok(Json(json!({ "fx_rates": fx_rates })))
}

/// GET /api/v1/fx-rates/latest
async fn latest_fx_rates(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Value>> {
    let latest: Vec<LatestFxRate> = sqlx::query_as::<_, LatestFxRate>(
        "SELECT f.from_currency, f.to_currency, f.rate, f.date
         FROM fx_rates f
         WHERE f.user_id = ?
           AND NOT EXISTS (
               SELECT 1
               FROM fx_rates newer
               WHERE newer.user_id = f.user_id
                 AND newer.from_currency = f.from_currency
                 AND newer.to_currency = f.to_currency
                 AND (
                     newer.date > f.date
                     OR (newer.date = f.date AND newer.created_at > f.created_at)
                     OR (newer.date = f.date AND newer.created_at = f.created_at AND newer.id > f.id)
                 )
           )
         ORDER BY f.from_currency, f.to_currency",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(json!({ "latest": latest })))
}

/// POST /api/v1/fx-rates
async fn create_fx_rate(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateFxRateRequest>,
) -> Result<(StatusCode, Json<Value>)> {
    let from_currency = validate_currency_code(req.from_currency, "from_currency")?;
    let to_currency = validate_currency_code(req.to_currency, "to_currency")?;

    if from_currency == to_currency {
        return Err(AppError::BadRequest(
            "from_currency and to_currency must be different".into(),
        ));
    }

    if req.rate <= 0.0 {
        return Err(AppError::BadRequest("rate must be greater than 0".into()));
    }

    validate_date_format(&req.date)?;

    let notes = normalize_notes(req.notes)?;
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "INSERT INTO fx_rates (id, user_id, from_currency, to_currency, rate, date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&from_currency)
    .bind(&to_currency)
    .bind(req.rate)
    .bind(&req.date)
    .bind(&notes)
    .execute(&mut *tx)
    .await?;

    let created = sqlx::query_as::<_, FxRate>(
        "SELECT id, user_id, from_currency, to_currency, rate, date, notes, created_at
         FROM fx_rates WHERE id = ?",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;

    insert_audit_log(
        &mut tx,
        &user.id,
        "create",
        "fx_rate",
        &id,
        json!({ "after": created }),
    )
    .await?;

    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(json!({ "fx_rate": created }))))
}

/// DELETE /api/v1/fx-rates/:id
async fn delete_fx_rate(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let existing = sqlx::query_as::<_, FxRate>(
        "SELECT id, user_id, from_currency, to_currency, rate, date, notes, created_at
         FROM fx_rates WHERE id = ? AND user_id = ?",
    )
    .bind(&id)
    .bind(&user.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("FX rate not found".into()))?;

    let mut tx = state.db.begin().await?;

    sqlx::query("DELETE FROM fx_rates WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&user.id)
        .execute(&mut *tx)
        .await?;

    insert_audit_log(
        &mut tx,
        &user.id,
        "delete",
        "fx_rate",
        &id,
        json!({ "before": existing }),
    )
    .await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn validate_currency_code(raw: String, field: &str) -> Result<String> {
    let code = raw.trim().to_uppercase();
    if code.is_empty() || code.len() < 2 || code.len() > 10 {
        return Err(AppError::BadRequest(format!(
            "{field} must be a 2–10 character currency code"
        )));
    }
    if !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(AppError::BadRequest(format!(
            "{field} must be alphanumeric"
        )));
    }
    Ok(code)
}

fn validate_date_format(date: &str) -> Result<()> {
    let date = date.trim();
    // Expect YYYY-MM-DD
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
