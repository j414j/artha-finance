use std::collections::BTreeMap;

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, SqlitePool};

use crate::{
    error::Result,
    middleware::auth::AuthUser,
    models::fx_rate::{rate_for_user_on_or_before, FxRateMap},
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/holdings", get(list_holdings))
        .route("/holdings/summary", get(holdings_summary))
}

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct HoldingsQuery {
    account_id: Option<String>,
}

// ---------------------------------------------------------------------------
// View structs
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct HoldingView {
    pub instrument_id: String,
    pub instrument_name: String,
    pub instrument_ticker: Option<String>,
    pub instrument_type: String,
    pub instrument_currency: String,
    pub instrument_sector: Option<String>,
    pub instrument_geography: Option<String>,
    pub account_id: String,
    pub account_name: String,
    pub quantity_held: f64,
    pub avg_cost_per_unit_paise: i64,
    pub invested_value_paise: i64,
    pub invested_value_inr_paise: Option<i64>,
    pub latest_price_paise: Option<i64>,
    pub latest_price_date: Option<String>,
    pub current_value_paise: Option<i64>,
    pub current_value_inr_paise: Option<i64>,
    pub unrealised_pnl_paise: Option<i64>,
    pub unrealised_pnl_inr_paise: Option<i64>,
    pub unrealised_pnl_pct: Option<f64>,
    pub realised_pnl_paise: i64,
    pub realised_pnl_inr_paise: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct HoldingsSummary {
    pub total_invested_paise: i64,
    pub total_current_value_paise: Option<i64>,
    pub total_unrealised_pnl_paise: Option<i64>,
    pub total_unrealised_pnl_pct: Option<f64>,
    pub total_realised_pnl_paise: i64,
    pub holdings_count: usize,
}

// ---------------------------------------------------------------------------
// Intermediate DB row
// ---------------------------------------------------------------------------

#[derive(Debug, FromRow)]
struct InvestmentTransactionRow {
    instrument_id: String,
    instrument_name: String,
    instrument_ticker: Option<String>,
    instrument_type: String,
    instrument_currency: String,
    instrument_sector: Option<String>,
    instrument_geography: Option<String>,
    account_id: String,
    account_name: String,
    transaction_type: String,
    date: String,
    quantity: f64,
    price_per_unit_paise: i64,
    fees_paise: i64,
    cost_basis_per_unit_paise: Option<i64>,
}

#[derive(Debug)]
struct HoldingAccumulator {
    instrument_id: String,
    instrument_name: String,
    instrument_ticker: Option<String>,
    instrument_type: String,
    instrument_currency: String,
    instrument_sector: Option<String>,
    instrument_geography: Option<String>,
    account_id: String,
    account_name: String,
    bought_quantity: f64,
    sold_quantity: f64,
    total_buy_cost_paise: i64,
    total_buy_cost_inr_paise: Option<i64>,
    realised_pnl_paise: i64,
    realised_pnl_inr_paise: Option<i64>,
    latest_buy_price_paise: Option<i64>,
    latest_buy_date: Option<String>,
}

#[derive(Debug, FromRow)]
struct LatestPriceRow {
    price_paise: i64,
    date: String,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/v1/investments/holdings
async fn list_holdings(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(q): Query<HoldingsQuery>,
) -> Result<Json<Value>> {
    let holdings = compute_holdings(&state.db, &user.id, q.account_id.as_deref()).await?;
    Ok(Json(json!({ "holdings": holdings })))
}

/// GET /api/v1/investments/holdings/summary
async fn holdings_summary(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(q): Query<HoldingsQuery>,
) -> Result<Json<Value>> {
    let holdings = compute_holdings(&state.db, &user.id, q.account_id.as_deref()).await?;

    let total_invested_paise: i64 = holdings
        .iter()
        .filter_map(|h| h.invested_value_inr_paise)
        .sum();
    let total_realised_pnl_paise: i64 = holdings
        .iter()
        .filter_map(|h| h.realised_pnl_inr_paise)
        .sum();
    let holdings_count = holdings.len();

    // Only compute current / unrealised totals when every holding has a price
    let all_have_prices = holdings.iter().all(|h| h.current_value_inr_paise.is_some());
    let (total_current_value_paise, total_unrealised_pnl_paise, total_unrealised_pnl_pct) =
        if all_have_prices {
            let total_current: i64 = holdings
                .iter()
                .map(|h| h.current_value_inr_paise.unwrap_or(0))
                .sum();
            let unrealised = total_current - total_invested_paise;
            let pct = if total_invested_paise != 0 {
                Some(unrealised as f64 / total_invested_paise as f64 * 100.0)
            } else {
                None
            };
            (Some(total_current), Some(unrealised), pct)
        } else {
            // Partial — sum whatever is available
            let partial_current: i64 = holdings
                .iter()
                .filter_map(|h| h.current_value_inr_paise)
                .sum();
            let partial_unrealised: i64 = holdings
                .iter()
                .filter_map(|h| h.unrealised_pnl_inr_paise)
                .sum();

            if partial_current == 0 && holdings.iter().all(|h| h.current_value_inr_paise.is_none())
            {
                (None, None, None)
            } else {
                (Some(partial_current), Some(partial_unrealised), None)
            }
        };

    let summary = HoldingsSummary {
        total_invested_paise,
        total_current_value_paise,
        total_unrealised_pnl_paise,
        total_unrealised_pnl_pct,
        total_realised_pnl_paise,
        holdings_count,
    };

    Ok(Json(json!({ "summary": summary })))
}

// ---------------------------------------------------------------------------
// Core computation
// ---------------------------------------------------------------------------

pub(crate) async fn compute_holdings(
    pool: &SqlitePool,
    user_id: &str,
    account_id: Option<&str>,
) -> Result<Vec<HoldingView>> {
    let rows: Vec<InvestmentTransactionRow> = match account_id {
        Some(aid) => {
            sqlx::query_as::<_, InvestmentTransactionRow>(
                "SELECT
                i.id        AS instrument_id,
                i.name      AS instrument_name,
                i.ticker    AS instrument_ticker,
                i.type      AS instrument_type,
                i.currency  AS instrument_currency,
                i.sector    AS instrument_sector,
                i.geography AS instrument_geography,
                t.account_id,
                a.name      AS account_name,
                t.type      AS transaction_type,
                t.date,
                itd.quantity,
                itd.price_per_unit_paise,
                itd.fees_paise,
                itd.cost_basis_per_unit_paise
             FROM investment_transaction_details itd
             JOIN transactions t  ON t.id  = itd.transaction_id
             JOIN instruments   i ON i.id  = itd.instrument_id
             JOIN accounts      a ON a.id  = t.account_id
             WHERE t.user_id    = ?
               AND t.deleted_at IS NULL
               AND t.type IN ('investment_buy', 'investment_sell')
               AND t.account_id = ?
             ORDER BY t.date ASC, t.created_at ASC, t.id ASC",
            )
            .bind(user_id)
            .bind(aid)
            .fetch_all(pool)
            .await?
        }

        None => {
            sqlx::query_as::<_, InvestmentTransactionRow>(
                "SELECT
                i.id        AS instrument_id,
                i.name      AS instrument_name,
                i.ticker    AS instrument_ticker,
                i.type      AS instrument_type,
                i.currency  AS instrument_currency,
                i.sector    AS instrument_sector,
                i.geography AS instrument_geography,
                t.account_id,
                a.name      AS account_name,
                t.type      AS transaction_type,
                t.date,
                itd.quantity,
                itd.price_per_unit_paise,
                itd.fees_paise,
                itd.cost_basis_per_unit_paise
             FROM investment_transaction_details itd
             JOIN transactions t  ON t.id  = itd.transaction_id
             JOIN instruments   i ON i.id  = itd.instrument_id
             JOIN accounts      a ON a.id  = t.account_id
             WHERE t.user_id    = ?
               AND t.deleted_at IS NULL
               AND t.type IN ('investment_buy', 'investment_sell')
             ORDER BY t.date ASC, t.created_at ASC, t.id ASC",
            )
            .bind(user_id)
            .fetch_all(pool)
            .await?
        }
    };

    let fx_rates = FxRateMap::latest_for_user(pool, user_id).await?;
    let mut accumulators: BTreeMap<(String, String), HoldingAccumulator> = BTreeMap::new();

    for row in rows {
        let key = (row.instrument_id.clone(), row.account_id.clone());
        let entry = accumulators
            .entry(key)
            .or_insert_with(|| HoldingAccumulator {
                instrument_id: row.instrument_id.clone(),
                instrument_name: row.instrument_name.clone(),
                instrument_ticker: row.instrument_ticker.clone(),
                instrument_type: row.instrument_type.clone(),
                instrument_currency: row.instrument_currency.clone(),
                instrument_sector: row.instrument_sector.clone(),
                instrument_geography: row.instrument_geography.clone(),
                account_id: row.account_id.clone(),
                account_name: row.account_name.clone(),
                bought_quantity: 0.0,
                sold_quantity: 0.0,
                total_buy_cost_paise: 0,
                total_buy_cost_inr_paise: Some(0),
                realised_pnl_paise: 0,
                realised_pnl_inr_paise: Some(0),
                latest_buy_price_paise: None,
                latest_buy_date: None,
            });

        if row.transaction_type == "investment_buy" {
            let gross =
                (row.quantity * row.price_per_unit_paise as f64).round() as i64 + row.fees_paise;
            entry.bought_quantity += row.quantity;
            entry.total_buy_cost_paise += gross;
            entry.total_buy_cost_inr_paise = add_optional_paise(
                entry.total_buy_cost_inr_paise,
                convert_to_inr_on_or_latest(
                    pool,
                    user_id,
                    &fx_rates,
                    &row.instrument_currency,
                    gross,
                    &row.date,
                )
                .await?,
            );
            if entry
                .latest_buy_date
                .as_deref()
                .map_or(true, |date| row.date.as_str() >= date)
            {
                entry.latest_buy_price_paise = Some(row.price_per_unit_paise);
                entry.latest_buy_date = Some(row.date.clone());
            }
        } else {
            let cost_basis = row.cost_basis_per_unit_paise.unwrap_or(0);
            let realised = ((row.price_per_unit_paise - cost_basis) as f64 * row.quantity).round()
                as i64
                - row.fees_paise;
            entry.sold_quantity += row.quantity;
            entry.realised_pnl_paise += realised;
            entry.realised_pnl_inr_paise = add_optional_paise(
                entry.realised_pnl_inr_paise,
                convert_to_inr_on_or_latest(
                    pool,
                    user_id,
                    &fx_rates,
                    &row.instrument_currency,
                    realised,
                    &row.date,
                )
                .await?,
            );
        }
    }

    let mut holdings: Vec<HoldingView> = Vec::with_capacity(accumulators.len());

    for row in accumulators.into_values() {
        let quantity_from_transactions = row.bought_quantity - row.sold_quantity;
        if quantity_from_transactions <= 0.0001 {
            continue;
        }

        let ca_delta: f64 = sqlx::query_scalar::<_, f64>(
            "SELECT COALESCE(SUM(quantity_delta), 0.0)
             FROM corporate_actions
             WHERE user_id = ? AND instrument_id = ? AND account_id = ?",
        )
        .bind(user_id)
        .bind(&row.instrument_id)
        .bind(&row.account_id)
        .fetch_one(pool)
        .await
        .unwrap_or(0.0);

        let quantity_held = quantity_from_transactions + ca_delta;
        if quantity_held <= 0.0001 {
            continue;
        }

        let remaining_cost_quantity = quantity_from_transactions.max(0.0);
        let native_cost_basis = if row.bought_quantity > 0.0 {
            ((row.total_buy_cost_paise as f64 / row.bought_quantity) * remaining_cost_quantity)
                .round() as i64
        } else {
            0
        };
        let invested_value_inr_paise = row.total_buy_cost_inr_paise.map(|total_inr| {
            if row.bought_quantity > 0.0 {
                ((total_inr as f64 / row.bought_quantity) * remaining_cost_quantity).round() as i64
            } else {
                0
            }
        });
        let avg_cost_per_unit_paise: i64 = if quantity_held > 0.0 {
            (native_cost_basis as f64 / quantity_held).round() as i64
        } else {
            0
        };

        let latest = sqlx::query_as::<_, LatestPriceRow>(
            "SELECT price_paise, date
             FROM price_snapshots
             WHERE user_id = ? AND instrument_id = ?
             ORDER BY date DESC, created_at DESC
             LIMIT 1",
        )
        .bind(user_id)
        .bind(&row.instrument_id)
        .fetch_optional(pool)
        .await?;

        let (
            latest_price_paise,
            latest_price_date,
            current_value_paise,
            current_value_inr_paise,
            unrealised_pnl_paise,
            unrealised_pnl_inr_paise,
            unrealised_pnl_pct,
        ) = match latest {
            Some(p) => {
                let current = (quantity_held * p.price_paise as f64).round() as i64;
                let current_inr = fx_rates.convert_to_inr_paise(&row.instrument_currency, current);
                let unrealised = current - native_cost_basis;
                let unrealised_inr = match (current_inr, invested_value_inr_paise) {
                    (Some(current), Some(invested)) => Some(current - invested),
                    _ => None,
                };
                let pct = if native_cost_basis != 0 {
                    Some(unrealised as f64 / native_cost_basis as f64 * 100.0)
                } else {
                    None
                };
                (
                    Some(p.price_paise),
                    Some(p.date),
                    Some(current),
                    current_inr,
                    Some(unrealised),
                    unrealised_inr,
                    pct,
                )
            }
            None => match (row.latest_buy_price_paise, row.latest_buy_date.clone()) {
                (Some(price), Some(date)) => {
                    let current = (quantity_held * price as f64).round() as i64;
                    let current_inr =
                        fx_rates.convert_to_inr_paise(&row.instrument_currency, current);
                    let unrealised = current - native_cost_basis;
                    let unrealised_inr = match (current_inr, invested_value_inr_paise) {
                        (Some(current), Some(invested)) => Some(current - invested),
                        _ => None,
                    };
                    let pct = if native_cost_basis != 0 {
                        Some(unrealised as f64 / native_cost_basis as f64 * 100.0)
                    } else {
                        None
                    };
                    (
                        Some(price),
                        Some(date),
                        Some(current),
                        current_inr,
                        Some(unrealised),
                        unrealised_inr,
                        pct,
                    )
                }
                _ => (None, None, None, None, None, None, None),
            },
        };

        holdings.push(HoldingView {
            instrument_id: row.instrument_id,
            instrument_name: row.instrument_name,
            instrument_ticker: row.instrument_ticker,
            instrument_type: row.instrument_type,
            instrument_currency: row.instrument_currency,
            instrument_sector: row.instrument_sector,
            instrument_geography: row.instrument_geography,
            account_id: row.account_id,
            account_name: row.account_name,
            quantity_held,
            avg_cost_per_unit_paise,
            invested_value_paise: native_cost_basis,
            invested_value_inr_paise,
            latest_price_paise,
            latest_price_date,
            current_value_paise,
            current_value_inr_paise,
            unrealised_pnl_paise,
            unrealised_pnl_inr_paise,
            unrealised_pnl_pct,
            realised_pnl_paise: row.realised_pnl_paise,
            realised_pnl_inr_paise: row.realised_pnl_inr_paise,
        });
    }

    Ok(holdings)
}

fn add_optional_paise(current: Option<i64>, next: Option<i64>) -> Option<i64> {
    match (current, next) {
        (Some(current), Some(next)) => Some(current + next),
        _ => None,
    }
}

async fn convert_to_inr_on_or_latest(
    pool: &sqlx::SqlitePool,
    user_id: &str,
    latest_rates: &FxRateMap,
    currency: &str,
    amount_paise: i64,
    date: &str,
) -> Result<Option<i64>> {
    if let Some(rate) = rate_for_user_on_or_before(pool, user_id, currency, "INR", date).await? {
        return Ok(Some((amount_paise as f64 * rate).round() as i64));
    }
    Ok(latest_rates.convert_to_inr_paise(currency, amount_paise))
}
