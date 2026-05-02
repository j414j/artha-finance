use std::collections::{BTreeMap, BTreeSet};

use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{Datelike, NaiveDate, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    middleware::auth::AuthUser,
    models::{
        audit::insert_audit_log,
        balance_effect::{
            calculate_account_deltas, reverse_deltas, would_keep_balances_non_negative,
            AccountBalanceContext, AccountDelta, TransactionEffectInput,
        },
        category::Category,
        transaction::{
            category_type_for_transaction, is_investment_type, is_valid_recurring_frequency,
            is_valid_transaction_type, requires_destination_account, requires_investment_detail,
            supports_splits, CreateTransactionRequest, InvestmentDetailView, Transaction,
            TransactionSplit, TransactionSplitInput, TransactionSplitView, TransactionSummary,
            TransactionView, UpdateTransactionRequest, RECURRING_FREQUENCIES, TRANSACTION_TYPES,
        },
    },
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/", get(list_transactions).post(create_transaction))
        .route("/summary", get(transaction_summary))
        .route("/export/csv", get(export_transactions_csv))
        .route("/bulk", post(bulk_transactions))
        .route(
            "/:id",
            patch(update_transaction).delete(soft_delete_transaction),
        )
}

async fn list_transactions(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<TransactionListQuery>,
) -> Result<Json<Value>> {
    let filters = NormalizedTransactionQuery::from_query(query, true)?;
    let mut rows = fetch_transaction_rows(&state.db, &user.id, &filters).await?;
    let has_more = rows.len() > filters.limit as usize;

    if has_more {
        rows.pop();
    }

    let next_cursor = if has_more {
        rows.last().map(transaction_cursor)
    } else {
        None
    };
    let transactions = hydrate_transaction_views(&state.db, &user.id, rows).await?;

    Ok(Json(json!({
        "transactions": transactions,
        "next_cursor": next_cursor,
    })))
}

async fn transaction_summary(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<TransactionListQuery>,
) -> Result<Json<Value>> {
    let filters = NormalizedTransactionQuery::from_query(query, false)?;
    let summary = fetch_transaction_summary(&state.db, &user.id, &filters).await?;
    Ok(Json(json!({ "summary": summary })))
}

async fn create_transaction(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateTransactionRequest>,
) -> Result<(StatusCode, Json<Value>)> {
    let input = ValidatedTransactionInput::from_create(&state.db, &user.id, req).await?;
    let id = Uuid::new_v4().to_string();
    let mut tx = state.db.begin().await?;

    let (new_deltas, new_contexts) =
        calculate_new_deltas_in_tx(&mut tx, &user.id, &input, &BTreeMap::new()).await?;
    ensure_balances_can_apply(&new_contexts, &new_deltas)?;

    insert_transaction_in_tx(&mut tx, &id, &user.id, &input).await?;
    replace_splits_in_tx(&mut tx, &id, &user.id, &input.splits).await?;
    replace_tags_in_tx(&mut tx, &id, &user.id, &input.tags).await?;
    apply_account_deltas_in_tx(&mut tx, &user.id, &new_deltas).await?;
    replace_account_effects_in_tx(&mut tx, &id, &user.id, &new_deltas).await?;

    if let Some(ref detail) = input.investment_detail {
        let cost_basis = if input.transaction_type == "investment_sell" {
            compute_cost_basis_in_tx(
                &mut tx,
                &user.id,
                &input.account_id,
                &detail.instrument_id,
                &input.date,
            )
            .await?
        } else {
            None
        };
        let detail_with_basis = ValidatedInvestmentDetail {
            cost_basis_per_unit_paise: cost_basis,
            ..detail.clone()
        };
        upsert_investment_detail_in_tx(&mut tx, &id, &user.id, &detail_with_basis).await?;
    }

    let view = fetch_transaction_view_in_tx(&mut tx, &id, &user.id).await?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "create",
        "transaction",
        &id,
        json!({ "after": view }),
    )
    .await?;

    tx.commit().await?;

    Ok((StatusCode::CREATED, Json(json!({ "transaction": view }))))
}

async fn update_transaction(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
    Json(req): Json<UpdateTransactionRequest>,
) -> Result<Json<Value>> {
    let mut tx = state.db.begin().await?;
    let before_view = fetch_transaction_view_in_tx(&mut tx, &id, &user.id).await?;
    let current = fetch_active_transaction_in_tx(&mut tx, &id, &user.id).await?;
    let current_splits = fetch_transaction_splits_in_tx(&mut tx, &id, &user.id).await?;
    let current_tags = fetch_transaction_tags_in_tx(&mut tx, &id, &user.id).await?;
    let input = ValidatedTransactionInput::from_update(
        &state.db,
        &user.id,
        req,
        &current,
        &current_splits,
        current_tags,
        before_view.investment_detail.as_ref(),
    )
    .await?;

    let old_deltas = fetch_account_effects_in_tx(&mut tx, &id, &user.id).await?;
    let reverse_old_deltas = reverse_deltas(&old_deltas);
    let mut old_context_ids = old_transaction_account_ids(&current);
    old_context_ids.extend(old_deltas.iter().map(|delta| delta.account_id.clone()));
    let old_contexts =
        fetch_account_contexts_by_ids_in_tx(&mut tx, &user.id, old_context_ids, false).await?;
    let simulated_contexts = contexts_after_deltas(old_contexts.clone(), &reverse_old_deltas);
    let simulated_context_map = context_map(simulated_contexts);

    let (new_deltas, new_contexts) =
        calculate_new_deltas_in_tx(&mut tx, &user.id, &input, &simulated_context_map).await?;
    let combined_deltas = merge_deltas(
        reverse_old_deltas
            .iter()
            .cloned()
            .chain(new_deltas.iter().cloned())
            .collect(),
    );

    let original_contexts = merge_contexts(old_contexts, new_contexts);
    ensure_balances_can_apply(&original_contexts, &combined_deltas)?;

    update_transaction_in_tx(&mut tx, &id, &user.id, &input).await?;
    replace_splits_in_tx(&mut tx, &id, &user.id, &input.splits).await?;
    replace_tags_in_tx(&mut tx, &id, &user.id, &input.tags).await?;
    apply_account_deltas_in_tx(&mut tx, &user.id, &combined_deltas).await?;
    replace_account_effects_in_tx(&mut tx, &id, &user.id, &new_deltas).await?;

    if let Some(ref detail) = input.investment_detail {
        let cost_basis = if input.transaction_type == "investment_sell" {
            compute_cost_basis_in_tx(
                &mut tx,
                &user.id,
                &input.account_id,
                &detail.instrument_id,
                &input.date,
            )
            .await?
        } else {
            None
        };
        let detail_with_basis = ValidatedInvestmentDetail {
            cost_basis_per_unit_paise: cost_basis,
            ..detail.clone()
        };
        upsert_investment_detail_in_tx(&mut tx, &id, &user.id, &detail_with_basis).await?;
    } else if !is_investment_type(&input.transaction_type) {
        // type was changed away from investment type, clean up any stale detail
        delete_investment_detail_in_tx(&mut tx, &id, &user.id).await?;
    }

    let after_view = fetch_transaction_view_in_tx(&mut tx, &id, &user.id).await?;
    insert_audit_log(
        &mut tx,
        &user.id,
        "update",
        "transaction",
        &id,
        json!({
            "before": before_view,
            "after": after_view,
        }),
    )
    .await?;

    tx.commit().await?;

    Ok(Json(json!({ "transaction": after_view })))
}

async fn soft_delete_transaction(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let mut tx = state.db.begin().await?;
    soft_delete_transaction_in_tx(&mut tx, &id, &user.id).await?;
    tx.commit().await?;

    Ok(StatusCode::NO_CONTENT)
}

async fn bulk_transactions(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<BulkTransactionRequest>,
) -> Result<Json<Value>> {
    let ids = normalize_bulk_ids(req.ids)?;
    let action = req.action.trim().to_ascii_lowercase();
    let mut tx = state.db.begin().await?;

    match action.as_str() {
        "soft_delete" => {
            for id in &ids {
                soft_delete_transaction_in_tx(&mut tx, id, &user.id).await?;
            }
        }
        "add_tag" => {
            let tag = normalize_required_tag(req.tag)?;
            for id in &ids {
                fetch_active_transaction_in_tx(&mut tx, id, &user.id).await?;
                insert_tag_in_tx(&mut tx, id, &user.id, &tag).await?;
                insert_audit_log(
                    &mut tx,
                    &user.id,
                    "bulk_add_tag",
                    "transaction",
                    id,
                    json!({ "tag": tag }),
                )
                .await?;
            }
        }
        "remove_tag" => {
            let tag = normalize_required_tag(req.tag)?;
            for id in &ids {
                fetch_active_transaction_in_tx(&mut tx, id, &user.id).await?;
                sqlx::query(
                    "DELETE FROM transaction_tags
                     WHERE user_id = ? AND transaction_id = ? AND tag = ?",
                )
                .bind(&user.id)
                .bind(id)
                .bind(&tag)
                .execute(&mut *tx)
                .await?;
                insert_audit_log(
                    &mut tx,
                    &user.id,
                    "bulk_remove_tag",
                    "transaction",
                    id,
                    json!({ "tag": tag }),
                )
                .await?;
            }
        }
        "categorize" => {
            let category_id = req
                .category_id
                .ok_or_else(|| AppError::BadRequest("category_id is required".into()))?;
            let category = fetch_active_category(&state.db, &category_id, &user.id).await?;

            for id in &ids {
                let transaction = fetch_active_transaction_in_tx(&mut tx, id, &user.id).await?;
                validate_category_for_transaction(
                    Some(&category),
                    &transaction.transaction_type,
                    false,
                )?;
                ensure_transaction_has_no_splits_in_tx(&mut tx, id, &user.id).await?;

                sqlx::query(
                    "UPDATE transactions
                     SET category_id = ?,
                         updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
                     WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                )
                .bind(&category_id)
                .bind(id)
                .bind(&user.id)
                .execute(&mut *tx)
                .await?;
                insert_audit_log(
                    &mut tx,
                    &user.id,
                    "bulk_categorize",
                    "transaction",
                    id,
                    json!({ "category_id": category_id }),
                )
                .await?;
            }
        }
        _ => {
            return Err(AppError::BadRequest(
                "Bulk action must be soft_delete, add_tag, remove_tag, or categorize".into(),
            ))
        }
    }

    tx.commit().await?;

    Ok(Json(json!({ "updated": ids.len() })))
}

async fn export_transactions_csv(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(query): Query<TransactionListQuery>,
) -> Result<impl IntoResponse> {
    let mut filters = NormalizedTransactionQuery::from_query(query, false)?;
    filters.limit = 10_000;
    let mut rows = fetch_transaction_rows(&state.db, &user.id, &filters).await?;
    rows.truncate(10_000);
    let transactions = hydrate_transaction_views(&state.db, &user.id, rows).await?;
    let body = transactions_to_csv(&transactions);

    Ok((
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8"),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"artha-transactions.csv\"",
            ),
        ],
        body,
    ))
}

#[derive(Debug, Deserialize, Default)]
struct TransactionListQuery {
    cursor: Option<String>,
    limit: Option<i64>,
    date_from: Option<String>,
    date_to: Option<String>,
    account_id: Option<String>,
    category_id: Option<String>,
    #[serde(rename = "type")]
    transaction_type: Option<String>,
    tag: Option<String>,
    search: Option<String>,
    amount_min: Option<i64>,
    amount_max: Option<i64>,
    sort: Option<String>,
}

#[derive(Debug, Clone)]
struct NormalizedTransactionQuery {
    cursor: Option<TransactionCursor>,
    limit: i64,
    date_from: Option<String>,
    date_to: Option<String>,
    account_id: Option<String>,
    category_id: Option<String>,
    transaction_type: Option<String>,
    tag: Option<String>,
    search: Option<String>,
    amount_min: Option<i64>,
    amount_max: Option<i64>,
}

impl NormalizedTransactionQuery {
    fn from_query(query: TransactionListQuery, include_cursor: bool) -> Result<Self> {
        let (default_from, default_to) = current_month_range();
        let has_date_filter = query.date_from.is_some() || query.date_to.is_some();
        let date_from = match query.date_from {
            Some(date) => Some(normalize_date_filter(date, "date_from")?),
            None if !has_date_filter => Some(default_from),
            None => None,
        };
        let date_to = match query.date_to {
            Some(date) => Some(normalize_date_filter(date, "date_to")?),
            None if !has_date_filter => Some(default_to),
            None => None,
        };

        if let (Some(from), Some(to)) = (&date_from, &date_to) {
            if parse_date(from)? > parse_date(to)? {
                return Err(AppError::BadRequest(
                    "date_from must be before or equal to date_to".into(),
                ));
            }
        }

        let limit = query.limit.unwrap_or(50);
        if !(1..=500).contains(&limit) {
            return Err(AppError::BadRequest(
                "limit must be between 1 and 500".into(),
            ));
        }

        let amount_min = normalize_optional_amount(query.amount_min, "amount_min")?;
        let amount_max = normalize_optional_amount(query.amount_max, "amount_max")?;
        if let (Some(min), Some(max)) = (amount_min, amount_max) {
            if min > max {
                return Err(AppError::BadRequest(
                    "amount_min must be less than or equal to amount_max".into(),
                ));
            }
        }

        validate_sort(query.sort)?;

        Ok(NormalizedTransactionQuery {
            cursor: if include_cursor {
                query.cursor.map(parse_cursor).transpose()?
            } else {
                None
            },
            limit,
            date_from,
            date_to,
            account_id: normalize_optional_id(query.account_id),
            category_id: normalize_optional_id(query.category_id),
            transaction_type: query
                .transaction_type
                .map(validate_transaction_type)
                .transpose()?,
            tag: query
                .tag
                .map(|tag| normalize_required_tag(Some(tag)))
                .transpose()?,
            search: normalize_search(query.search)?,
            amount_min,
            amount_max,
        })
    }
}

#[derive(Debug, Clone)]
struct TransactionCursor {
    date: String,
    created_at: String,
    rowid: i64,
}

#[derive(Debug, Clone)]
struct ValidatedTransactionInput {
    account_id: String,
    transfer_account_id: Option<String>,
    transaction_type: String,
    date: String,
    description: String,
    amount_paise: i64,
    category_id: Option<String>,
    notes: Option<String>,
    tags: Vec<String>,
    splits: Vec<ValidatedSplitInput>,
    is_recurring: bool,
    recurrence_frequency: Option<String>,
    fx_rate: Option<f64>,
    fx_to_amount_paise: Option<i64>,
    fx_fee_paise: i64,
    investment_detail: Option<ValidatedInvestmentDetail>,
}

#[derive(Debug, Clone)]
struct ValidatedSplitInput {
    category_id: String,
    amount_paise: i64,
    notes: Option<String>,
}

#[derive(Debug, Clone)]
struct ValidatedInvestmentDetail {
    instrument_id: String,
    quantity: f64,
    price_per_unit_paise: i64,
    fees_paise: i64,
    cost_basis_per_unit_paise: Option<i64>, // computed on sell
}

impl ValidatedTransactionInput {
    async fn from_create(
        pool: &SqlitePool,
        user_id: &str,
        req: CreateTransactionRequest,
    ) -> Result<Self> {
        validate_transaction_input(
            pool,
            user_id,
            TransactionInputParts {
                account_id: req.account_id,
                transfer_account_id: req.transfer_account_id,
                transaction_type: req.transaction_type,
                date: req.date,
                description: req.description,
                amount_paise: req.amount_paise,
                category_id: req.category_id,
                notes: req.notes,
                tags: req.tags.unwrap_or_default(),
                splits: req.splits.unwrap_or_default(),
                is_recurring: req.is_recurring.unwrap_or(false),
                recurrence_frequency: req.recurrence_frequency,
                fx_rate: req.fx_rate,
                fx_to_amount_paise: req.fx_to_amount_paise,
                fx_fee_paise: req.fx_fee_paise,
                instrument_id: req.instrument_id,
                quantity: req.quantity,
                price_per_unit_paise: req.price_per_unit_paise,
                fees_paise: req.fees_paise,
            },
        )
        .await
    }

    async fn from_update(
        pool: &SqlitePool,
        user_id: &str,
        req: UpdateTransactionRequest,
        current: &Transaction,
        current_splits: &[TransactionSplit],
        current_tags: Vec<String>,
        current_investment_detail: Option<&InvestmentDetailView>,
    ) -> Result<Self> {
        let fx_context_was_supplied = req.account_id.is_some()
            || req.transfer_account_id.is_some()
            || req.transaction_type.is_some()
            || req.amount_paise.is_some();
        let splits_were_supplied = req.splits.is_some();
        let splits = match req.splits {
            Some(splits) => splits,
            None => current_splits
                .iter()
                .map(|split| TransactionSplitInput {
                    category_id: split.category_id.clone().unwrap_or_default(),
                    amount_paise: split.amount_paise,
                    notes: split.notes.clone(),
                })
                .collect(),
        };

        let category_id = match req.category_id {
            Some(category_id) => category_id,
            None if splits_were_supplied && !splits.is_empty() => None,
            None => current.category_id.clone(),
        };

        validate_transaction_input(
            pool,
            user_id,
            TransactionInputParts {
                account_id: req.account_id.unwrap_or_else(|| current.account_id.clone()),
                transfer_account_id: match req.transfer_account_id {
                    Some(transfer_account_id) => transfer_account_id,
                    None => current.transfer_account_id.clone(),
                },
                transaction_type: req
                    .transaction_type
                    .unwrap_or_else(|| current.transaction_type.clone()),
                date: req.date.unwrap_or_else(|| current.date.clone()),
                description: req
                    .description
                    .unwrap_or_else(|| current.description.clone()),
                amount_paise: req.amount_paise.unwrap_or(current.amount_paise),
                category_id,
                notes: match req.notes {
                    Some(notes) => notes,
                    None => current.notes.clone(),
                },
                tags: req.tags.unwrap_or(current_tags),
                splits,
                is_recurring: req.is_recurring.unwrap_or(current.is_recurring),
                recurrence_frequency: match req.recurrence_frequency {
                    Some(frequency) => frequency,
                    None => current.recurrence_frequency.clone(),
                },
                fx_rate: match req.fx_rate {
                    Some(rate) => rate,
                    None if fx_context_was_supplied => None,
                    None => current.fx_rate,
                },
                fx_to_amount_paise: match req.fx_to_amount_paise {
                    Some(amount) => amount,
                    None if fx_context_was_supplied => None,
                    None => current.fx_to_amount_paise,
                },
                fx_fee_paise: match req.fx_fee_paise {
                    Some(fee) => fee,
                    None if fx_context_was_supplied => None,
                    None => Some(current.fx_fee_paise),
                },
                // Investment detail fields: use request if provided, fall back to current detail
                instrument_id: match req.instrument_id {
                    Some(id) => id,
                    None => current_investment_detail.map(|d| d.instrument_id.clone()),
                },
                quantity: req
                    .quantity
                    .or_else(|| current_investment_detail.map(|d| d.quantity)),
                price_per_unit_paise: req
                    .price_per_unit_paise
                    .or_else(|| current_investment_detail.map(|d| d.price_per_unit_paise)),
                fees_paise: req
                    .fees_paise
                    .or_else(|| current_investment_detail.map(|d| d.fees_paise)),
            },
        )
        .await
    }
}

struct TransactionInputParts {
    account_id: String,
    transfer_account_id: Option<String>,
    transaction_type: String,
    date: String,
    description: String,
    amount_paise: i64,
    category_id: Option<String>,
    notes: Option<String>,
    tags: Vec<String>,
    splits: Vec<TransactionSplitInput>,
    is_recurring: bool,
    recurrence_frequency: Option<String>,
    fx_rate: Option<f64>,
    fx_to_amount_paise: Option<i64>,
    fx_fee_paise: Option<i64>,
    instrument_id: Option<String>,
    quantity: Option<f64>,
    price_per_unit_paise: Option<i64>,
    fees_paise: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct BulkTransactionRequest {
    ids: Vec<String>,
    action: String,
    category_id: Option<String>,
    tag: Option<String>,
}

#[derive(Debug, Clone, FromRow)]
struct TransactionJoinedRow {
    rowid: i64,
    id: String,
    account_id: String,
    account_name: String,
    transfer_account_id: Option<String>,
    transfer_account_name: Option<String>,
    transaction_type: String,
    date: String,
    description: String,
    amount_paise: i64,
    category_id: Option<String>,
    category_name: Option<String>,
    notes: Option<String>,
    is_recurring: bool,
    recurrence_frequency: Option<String>,
    created_at: String,
    updated_at: String,
    fx_rate: Option<f64>,
    fx_to_amount_paise: Option<i64>,
    fx_fee_paise: i64,
}

#[derive(Debug, Clone, FromRow)]
struct TransactionSplitJoinedRow {
    id: String,
    category_id: Option<String>,
    category_name: Option<String>,
    amount_paise: i64,
    notes: Option<String>,
}

#[derive(Debug, FromRow)]
struct SummaryRow {
    count: i64,
    total_income_paise: i64,
    total_expense_paise: i64,
}

async fn validate_transaction_input(
    pool: &SqlitePool,
    user_id: &str,
    parts: TransactionInputParts,
) -> Result<ValidatedTransactionInput> {
    let transaction_type = validate_transaction_type(parts.transaction_type)?;
    let amount_paise = validate_positive_amount(parts.amount_paise)?;
    let date = validate_transaction_date(parts.date)?;
    let description = validate_description(parts.description)?;
    let notes = normalize_notes(parts.notes)?;
    let tags = normalize_tags(parts.tags)?;
    let splits =
        validate_splits(pool, user_id, parts.splits, amount_paise, &transaction_type).await?;
    let category_id =
        validate_transaction_category(pool, user_id, parts.category_id, &transaction_type, &splits)
            .await?;
    let transfer_account_id =
        validate_transfer_account_id(parts.transfer_account_id, &transaction_type)?;
    let recurrence_frequency = validate_recurrence(parts.is_recurring, parts.recurrence_frequency)?;

    let (fx_rate, fx_to_amount_paise, fx_fee_paise) = validate_fx_fields(
        parts.fx_rate,
        parts.fx_to_amount_paise,
        parts.fx_fee_paise,
        &transaction_type,
    )?;

    let investment_detail = validate_investment_detail(
        pool,
        user_id,
        parts.instrument_id,
        parts.quantity,
        parts.price_per_unit_paise,
        parts.fees_paise,
        &transaction_type,
    )
    .await?;

    Ok(ValidatedTransactionInput {
        account_id: normalize_required_id(parts.account_id, "account_id")?,
        transfer_account_id,
        transaction_type,
        date,
        description,
        amount_paise,
        category_id,
        notes,
        tags,
        splits,
        is_recurring: parts.is_recurring,
        recurrence_frequency,
        fx_rate,
        fx_to_amount_paise,
        fx_fee_paise,
        investment_detail,
    })
}

fn validate_fx_fields(
    fx_rate: Option<f64>,
    fx_to_amount_paise: Option<i64>,
    fx_fee_paise: Option<i64>,
    transaction_type: &str,
) -> Result<(Option<f64>, Option<i64>, i64)> {
    let fee = fx_fee_paise.unwrap_or(0);
    if fee < 0 {
        return Err(AppError::BadRequest(
            "fx_fee_paise cannot be negative".into(),
        ));
    }

    let has_fx = fx_rate.is_some() || fx_to_amount_paise.is_some() || fee != 0;

    if has_fx && transaction_type != "transfer" {
        return Err(AppError::BadRequest(
            "FX fields are only allowed for transfer transactions".into(),
        ));
    }

    if has_fx {
        let rate = fx_rate.ok_or_else(|| {
            AppError::BadRequest("fx_rate is required when fx_to_amount_paise is set".into())
        })?;
        if rate <= 0.0 {
            return Err(AppError::BadRequest("fx_rate must be positive".into()));
        }
        let to_amount = fx_to_amount_paise.ok_or_else(|| {
            AppError::BadRequest("fx_to_amount_paise is required when fx_rate is set".into())
        })?;
        if to_amount <= 0 {
            return Err(AppError::BadRequest(
                "fx_to_amount_paise must be positive".into(),
            ));
        }
        Ok((Some(rate), Some(to_amount), fee))
    } else {
        Ok((None, None, fee))
    }
}

async fn validate_investment_detail(
    pool: &SqlitePool,
    user_id: &str,
    instrument_id: Option<String>,
    quantity: Option<f64>,
    price_per_unit_paise: Option<i64>,
    fees_paise: Option<i64>,
    transaction_type: &str,
) -> Result<Option<ValidatedInvestmentDetail>> {
    let has_investment_fields = instrument_id.is_some()
        || quantity.is_some()
        || price_per_unit_paise.is_some()
        || fees_paise.is_some();

    if !is_investment_type(transaction_type) {
        if has_investment_fields {
            return Err(AppError::BadRequest(
                "Investment fields are only allowed for investment_buy, investment_sell, and dividend transactions".into(),
            ));
        }
        return Ok(None);
    }

    if transaction_type == "dividend" {
        return match instrument_id {
            Some(instrument_id) => {
                let instrument_id =
                    validate_active_instrument_id(pool, user_id, Some(instrument_id)).await?;
                Ok(Some(ValidatedInvestmentDetail {
                    instrument_id,
                    // Dividends are cash income. These neutral values exist only because
                    // the optional instrument link is stored in the investment detail table.
                    quantity: 1.0,
                    price_per_unit_paise: 0,
                    fees_paise: 0,
                    cost_basis_per_unit_paise: None,
                }))
            }
            None => Ok(None),
        };
    }

    if requires_investment_detail(transaction_type) && !has_investment_fields {
        return Err(AppError::BadRequest(format!(
            "{transaction_type} transactions require investment detail fields (instrument_id, quantity, price_per_unit_paise)"
        )));
    }

    if !has_investment_fields {
        // dividend without detail is allowed
        return Ok(None);
    }

    let instrument_id = validate_active_instrument_id(pool, user_id, instrument_id).await?;

    let qty = quantity.ok_or_else(|| {
        AppError::BadRequest("quantity is required for investment transactions".into())
    })?;
    if qty <= 0.0 {
        return Err(AppError::BadRequest("quantity must be positive".into()));
    }

    let price = price_per_unit_paise.ok_or_else(|| {
        AppError::BadRequest("price_per_unit_paise is required for investment transactions".into())
    })?;
    if price < 0 {
        return Err(AppError::BadRequest(
            "price_per_unit_paise cannot be negative".into(),
        ));
    }

    let fees = fees_paise.unwrap_or(0);
    if fees < 0 {
        return Err(AppError::BadRequest("fees_paise cannot be negative".into()));
    }

    Ok(Some(ValidatedInvestmentDetail {
        instrument_id,
        quantity: qty,
        price_per_unit_paise: price,
        fees_paise: fees,
        cost_basis_per_unit_paise: None, // computed later for sells
    }))
}

async fn validate_active_instrument_id(
    pool: &SqlitePool,
    user_id: &str,
    instrument_id: Option<String>,
) -> Result<String> {
    let instrument_id = instrument_id.ok_or_else(|| {
        AppError::BadRequest("instrument_id is required for investment transactions".into())
    })?;
    let instrument_id = normalize_required_id(instrument_id, "instrument_id")?;

    let exists: Option<(String,)> =
        sqlx::query_as("SELECT id FROM instruments WHERE id = ? AND user_id = ? AND is_active = 1")
            .bind(&instrument_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("Instrument not found".into()));
    }

    Ok(instrument_id)
}

async fn validate_splits(
    pool: &SqlitePool,
    user_id: &str,
    splits: Vec<TransactionSplitInput>,
    amount_paise: i64,
    transaction_type: &str,
) -> Result<Vec<ValidatedSplitInput>> {
    if splits.is_empty() {
        return Ok(Vec::new());
    }

    if !supports_splits(transaction_type) {
        return Err(AppError::BadRequest(
            "Only income and expense transactions can be split".into(),
        ));
    }
    if splits.len() > 20 {
        return Err(AppError::BadRequest(
            "A transaction can have at most 20 splits".into(),
        ));
    }

    let expected_category_type =
        category_type_for_transaction(transaction_type).ok_or_else(|| {
            AppError::BadRequest("Transaction type does not support categories".into())
        })?;
    let mut total = 0_i64;
    let mut validated = Vec::with_capacity(splits.len());

    for split in splits {
        let amount = validate_positive_amount(split.amount_paise)?;
        total = total
            .checked_add(amount)
            .ok_or_else(|| AppError::BadRequest("Split total is too large".into()))?;
        let category = fetch_active_category(pool, &split.category_id, user_id).await?;
        if category.category_type != expected_category_type {
            return Err(AppError::BadRequest(format!(
                "Split category must be a {expected_category_type} category"
            )));
        }

        validated.push(ValidatedSplitInput {
            category_id: category.id,
            amount_paise: amount,
            notes: normalize_notes(split.notes)?,
        });
    }

    if total != amount_paise {
        return Err(AppError::BadRequest(
            "Split amounts must add up exactly to the transaction amount".into(),
        ));
    }

    Ok(validated)
}

async fn validate_transaction_category(
    pool: &SqlitePool,
    user_id: &str,
    category_id: Option<String>,
    transaction_type: &str,
    splits: &[ValidatedSplitInput],
) -> Result<Option<String>> {
    if !splits.is_empty() {
        if category_id.is_some() {
            return Err(AppError::BadRequest(
                "Split transactions should not also set a top-level category".into(),
            ));
        }
        return Ok(None);
    }

    let expected_category_type = category_type_for_transaction(transaction_type);

    match (category_id, expected_category_type) {
        (Some(category_id), Some(_)) => {
            let category = fetch_active_category(pool, &category_id, user_id).await?;
            validate_category_for_transaction(Some(&category), transaction_type, false)?;
            Ok(Some(category.id))
        }
        (None, Some(expected)) => Err(AppError::BadRequest(format!(
            "{transaction_type} transactions require a {expected} category"
        ))),
        (Some(_), None) => Err(AppError::BadRequest(
            "This transaction type does not support categories".into(),
        )),
        (None, None) => Ok(None),
    }
}

fn validate_category_for_transaction(
    category: Option<&Category>,
    transaction_type: &str,
    allow_missing: bool,
) -> Result<()> {
    let expected = category_type_for_transaction(transaction_type);
    match (category, expected) {
        (Some(category), Some(expected)) if category.category_type == expected => Ok(()),
        (Some(_), Some(expected)) => Err(AppError::BadRequest(format!(
            "Category must be a {expected} category"
        ))),
        (None, Some(_)) if allow_missing => Ok(()),
        (None, Some(expected)) => Err(AppError::BadRequest(format!(
            "{transaction_type} transactions require a {expected} category"
        ))),
        (Some(_), None) => Err(AppError::BadRequest(
            "This transaction type does not support categories".into(),
        )),
        (None, None) => Ok(()),
    }
}

fn validate_transfer_account_id(
    transfer_account_id: Option<String>,
    transaction_type: &str,
) -> Result<Option<String>> {
    let transfer_account_id = transfer_account_id
        .map(|id| normalize_required_id(id, "transfer_account_id"))
        .transpose()?;

    if requires_destination_account(transaction_type) && transfer_account_id.is_none() {
        return Err(AppError::BadRequest(
            "Destination account is required for this transaction type".into(),
        ));
    }
    if !requires_destination_account(transaction_type) && transfer_account_id.is_some() {
        return Err(AppError::BadRequest(
            "Destination account is only allowed for transfers and repayments".into(),
        ));
    }

    Ok(transfer_account_id)
}

fn validate_recurrence(
    is_recurring: bool,
    recurrence_frequency: Option<String>,
) -> Result<Option<String>> {
    match (is_recurring, recurrence_frequency) {
        (true, Some(frequency)) => {
            let frequency = frequency.trim().to_ascii_lowercase();
            if is_valid_recurring_frequency(&frequency) {
                Ok(Some(frequency))
            } else {
                Err(AppError::BadRequest(format!(
                    "Recurrence frequency must be one of: {}",
                    RECURRING_FREQUENCIES.join(", ")
                )))
            }
        }
        (true, None) => Err(AppError::BadRequest(
            "Recurring transactions require recurrence_frequency".into(),
        )),
        (false, Some(_)) => Err(AppError::BadRequest(
            "recurrence_frequency is only allowed when is_recurring is true".into(),
        )),
        (false, None) => Ok(None),
    }
}

async fn calculate_new_deltas_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    user_id: &str,
    input: &ValidatedTransactionInput,
    account_overrides: &BTreeMap<String, AccountBalanceContext>,
) -> Result<(Vec<AccountDelta>, Vec<AccountBalanceContext>)> {
    let account =
        account_context_for_input(tx, user_id, &input.account_id, true, account_overrides).await?;
    let destination_account = match &input.transfer_account_id {
        Some(id) => {
            Some(account_context_for_input(tx, user_id, id, true, account_overrides).await?)
        }
        None => None,
    };

    let mut contexts = vec![account.clone()];
    if let Some(destination) = &destination_account {
        contexts.push(destination.clone());
    }

    validate_transfer_fx_against_accounts(input, &account, destination_account.as_ref())?;

    let deltas = calculate_account_deltas(&TransactionEffectInput {
        transaction_type: input.transaction_type.clone(),
        amount_paise: input.amount_paise,
        account,
        destination_account,
        fx_to_amount_paise: input.fx_to_amount_paise,
    })
    .map_err(AppError::BadRequest)?;

    Ok((non_zero_deltas(deltas), contexts))
}

fn validate_transfer_fx_against_accounts(
    input: &ValidatedTransactionInput,
    account: &AccountBalanceContext,
    destination_account: Option<&AccountBalanceContext>,
) -> Result<()> {
    if input.transaction_type != "transfer" {
        return Ok(());
    }

    let Some(destination) = destination_account else {
        return Ok(());
    };

    let cross_currency = account.currency != destination.currency;
    let has_fx =
        input.fx_rate.is_some() || input.fx_to_amount_paise.is_some() || input.fx_fee_paise != 0;

    if cross_currency {
        let rate = input.fx_rate.ok_or_else(|| {
            AppError::BadRequest(
                "Cross-currency transfers require fx_rate and fx_to_amount_paise".into(),
            )
        })?;
        let to_amount = input.fx_to_amount_paise.ok_or_else(|| {
            AppError::BadRequest(
                "Cross-currency transfers require fx_rate and fx_to_amount_paise".into(),
            )
        })?;
        let expected = (input.amount_paise as f64 * rate).round() as i64;
        if (expected - to_amount).abs() > 1 {
            return Err(AppError::BadRequest(
                "fx_to_amount_paise must match amount_paise multiplied by fx_rate".into(),
            ));
        }
    } else if has_fx {
        return Err(AppError::BadRequest(
            "FX fields are only allowed when transfer accounts use different currencies".into(),
        ));
    }

    Ok(())
}

async fn account_context_for_input(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    user_id: &str,
    account_id: &str,
    require_active: bool,
    account_overrides: &BTreeMap<String, AccountBalanceContext>,
) -> Result<AccountBalanceContext> {
    if let Some(context) = account_overrides.get(account_id) {
        return Ok(context.clone());
    }

    fetch_account_context_in_tx(tx, account_id, user_id, require_active).await
}

fn ensure_balances_can_apply(
    contexts: &[AccountBalanceContext],
    deltas: &[AccountDelta],
) -> Result<()> {
    if would_keep_balances_non_negative(contexts, deltas) {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "Transaction would make an account balance invalid or consume funds blocked for goals"
                .into(),
        ))
    }
}

async fn soft_delete_transaction_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: &str,
    user_id: &str,
) -> Result<()> {
    let before_view = fetch_transaction_view_in_tx(tx, id, user_id).await?;
    let old_deltas = fetch_account_effects_in_tx(tx, id, user_id).await?;
    let reverse_old_deltas = reverse_deltas(&old_deltas);
    let contexts = fetch_account_contexts_by_ids_in_tx(
        tx,
        user_id,
        old_deltas
            .iter()
            .map(|delta| delta.account_id.clone())
            .collect(),
        false,
    )
    .await?;
    ensure_balances_can_apply(&contexts, &reverse_old_deltas)?;

    apply_account_deltas_in_tx(tx, user_id, &reverse_old_deltas).await?;
    delete_investment_detail_in_tx(tx, id, user_id).await?;
    sqlx::query(
        "UPDATE transactions
         SET deleted_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;

    insert_audit_log(
        tx,
        user_id,
        "soft_delete",
        "transaction",
        id,
        json!({
            "before": before_view,
            "after": { "deleted": true },
        }),
    )
    .await?;

    Ok(())
}

fn append_transaction_filters(
    builder: &mut QueryBuilder<'_, Sqlite>,
    user_id: &str,
    filters: &NormalizedTransactionQuery,
    include_cursor: bool,
) {
    builder
        .push(" WHERE t.user_id = ")
        .push_bind(user_id.to_string())
        .push(" AND t.deleted_at IS NULL");

    if let Some(date_from) = &filters.date_from {
        builder.push(" AND t.date >= ").push_bind(date_from.clone());
    }
    if let Some(date_to) = &filters.date_to {
        builder.push(" AND t.date <= ").push_bind(date_to.clone());
    }
    if let Some(account_id) = &filters.account_id {
        builder
            .push(" AND (t.account_id = ")
            .push_bind(account_id.clone())
            .push(" OR t.transfer_account_id = ")
            .push_bind(account_id.clone())
            .push(")");
    }
    if let Some(category_id) = &filters.category_id {
        builder
            .push(" AND (t.category_id = ")
            .push_bind(category_id.clone())
            .push(
                " OR EXISTS (
                    SELECT 1 FROM transaction_splits s
                    WHERE s.user_id = t.user_id
                      AND s.transaction_id = t.id
                      AND s.category_id = ",
            )
            .push_bind(category_id.clone())
            .push("))");
    }
    if let Some(transaction_type) = &filters.transaction_type {
        builder
            .push(" AND t.type = ")
            .push_bind(transaction_type.clone());
    }
    if let Some(tag) = &filters.tag {
        builder
            .push(
                " AND EXISTS (
                    SELECT 1 FROM transaction_tags tt
                    WHERE tt.user_id = t.user_id
                      AND tt.transaction_id = t.id
                      AND tt.tag = ",
            )
            .push_bind(tag.clone())
            .push(")");
    }
    if let Some(search) = &filters.search {
        let pattern = format!("%{search}%");
        builder
            .push(" AND (t.description LIKE ")
            .push_bind(pattern.clone())
            .push(" OR t.notes LIKE ")
            .push_bind(pattern)
            .push(")");
    }
    if let Some(amount_min) = filters.amount_min {
        builder
            .push(" AND t.amount_paise >= ")
            .push_bind(amount_min);
    }
    if let Some(amount_max) = filters.amount_max {
        builder
            .push(" AND t.amount_paise <= ")
            .push_bind(amount_max);
    }
    if include_cursor {
        if let Some(cursor) = &filters.cursor {
            builder
                .push(" AND (t.date < ")
                .push_bind(cursor.date.clone())
                .push(" OR (t.date = ")
                .push_bind(cursor.date.clone())
                .push(" AND t.created_at < ")
                .push_bind(cursor.created_at.clone())
                .push(") OR (t.date = ")
                .push_bind(cursor.date.clone())
                .push(" AND t.created_at = ")
                .push_bind(cursor.created_at.clone())
                .push(" AND t.rowid < ")
                .push_bind(cursor.rowid)
                .push("))");
        }
    }
}

async fn fetch_transaction_rows(
    pool: &SqlitePool,
    user_id: &str,
    filters: &NormalizedTransactionQuery,
) -> Result<Vec<TransactionJoinedRow>> {
    let mut builder = QueryBuilder::<Sqlite>::new(transaction_select_sql());
    append_transaction_filters(&mut builder, user_id, filters, true);
    builder
        .push(" ORDER BY t.date DESC, t.created_at DESC, t.rowid DESC LIMIT ")
        .push_bind(filters.limit + 1);

    Ok(builder.build_query_as().fetch_all(pool).await?)
}

async fn fetch_transaction_summary(
    pool: &SqlitePool,
    user_id: &str,
    filters: &NormalizedTransactionQuery,
) -> Result<TransactionSummary> {
    let mut builder = QueryBuilder::<Sqlite>::new(
        "SELECT COUNT(*) AS count,
                COALESCE(SUM(CASE WHEN t.type IN ('income', 'dividend') THEN t.amount_paise ELSE 0 END), 0) AS total_income_paise,
                COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount_paise ELSE 0 END), 0) AS total_expense_paise
         FROM transactions t",
    );
    append_transaction_filters(&mut builder, user_id, filters, false);

    let row: SummaryRow = builder.build_query_as().fetch_one(pool).await?;
    Ok(TransactionSummary {
        count: row.count,
        total_income_paise: row.total_income_paise,
        total_expense_paise: row.total_expense_paise,
        net_paise: row.total_income_paise - row.total_expense_paise,
    })
}

async fn hydrate_transaction_views(
    pool: &SqlitePool,
    user_id: &str,
    rows: Vec<TransactionJoinedRow>,
) -> Result<Vec<TransactionView>> {
    let mut views = Vec::with_capacity(rows.len());
    for row in rows {
        let tags = fetch_transaction_tags(pool, &row.id, user_id).await?;
        let splits = fetch_transaction_split_views(pool, &row.id, user_id).await?;
        let transaction_type = row.transaction_type.clone();
        let transaction_id = row.id.clone();
        let mut view = row_to_view(row, tags, splits);
        if is_investment_type(&transaction_type) {
            view.investment_detail =
                fetch_investment_detail(pool, &transaction_id, user_id).await?;
        }
        views.push(view);
    }
    Ok(views)
}

async fn fetch_transaction_view_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: &str,
    user_id: &str,
) -> Result<TransactionView> {
    let row = sqlx::query_as::<_, TransactionJoinedRow>(&format!(
        "{} WHERE t.id = ? AND t.user_id = ? AND t.deleted_at IS NULL",
        transaction_select_sql()
    ))
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Transaction not found".into()))?;
    let tags = fetch_transaction_tags_in_tx(tx, id, user_id).await?;
    let splits = fetch_transaction_split_views_in_tx(tx, id, user_id).await?;
    let transaction_type = row.transaction_type.clone();
    let mut view = row_to_view(row, tags, splits);
    if is_investment_type(&transaction_type) {
        view.investment_detail = fetch_investment_detail_in_tx(tx, id, user_id).await?;
    }

    Ok(view)
}

fn row_to_view(
    row: TransactionJoinedRow,
    tags: Vec<String>,
    splits: Vec<TransactionSplitView>,
) -> TransactionView {
    TransactionView {
        id: row.id,
        account_id: row.account_id,
        account_name: row.account_name,
        transfer_account_id: row.transfer_account_id,
        transfer_account_name: row.transfer_account_name,
        transaction_type: row.transaction_type,
        date: row.date,
        description: row.description,
        amount_paise: row.amount_paise,
        category_id: row.category_id,
        category_name: row.category_name,
        notes: row.notes,
        tags,
        splits,
        is_recurring: row.is_recurring,
        recurrence_frequency: row.recurrence_frequency,
        created_at: row.created_at,
        updated_at: row.updated_at,
        fx_rate: row.fx_rate,
        fx_to_amount_paise: row.fx_to_amount_paise,
        fx_fee_paise: row.fx_fee_paise,
        investment_detail: None, // hydrated separately
    }
}

fn transaction_select_sql() -> &'static str {
    "SELECT t.rowid AS rowid,
            t.id,
            t.account_id,
            a.name AS account_name,
            t.transfer_account_id,
            ta.name AS transfer_account_name,
            t.type AS transaction_type,
            t.date,
            t.description,
            t.amount_paise,
            t.category_id,
            c.name AS category_name,
            t.notes,
            t.is_recurring,
            t.recurrence_frequency,
            t.created_at,
            t.updated_at,
            t.fx_rate,
            t.fx_to_amount_paise,
            t.fx_fee_paise
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     LEFT JOIN accounts ta ON ta.id = t.transfer_account_id AND ta.user_id = t.user_id
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id"
}

async fn insert_transaction_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: &str,
    user_id: &str,
    input: &ValidatedTransactionInput,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO transactions (
            id, user_id, account_id, transfer_account_id, type, date, description,
            amount_paise, category_id, notes, is_recurring, recurrence_frequency,
            fx_rate, fx_to_amount_paise, fx_fee_paise
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(user_id)
    .bind(&input.account_id)
    .bind(&input.transfer_account_id)
    .bind(&input.transaction_type)
    .bind(&input.date)
    .bind(&input.description)
    .bind(input.amount_paise)
    .bind(&input.category_id)
    .bind(&input.notes)
    .bind(input.is_recurring)
    .bind(&input.recurrence_frequency)
    .bind(input.fx_rate)
    .bind(input.fx_to_amount_paise)
    .bind(input.fx_fee_paise)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn update_transaction_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: &str,
    user_id: &str,
    input: &ValidatedTransactionInput,
) -> Result<()> {
    sqlx::query(
        "UPDATE transactions
         SET account_id = ?,
             transfer_account_id = ?,
             type = ?,
             date = ?,
             description = ?,
             amount_paise = ?,
             category_id = ?,
             notes = ?,
             is_recurring = ?,
             recurrence_frequency = ?,
             fx_rate = ?,
             fx_to_amount_paise = ?,
             fx_fee_paise = ?,
             updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .bind(&input.account_id)
    .bind(&input.transfer_account_id)
    .bind(&input.transaction_type)
    .bind(&input.date)
    .bind(&input.description)
    .bind(input.amount_paise)
    .bind(&input.category_id)
    .bind(&input.notes)
    .bind(input.is_recurring)
    .bind(&input.recurrence_frequency)
    .bind(input.fx_rate)
    .bind(input.fx_to_amount_paise)
    .bind(input.fx_fee_paise)
    .bind(id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn upsert_investment_detail_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
    detail: &ValidatedInvestmentDetail,
) -> Result<()> {
    // Delete any existing detail for this transaction first
    sqlx::query(
        "DELETE FROM investment_transaction_details
         WHERE user_id = ? AND transaction_id = ?",
    )
    .bind(user_id)
    .bind(transaction_id)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        "INSERT INTO investment_transaction_details (
            id, user_id, transaction_id, instrument_id, quantity,
            price_per_unit_paise, fees_paise, cost_basis_per_unit_paise
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user_id)
    .bind(transaction_id)
    .bind(&detail.instrument_id)
    .bind(detail.quantity)
    .bind(detail.price_per_unit_paise)
    .bind(detail.fees_paise)
    .bind(detail.cost_basis_per_unit_paise)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn delete_investment_detail_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
) -> Result<()> {
    sqlx::query(
        "DELETE FROM investment_transaction_details
         WHERE user_id = ? AND transaction_id = ?",
    )
    .bind(user_id)
    .bind(transaction_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn fetch_investment_detail(
    pool: &SqlitePool,
    transaction_id: &str,
    user_id: &str,
) -> Result<Option<InvestmentDetailView>> {
    #[derive(sqlx::FromRow)]
    struct InvDetailRow {
        instrument_id: String,
        instrument_name: String,
        instrument_ticker: Option<String>,
        quantity: f64,
        price_per_unit_paise: i64,
        fees_paise: i64,
        cost_basis_per_unit_paise: Option<i64>,
    }

    let row = sqlx::query_as::<_, InvDetailRow>(
        "SELECT itd.instrument_id,
                i.name AS instrument_name,
                i.ticker AS instrument_ticker,
                itd.quantity,
                itd.price_per_unit_paise,
                itd.fees_paise,
                itd.cost_basis_per_unit_paise
         FROM investment_transaction_details itd
         JOIN instruments i ON i.id = itd.instrument_id
         WHERE itd.user_id = ? AND itd.transaction_id = ?",
    )
    .bind(user_id)
    .bind(transaction_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| InvestmentDetailView {
        instrument_id: r.instrument_id,
        instrument_name: r.instrument_name,
        instrument_ticker: r.instrument_ticker,
        quantity: r.quantity,
        price_per_unit_paise: r.price_per_unit_paise,
        fees_paise: r.fees_paise,
        cost_basis_per_unit_paise: r.cost_basis_per_unit_paise,
    }))
}

async fn fetch_investment_detail_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
) -> Result<Option<InvestmentDetailView>> {
    #[derive(sqlx::FromRow)]
    struct InvDetailRow {
        instrument_id: String,
        instrument_name: String,
        instrument_ticker: Option<String>,
        quantity: f64,
        price_per_unit_paise: i64,
        fees_paise: i64,
        cost_basis_per_unit_paise: Option<i64>,
    }

    let row = sqlx::query_as::<_, InvDetailRow>(
        "SELECT itd.instrument_id,
                i.name AS instrument_name,
                i.ticker AS instrument_ticker,
                itd.quantity,
                itd.price_per_unit_paise,
                itd.fees_paise,
                itd.cost_basis_per_unit_paise
         FROM investment_transaction_details itd
         JOIN instruments i ON i.id = itd.instrument_id
         WHERE itd.user_id = ? AND itd.transaction_id = ?",
    )
    .bind(user_id)
    .bind(transaction_id)
    .fetch_optional(&mut **tx)
    .await?;

    Ok(row.map(|r| InvestmentDetailView {
        instrument_id: r.instrument_id,
        instrument_name: r.instrument_name,
        instrument_ticker: r.instrument_ticker,
        quantity: r.quantity,
        price_per_unit_paise: r.price_per_unit_paise,
        fees_paise: r.fees_paise,
        cost_basis_per_unit_paise: r.cost_basis_per_unit_paise,
    }))
}

async fn compute_cost_basis_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    user_id: &str,
    account_id: &str,
    instrument_id: &str,
    date: &str,
) -> Result<Option<i64>> {
    #[derive(sqlx::FromRow)]
    struct CostBasisRow {
        total_cost: Option<f64>,
        total_qty: Option<f64>,
    }

    let row = sqlx::query_as::<_, CostBasisRow>(
        "SELECT
            SUM(CAST(itd.quantity * itd.price_per_unit_paise AS REAL) + itd.fees_paise) AS total_cost,
            SUM(itd.quantity) AS total_qty
         FROM investment_transaction_details itd
         JOIN transactions t ON t.id = itd.transaction_id
         WHERE t.user_id = ?
           AND t.account_id = ?
           AND itd.instrument_id = ?
           AND t.type = 'investment_buy'
           AND t.deleted_at IS NULL
           AND t.date <= ?",
    )
    .bind(user_id)
    .bind(account_id)
    .bind(instrument_id)
    .bind(date)
    .fetch_optional(&mut **tx)
    .await?;

    Ok(row.and_then(|r| match (r.total_cost, r.total_qty) {
        (Some(cost), Some(qty)) if qty > 0.0 => Some((cost / qty) as i64),
        _ => None,
    }))
}

async fn replace_splits_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
    splits: &[ValidatedSplitInput],
) -> Result<()> {
    sqlx::query("DELETE FROM transaction_splits WHERE user_id = ? AND transaction_id = ?")
        .bind(user_id)
        .bind(transaction_id)
        .execute(&mut **tx)
        .await?;

    for split in splits {
        sqlx::query(
            "INSERT INTO transaction_splits (
                id, user_id, transaction_id, category_id, amount_paise, notes
            ) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(user_id)
        .bind(transaction_id)
        .bind(&split.category_id)
        .bind(split.amount_paise)
        .bind(&split.notes)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

async fn replace_tags_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
    tags: &[String],
) -> Result<()> {
    sqlx::query("DELETE FROM transaction_tags WHERE user_id = ? AND transaction_id = ?")
        .bind(user_id)
        .bind(transaction_id)
        .execute(&mut **tx)
        .await?;

    for tag in tags {
        insert_tag_in_tx(tx, transaction_id, user_id, tag).await?;
    }

    Ok(())
}

async fn insert_tag_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
    tag: &str,
) -> Result<()> {
    sqlx::query(
        "INSERT OR IGNORE INTO transaction_tags (id, user_id, transaction_id, tag)
         VALUES (?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(user_id)
    .bind(transaction_id)
    .bind(tag)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn replace_account_effects_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
    deltas: &[AccountDelta],
) -> Result<()> {
    sqlx::query("DELETE FROM transaction_account_effects WHERE user_id = ? AND transaction_id = ?")
        .bind(user_id)
        .bind(transaction_id)
        .execute(&mut **tx)
        .await?;

    for delta in deltas {
        sqlx::query(
            "INSERT INTO transaction_account_effects (
                id, user_id, transaction_id, account_id, balance_delta_paise, inr_value_delta_paise
            ) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(user_id)
        .bind(transaction_id)
        .bind(&delta.account_id)
        .bind(delta.balance_delta_paise)
        .bind(delta.inr_value_delta_paise)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

async fn apply_account_deltas_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    user_id: &str,
    deltas: &[AccountDelta],
) -> Result<()> {
    for delta in deltas {
        if delta.balance_delta_paise == 0 && delta.inr_value_delta_paise == 0 {
            continue;
        }

        sqlx::query(
            "UPDATE accounts
             SET balance_paise = balance_paise + ?,
                 inr_value_paise = inr_value_paise + ?,
                 last_updated = strftime('%Y-%m-%d %H:%M:%S', 'now'),
                 updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
             WHERE id = ? AND user_id = ?",
        )
        .bind(delta.balance_delta_paise)
        .bind(delta.inr_value_delta_paise)
        .bind(&delta.account_id)
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

async fn fetch_active_transaction_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: &str,
    user_id: &str,
) -> Result<Transaction> {
    sqlx::query_as::<_, Transaction>(
        "SELECT id,
                user_id,
                account_id,
                transfer_account_id,
                type AS transaction_type,
                date,
                description,
                amount_paise,
                category_id,
                notes,
                is_recurring,
                recurrence_frequency,
                deleted_at,
                created_at,
                updated_at,
                fx_rate,
                fx_to_amount_paise,
                fx_fee_paise
         FROM transactions
         WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut **tx)
    .await?
    .ok_or_else(|| AppError::NotFound("Transaction not found".into()))
}

async fn fetch_transaction_splits_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
) -> Result<Vec<TransactionSplit>> {
    Ok(sqlx::query_as::<_, TransactionSplit>(
        "SELECT id, user_id, transaction_id, category_id, amount_paise, notes
         FROM transaction_splits
         WHERE user_id = ? AND transaction_id = ?
         ORDER BY rowid",
    )
    .bind(user_id)
    .bind(transaction_id)
    .fetch_all(&mut **tx)
    .await?)
}

async fn fetch_transaction_tags(
    pool: &SqlitePool,
    transaction_id: &str,
    user_id: &str,
) -> Result<Vec<String>> {
    fetch_tags_with_executor(pool, transaction_id, user_id).await
}

async fn fetch_transaction_tags_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
) -> Result<Vec<String>> {
    #[derive(FromRow)]
    struct TagRow {
        tag: String,
    }

    let rows = sqlx::query_as::<_, TagRow>(
        "SELECT tag
         FROM transaction_tags
         WHERE user_id = ? AND transaction_id = ?
         ORDER BY tag",
    )
    .bind(user_id)
    .bind(transaction_id)
    .fetch_all(&mut **tx)
    .await?;

    Ok(rows.into_iter().map(|row| row.tag).collect())
}

async fn fetch_tags_with_executor(
    pool: &SqlitePool,
    transaction_id: &str,
    user_id: &str,
) -> Result<Vec<String>> {
    #[derive(FromRow)]
    struct TagRow {
        tag: String,
    }

    let rows = sqlx::query_as::<_, TagRow>(
        "SELECT tag
         FROM transaction_tags
         WHERE user_id = ? AND transaction_id = ?
         ORDER BY tag",
    )
    .bind(user_id)
    .bind(transaction_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|row| row.tag).collect())
}

async fn fetch_transaction_split_views(
    pool: &SqlitePool,
    transaction_id: &str,
    user_id: &str,
) -> Result<Vec<TransactionSplitView>> {
    let rows = sqlx::query_as::<_, TransactionSplitJoinedRow>(
        "SELECT s.id,
                s.category_id,
                c.name AS category_name,
                s.amount_paise,
                s.notes
         FROM transaction_splits s
         LEFT JOIN categories c ON c.id = s.category_id AND c.user_id = s.user_id
         WHERE s.user_id = ? AND s.transaction_id = ?
         ORDER BY s.rowid",
    )
    .bind(user_id)
    .bind(transaction_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(split_row_to_view).collect())
}

async fn fetch_transaction_split_views_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
) -> Result<Vec<TransactionSplitView>> {
    let rows = sqlx::query_as::<_, TransactionSplitJoinedRow>(
        "SELECT s.id,
                s.category_id,
                c.name AS category_name,
                s.amount_paise,
                s.notes
         FROM transaction_splits s
         LEFT JOIN categories c ON c.id = s.category_id AND c.user_id = s.user_id
         WHERE s.user_id = ? AND s.transaction_id = ?
         ORDER BY s.rowid",
    )
    .bind(user_id)
    .bind(transaction_id)
    .fetch_all(&mut **tx)
    .await?;

    Ok(rows.into_iter().map(split_row_to_view).collect())
}

fn split_row_to_view(row: TransactionSplitJoinedRow) -> TransactionSplitView {
    TransactionSplitView {
        id: row.id,
        category_id: row.category_id,
        category_name: row.category_name,
        amount_paise: row.amount_paise,
        notes: row.notes,
    }
}

async fn fetch_account_effects_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
) -> Result<Vec<AccountDelta>> {
    #[derive(FromRow)]
    struct EffectRow {
        account_id: String,
        balance_delta_paise: i64,
        inr_value_delta_paise: i64,
    }

    let rows = sqlx::query_as::<_, EffectRow>(
        "SELECT account_id, balance_delta_paise, inr_value_delta_paise
         FROM transaction_account_effects
         WHERE user_id = ? AND transaction_id = ?",
    )
    .bind(user_id)
    .bind(transaction_id)
    .fetch_all(&mut **tx)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| AccountDelta {
            account_id: row.account_id,
            balance_delta_paise: row.balance_delta_paise,
            inr_value_delta_paise: row.inr_value_delta_paise,
        })
        .collect())
}

async fn fetch_account_context_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: &str,
    user_id: &str,
    require_active: bool,
) -> Result<AccountBalanceContext> {
    let sql = if require_active {
        "SELECT id,
                type AS account_type,
                currency,
                balance_paise,
                inr_value_paise,
                COALESCE((
                    SELECT SUM(g.current_blocked_paise)
                    FROM goals g
                    WHERE g.user_id = accounts.user_id
                      AND g.source_account_id = accounts.id
                      AND g.status = 'active'
                ), 0) AS blocked_paise
         FROM accounts
         WHERE id = ? AND user_id = ? AND is_active = 1"
    } else {
        "SELECT id,
                type AS account_type,
                currency,
                balance_paise,
                inr_value_paise,
                COALESCE((
                    SELECT SUM(g.current_blocked_paise)
                    FROM goals g
                    WHERE g.user_id = accounts.user_id
                      AND g.source_account_id = accounts.id
                      AND g.status = 'active'
                ), 0) AS blocked_paise
         FROM accounts
         WHERE id = ? AND user_id = ?"
    };

    sqlx::query_as::<_, AccountBalanceContext>(sql)
        .bind(id)
        .bind(user_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| AppError::NotFound("Account not found".into()))
}

async fn fetch_account_contexts_by_ids_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    user_id: &str,
    ids: Vec<String>,
    require_active: bool,
) -> Result<Vec<AccountBalanceContext>> {
    let unique_ids: BTreeSet<String> = ids.into_iter().filter(|id| !id.is_empty()).collect();
    let mut contexts = Vec::with_capacity(unique_ids.len());

    for id in unique_ids {
        contexts.push(fetch_account_context_in_tx(tx, &id, user_id, require_active).await?);
    }

    Ok(contexts)
}

async fn fetch_active_category(pool: &SqlitePool, id: &str, user_id: &str) -> Result<Category> {
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

async fn ensure_transaction_has_no_splits_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    transaction_id: &str,
    user_id: &str,
) -> Result<()> {
    #[derive(FromRow)]
    struct CountRow {
        count: i64,
    }

    let row = sqlx::query_as::<_, CountRow>(
        "SELECT COUNT(*) AS count
         FROM transaction_splits
         WHERE user_id = ? AND transaction_id = ?",
    )
    .bind(user_id)
    .bind(transaction_id)
    .fetch_one(&mut **tx)
    .await?;

    if row.count > 0 {
        return Err(AppError::BadRequest(
            "Split transactions cannot be bulk categorized".into(),
        ));
    }

    Ok(())
}

fn old_transaction_account_ids(transaction: &Transaction) -> Vec<String> {
    let mut ids = vec![transaction.account_id.clone()];
    if let Some(id) = &transaction.transfer_account_id {
        ids.push(id.clone());
    }
    ids
}

fn contexts_after_deltas(
    contexts: Vec<AccountBalanceContext>,
    deltas: &[AccountDelta],
) -> Vec<AccountBalanceContext> {
    let mut contexts = context_map(contexts);
    for delta in deltas {
        if let Some(context) = contexts.get_mut(&delta.account_id) {
            context.balance_paise += delta.balance_delta_paise;
            context.inr_value_paise += delta.inr_value_delta_paise;
        }
    }
    contexts.into_values().collect()
}

fn context_map(contexts: Vec<AccountBalanceContext>) -> BTreeMap<String, AccountBalanceContext> {
    contexts
        .into_iter()
        .map(|context| (context.id.clone(), context))
        .collect()
}

fn merge_contexts(
    first: Vec<AccountBalanceContext>,
    second: Vec<AccountBalanceContext>,
) -> Vec<AccountBalanceContext> {
    let mut contexts = context_map(first);
    for context in second {
        contexts.entry(context.id.clone()).or_insert(context);
    }
    contexts.into_values().collect()
}

fn merge_deltas(deltas: Vec<AccountDelta>) -> Vec<AccountDelta> {
    let mut merged: BTreeMap<String, AccountDelta> = BTreeMap::new();
    for delta in deltas {
        merged
            .entry(delta.account_id.clone())
            .and_modify(|existing| {
                existing.balance_delta_paise += delta.balance_delta_paise;
                existing.inr_value_delta_paise += delta.inr_value_delta_paise;
            })
            .or_insert(delta);
    }

    non_zero_deltas(merged.into_values().collect())
}

fn non_zero_deltas(deltas: Vec<AccountDelta>) -> Vec<AccountDelta> {
    deltas
        .into_iter()
        .filter(|delta| delta.balance_delta_paise != 0 || delta.inr_value_delta_paise != 0)
        .collect()
}

fn transaction_cursor(row: &TransactionJoinedRow) -> String {
    format!("{}|{}|{}", row.date, row.created_at, row.rowid)
}

fn parse_cursor(cursor: String) -> Result<TransactionCursor> {
    let cursor = cursor.trim();
    let mut parts = cursor.split('|');
    let (Some(date), Some(created_at), Some(rowid), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(AppError::BadRequest(
            "cursor must use the format date|created_at|rowid".into(),
        ));
    };
    Ok(TransactionCursor {
        date: normalize_date_filter(date.to_string(), "cursor date")?,
        created_at: normalize_required_string(created_at.to_string(), "cursor created_at")?,
        rowid: parse_cursor_rowid(rowid)?,
    })
}

fn current_month_range() -> (String, String) {
    let today = Utc::now().date_naive();
    let start = NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap();
    let (next_year, next_month) = if today.month() == 12 {
        (today.year() + 1, 1)
    } else {
        (today.year(), today.month() + 1)
    };
    let next_month_start = NaiveDate::from_ymd_opt(next_year, next_month, 1).unwrap();
    let end = next_month_start.pred_opt().unwrap();

    (start.to_string(), end.to_string())
}

fn normalize_date_filter(date: String, label: &str) -> Result<String> {
    let date = date.trim().to_string();
    parse_date(&date)
        .map_err(|_| AppError::BadRequest(format!("{label} must use YYYY-MM-DD format")))?;
    Ok(date)
}

fn validate_transaction_date(date: String) -> Result<String> {
    normalize_date_filter(date, "date")
}

fn parse_date(date: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| AppError::BadRequest("Date must use YYYY-MM-DD format".into()))
}

fn validate_transaction_type(transaction_type: String) -> Result<String> {
    let transaction_type = transaction_type.trim().to_ascii_lowercase();
    if is_valid_transaction_type(&transaction_type) {
        Ok(transaction_type)
    } else {
        Err(AppError::BadRequest(format!(
            "Transaction type must be one of: {}",
            TRANSACTION_TYPES.join(", ")
        )))
    }
}

fn validate_positive_amount(amount: i64) -> Result<i64> {
    if amount <= 0 {
        Err(AppError::BadRequest("Amount must be positive".into()))
    } else {
        Ok(amount)
    }
}

fn normalize_optional_amount(amount: Option<i64>, label: &str) -> Result<Option<i64>> {
    match amount {
        Some(amount) if amount < 0 => {
            Err(AppError::BadRequest(format!("{label} cannot be negative")))
        }
        _ => Ok(amount),
    }
}

fn validate_description(description: String) -> Result<String> {
    let description = description.trim().to_string();
    if description.is_empty() {
        return Err(AppError::BadRequest("Description is required".into()));
    }
    if description.len() > 200 {
        return Err(AppError::BadRequest(
            "Description must be 200 characters or fewer".into(),
        ));
    }
    Ok(description)
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

fn normalize_tags(tags: Vec<String>) -> Result<Vec<String>> {
    let mut seen = BTreeSet::new();
    for tag in tags {
        let tag = normalize_required_tag(Some(tag))?;
        seen.insert(tag);
    }
    Ok(seen.into_iter().collect())
}

fn normalize_required_tag(tag: Option<String>) -> Result<String> {
    let tag = tag
        .ok_or_else(|| AppError::BadRequest("tag is required".into()))?
        .trim()
        .trim_start_matches('#')
        .to_ascii_lowercase();

    if tag.is_empty() {
        return Err(AppError::BadRequest("tag is required".into()));
    }
    if tag.len() > 40 {
        return Err(AppError::BadRequest(
            "Tags must be 40 characters or fewer".into(),
        ));
    }
    if tag.chars().any(char::is_whitespace) {
        return Err(AppError::BadRequest(
            "Tags cannot contain whitespace".into(),
        ));
    }
    Ok(tag)
}

fn normalize_search(search: Option<String>) -> Result<Option<String>> {
    let Some(search) = search else {
        return Ok(None);
    };
    let search = search.trim().to_string();
    if search.len() > 100 {
        return Err(AppError::BadRequest(
            "Search must be 100 characters or fewer".into(),
        ));
    }
    if search.is_empty() {
        Ok(None)
    } else {
        Ok(Some(search))
    }
}

fn normalize_required_id(id: String, label: &str) -> Result<String> {
    let id = id.trim().to_string();
    if id.is_empty() {
        Err(AppError::BadRequest(format!("{label} is required")))
    } else {
        Ok(id)
    }
}

fn normalize_required_string(value: String, label: &str) -> Result<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        Err(AppError::BadRequest(format!("{label} is required")))
    } else {
        Ok(value)
    }
}

fn parse_cursor_rowid(rowid: &str) -> Result<i64> {
    let rowid = rowid
        .trim()
        .parse::<i64>()
        .map_err(|_| AppError::BadRequest("cursor rowid must be a positive integer".into()))?;
    if rowid <= 0 {
        return Err(AppError::BadRequest(
            "cursor rowid must be a positive integer".into(),
        ));
    }
    Ok(rowid)
}

fn normalize_optional_id(id: Option<String>) -> Option<String> {
    id.map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

fn validate_sort(sort: Option<String>) -> Result<()> {
    match sort
        .as_deref()
        .map(str::trim)
        .filter(|sort| !sort.is_empty())
    {
        None | Some("date_desc") => Ok(()),
        Some(_) => Err(AppError::BadRequest(
            "Only date_desc sort is supported by cursor pagination in this phase".into(),
        )),
    }
}

fn normalize_bulk_ids(ids: Vec<String>) -> Result<Vec<String>> {
    if ids.is_empty() {
        return Err(AppError::BadRequest("ids cannot be empty".into()));
    }
    if ids.len() > 100 {
        return Err(AppError::BadRequest(
            "Bulk actions can include at most 100 transactions".into(),
        ));
    }

    let mut seen = BTreeSet::new();
    for id in ids {
        seen.insert(normalize_required_id(id, "transaction id")?);
    }
    Ok(seen.into_iter().collect())
}

fn transactions_to_csv(transactions: &[TransactionView]) -> String {
    let mut csv = String::from(
        "date,type,description,account,destination_account,category,amount_paise,tags,notes\n",
    );

    for transaction in transactions {
        let destination = transaction
            .transfer_account_name
            .clone()
            .unwrap_or_default();
        let category = if transaction.splits.is_empty() {
            transaction.category_name.clone().unwrap_or_default()
        } else {
            transaction
                .splits
                .iter()
                .map(|split| {
                    format!(
                        "{}:{}",
                        split.category_name.clone().unwrap_or_default(),
                        split.amount_paise
                    )
                })
                .collect::<Vec<_>>()
                .join("; ")
        };

        csv.push_str(&csv_row(&[
            transaction.date.clone(),
            transaction.transaction_type.clone(),
            transaction.description.clone(),
            transaction.account_name.clone(),
            destination,
            category,
            transaction.amount_paise.to_string(),
            transaction.tags.join(" "),
            transaction.notes.clone().unwrap_or_default(),
        ]));
    }

    csv
}

fn csv_row(fields: &[String]) -> String {
    let mut row = fields
        .iter()
        .map(|field| csv_escape(field))
        .collect::<Vec<_>>()
        .join(",");
    row.push('\n');
    row
}

fn csv_escape(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_tags_case_and_hash_prefix() {
        let tags =
            normalize_tags(vec!["#Medical".into(), "medical".into(), "Trip".into()]).expect("tags");

        assert_eq!(tags, vec!["medical".to_string(), "trip".to_string()]);
    }

    #[test]
    fn csv_escape_quotes_commas_and_quotes() {
        assert_eq!(csv_escape("A, B"), "\"A, B\"");
        assert_eq!(csv_escape("A \"B\""), "\"A \"\"B\"\"\"");
    }

    #[test]
    fn parses_cursor_date_created_at_and_rowid() {
        let cursor = parse_cursor("2026-05-01|2026-05-01 10:30:00|42".into()).expect("cursor");

        assert_eq!(cursor.date, "2026-05-01");
        assert_eq!(cursor.created_at, "2026-05-01 10:30:00");
        assert_eq!(cursor.rowid, 42);
    }

    #[tokio::test]
    async fn dividend_instrument_link_does_not_require_quantity() {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("sqlite pool");
        sqlx::query(
            "CREATE TABLE instruments (
                id TEXT PRIMARY KEY NOT NULL,
                user_id TEXT NOT NULL,
                is_active INTEGER NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .expect("create instruments table");
        sqlx::query("INSERT INTO instruments (id, user_id, is_active) VALUES (?, ?, 1)")
            .bind("instrument-1")
            .bind("user-1")
            .execute(&pool)
            .await
            .expect("insert instrument");

        let detail = validate_investment_detail(
            &pool,
            "user-1",
            Some("instrument-1".into()),
            None,
            None,
            None,
            "dividend",
        )
        .await
        .expect("dividend validation")
        .expect("instrument link detail");

        assert_eq!(detail.instrument_id, "instrument-1");
        assert_eq!(detail.quantity, 1.0);
        assert_eq!(detail.price_per_unit_paise, 0);
        assert_eq!(detail.fees_paise, 0);
    }
}
