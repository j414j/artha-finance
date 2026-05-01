use serde_json::Value;
use sqlx::{Sqlite, Transaction};
use uuid::Uuid;

use crate::error::{AppError, Result};

pub async fn insert_audit_log(
    tx: &mut Transaction<'_, Sqlite>,
    user_id: &str,
    action: &str,
    entity_type: &str,
    entity_id: &str,
    diff: Value,
) -> Result<()> {
    let id = Uuid::new_v4().to_string();
    let diff_json =
        serde_json::to_string(&diff).map_err(|err| AppError::Internal(anyhow::Error::from(err)))?;

    sqlx::query(
        "INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, diff_json)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(user_id)
    .bind(action)
    .bind(entity_type)
    .bind(entity_id)
    .bind(diff_json)
    .execute(&mut **tx)
    .await?;

    Ok(())
}
