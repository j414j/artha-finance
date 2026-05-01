use async_trait::async_trait;
use axum::{
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};

use crate::{error::AppError, models::user::User, state::AppState};

pub struct AuthUser(pub User);

/// Extracts the authenticated user from the session cookie.
/// Returns 401 if the cookie is missing, invalid, or expired.
#[async_trait]
impl<S> FromRequestParts<S> for AuthUser
where
    AppState: FromRef<S>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let app_state = AppState::from_ref(state);

        let session_id = extract_session_cookie(parts).ok_or(AppError::Unauthorized)?;

        #[derive(sqlx::FromRow)]
        struct Row {
            user_id: String,
        }

        let row = sqlx::query_as::<_, Row>(
            "SELECT user_id FROM sessions \
             WHERE id = ? AND expires_at > strftime('%Y-%m-%d %H:%M:%S', 'now')",
        )
        .bind(&session_id)
        .fetch_optional(&app_state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::Error::from(e)))?
        .ok_or(AppError::Unauthorized)?;

        let user = sqlx::query_as::<_, User>(
            "SELECT id, email, display_name, password_hash, avatar_initials, created_at \
             FROM users WHERE id = ?",
        )
        .bind(&row.user_id)
        .fetch_optional(&app_state.db)
        .await
        .map_err(|e| AppError::Internal(anyhow::Error::from(e)))?
        .ok_or(AppError::Unauthorized)?;

        Ok(AuthUser(user))
    }
}

fn extract_session_cookie(parts: &Parts) -> Option<String> {
    let header = parts.headers.get("cookie")?.to_str().ok()?;
    header.split(';').find_map(|pair| {
        pair.trim()
            .strip_prefix("session_id=")
            .map(|v| v.to_string())
    })
}
