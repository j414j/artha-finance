use axum::{
    extract::{Path, State},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{NaiveDate, NaiveDateTime, Utc};
use serde_json::{json, Value};
use sqlx::{FromRow, Sqlite, SqlitePool, Transaction};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::{
        account::validate_date,
        audit::insert_audit_log,
        goal::{
            CompleteGoalRequest, CreateGoalRequest, GoalAccountAvailabilityView, GoalEventView,
            GoalFundsRequest, GoalView, UpdateGoalRequest,
        },
    },
    state::AppState,
};

const GOAL_COLOR_PALETTE: &[&str] = &[
    "#F0A500", "#00C896", "#3A7FFF", "#FF6B6B", "#7C5CFC", "#39C0ED", "#FFC857", "#8AC926",
];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_goals).post(create_goal))
        .route("/account-availability", get(account_availability))
        .route("/:id", patch(update_goal))
        .route("/:id/history", get(goal_history))
        .route("/:id/block", post(block_goal_funds))
        .route("/:id/release", post(release_goal_funds))
        .route("/:id/complete", post(complete_goal))
}

async fn list_goals(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Value>> {
    let rows = fetch_goal_rows(&state.db, &user.id).await?;
    let active_goals = rows
        .iter()
        .filter(|row| row.status == "active")
        .map(build_goal_view)
        .collect::<Result<Vec<_>>>()?;
    let completed_goals = rows
        .iter()
        .filter(|row| row.status == "completed")
        .map(build_goal_view)
        .collect::<Result<Vec<_>>>()?;
    let account_availability = fetch_account_availability(&state.db, &user.id).await?;
    let total_blocked_paise = account_availability
        .iter()
        .map(|row| row.blocked_paise)
        .sum::<i64>();

    Ok(Json(json!({
        "active_goals": active_goals,
        "completed_goals": completed_goals,
        "account_availability": account_availability,
        "total_blocked_paise": total_blocked_paise,
    })))
}

async fn account_availability(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Value>> {
    let account_availability = fetch_account_availability(&state.db, &user.id).await?;
    let total_blocked_paise = account_availability
        .iter()
        .map(|row| row.blocked_paise)
        .sum::<i64>();
    Ok(Json(json!({
        "accounts": account_availability,
        "total_blocked_paise": total_blocked_paise,
    })))
}

async fn create_goal(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateGoalRequest>,
) -> Result<Json<Value>> {
    let input = validate_goal_create_input(req)?;
    let mut tx = state.db.begin().await?;
    let source_account =
        fetch_goal_source_account_in_tx(&mut tx, &user.id, &input.source_account_id).await?;

    let id = Uuid::new_v4().to_string();
    let color_hex = pick_goal_color(&id).to_string();
    sqlx::query(
        "INSERT INTO goals (
            id, user_id, name, color_hex, target_amount_paise, source_account_id, target_date, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&input.name)
    .bind(&color_hex)
    .bind(input.target_amount_paise)
    .bind(&source_account.id)
    .bind(&input.target_date)
    .bind(&input.notes)
    .execute(&mut *tx)
    .await?;

    let row = fetch_goal_row_in_tx(&mut tx, &user.id, &id).await?;
    let view = build_goal_view(&row)?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "create",
        "goal",
        &id,
        json!({ "after": view }),
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "goal": view })))
}

async fn update_goal(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateGoalRequest>,
) -> Result<Json<Value>> {
    let mut tx = state.db.begin().await?;
    let before = fetch_goal_row_in_tx(&mut tx, &user.id, &id).await?;
    if before.status != "active" {
        return Err(AppError::BadRequest(
            "Only active goals can be edited".into(),
        ));
    }

    let input = validate_goal_update_input(req, &before)?;
    if input.source_account_id != before.source_account_id && before.current_blocked_paise > 0 {
        return Err(AppError::BadRequest(
            "Release blocked funds before changing the source account".into(),
        ));
    }

    fetch_goal_source_account_in_tx(&mut tx, &user.id, &input.source_account_id).await?;

    sqlx::query(
        "UPDATE goals
         SET name = ?,
             target_amount_paise = ?,
             source_account_id = ?,
             target_date = ?,
             notes = ?,
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ?",
    )
    .bind(&input.name)
    .bind(input.target_amount_paise)
    .bind(&input.source_account_id)
    .bind(&input.target_date)
    .bind(&input.notes)
    .bind(&id)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let after = fetch_goal_row_in_tx(&mut tx, &user.id, &id).await?;
    let before_view = build_goal_view(&before)?;
    let after_view = build_goal_view(&after)?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "update",
        "goal",
        &id,
        json!({ "before": before_view, "after": after_view }),
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "goal": after_view })))
}

async fn block_goal_funds(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(req): Json<GoalFundsRequest>,
) -> Result<Json<Value>> {
    let input = validate_goal_funds_input(req)?;
    let mut tx = state.db.begin().await?;
    let before = fetch_goal_row_in_tx(&mut tx, &user.id, &id).await?;
    ensure_goal_active(&before)?;

    let availability =
        fetch_account_availability_row_in_tx(&mut tx, &user.id, &before.source_account_id).await?;
    if availability.available_balance_paise < input.amount_paise {
        return Err(AppError::BadRequest(
            "Available balance is insufficient because funds are blocked for goals".into(),
        ));
    }

    insert_goal_event_in_tx(
        &mut tx,
        &user.id,
        &id,
        "block",
        input.amount_paise,
        &input.date,
        input.notes.as_deref(),
    )
    .await?;
    update_goal_blocked_amount_in_tx(
        &mut tx,
        &user.id,
        &id,
        before.current_blocked_paise + input.amount_paise,
    )
    .await?;

    let after = fetch_goal_row_in_tx(&mut tx, &user.id, &id).await?;
    let before_view = build_goal_view(&before)?;
    let after_view = build_goal_view(&after)?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "block_funds",
        "goal",
        &id,
        json!({
            "before": before_view,
            "after": after_view,
            "amount_paise": input.amount_paise,
            "date": input.date,
        }),
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "goal": after_view })))
}

async fn release_goal_funds(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(req): Json<GoalFundsRequest>,
) -> Result<Json<Value>> {
    let input = validate_goal_funds_input(req)?;
    let mut tx = state.db.begin().await?;
    let before = fetch_goal_row_in_tx(&mut tx, &user.id, &id).await?;
    ensure_goal_active(&before)?;
    if input.amount_paise > before.current_blocked_paise {
        return Err(AppError::BadRequest(
            "Release amount cannot exceed blocked funds".into(),
        ));
    }

    insert_goal_event_in_tx(
        &mut tx,
        &user.id,
        &id,
        "release",
        input.amount_paise,
        &input.date,
        input.notes.as_deref(),
    )
    .await?;
    update_goal_blocked_amount_in_tx(
        &mut tx,
        &user.id,
        &id,
        before.current_blocked_paise - input.amount_paise,
    )
    .await?;

    let after = fetch_goal_row_in_tx(&mut tx, &user.id, &id).await?;
    let before_view = build_goal_view(&before)?;
    let after_view = build_goal_view(&after)?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "release_funds",
        "goal",
        &id,
        json!({
            "before": before_view,
            "after": after_view,
            "amount_paise": input.amount_paise,
            "date": input.date,
        }),
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "goal": after_view })))
}

async fn complete_goal(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(req): Json<CompleteGoalRequest>,
) -> Result<Json<Value>> {
    let completion_date = match req.date {
        Some(date) => normalize_goal_date(date)?,
        None => Utc::now().date_naive().format("%Y-%m-%d").to_string(),
    };
    let notes = normalize_goal_notes(req.notes)?;

    let mut tx = state.db.begin().await?;
    let before = fetch_goal_row_in_tx(&mut tx, &user.id, &id).await?;
    ensure_goal_active(&before)?;

    if before.current_blocked_paise > 0 {
        insert_goal_event_in_tx(
            &mut tx,
            &user.id,
            &id,
            "complete_release",
            before.current_blocked_paise,
            &completion_date,
            notes.as_deref(),
        )
        .await?;
    }

    sqlx::query(
        "UPDATE goals
         SET current_blocked_paise = 0,
             completed_amount_paise = ?,
             status = 'completed',
             completed_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ?",
    )
    .bind(before.current_blocked_paise)
    .bind(&id)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let after = fetch_goal_row_in_tx(&mut tx, &user.id, &id).await?;
    let before_view = build_goal_view(&before)?;
    let after_view = build_goal_view(&after)?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "complete",
        "goal",
        &id,
        json!({
            "before": before_view,
            "after": after_view,
            "date": completion_date,
        }),
    )
    .await?;
    tx.commit().await?;

    Ok(Json(json!({ "goal": after_view })))
}

async fn goal_history(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    ensure_goal_exists(&state.db, &user.id, &id).await?;
    let events = fetch_goal_events(&state.db, &user.id, &id).await?;
    Ok(Json(json!({ "events": events })))
}

#[derive(Debug, Clone, FromRow)]
struct GoalRow {
    id: String,
    name: String,
    color_hex: String,
    target_amount_paise: i64,
    source_account_id: String,
    source_account_name: String,
    target_date: Option<String>,
    current_blocked_paise: i64,
    completed_amount_paise: Option<i64>,
    status: String,
    notes: Option<String>,
    created_at: String,
    completed_at: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct GoalSourceAccountRow {
    id: String,
}

#[derive(Debug, Clone, FromRow)]
struct AccountAvailabilityRow {
    account_id: String,
    account_name: String,
    total_balance_paise: i64,
    blocked_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
struct GoalEventRow {
    id: String,
    event_type: String,
    amount_paise: i64,
    date: String,
    notes: Option<String>,
    created_at: String,
}

#[derive(Debug, Clone)]
struct ValidatedGoalInput {
    name: String,
    target_amount_paise: i64,
    source_account_id: String,
    target_date: Option<String>,
    notes: Option<String>,
}

fn validate_goal_create_input(req: CreateGoalRequest) -> Result<ValidatedGoalInput> {
    Ok(ValidatedGoalInput {
        name: normalize_goal_name(req.name)?,
        target_amount_paise: validate_goal_amount(req.target_amount_paise, "Target amount")?,
        source_account_id: normalize_goal_id(req.source_account_id, "Source account")?,
        target_date: normalize_goal_optional_date(req.target_date)?,
        notes: normalize_goal_notes(req.notes)?,
    })
}

fn validate_goal_update_input(
    req: UpdateGoalRequest,
    current: &GoalRow,
) -> Result<ValidatedGoalInput> {
    Ok(ValidatedGoalInput {
        name: match req.name {
            Some(name) => normalize_goal_name(name)?,
            None => current.name.clone(),
        },
        target_amount_paise: match req.target_amount_paise {
            Some(amount) => validate_goal_amount(amount, "Target amount")?,
            None => current.target_amount_paise,
        },
        source_account_id: match req.source_account_id {
            Some(id) => normalize_goal_id(id, "Source account")?,
            None => current.source_account_id.clone(),
        },
        target_date: match req.target_date {
            Some(date) => normalize_goal_optional_date(date)?,
            None => current.target_date.clone(),
        },
        notes: match req.notes {
            Some(notes) => normalize_goal_notes(notes)?,
            None => current.notes.clone(),
        },
    })
}

fn validate_goal_funds_input(req: GoalFundsRequest) -> Result<GoalFundsRequest> {
    Ok(GoalFundsRequest {
        amount_paise: validate_goal_amount(req.amount_paise, "Amount")?,
        date: normalize_goal_date(req.date)?,
        notes: normalize_goal_notes(req.notes)?,
    })
}

fn normalize_goal_name(name: String) -> Result<String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("Goal name is required".into()));
    }
    if name.len() > 100 {
        return Err(AppError::BadRequest(
            "Goal name must be 100 characters or fewer".into(),
        ));
    }
    Ok(name)
}

fn validate_goal_amount(amount: i64, label: &str) -> Result<i64> {
    if amount <= 0 {
        return Err(AppError::BadRequest(format!(
            "{label} must be greater than zero"
        )));
    }
    Ok(amount)
}

fn normalize_goal_id(id: String, label: &str) -> Result<String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err(AppError::BadRequest(format!("{label} is required")));
    }
    Ok(id)
}

fn normalize_goal_date(date: String) -> Result<String> {
    let date = date.trim().to_string();
    if validate_date(&date) {
        Ok(date)
    } else {
        Err(AppError::BadRequest(
            "Date must use YYYY-MM-DD format".into(),
        ))
    }
}

fn normalize_goal_optional_date(date: Option<String>) -> Result<Option<String>> {
    match date {
        Some(date) => {
            let normalized = date.trim().to_string();
            if normalized.is_empty() {
                Ok(None)
            } else {
                Ok(Some(normalize_goal_date(normalized)?))
            }
        }
        None => Ok(None),
    }
}

fn normalize_goal_notes(notes: Option<String>) -> Result<Option<String>> {
    let Some(notes) = notes else {
        return Ok(None);
    };
    let notes = notes.trim().to_string();
    if notes.is_empty() {
        return Ok(None);
    }
    if notes.len() > 2_000 {
        return Err(AppError::BadRequest(
            "Notes must be 2000 characters or fewer".into(),
        ));
    }
    Ok(Some(notes))
}

fn pick_goal_color(seed: &str) -> &'static str {
    let index =
        seed.bytes().fold(0usize, |acc, byte| acc + byte as usize) % GOAL_COLOR_PALETTE.len();
    GOAL_COLOR_PALETTE[index]
}

async fn fetch_goal_rows(pool: &SqlitePool, user_id: &str) -> Result<Vec<GoalRow>> {
    sqlx::query_as::<_, GoalRow>(
        "SELECT g.id,
                g.name,
                g.color_hex,
                g.target_amount_paise,
                g.source_account_id,
                a.name AS source_account_name,
                g.target_date,
                g.current_blocked_paise,
                g.completed_amount_paise,
                g.status,
                g.notes,
                g.created_at,
                g.completed_at
         FROM goals g
         JOIN accounts a ON a.id = g.source_account_id
         WHERE g.user_id = ? AND g.status IN ('active', 'completed')
         ORDER BY CASE g.status WHEN 'active' THEN 0 ELSE 1 END,
                  g.created_at DESC,
                  g.id DESC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(Into::into)
}

async fn fetch_goal_row_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    goal_id: &str,
) -> Result<GoalRow> {
    sqlx::query_as::<_, GoalRow>(
        "SELECT g.id,
                g.name,
                g.color_hex,
                g.target_amount_paise,
                g.source_account_id,
                a.name AS source_account_name,
                g.target_date,
                g.current_blocked_paise,
                g.completed_amount_paise,
                g.status,
                g.notes,
                g.created_at,
                g.completed_at
         FROM goals g
         JOIN accounts a ON a.id = g.source_account_id
         WHERE g.user_id = ? AND g.id = ?",
    )
    .bind(user_id)
    .bind(goal_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Goal not found".into()))
}

async fn ensure_goal_exists(pool: &SqlitePool, user_id: &str, goal_id: &str) -> Result<()> {
    let exists =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM goals WHERE user_id = ? AND id = ?")
            .bind(user_id)
            .bind(goal_id)
            .fetch_one(pool)
            .await?;

    if exists == 0 {
        Err(AppError::NotFound("Goal not found".into()))
    } else {
        Ok(())
    }
}

async fn fetch_goal_source_account_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    account_id: &str,
) -> Result<GoalSourceAccountRow> {
    sqlx::query_as::<_, GoalSourceAccountRow>(
        "SELECT id
         FROM accounts
         WHERE user_id = ?
           AND id = ?
           AND is_active = 1
           AND type IN ('savings', 'current')",
    )
    .bind(user_id)
    .bind(account_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        AppError::BadRequest(
            "Goal source account must be an active savings or current account".into(),
        )
    })
}

async fn fetch_account_availability(
    pool: &SqlitePool,
    user_id: &str,
) -> Result<Vec<GoalAccountAvailabilityView>> {
    let rows = sqlx::query_as::<_, AccountAvailabilityRow>(
        "SELECT a.id AS account_id,
                a.name AS account_name,
                a.balance_paise AS total_balance_paise,
                COALESCE(SUM(CASE WHEN g.status = 'active' THEN g.current_blocked_paise ELSE 0 END), 0) AS blocked_paise
         FROM accounts a
         LEFT JOIN goals g
           ON g.user_id = a.user_id
          AND g.source_account_id = a.id
         WHERE a.user_id = ?
           AND a.is_active = 1
           AND a.type IN ('savings', 'current')
         GROUP BY a.id, a.name, a.balance_paise
         ORDER BY a.name ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(map_account_availability).collect())
}

async fn fetch_account_availability_row_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    account_id: &str,
) -> Result<GoalAccountAvailabilityView> {
    let row = sqlx::query_as::<_, AccountAvailabilityRow>(
        "SELECT a.id AS account_id,
                a.name AS account_name,
                a.balance_paise AS total_balance_paise,
                COALESCE(SUM(CASE WHEN g.status = 'active' THEN g.current_blocked_paise ELSE 0 END), 0) AS blocked_paise
         FROM accounts a
         LEFT JOIN goals g
           ON g.user_id = a.user_id
          AND g.source_account_id = a.id
         WHERE a.user_id = ?
           AND a.id = ?
           AND a.is_active = 1
           AND a.type IN ('savings', 'current')
         GROUP BY a.id, a.name, a.balance_paise",
    )
    .bind(user_id)
    .bind(account_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| {
        AppError::BadRequest("Goal source account must be an active savings or current account".into())
    })?;

    Ok(map_account_availability(row))
}

fn map_account_availability(row: AccountAvailabilityRow) -> GoalAccountAvailabilityView {
    GoalAccountAvailabilityView {
        account_id: row.account_id,
        account_name: row.account_name,
        total_balance_paise: row.total_balance_paise,
        blocked_paise: row.blocked_paise,
        available_balance_paise: row.total_balance_paise - row.blocked_paise,
    }
}

async fn insert_goal_event_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    goal_id: &str,
    event_type: &str,
    amount_paise: i64,
    date: &str,
    notes: Option<&str>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO goal_events (id, user_id, goal_id, event_type, amount_paise, date, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user_id)
    .bind(goal_id)
    .bind(event_type)
    .bind(amount_paise)
    .bind(date)
    .bind(notes)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn update_goal_blocked_amount_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    goal_id: &str,
    current_blocked_paise: i64,
) -> Result<()> {
    sqlx::query(
        "UPDATE goals
         SET current_blocked_paise = ?,
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ?",
    )
    .bind(current_blocked_paise)
    .bind(goal_id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn fetch_goal_events(
    pool: &SqlitePool,
    user_id: &str,
    goal_id: &str,
) -> Result<Vec<GoalEventView>> {
    let rows = sqlx::query_as::<_, GoalEventRow>(
        "SELECT id, event_type, amount_paise, date, notes, created_at
         FROM goal_events
         WHERE user_id = ? AND goal_id = ?
         ORDER BY date DESC, created_at DESC, id DESC",
    )
    .bind(user_id)
    .bind(goal_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| GoalEventView {
            id: row.id,
            event_type: row.event_type,
            amount_paise: row.amount_paise,
            date: row.date,
            notes: row.notes,
            created_at: row.created_at,
        })
        .collect())
}

fn ensure_goal_active(goal: &GoalRow) -> Result<()> {
    if goal.status == "active" {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "Only active goals can be changed".into(),
        ))
    }
}

fn build_goal_view(row: &GoalRow) -> Result<GoalView> {
    let created_date = parse_sqlite_datetime(&row.created_at)?.date();
    let today = Utc::now().date_naive();
    let display_amount_paise = if row.status == "completed" {
        row.completed_amount_paise
            .unwrap_or(row.current_blocked_paise)
    } else {
        row.current_blocked_paise
    };
    let remaining_paise = (row.target_amount_paise - display_amount_paise).max(0);
    let progress_pct =
        ((display_amount_paise as f64 / row.target_amount_paise as f64) * 100.0).clamp(0.0, 100.0);

    let projected_completion_date = if row.status == "completed" {
        None
    } else {
        compute_projected_completion_date(
            display_amount_paise,
            remaining_paise,
            created_date,
            today,
        )
    };
    let required_monthly_paise = if row.status == "active" {
        compute_required_monthly_paise(remaining_paise, row.target_date.as_deref(), today)?
    } else {
        None
    };
    let (status_label, status_tone) = compute_goal_status(
        &row.status,
        display_amount_paise,
        remaining_paise,
        row.target_date.as_deref(),
        projected_completion_date.as_deref(),
        today,
    )?;

    Ok(GoalView {
        id: row.id.clone(),
        name: row.name.clone(),
        color_hex: row.color_hex.clone(),
        target_amount_paise: row.target_amount_paise,
        source_account_id: row.source_account_id.clone(),
        source_account_name: row.source_account_name.clone(),
        target_date: row.target_date.clone(),
        current_blocked_paise: row.current_blocked_paise,
        completed_amount_paise: row.completed_amount_paise,
        display_amount_paise,
        remaining_paise,
        progress_pct,
        projected_completion_date,
        required_monthly_paise,
        status: row.status.clone(),
        status_label,
        status_tone,
        notes: row.notes.clone(),
        created_at: row.created_at.clone(),
        completed_at: row.completed_at.clone(),
    })
}

fn compute_projected_completion_date(
    display_amount_paise: i64,
    remaining_paise: i64,
    created_date: NaiveDate,
    today: NaiveDate,
) -> Option<String> {
    if remaining_paise == 0 {
        return Some(today.format("%Y-%m-%d").to_string());
    }
    if display_amount_paise <= 0 {
        return None;
    }

    let elapsed_days = (today - created_date).num_days().max(1);
    let daily_rate = display_amount_paise as f64 / elapsed_days as f64;
    if daily_rate <= 0.0 {
        return None;
    }

    let days_needed = (remaining_paise as f64 / daily_rate).ceil() as i64;
    Some(
        (today + chrono::Days::new(days_needed.max(0) as u64))
            .format("%Y-%m-%d")
            .to_string(),
    )
}

fn compute_required_monthly_paise(
    remaining_paise: i64,
    target_date: Option<&str>,
    today: NaiveDate,
) -> Result<Option<i64>> {
    let Some(target_date) = target_date else {
        return Ok(None);
    };
    if remaining_paise == 0 {
        return Ok(Some(0));
    }

    let target = parse_date(target_date)?;
    let days_remaining = (target - today).num_days();
    if days_remaining <= 0 {
        return Ok(None);
    }

    let months_remaining = (days_remaining as f64 / 30.4375).max(1.0);
    Ok(Some(
        (remaining_paise as f64 / months_remaining).ceil() as i64
    ))
}

fn compute_goal_status(
    status: &str,
    display_amount_paise: i64,
    remaining_paise: i64,
    target_date: Option<&str>,
    projected_completion_date: Option<&str>,
    today: NaiveDate,
) -> Result<(String, String)> {
    if status == "completed" {
        return Ok(("COMPLETED".into(), "green".into()));
    }
    if remaining_paise == 0 {
        return Ok(("READY".into(), "green".into()));
    }

    let Some(target_date) = target_date else {
        return Ok(if display_amount_paise > 0 {
            ("ON TRACK".into(), "green".into())
        } else {
            ("PLANNED".into(), "neutral".into())
        });
    };
    let target = parse_date(target_date)?;

    let Some(projected) = projected_completion_date else {
        return Ok(("AT RISK".into(), "red".into()));
    };
    let projected = parse_date(projected)?;

    if target < today {
        return Ok(("AT RISK".into(), "red".into()));
    }
    if projected <= target {
        return Ok(("ON TRACK".into(), "green".into()));
    }
    if projected <= target + chrono::Days::new(31) {
        return Ok(("SLIGHTLY BEHIND".into(), "amber".into()));
    }
    Ok(("AT RISK".into(), "red".into()))
}

fn parse_date(value: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Date must use YYYY-MM-DD format".into()))
}

fn parse_sqlite_datetime(value: &str) -> Result<NaiveDateTime> {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S")
        .map_err(|_| AppError::Internal(anyhow::anyhow!("invalid sqlite datetime: {value}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn planned_status_is_used_for_new_goal_without_progress() {
        let today = NaiveDate::from_ymd_opt(2026, 5, 2).expect("date");
        let status = compute_goal_status("active", 0, 1_000, None, None, today).expect("status");

        assert_eq!(status, ("PLANNED".to_string(), "neutral".to_string()));
    }

    #[test]
    fn slightly_behind_status_applies_when_projection_misses_target_briefly() {
        let today = NaiveDate::from_ymd_opt(2026, 5, 2).expect("date");
        let status = compute_goal_status(
            "active",
            50_000,
            10_000,
            Some("2026-06-01"),
            Some("2026-06-15"),
            today,
        )
        .expect("status");

        assert_eq!(status, ("SLIGHTLY BEHIND".to_string(), "amber".to_string()));
    }
}
