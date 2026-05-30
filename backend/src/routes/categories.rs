use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::{
        account::validate_color_hex,
        audit::insert_audit_log,
        category::{
            build_category_tree, is_valid_category_type, Category, CategoryNode,
            CreateCategoryRequest, UpdateCategoryRequest,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_categories).post(create_category))
        .route("/:id", patch(update_category).delete(archive_category))
}

async fn list_categories(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Value>> {
    let categories = fetch_active_categories(&state.db, &user.id).await?;
    Ok(Json(
        json!({ "categories": build_category_tree(categories) }),
    ))
}

async fn create_category(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateCategoryRequest>,
) -> Result<(StatusCode, Json<Value>)> {
    let input = ValidatedCategoryInput::from_create(&state.db, &user.id, req).await?;
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "INSERT INTO categories (
            id, user_id, parent_id, name, type, color_hex, icon_emoji, is_default
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(&id)
    .bind(&user.id)
    .bind(&input.parent_id)
    .bind(&input.name)
    .bind(&input.category_type)
    .bind(&input.color_hex)
    .bind(&input.icon_emoji)
    .execute(&mut *tx)
    .await?;

    let category = fetch_active_category_in_tx(&mut tx, &id, &user.id).await?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "create",
        "category",
        &id,
        json!({ "after": category_to_node(&category) }),
    )
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({ "category": category_to_node(&category) })),
    ))
}

async fn update_category(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateCategoryRequest>,
) -> Result<Json<Value>> {
    let before = fetch_active_category(&state.db, &id, &user.id).await?;
    let input = ValidatedCategoryInput::from_update(&state.db, &user.id, req, &before).await?;
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "UPDATE categories
         SET parent_id = ?,
             name = ?,
             color_hex = ?,
             icon_emoji = ?,
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(&input.parent_id)
    .bind(&input.name)
    .bind(&input.color_hex)
    .bind(&input.icon_emoji)
    .bind(&id)
    .bind(&user.id)
    .execute(&mut *tx)
    .await?;

    let after = fetch_active_category_in_tx(&mut tx, &id, &user.id).await?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "update",
        "category",
        &id,
        json!({
            "before": category_to_node(&before),
            "after": category_to_node(&after),
        }),
    )
    .await?;

    tx.commit().await?;

    Ok(Json(json!({ "category": category_to_node(&after) })))
}

async fn archive_category(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let before = fetch_active_category(&state.db, &id, &user.id).await?;
    let mut tx = state.db.begin().await?;

    sqlx::query(
        "UPDATE transactions
         SET category_id = NULL,
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE user_id = ? AND category_id = ? AND deleted_at IS NULL",
    )
    .bind(&user.id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE transaction_splits
         SET category_id = NULL
         WHERE user_id = ? AND category_id = ?",
    )
    .bind(&user.id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "UPDATE categories
         SET is_active = 0,
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
        "category",
        &id,
        json!({
            "before": category_to_node(&before),
            "after": {
                "is_active": false,
                "reassigned_transactions": "uncategorized",
            },
        }),
    )
    .await?;

    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug)]
struct ValidatedCategoryInput {
    parent_id: Option<String>,
    name: String,
    category_type: String,
    color_hex: String,
    icon_emoji: Option<String>,
}

impl ValidatedCategoryInput {
    async fn from_create(
        pool: &sqlx::SqlitePool,
        user_id: &str,
        req: CreateCategoryRequest,
    ) -> Result<Self> {
        let category_type = validate_category_type(req.category_type)?;
        validate_parent(pool, user_id, req.parent_id.as_deref(), &category_type).await?;

        Ok(ValidatedCategoryInput {
            parent_id: req.parent_id,
            name: validate_name(req.name)?,
            category_type,
            color_hex: validate_color(req.color_hex)?,
            icon_emoji: normalize_icon(req.icon_emoji)?,
        })
    }

    async fn from_update(
        pool: &sqlx::SqlitePool,
        user_id: &str,
        req: UpdateCategoryRequest,
        current: &Category,
    ) -> Result<Self> {
        let parent_id = match req.parent_id {
            Some(parent_id) => parent_id,
            None => current.parent_id.clone(),
        };
        validate_parent(pool, user_id, parent_id.as_deref(), &current.category_type).await?;
        if parent_id.as_deref() == Some(current.id.as_str()) {
            return Err(AppError::BadRequest(
                "Category cannot be its own parent".into(),
            ));
        }

        Ok(ValidatedCategoryInput {
            parent_id,
            name: match req.name {
                Some(name) => validate_name(name)?,
                None => current.name.clone(),
            },
            category_type: current.category_type.clone(),
            color_hex: match req.color_hex {
                Some(color) => validate_color(color)?,
                None => current.color_hex.clone(),
            },
            icon_emoji: match req.icon_emoji {
                Some(icon) => normalize_icon(icon)?,
                None => current.icon_emoji.clone(),
            },
        })
    }
}

fn validate_name(name: String) -> Result<String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("Category name is required".into()));
    }
    if name.len() > 80 {
        return Err(AppError::BadRequest(
            "Category name must be 80 characters or fewer".into(),
        ));
    }
    Ok(name)
}

fn validate_category_type(category_type: String) -> Result<String> {
    let category_type = category_type.trim().to_ascii_lowercase();
    if is_valid_category_type(&category_type) {
        return Ok(category_type);
    }
    Err(AppError::BadRequest(
        "Category type must be income or expense".into(),
    ))
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

fn normalize_icon(icon: Option<String>) -> Result<Option<String>> {
    let Some(icon) = icon else {
        return Ok(None);
    };
    let icon = icon.trim().to_string();
    if icon.len() > 12 {
        return Err(AppError::BadRequest(
            "Icon must be 12 characters or fewer".into(),
        ));
    }
    if icon.is_empty() {
        Ok(None)
    } else {
        Ok(Some(icon))
    }
}

async fn validate_parent(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    parent_id: Option<&str>,
    category_type: &str,
) -> Result<()> {
    let Some(parent_id) = parent_id else {
        return Ok(());
    };

    let parent = fetch_active_category(pool, parent_id, user_id).await?;
    if parent.category_type != category_type {
        return Err(AppError::BadRequest(
            "Parent category type must match child category type".into(),
        ));
    }
    Ok(())
}

async fn fetch_active_categories(pool: &sqlx::SqlitePool, user_id: &str) -> Result<Vec<Category>> {
    Ok(sqlx::query_as::<_, Category>(
        "SELECT id,
                user_id,
                parent_id,
                name,
                type AS category_type,
                color_hex,
                icon_emoji,
                is_default,
                is_active,
                created_at,
                updated_at
         FROM categories
         WHERE user_id = ? AND is_active = 1
         ORDER BY type, parent_id, name",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?)
}

async fn fetch_active_category(
    pool: &sqlx::SqlitePool,
    id: &str,
    user_id: &str,
) -> Result<Category> {
    sqlx::query_as::<_, Category>(
        "SELECT id,
                user_id,
                parent_id,
                name,
                type AS category_type,
                color_hex,
                icon_emoji,
                is_default,
                is_active,
                created_at,
                updated_at
         FROM categories
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::NotFound("Category not found".into()))
}

pub async fn fetch_active_category_by_name(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    name: &str,
) -> Result<Option<Category>> {
    Ok(sqlx::query_as::<_, Category>(
        "SELECT id,
                user_id,
                parent_id,
                name,
                type AS category_type,
                color_hex,
                icon_emoji,
                is_default,
                is_active,
                created_at,
                updated_at
         FROM categories
         WHERE user_id = ? AND is_active = 1
           AND lower(trim(name)) = lower(trim(?))
         LIMIT 1",
    )
    .bind(user_id)
    .bind(name)
    .fetch_optional(pool)
    .await?)
}

async fn fetch_active_category_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    user_id: &str,
) -> Result<Category> {
    sqlx::query_as::<_, Category>(
        "SELECT id,
                user_id,
                parent_id,
                name,
                type AS category_type,
                color_hex,
                icon_emoji,
                is_default,
                is_active,
                created_at,
                updated_at
         FROM categories
         WHERE id = ? AND user_id = ? AND is_active = 1",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Category not found".into()))
}

fn category_to_node(category: &Category) -> CategoryNode {
    CategoryNode {
        id: category.id.clone(),
        parent_id: category.parent_id.clone(),
        name: category.name.clone(),
        category_type: category.category_type.clone(),
        color_hex: category.color_hex.clone(),
        icon_emoji: category.icon_emoji.clone(),
        is_default: category.is_default,
        children: Vec::new(),
    }
}
