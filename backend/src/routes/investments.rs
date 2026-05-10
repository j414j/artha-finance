use std::collections::BTreeMap;

use axum::{
    extract::{Path, Query, State},
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
        .route("/holdings/:instrument_id/drilldown", get(holding_drilldown))
        .route("/portfolio-history", get(portfolio_history))
        .route("/xirr-summary", get(xirr_summary))
        .route("/dividend-income", get(dividend_income))
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

// ---------------------------------------------------------------------------
// Drilldown
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct DrilldownQuery {
    account_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ValueHistoryPoint {
    date: String,
    value_paise: i64,
}

#[derive(Debug, Serialize)]
struct BuyLot {
    transaction_id: String,
    date: String,
    description: String,
    quantity: f64,
    price_per_unit_paise: i64,
    fees_paise: i64,
    invested_paise: i64,
    current_value_paise: Option<i64>,
    pnl_paise: Option<i64>,
    pnl_pct: Option<f64>,
    days_held: i64,
    annualised_return_pct: Option<f64>,
}

#[derive(Debug, FromRow)]
struct BuyTxRow {
    transaction_id: String,
    date: String,
    description: String,
    quantity: f64,
    price_per_unit_paise: i64,
    fees_paise: i64,
}

#[derive(Debug, FromRow)]
struct SellQtyRow {
    date: String,
    quantity: f64,
}

#[derive(Debug, FromRow)]
struct PriceHistoryRow {
    date: String,
    price_paise: i64,
}

/// GET /api/v1/investments/holdings/:instrument_id/drilldown
async fn holding_drilldown(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(instrument_id): Path<String>,
    Query(q): Query<DrilldownQuery>,
) -> Result<Json<Value>> {
    let pool = &state.db;
    let account_id = q.account_id.as_deref();

    // Fetch all buy transactions for this instrument (+ optional account filter)
    let buy_rows: Vec<BuyTxRow> = if let Some(aid) = account_id {
        sqlx::query_as::<_, BuyTxRow>(
            "SELECT t.id AS transaction_id, t.date, t.description,
                    itd.quantity, itd.price_per_unit_paise, itd.fees_paise
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             WHERE t.user_id = ? AND itd.instrument_id = ? AND t.account_id = ?
               AND t.type = 'investment_buy' AND t.deleted_at IS NULL
             ORDER BY t.date ASC, t.created_at ASC",
        )
        .bind(&user.id)
        .bind(&instrument_id)
        .bind(aid)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, BuyTxRow>(
            "SELECT t.id AS transaction_id, t.date, t.description,
                    itd.quantity, itd.price_per_unit_paise, itd.fees_paise
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             WHERE t.user_id = ? AND itd.instrument_id = ?
               AND t.type = 'investment_buy' AND t.deleted_at IS NULL
             ORDER BY t.date ASC, t.created_at ASC",
        )
        .bind(&user.id)
        .bind(&instrument_id)
        .fetch_all(pool)
        .await?
    };

    // Fetch sell quantities (date-ordered) to support running balance for history
    let sell_rows: Vec<SellQtyRow> = if let Some(aid) = account_id {
        sqlx::query_as::<_, SellQtyRow>(
            "SELECT t.date, itd.quantity
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             WHERE t.user_id = ? AND itd.instrument_id = ? AND t.account_id = ?
               AND t.type = 'investment_sell' AND t.deleted_at IS NULL
             ORDER BY t.date ASC, t.created_at ASC",
        )
        .bind(&user.id)
        .bind(&instrument_id)
        .bind(aid)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, SellQtyRow>(
            "SELECT t.date, itd.quantity
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             WHERE t.user_id = ? AND itd.instrument_id = ?
               AND t.type = 'investment_sell' AND t.deleted_at IS NULL
             ORDER BY t.date ASC, t.created_at ASC",
        )
        .bind(&user.id)
        .bind(&instrument_id)
        .fetch_all(pool)
        .await?
    };

    // Latest price snapshot
    let latest_price: Option<PriceHistoryRow> = sqlx::query_as::<_, PriceHistoryRow>(
        "SELECT date, price_paise FROM price_snapshots
         WHERE user_id = ? AND instrument_id = ?
         ORDER BY date DESC, created_at DESC LIMIT 1",
    )
    .bind(&user.id)
    .bind(&instrument_id)
    .fetch_optional(pool)
    .await?;

    // All price snapshots for history chart (ascending)
    let price_history: Vec<PriceHistoryRow> = sqlx::query_as::<_, PriceHistoryRow>(
        "SELECT date, price_paise FROM price_snapshots
         WHERE user_id = ? AND instrument_id = ?
         ORDER BY date ASC",
    )
    .bind(&user.id)
    .bind(&instrument_id)
    .fetch_all(pool)
    .await?;

    let today = chrono::Local::now().date_naive().to_string();
    let effective_price = latest_price.as_ref().map(|p| p.price_paise);

    // Build buy lots
    let mut buy_lots: Vec<BuyLot> = Vec::with_capacity(buy_rows.len());
    let mut xirr_flows: Vec<(f64, f64)> = Vec::new(); // (amount, year_fraction from earliest)

    let earliest_date = buy_rows.first().map(|r| r.date.as_str()).unwrap_or(&today);

    for row in &buy_rows {
        let invested_paise = (row.quantity * row.price_per_unit_paise as f64).round() as i64
            + row.fees_paise;

        let current_value_paise = effective_price
            .map(|p| (row.quantity * p as f64).round() as i64);

        let pnl_paise = current_value_paise.map(|cv| cv - invested_paise);
        let pnl_pct = pnl_paise.map(|pnl| {
            if invested_paise != 0 {
                pnl as f64 / invested_paise as f64 * 100.0
            } else {
                0.0
            }
        });

        let days_held = days_between(&row.date, &today);

        let annualised_return_pct = pnl_pct.map(|pct| {
            if days_held <= 0 {
                return pct;
            }
            let r = pct / 100.0;
            ((1.0 + r).powf(365.0 / days_held as f64) - 1.0) * 100.0
        });

        // XIRR cash flow: outflow at buy date
        let t = days_between(earliest_date, &row.date) as f64 / 365.0;
        xirr_flows.push((-(invested_paise as f64), t));

        buy_lots.push(BuyLot {
            transaction_id: row.transaction_id.clone(),
            date: row.date.clone(),
            description: row.description.clone(),
            quantity: row.quantity,
            price_per_unit_paise: row.price_per_unit_paise,
            fees_paise: row.fees_paise,
            invested_paise,
            current_value_paise,
            pnl_paise,
            pnl_pct,
            days_held,
            annualised_return_pct,
        });
    }

    // XIRR: add terminal cash flow (current total value at today)
    let xirr_pct = if !xirr_flows.is_empty() {
        if let Some(price) = effective_price {
            // Total quantity currently held
            let total_bought: f64 = buy_rows.iter().map(|r| r.quantity).sum();
            let total_sold: f64 = sell_rows.iter().map(|r| r.quantity).sum();
            let qty_held = (total_bought - total_sold).max(0.0);
            let terminal_value = (qty_held * price as f64).round() as f64;
            let t_today = days_between(earliest_date, &today) as f64 / 365.0;
            xirr_flows.push((terminal_value, t_today));
            compute_xirr(&xirr_flows)
        } else {
            None
        }
    } else {
        None
    };

    // Value history: for each price snapshot, compute quantity held at that point
    let mut value_history: Vec<ValueHistoryPoint> = Vec::new();
    let mut buy_idx = 0usize;
    let mut sell_idx = 0usize;
    let mut running_qty: f64 = 0.0;

    for price_pt in &price_history {
        // Advance all buy/sell transactions with date <= price_pt.date
        while buy_idx < buy_rows.len() && buy_rows[buy_idx].date.as_str() <= price_pt.date.as_str() {
            running_qty += buy_rows[buy_idx].quantity;
            buy_idx += 1;
        }
        while sell_idx < sell_rows.len() && sell_rows[sell_idx].date.as_str() <= price_pt.date.as_str() {
            running_qty -= sell_rows[sell_idx].quantity;
            sell_idx += 1;
        }
        if running_qty > 0.0 {
            let value_paise = (running_qty * price_pt.price_paise as f64).round() as i64;
            value_history.push(ValueHistoryPoint {
                date: price_pt.date.clone(),
                value_paise,
            });
        }
    }

    Ok(Json(json!({
        "xirr_pct": xirr_pct.map(|r| (r * 10000.0).round() / 100.0),  // round to 2dp
        "value_history": value_history,
        "buy_lots": buy_lots,
    })))
}

fn days_between(from: &str, to: &str) -> i64 {
    use chrono::NaiveDate;
    let a = NaiveDate::parse_from_str(from, "%Y-%m-%d").unwrap_or_default();
    let b = NaiveDate::parse_from_str(to, "%Y-%m-%d").unwrap_or_default();
    (b - a).num_days()
}

// ---------------------------------------------------------------------------
// Portfolio history
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
struct PortfolioHistoryPoint {
    date: String,
    value_paise: i64,
    invested_paise: i64,
}

#[derive(Debug, FromRow)]
struct AllPriceSnapRow {
    instrument_id: String,
    date: String,
    price_paise: i64,
}

/// GET /api/v1/investments/portfolio-history
async fn portfolio_history(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(q): Query<HoldingsQuery>,
) -> Result<Json<Value>> {
    let pool = &state.db;
    let account_id = q.account_id.as_deref();
    let fx_rates = FxRateMap::latest_for_user(pool, &user.id).await?;

    // All investment transactions ordered by date ASC
    let txs: Vec<InvestmentTransactionRow> = match account_id {
        Some(aid) => sqlx::query_as::<_, InvestmentTransactionRow>(
            "SELECT i.id AS instrument_id, i.name AS instrument_name,
                    i.ticker AS instrument_ticker, i.type AS instrument_type,
                    i.currency AS instrument_currency, i.sector AS instrument_sector,
                    i.geography AS instrument_geography,
                    t.account_id, a.name AS account_name,
                    t.type AS transaction_type, t.date,
                    itd.quantity, itd.price_per_unit_paise, itd.fees_paise,
                    itd.cost_basis_per_unit_paise
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             JOIN instruments i ON i.id = itd.instrument_id
             JOIN accounts a ON a.id = t.account_id
             WHERE t.user_id = ? AND t.deleted_at IS NULL
               AND t.type IN ('investment_buy', 'investment_sell')
               AND t.account_id = ?
             ORDER BY t.date ASC, t.created_at ASC",
        )
        .bind(&user.id)
        .bind(aid)
        .fetch_all(pool)
        .await?,
        None => sqlx::query_as::<_, InvestmentTransactionRow>(
            "SELECT i.id AS instrument_id, i.name AS instrument_name,
                    i.ticker AS instrument_ticker, i.type AS instrument_type,
                    i.currency AS instrument_currency, i.sector AS instrument_sector,
                    i.geography AS instrument_geography,
                    t.account_id, a.name AS account_name,
                    t.type AS transaction_type, t.date,
                    itd.quantity, itd.price_per_unit_paise, itd.fees_paise,
                    itd.cost_basis_per_unit_paise
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             JOIN instruments i ON i.id = itd.instrument_id
             JOIN accounts a ON a.id = t.account_id
             WHERE t.user_id = ? AND t.deleted_at IS NULL
               AND t.type IN ('investment_buy', 'investment_sell')
             ORDER BY t.date ASC, t.created_at ASC",
        )
        .bind(&user.id)
        .fetch_all(pool)
        .await?,
    };

    // Build per-instrument currency map
    let mut currency_map: BTreeMap<String, String> = BTreeMap::new();
    for tx in &txs {
        currency_map
            .entry(tx.instrument_id.clone())
            .or_insert_with(|| tx.instrument_currency.clone());
    }

    // Precompute tagged buy/sell entries (date-ordered, same order as txs)
    struct BuyEntry {
        date: String,
        instrument_id: String,
        account_id: String,
        quantity: f64,
        inr_cost: Option<i64>,
    }
    struct SellEntry {
        date: String,
        instrument_id: String,
        account_id: String,
        quantity: f64,
    }

    let mut buy_entries: Vec<BuyEntry> = Vec::new();
    let mut sell_entries: Vec<SellEntry> = Vec::new();

    for tx in &txs {
        if tx.transaction_type == "investment_buy" {
            let gross =
                (tx.quantity * tx.price_per_unit_paise as f64).round() as i64 + tx.fees_paise;
            let inr = convert_to_inr_on_or_latest(
                pool,
                &user.id,
                &fx_rates,
                &tx.instrument_currency,
                gross,
                &tx.date,
            )
            .await?;
            buy_entries.push(BuyEntry {
                date: tx.date.clone(),
                instrument_id: tx.instrument_id.clone(),
                account_id: tx.account_id.clone(),
                quantity: tx.quantity,
                inr_cost: inr,
            });
        } else {
            sell_entries.push(SellEntry {
                date: tx.date.clone(),
                instrument_id: tx.instrument_id.clone(),
                account_id: tx.account_id.clone(),
                quantity: tx.quantity,
            });
        }
    }

    // All price snapshots
    let snaps: Vec<AllPriceSnapRow> = sqlx::query_as::<_, AllPriceSnapRow>(
        "SELECT instrument_id, date, price_paise FROM price_snapshots
         WHERE user_id = ? ORDER BY instrument_id, date ASC",
    )
    .bind(&user.id)
    .fetch_all(pool)
    .await?;

    // price_map: instrument_id -> BTreeMap<date, price>
    let mut price_map: BTreeMap<String, BTreeMap<String, i64>> = BTreeMap::new();
    for snap in &snaps {
        price_map
            .entry(snap.instrument_id.clone())
            .or_default()
            .insert(snap.date.clone(), snap.price_paise);
    }

    // All distinct snapshot dates, sorted
    let snapshot_dates: Vec<String> = {
        let mut set = std::collections::BTreeSet::new();
        for s in &snaps {
            set.insert(s.date.clone());
        }
        set.into_iter().collect()
    };

    // Holding state per (instrument_id, account_id): tracks qty and cumulative INR buy cost
    struct HoldingState {
        bought_qty: f64,
        sold_qty: f64,
        total_buy_cost_inr: Option<i64>,
        currency: String,
    }
    let mut holding_state: BTreeMap<(String, String), HoldingState> = BTreeMap::new();
    let mut buy_idx = 0usize;
    let mut sell_idx = 0usize;
    let mut result: Vec<PortfolioHistoryPoint> = Vec::with_capacity(snapshot_dates.len());

    for date in &snapshot_dates {
        // Advance buy entries
        while buy_idx < buy_entries.len() && buy_entries[buy_idx].date.as_str() <= date.as_str() {
            let e = &buy_entries[buy_idx];
            let state = holding_state
                .entry((e.instrument_id.clone(), e.account_id.clone()))
                .or_insert_with(|| HoldingState {
                    bought_qty: 0.0,
                    sold_qty: 0.0,
                    total_buy_cost_inr: Some(0),
                    currency: currency_map
                        .get(&e.instrument_id)
                        .cloned()
                        .unwrap_or_else(|| "INR".to_string()),
                });
            state.bought_qty += e.quantity;
            state.total_buy_cost_inr = add_optional_paise(state.total_buy_cost_inr, e.inr_cost);
            buy_idx += 1;
        }

        // Advance sell entries
        while sell_idx < sell_entries.len()
            && sell_entries[sell_idx].date.as_str() <= date.as_str()
        {
            let e = &sell_entries[sell_idx];
            if let Some(state) = holding_state.get_mut(&(e.instrument_id.clone(), e.account_id.clone())) {
                state.sold_qty += e.quantity;
            }
            sell_idx += 1;
        }

        // Compute value and cost basis only for holdings that have a price at this date.
        // Keeping both metrics on the same instrument set ensures they are directly comparable.
        let mut total_value: i64 = 0;
        let mut total_invested: i64 = 0;
        let mut has_value = false;

        for ((instrument_id, _), state) in &holding_state {
            let remaining = state.bought_qty - state.sold_qty;
            if remaining <= 0.0001 {
                continue;
            }

            // Latest price on or before this date
            let price = price_map
                .get(instrument_id)
                .and_then(|m| m.range(..=date.clone()).next_back().map(|(_, &p)| p));

            if let Some(p) = price {
                // Portfolio value
                let value_native = (remaining * p as f64).round() as i64;
                let value_inr = fx_rates
                    .convert_to_inr_paise(&state.currency, value_native)
                    .unwrap_or(value_native);
                total_value += value_inr;

                // Cost basis prorated to remaining qty (matches holdings/summary definition)
                if let Some(total_cost) = state.total_buy_cost_inr {
                    if state.bought_qty > 0.0 {
                        let cost_basis =
                            ((total_cost as f64 / state.bought_qty) * remaining).round() as i64;
                        total_invested += cost_basis;
                    }
                }

                has_value = true;
            }
        }

        if !has_value {
            continue;
        }

        result.push(PortfolioHistoryPoint {
            date: date.clone(),
            value_paise: total_value,
            invested_paise: total_invested,
        });
    }

    Ok(Json(json!({ "history": result })))
}

// ---------------------------------------------------------------------------
// XIRR summary
// ---------------------------------------------------------------------------

#[derive(Debug, FromRow)]
struct XirrBuyRow {
    instrument_id: String,
    account_id: String,
    date: String,
    quantity: f64,
    price_per_unit_paise: i64,
    fees_paise: i64,
}

#[derive(Debug, FromRow)]
struct XirrSellRow {
    date: String,
    quantity: f64,
    price_per_unit_paise: i64,
    fees_paise: i64,
}

/// GET /api/v1/investments/xirr-summary
async fn xirr_summary(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Query(q): Query<HoldingsQuery>,
) -> Result<Json<Value>> {
    let pool = &state.db;
    let account_id = q.account_id.as_deref();
    let today = chrono::Local::now().date_naive().to_string();

    // Holdings for current values
    let holdings = compute_holdings(pool, &user.id, account_id).await?;

    // All buy transactions
    let buy_rows: Vec<XirrBuyRow> = match account_id {
        Some(aid) => sqlx::query_as::<_, XirrBuyRow>(
            "SELECT itd.instrument_id, t.account_id, t.date,
                    itd.quantity, itd.price_per_unit_paise, itd.fees_paise
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             WHERE t.user_id = ? AND t.account_id = ?
               AND t.type = 'investment_buy' AND t.deleted_at IS NULL
             ORDER BY t.date ASC, t.created_at ASC",
        )
        .bind(&user.id)
        .bind(aid)
        .fetch_all(pool)
        .await?,
        None => sqlx::query_as::<_, XirrBuyRow>(
            "SELECT itd.instrument_id, t.account_id, t.date,
                    itd.quantity, itd.price_per_unit_paise, itd.fees_paise
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             WHERE t.user_id = ?
               AND t.type = 'investment_buy' AND t.deleted_at IS NULL
             ORDER BY t.date ASC, t.created_at ASC",
        )
        .bind(&user.id)
        .fetch_all(pool)
        .await?,
    };

    // All sell transactions (for portfolio-level XIRR)
    let sell_rows: Vec<XirrSellRow> = match account_id {
        Some(aid) => sqlx::query_as::<_, XirrSellRow>(
            "SELECT t.date, itd.quantity, itd.price_per_unit_paise, itd.fees_paise
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             WHERE t.user_id = ? AND t.account_id = ?
               AND t.type = 'investment_sell' AND t.deleted_at IS NULL
             ORDER BY t.date ASC",
        )
        .bind(&user.id)
        .bind(aid)
        .fetch_all(pool)
        .await?,
        None => sqlx::query_as::<_, XirrSellRow>(
            "SELECT t.date, itd.quantity, itd.price_per_unit_paise, itd.fees_paise
             FROM investment_transaction_details itd
             JOIN transactions t ON t.id = itd.transaction_id
             WHERE t.user_id = ?
               AND t.type = 'investment_sell' AND t.deleted_at IS NULL
             ORDER BY t.date ASC",
        )
        .bind(&user.id)
        .fetch_all(pool)
        .await?,
    };

    let earliest_date: Option<String> = buy_rows.first().map(|r| r.date.clone());

    // Group buy rows by (instrument_id, account_id) -> Vec<(date, invested_paise)>
    let mut flows_by_holding: BTreeMap<(String, String), Vec<(String, i64)>> = BTreeMap::new();
    let mut portfolio_flows: Vec<(f64, f64)> = Vec::new();

    for row in &buy_rows {
        let invested =
            (row.quantity * row.price_per_unit_paise as f64).round() as i64 + row.fees_paise;
        flows_by_holding
            .entry((row.instrument_id.clone(), row.account_id.clone()))
            .or_default()
            .push((row.date.clone(), invested));

        if let Some(ref earliest) = earliest_date {
            let t = days_between(earliest, &row.date) as f64 / 365.0;
            portfolio_flows.push((-(invested as f64), t));
        }
    }

    // Add sell inflows for portfolio XIRR
    if let Some(ref earliest) = earliest_date {
        for row in &sell_rows {
            let proceeds =
                (row.quantity * row.price_per_unit_paise as f64).round() as i64 - row.fees_paise;
            let t = days_between(earliest, &row.date) as f64 / 365.0;
            portfolio_flows.push((proceeds as f64, t));
        }
    }

    // Total current portfolio value as terminal inflow
    let total_current: i64 = holdings
        .iter()
        .filter_map(|h| h.current_value_paise)
        .sum();

    let portfolio_xirr_pct = if !portfolio_flows.is_empty() && total_current > 0 {
        if let Some(ref earliest) = earliest_date {
            let t_today = days_between(earliest, &today) as f64 / 365.0;
            let mut all_flows = portfolio_flows.clone();
            all_flows.push((total_current as f64, t_today));
            compute_xirr(&all_flows).map(|r| (r * 10000.0).round() / 100.0)
        } else {
            None
        }
    } else {
        None
    };

    // Per-holding XIRR
    let mut holding_xirrs: Vec<Value> = Vec::with_capacity(holdings.len());
    for holding in &holdings {
        let key = (holding.instrument_id.clone(), holding.account_id.clone());
        let xirr_pct = match (flows_by_holding.get(&key), holding.current_value_paise) {
            (Some(flows), Some(cv)) if !flows.is_empty() => {
                let earliest = &flows[0].0;
                let mut xirr_flows: Vec<(f64, f64)> = flows
                    .iter()
                    .map(|(date, amount)| {
                        let t = days_between(earliest, date) as f64 / 365.0;
                        (-(*amount as f64), t)
                    })
                    .collect();
                let t_today = days_between(earliest, &today) as f64 / 365.0;
                xirr_flows.push((cv as f64, t_today));
                compute_xirr(&xirr_flows).map(|r| (r * 10000.0).round() / 100.0)
            }
            _ => None,
        };
        holding_xirrs.push(json!({
            "instrument_id": holding.instrument_id,
            "account_id": holding.account_id,
            "xirr_pct": xirr_pct,
        }));
    }

    Ok(Json(json!({
        "portfolio_xirr_pct": portfolio_xirr_pct,
        "holdings": holding_xirrs,
    })))
}

// ---------------------------------------------------------------------------
// Dividend income
// ---------------------------------------------------------------------------

#[derive(Debug, FromRow)]
struct DividendTxRow {
    date: String,
    amount_paise: i64,
}

/// GET /api/v1/investments/dividend-income
async fn dividend_income(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Result<Json<Value>> {
    let rows: Vec<DividendTxRow> = sqlx::query_as::<_, DividendTxRow>(
        "SELECT date, amount_paise FROM transactions
         WHERE user_id = ? AND type = 'dividend' AND deleted_at IS NULL
         ORDER BY date ASC",
    )
    .bind(&user.id)
    .fetch_all(&state.db)
    .await?;

    // Group by month (YYYY-MM)
    let mut by_month: BTreeMap<String, i64> = BTreeMap::new();
    for row in &rows {
        let month = row.date.chars().take(7).collect::<String>();
        *by_month.entry(month).or_insert(0) += row.amount_paise;
    }

    let income: Vec<Value> = by_month
        .into_iter()
        .map(|(month, amount_paise)| json!({ "month": month, "amount_paise": amount_paise }))
        .collect();

    Ok(Json(json!({ "income": income })))
}

fn compute_xirr(flows: &[(f64, f64)]) -> Option<f64> {
    // Newton-Raphson: find r such that sum(cf / (1+r)^t) = 0
    let has_negative = flows.iter().any(|(cf, _)| *cf < 0.0);
    let has_positive = flows.iter().any(|(cf, _)| *cf > 0.0);
    if !has_negative || !has_positive {
        return None;
    }

    let mut rate = 0.1_f64;

    for _ in 0..200 {
        let f: f64 = flows
            .iter()
            .map(|(cf, t)| cf / (1.0 + rate).powf(*t))
            .sum();
        let df: f64 = flows
            .iter()
            .map(|(cf, t)| -t * cf / (1.0 + rate).powf(*t + 1.0))
            .sum();

        if df.abs() < 1e-12 {
            break;
        }

        let next = rate - f / df;

        if (next - rate).abs() < 1e-8 {
            return Some(next);
        }

        if next < -0.9999 || !next.is_finite() {
            break;
        }

        rate = next;
    }

    if rate.is_finite() && rate > -0.9999 {
        Some(rate)
    } else {
        None
    }
}
