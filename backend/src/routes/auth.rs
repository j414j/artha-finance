use axum::{extract::State, http::StatusCode, routing::{get, post}, Json, Router};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::{Duration, Utc};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::user::{generate_initials, LoginRequest, RegisterRequest, User, UserPublic},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/logout", post(logout))
        .route("/me", get(me))
}

async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<Value>)> {
    if req.email.trim().is_empty() || req.password.len() < 8 {
        return Err(AppError::BadRequest(
            "Valid email and password (min 8 chars) are required".into(),
        ));
    }

    let exists = sqlx::query("SELECT id FROM users WHERE email = ?")
        .bind(req.email.to_lowercase().trim())
        .fetch_optional(&state.db)
        .await?;

    if exists.is_some() {
        return Err(AppError::BadRequest("Email is already registered".into()));
    }

    let id = Uuid::new_v4().to_string();
    let password_hash = bcrypt::hash(&req.password, bcrypt::DEFAULT_COST)?;
    let avatar_initials = generate_initials(&req.display_name);
    let email = req.email.to_lowercase();

    sqlx::query(
        "INSERT INTO users (id, email, display_name, password_hash, avatar_initials) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&email)
    .bind(&req.display_name)
    .bind(&password_hash)
    .bind(&avatar_initials)
    .execute(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "user": {
                "id": id,
                "email": email,
                "display_name": req.display_name,
                "avatar_initials": avatar_initials,
            }
        })),
    ))
}

async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> Result<(CookieJar, Json<Value>)> {
    let user = sqlx::query_as::<_, User>(
        "SELECT id, email, display_name, password_hash, avatar_initials, created_at \
         FROM users WHERE email = ?",
    )
    .bind(req.email.to_lowercase().trim())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("Invalid email or password".into()))?;

    let valid = bcrypt::verify(&req.password, &user.password_hash)
        .map_err(|e| AppError::Internal(anyhow::Error::msg(e.to_string())))?;

    if !valid {
        return Err(AppError::BadRequest("Invalid email or password".into()));
    }

    let session_id = Uuid::new_v4().to_string();
    let expires_at = (Utc::now() + Duration::days(30))
        .naive_utc()
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();

    sqlx::query("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
        .bind(&session_id)
        .bind(&user.id)
        .bind(&expires_at)
        .execute(&state.db)
        .await?;

    let cookie = Cookie::build(("session_id", session_id))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax);

    let pub_user: UserPublic = user.into();
    Ok((jar.add(cookie), Json(json!({ "user": pub_user }))))
}

async fn logout(State(state): State<AppState>, jar: CookieJar) -> (CookieJar, StatusCode) {
    if let Some(cookie) = jar.get("session_id") {
        let _ = sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(cookie.value())
            .execute(&state.db)
            .await;
    }

    let mut removal = Cookie::new("session_id", "");
    removal.set_path("/");
    (jar.remove(removal), StatusCode::NO_CONTENT)
}

async fn me(AuthUser(user): AuthUser) -> Json<Value> {
    let pub_user: UserPublic = user.into();
    Json(json!({ "user": pub_user }))
}
