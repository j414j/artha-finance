use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Debug)]
pub struct BatchRowError {
    pub row: usize,
    pub message: String,
}

#[derive(Debug)]
pub enum AppError {
    Unauthorized,
    NotFound(String),
    BadRequest(String),
    BatchValidationFailed(Vec<BatchRowError>),
    Internal(anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            AppError::BatchValidationFailed(errors) => {
                let row_errors: Vec<_> = errors
                    .iter()
                    .map(|e| json!({ "row": e.row, "message": e.message }))
                    .collect();
                (
                    StatusCode::UNPROCESSABLE_ENTITY,
                    Json(json!({
                        "error": {
                            "code": "BATCH_VALIDATION_FAILED",
                            "message": "Validation failed for one or more rows",
                            "row_errors": row_errors
                        }
                    })),
                )
                    .into_response()
            }
            other => {
                let (status, code, message) = match other {
                    AppError::Unauthorized => (
                        StatusCode::UNAUTHORIZED,
                        "UNAUTHORIZED",
                        "Authentication required".to_string(),
                    ),
                    AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg),
                    AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", msg),
                    AppError::Internal(err) => {
                        tracing::error!("Internal error: {:?}", err);
                        (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "INTERNAL_ERROR",
                            "An internal error occurred".to_string(),
                        )
                    }
                    AppError::BatchValidationFailed(_) => unreachable!(),
                };

                (
                    status,
                    Json(json!({ "error": { "code": code, "message": message } })),
                )
                    .into_response()
            }
        }
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Internal(err)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        AppError::Internal(anyhow::Error::from(err))
    }
}

impl From<bcrypt::BcryptError> for AppError {
    fn from(err: bcrypt::BcryptError) -> Self {
        AppError::Internal(anyhow::Error::msg(err.to_string()))
    }
}
