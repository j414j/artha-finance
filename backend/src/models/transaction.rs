use serde::{Deserialize, Serialize};
use sqlx::FromRow;

pub const TRANSACTION_TYPES: &[&str] = &[
    "income",
    "expense",
    "transfer",
    "investment_buy",
    "investment_sell",
    "dividend",
    "loan_repayment",
    "credit_card_payment",
    "valuation_update",
];

pub const RECURRING_FREQUENCIES: &[&str] = &[
    "daily",
    "weekly",
    "fortnightly",
    "monthly",
    "quarterly",
    "annually",
];

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Transaction {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub account_id: String,
    pub transfer_account_id: Option<String>,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub date: String,
    pub description: String,
    pub amount_paise: i64,
    pub category_id: Option<String>,
    pub notes: Option<String>,
    pub is_recurring: bool,
    pub recurrence_frequency: Option<String>,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub fx_rate: Option<f64>,
    pub fx_to_amount_paise: Option<i64>,
    pub fx_fee_paise: i64,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TransactionSplit {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub transaction_id: String,
    pub category_id: String,
    pub amount_paise: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct TransactionTag {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub transaction_id: String,
    pub tag: String,
}

#[derive(Debug, Deserialize)]
pub struct TransactionSplitInput {
    pub category_id: String,
    pub amount_paise: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTransactionRequest {
    pub account_id: String,
    pub transfer_account_id: Option<String>,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub date: String,
    pub description: String,
    pub amount_paise: i64,
    pub category_id: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub splits: Option<Vec<TransactionSplitInput>>,
    pub is_recurring: Option<bool>,
    pub recurrence_frequency: Option<String>,
    // FX transfer fields (only for transfer type when accounts have different currencies)
    pub fx_rate: Option<f64>,
    pub fx_to_amount_paise: Option<i64>,
    pub fx_fee_paise: Option<i64>,
    // Investment detail fields (for investment_buy, investment_sell, dividend)
    pub instrument_id: Option<String>,
    pub quantity: Option<f64>,
    pub price_per_unit_paise: Option<i64>,
    pub fees_paise: Option<i64>,
}

#[derive(Debug, Deserialize, Default)]
pub struct UpdateTransactionRequest {
    pub account_id: Option<String>,
    pub transfer_account_id: Option<Option<String>>,
    #[serde(rename = "type")]
    pub transaction_type: Option<String>,
    pub date: Option<String>,
    pub description: Option<String>,
    pub amount_paise: Option<i64>,
    pub category_id: Option<Option<String>>,
    pub notes: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub splits: Option<Vec<TransactionSplitInput>>,
    pub is_recurring: Option<bool>,
    pub recurrence_frequency: Option<Option<String>>,
    // FX fields (for cross-currency transfer edits)
    pub fx_rate: Option<Option<f64>>,
    pub fx_to_amount_paise: Option<Option<i64>>,
    pub fx_fee_paise: Option<Option<i64>>,
    // Investment fields (for investment_buy/sell/dividend edits)
    pub instrument_id: Option<Option<String>>,
    pub quantity: Option<f64>,
    pub price_per_unit_paise: Option<i64>,
    pub fees_paise: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvestmentDetailView {
    pub instrument_id: String,
    pub instrument_name: String,
    pub instrument_ticker: Option<String>,
    pub quantity: f64,
    pub price_per_unit_paise: i64,
    pub fees_paise: i64,
    pub cost_basis_per_unit_paise: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransactionView {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub transfer_account_id: Option<String>,
    pub transfer_account_name: Option<String>,
    #[serde(rename = "type")]
    pub transaction_type: String,
    pub date: String,
    pub description: String,
    pub amount_paise: i64,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub notes: Option<String>,
    pub tags: Vec<String>,
    pub splits: Vec<TransactionSplitView>,
    pub is_recurring: bool,
    pub recurrence_frequency: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub fx_rate: Option<f64>,
    pub fx_to_amount_paise: Option<i64>,
    pub fx_fee_paise: i64,
    pub investment_detail: Option<InvestmentDetailView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransactionSplitView {
    pub id: String,
    pub category_id: String,
    pub category_name: Option<String>,
    pub amount_paise: i64,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransactionSummary {
    pub count: i64,
    pub total_income_paise: i64,
    pub total_expense_paise: i64,
    pub net_paise: i64,
}

pub fn is_valid_transaction_type(transaction_type: &str) -> bool {
    TRANSACTION_TYPES.contains(&transaction_type)
}

pub fn is_valid_recurring_frequency(frequency: &str) -> bool {
    RECURRING_FREQUENCIES.contains(&frequency)
}

pub fn category_type_for_transaction(transaction_type: &str) -> Option<&'static str> {
    match transaction_type {
        "income" | "dividend" => Some("income"),
        "expense" => Some("expense"),
        _ => None,
    }
}

pub fn requires_destination_account(transaction_type: &str) -> bool {
    matches!(
        transaction_type,
        "transfer" | "loan_repayment" | "credit_card_payment"
    )
}

pub fn supports_splits(transaction_type: &str) -> bool {
    matches!(transaction_type, "income" | "expense")
}

pub fn is_investment_type(transaction_type: &str) -> bool {
    matches!(
        transaction_type,
        "investment_buy" | "investment_sell" | "dividend"
    )
}

pub fn requires_investment_detail(transaction_type: &str) -> bool {
    matches!(transaction_type, "investment_buy" | "investment_sell")
}
