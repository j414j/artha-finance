use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub password_hash: String,
    pub avatar_initials: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    pub display_name: String,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct UserPublic {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub avatar_initials: String,
}

impl From<User> for UserPublic {
    fn from(u: User) -> Self {
        UserPublic {
            id: u.id,
            email: u.email,
            display_name: u.display_name,
            avatar_initials: u.avatar_initials,
        }
    }
}

/// Derives two-letter initials from a display name.
/// "Rahul Sharma" → "RS", "Alice" → "AL"
pub fn generate_initials(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    match parts.as_slice() {
        [] => "??".to_string(),
        [single] => {
            let mut chars = single.chars();
            match (chars.next(), chars.next()) {
                (Some(a), Some(b)) => format!("{}{}", a.to_uppercase(), b.to_uppercase()),
                (Some(a), None) => a.to_uppercase().to_string(),
                _ => "??".to_string(),
            }
        }
        [first, .., last] => format!(
            "{}{}",
            first.chars().next().unwrap_or('?').to_uppercase(),
            last.chars().next().unwrap_or('?').to_uppercase()
        ),
    }
}
