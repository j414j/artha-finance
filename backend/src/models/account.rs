use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

pub const ACCOUNT_TYPES: &[&str] = &[
    "savings",
    "current",
    "credit_card",
    "demat",
    "mutual_fund",
    "real_estate",
    "loan",
    "other_asset",
    "other_liability",
];

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Account {
    pub id: String,
    #[serde(skip_serializing)]
    pub user_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub currency: String,
    pub opening_balance_paise: i64,
    pub opening_date: String,
    pub balance_paise: i64,
    pub inr_value_paise: i64,
    pub color_hex: String,
    pub is_active: bool,
    pub archived_at: Option<String>,
    pub last_updated: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateAccountRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub currency: String,
    pub opening_balance_paise: i64,
    pub opening_date: String,
    pub inr_value_paise: Option<i64>,
    pub color_hex: String,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, Default, Serialize)]
pub struct UpdateAccountRequest {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub account_type: Option<String>,
    pub currency: Option<String>,
    pub opening_balance_paise: Option<i64>,
    pub opening_date: Option<String>,
    pub balance_paise: Option<i64>,
    pub inr_value_paise: Option<i64>,
    pub color_hex: Option<String>,
    pub notes: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountView {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: String,
    pub currency: String,
    pub opening_balance_paise: i64,
    pub opening_date: String,
    pub balance_paise: i64,
    pub inr_value_paise: i64,
    pub color_hex: String,
    pub is_active: bool,
    pub last_updated: String,
    pub notes: Option<String>,
    pub side: &'static str,
    pub class_key: &'static str,
    pub class_label: &'static str,
}

impl From<Account> for AccountView {
    fn from(account: Account) -> Self {
        let (class_key, class_label) = account_class(&account.account_type);
        let side = account_side(&account.account_type);
        AccountView {
            id: account.id,
            name: account.name,
            account_type: account.account_type,
            currency: account.currency,
            opening_balance_paise: account.opening_balance_paise,
            opening_date: account.opening_date,
            balance_paise: account.balance_paise,
            inr_value_paise: account.inr_value_paise,
            color_hex: account.color_hex,
            is_active: account.is_active,
            last_updated: account.last_updated,
            notes: account.notes,
            side,
            class_key,
            class_label,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountSummary {
    pub total_assets_paise: i64,
    pub total_liabilities_paise: i64,
    pub net_worth_paise: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountGroup {
    pub key: &'static str,
    pub label: &'static str,
    pub side: &'static str,
    pub total_inr_value_paise: i64,
    pub accounts: Vec<AccountView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountsListResponse {
    pub summary: AccountSummary,
    pub asset_groups: Vec<AccountGroup>,
    pub liability_groups: Vec<AccountGroup>,
}

pub fn is_valid_account_type(account_type: &str) -> bool {
    ACCOUNT_TYPES.contains(&account_type)
}

pub fn is_liability(account_type: &str) -> bool {
    matches!(account_type, "loan" | "credit_card" | "other_liability")
}

pub fn account_side(account_type: &str) -> &'static str {
    if is_liability(account_type) {
        "liability"
    } else {
        "asset"
    }
}

pub fn account_class(account_type: &str) -> (&'static str, &'static str) {
    match account_type {
        "savings" | "current" => ("cash_bank", "Cash & Bank"),
        "demat" | "mutual_fund" => ("investments", "Investments"),
        "real_estate" => ("real_estate", "Real Estate"),
        "loan" => ("loans", "Loans"),
        "credit_card" => ("credit_cards", "Credit Cards"),
        "other_liability" => ("other_liabilities", "Other Liabilities"),
        _ => ("other_assets", "Other Assets"),
    }
}

pub fn normalize_currency(currency: &str) -> Option<String> {
    let trimmed = currency.trim();
    if trimmed.len() == 3 && trimmed.chars().all(|c| c.is_ascii_alphabetic()) {
        Some(trimmed.to_ascii_uppercase())
    } else {
        None
    }
}

pub fn validate_color_hex(color: &str) -> bool {
    let bytes = color.as_bytes();
    bytes.len() == 7 && bytes[0] == b'#' && bytes[1..].iter().all(u8::is_ascii_hexdigit)
}

pub fn validate_date(date: &str) -> bool {
    NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok()
}

pub fn build_accounts_response(accounts: Vec<Account>) -> AccountsListResponse {
    let mut views: Vec<AccountView> = accounts.into_iter().map(AccountView::from).collect();
    views.sort_by(|a, b| {
        (
            side_order(a.side),
            class_order(a.class_key),
            a.name.to_lowercase(),
        )
            .cmp(&(
                side_order(b.side),
                class_order(b.class_key),
                b.name.to_lowercase(),
            ))
    });

    let summary = summarize_views(&views);
    let asset_groups = collect_groups(&views, "asset");
    let liability_groups = collect_groups(&views, "liability");

    AccountsListResponse {
        summary,
        asset_groups,
        liability_groups,
    }
}

pub fn summarize_accounts(accounts: &[Account]) -> AccountSummary {
    let views: Vec<AccountView> = accounts.iter().cloned().map(AccountView::from).collect();
    summarize_views(&views)
}

fn summarize_views(accounts: &[AccountView]) -> AccountSummary {
    let total_assets_paise = accounts
        .iter()
        .filter(|account| account.side == "asset")
        .map(|account| account.inr_value_paise)
        .sum();
    let total_liabilities_paise = accounts
        .iter()
        .filter(|account| account.side == "liability")
        .map(|account| account.inr_value_paise)
        .sum();

    AccountSummary {
        total_assets_paise,
        total_liabilities_paise,
        net_worth_paise: total_assets_paise - total_liabilities_paise,
    }
}

fn collect_groups(accounts: &[AccountView], side: &'static str) -> Vec<AccountGroup> {
    class_keys_for_side(side)
        .into_iter()
        .filter_map(|(key, label)| {
            let grouped_accounts: Vec<AccountView> = accounts
                .iter()
                .filter(|account| account.side == side && account.class_key == key)
                .cloned()
                .collect();

            if grouped_accounts.is_empty() {
                return None;
            }

            Some(AccountGroup {
                key,
                label,
                side,
                total_inr_value_paise: grouped_accounts
                    .iter()
                    .map(|account| account.inr_value_paise)
                    .sum(),
                accounts: grouped_accounts,
            })
        })
        .collect()
}

fn class_keys_for_side(side: &str) -> Vec<(&'static str, &'static str)> {
    match side {
        "asset" => vec![
            ("cash_bank", "Cash & Bank"),
            ("investments", "Investments"),
            ("real_estate", "Real Estate"),
            ("other_assets", "Other Assets"),
        ],
        _ => vec![
            ("loans", "Loans"),
            ("credit_cards", "Credit Cards"),
            ("other_liabilities", "Other Liabilities"),
        ],
    }
}

fn side_order(side: &str) -> usize {
    match side {
        "asset" => 0,
        _ => 1,
    }
}

fn class_order(class_key: &str) -> usize {
    match class_key {
        "cash_bank" => 0,
        "investments" => 1,
        "real_estate" => 2,
        "other_assets" => 3,
        "loans" => 4,
        "credit_cards" => 5,
        "other_liabilities" => 6,
        _ => 99,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(id: &str, account_type: &str, value: i64) -> Account {
        Account {
            id: id.to_string(),
            user_id: "user-1".to_string(),
            name: id.to_string(),
            account_type: account_type.to_string(),
            currency: "INR".to_string(),
            opening_balance_paise: value,
            opening_date: "2026-05-01".to_string(),
            balance_paise: value,
            inr_value_paise: value,
            color_hex: "#3A7FFF".to_string(),
            is_active: true,
            archived_at: None,
            last_updated: "2026-05-01 00:00:00".to_string(),
            notes: None,
            created_at: "2026-05-01 00:00:00".to_string(),
            updated_at: "2026-05-01 00:00:00".to_string(),
        }
    }

    #[test]
    fn classifies_assets_and_liabilities() {
        assert_eq!(account_side("savings"), "asset");
        assert_eq!(account_side("real_estate"), "asset");
        assert_eq!(account_side("loan"), "liability");
        assert_eq!(
            account_class("credit_card"),
            ("credit_cards", "Credit Cards")
        );
    }

    #[test]
    fn summarizes_net_worth_by_account_type() {
        let accounts = vec![
            account("Savings", "savings", 100_000),
            account("Demat", "demat", 200_000),
            account("Loan", "loan", 75_000),
        ];

        let summary = summarize_accounts(&accounts);

        assert_eq!(summary.total_assets_paise, 300_000);
        assert_eq!(summary.total_liabilities_paise, 75_000);
        assert_eq!(summary.net_worth_paise, 225_000);
    }

    #[test]
    fn validates_currency_and_color() {
        assert_eq!(normalize_currency("inr"), Some("INR".to_string()));
        assert_eq!(normalize_currency("rupee"), None);
        assert!(validate_color_hex("#00C896"));
        assert!(!validate_color_hex("00C896"));
        assert!(!validate_color_hex("#00C89Z"));
    }
}
