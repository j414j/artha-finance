use serde::{Deserialize, Serialize};
use sqlx::FromRow;

pub const INSTRUMENT_TYPES: &[&str] = &["equity", "mf", "etf", "bond", "gold", "crypto", "other"];

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Instrument {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub name: String,
    pub ticker: Option<String>,
    #[serde(rename = "type")]
    pub instrument_type: String,
    pub currency: String,
    pub sector: Option<String>,
    pub geography: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct PriceSnapshot {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub instrument_id: String,
    pub price_paise: i64,
    pub date: String,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct InvestmentTransactionDetail {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub transaction_id: String,
    pub instrument_id: String,
    pub quantity: f64,
    pub price_per_unit_paise: i64,
    pub fees_paise: i64,
    pub cost_basis_per_unit_paise: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct CorporateAction {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub instrument_id: String,
    pub account_id: String,
    #[serde(rename = "type")]
    pub action_type: String,
    pub date: String,
    pub quantity_delta: f64,
    pub split_ratio: Option<String>,
    pub price_per_unit_paise: Option<i64>,
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateInstrumentRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub instrument_type: String,
    pub ticker: Option<String>,
    pub currency: Option<String>,
    pub sector: Option<String>,
    pub geography: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateInstrumentRequest {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub instrument_type: Option<String>,
    pub ticker: Option<Option<String>>,
    pub currency: Option<String>,
    pub sector: Option<Option<String>>,
    pub geography: Option<Option<String>>,
    pub notes: Option<Option<String>>,
}

#[derive(Debug, Deserialize)]
pub struct CreatePriceSnapshotRequest {
    pub price_paise: i64,
    pub date: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCorporateActionRequest {
    pub instrument_id: String,
    pub account_id: String,
    #[serde(rename = "type")]
    pub action_type: String,
    pub date: String,
    pub quantity_delta: f64,
    pub split_ratio: Option<String>,
    pub price_per_unit_paise: Option<i64>,
    pub notes: Option<String>,
}

pub fn is_valid_instrument_type(t: &str) -> bool {
    INSTRUMENT_TYPES.contains(&t)
}
