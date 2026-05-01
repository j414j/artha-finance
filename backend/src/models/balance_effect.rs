use std::collections::BTreeMap;

use crate::models::account::{account_side, is_liability};

#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct AccountBalanceContext {
    pub id: String,
    pub account_type: String,
    pub currency: String,
    pub balance_paise: i64,
    pub inr_value_paise: i64,
    pub blocked_paise: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransactionEffectInput {
    pub transaction_type: String,
    pub amount_paise: i64,
    pub account: AccountBalanceContext,
    pub destination_account: Option<AccountBalanceContext>,
    // For FX transfers: amount credited to destination in its own currency
    pub fx_to_amount_paise: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountDelta {
    pub account_id: String,
    pub balance_delta_paise: i64,
    pub inr_value_delta_paise: i64,
}

pub fn calculate_account_deltas(
    input: &TransactionEffectInput,
) -> Result<Vec<AccountDelta>, String> {
    if input.amount_paise <= 0 {
        return Err("Amount must be positive".into());
    }

    let mut deltas = Vec::new();

    match input.transaction_type.as_str() {
        "income" | "dividend" => {
            require_asset(&input.account, "Income must use an asset account")?;
            deltas.push(delta(&input.account, input.amount_paise));
        }
        "expense" => {
            if input.account.account_type == "credit_card" {
                deltas.push(delta(&input.account, input.amount_paise));
            } else {
                require_asset(
                    &input.account,
                    "Expense must use an asset or credit card account",
                )?;
                deltas.push(delta(&input.account, -input.amount_paise));
            }
        }
        "transfer" => {
            let destination = require_destination(input)?;
            require_asset(&input.account, "Transfer source must be an asset account")?;
            require_asset(destination, "Transfer destination must be an asset account")?;
            ensure_distinct_accounts(&input.account, destination)?;
            deltas.push(delta(&input.account, -input.amount_paise));
            // For FX transfers, destination gets fx_to_amount_paise; otherwise same amount
            let dest_amount = input.fx_to_amount_paise.unwrap_or(input.amount_paise);
            let dest_inr = if destination.currency == "INR" {
                dest_amount
            } else {
                0
            };
            deltas.push(AccountDelta {
                account_id: destination.id.clone(),
                balance_delta_paise: dest_amount,
                inr_value_delta_paise: dest_inr,
            });
        }
        "credit_card_payment" => {
            let destination = require_destination(input)?;
            require_asset(
                &input.account,
                "Credit card payment source must be an asset account",
            )?;
            require_account_type(
                destination,
                "credit_card",
                "Credit card payment destination must be a credit card account",
            )?;
            ensure_distinct_accounts(&input.account, destination)?;
            deltas.push(delta(&input.account, -input.amount_paise));
            deltas.push(delta(destination, -input.amount_paise));
        }
        "loan_repayment" => {
            let destination = require_destination(input)?;
            require_asset(
                &input.account,
                "Loan repayment source must be an asset account",
            )?;
            require_account_type(
                destination,
                "loan",
                "Loan repayment destination must be a loan account",
            )?;
            ensure_distinct_accounts(&input.account, destination)?;
            deltas.push(delta(&input.account, -input.amount_paise));
            deltas.push(delta(destination, -input.amount_paise));
        }
        "investment_buy" => {
            require_asset(
                &input.account,
                "Investment buy must use an investment asset account",
            )?;
            require_investment_account(&input.account)?;
            deltas.push(delta(&input.account, -input.amount_paise));
        }
        "investment_sell" => {
            require_asset(
                &input.account,
                "Investment sell must use an investment asset account",
            )?;
            require_investment_account(&input.account)?;
            deltas.push(delta(&input.account, input.amount_paise));
        }
        "valuation_update" => {
            let balance_delta = input.amount_paise - input.account.balance_paise;
            deltas.push(delta(&input.account, balance_delta));
        }
        _ => return Err("Unsupported transaction type".into()),
    }

    Ok(merge_deltas(deltas))
}

pub fn reverse_deltas(deltas: &[AccountDelta]) -> Vec<AccountDelta> {
    deltas
        .iter()
        .map(|delta| AccountDelta {
            account_id: delta.account_id.clone(),
            balance_delta_paise: -delta.balance_delta_paise,
            inr_value_delta_paise: -delta.inr_value_delta_paise,
        })
        .collect()
}

fn delta(account: &AccountBalanceContext, amount: i64) -> AccountDelta {
    AccountDelta {
        account_id: account.id.clone(),
        balance_delta_paise: amount,
        inr_value_delta_paise: if account.currency == "INR" { amount } else { 0 },
    }
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

    merged.into_values().collect()
}

fn require_destination(input: &TransactionEffectInput) -> Result<&AccountBalanceContext, String> {
    input
        .destination_account
        .as_ref()
        .ok_or_else(|| "Destination account is required".to_string())
}

fn require_asset(account: &AccountBalanceContext, message: &str) -> Result<(), String> {
    if account_side(&account.account_type) == "asset" {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn require_account_type(
    account: &AccountBalanceContext,
    expected_type: &str,
    message: &str,
) -> Result<(), String> {
    if account.account_type == expected_type {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn require_investment_account(account: &AccountBalanceContext) -> Result<(), String> {
    if matches!(account.account_type.as_str(), "demat" | "mutual_fund") {
        Ok(())
    } else {
        Err("Investment transaction must use a demat or mutual fund account".into())
    }
}

fn ensure_distinct_accounts(
    source: &AccountBalanceContext,
    destination: &AccountBalanceContext,
) -> Result<(), String> {
    if source.id == destination.id {
        Err("Source and destination accounts must be different".into())
    } else {
        Ok(())
    }
}

pub fn would_keep_balances_non_negative(
    accounts: &[AccountBalanceContext],
    deltas: &[AccountDelta],
) -> bool {
    accounts.iter().all(|account| {
        let balance_delta = deltas
            .iter()
            .filter(|delta| delta.account_id == account.id)
            .map(|delta| delta.balance_delta_paise)
            .sum::<i64>();
        let inr_delta = deltas
            .iter()
            .filter(|delta| delta.account_id == account.id)
            .map(|delta| delta.inr_value_delta_paise)
            .sum::<i64>();

        account.balance_paise + balance_delta >= 0
            && account.inr_value_paise + inr_delta >= 0
            && account.balance_paise + balance_delta >= account.blocked_paise
            && (is_liability(&account.account_type) || account.balance_paise + balance_delta >= 0)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(id: &str, account_type: &str, balance: i64) -> AccountBalanceContext {
        AccountBalanceContext {
            id: id.to_string(),
            account_type: account_type.to_string(),
            currency: "INR".to_string(),
            balance_paise: balance,
            inr_value_paise: balance,
            blocked_paise: 0,
        }
    }

    fn input(
        transaction_type: &str,
        source: AccountBalanceContext,
        destination: Option<AccountBalanceContext>,
    ) -> TransactionEffectInput {
        TransactionEffectInput {
            transaction_type: transaction_type.to_string(),
            amount_paise: 10_000,
            account: source,
            destination_account: destination,
            fx_to_amount_paise: None,
        }
    }

    #[test]
    fn income_increases_asset_account() {
        let deltas =
            calculate_account_deltas(&input("income", account("bank", "savings", 0), None))
                .expect("income effect");

        assert_eq!(
            deltas,
            vec![AccountDelta {
                account_id: "bank".into(),
                balance_delta_paise: 10_000,
                inr_value_delta_paise: 10_000,
            }]
        );
    }

    #[test]
    fn asset_expense_decreases_asset_account() {
        let deltas =
            calculate_account_deltas(&input("expense", account("bank", "savings", 20_000), None))
                .expect("expense effect");

        assert_eq!(deltas[0].balance_delta_paise, -10_000);
    }

    #[test]
    fn credit_card_expense_increases_liability() {
        let deltas = calculate_account_deltas(&input(
            "expense",
            account("card", "credit_card", 20_000),
            None,
        ))
        .expect("credit card expense effect");

        assert_eq!(deltas[0].balance_delta_paise, 10_000);
    }

    #[test]
    fn transfer_moves_between_asset_accounts() {
        let deltas = calculate_account_deltas(&input(
            "transfer",
            account("source", "savings", 20_000),
            Some(account("destination", "current", 0)),
        ))
        .expect("transfer effect");

        assert_eq!(deltas.len(), 2);
        assert_eq!(deltas[0].account_id, "destination");
        assert_eq!(deltas[0].balance_delta_paise, 10_000);
        assert_eq!(deltas[1].account_id, "source");
        assert_eq!(deltas[1].balance_delta_paise, -10_000);
    }

    #[test]
    fn credit_card_payment_decreases_asset_and_liability() {
        let deltas = calculate_account_deltas(&input(
            "credit_card_payment",
            account("bank", "savings", 20_000),
            Some(account("card", "credit_card", 30_000)),
        ))
        .expect("credit card payment effect");

        assert_eq!(deltas[0].account_id, "bank");
        assert_eq!(deltas[0].balance_delta_paise, -10_000);
        assert_eq!(deltas[1].account_id, "card");
        assert_eq!(deltas[1].balance_delta_paise, -10_000);
    }

    #[test]
    fn loan_repayment_decreases_asset_and_liability() {
        let deltas = calculate_account_deltas(&input(
            "loan_repayment",
            account("bank", "savings", 20_000),
            Some(account("loan", "loan", 100_000)),
        ))
        .expect("loan repayment effect");

        assert_eq!(deltas[0].balance_delta_paise, -10_000);
        assert_eq!(deltas[1].balance_delta_paise, -10_000);
    }

    #[test]
    fn investment_buy_decreases_account_balance() {
        let deltas = calculate_account_deltas(&input(
            "investment_buy",
            account("demat", "demat", 100_000),
            None,
        ))
        .expect("investment buy effect");

        assert_eq!(deltas.len(), 1);
        assert_eq!(deltas[0].account_id, "demat");
        assert_eq!(deltas[0].balance_delta_paise, -10_000);
    }

    #[test]
    fn valuation_update_sets_balance_to_amount() {
        let deltas = calculate_account_deltas(&input(
            "valuation_update",
            account("property", "real_estate", 100_000),
            None,
        ))
        .expect("valuation effect");

        assert_eq!(deltas[0].balance_delta_paise, -90_000);
    }

    #[test]
    fn rejects_transfer_without_destination() {
        let err = calculate_account_deltas(&input("transfer", account("bank", "savings", 0), None))
            .expect_err("transfer should require destination");

        assert_eq!(err, "Destination account is required");
    }

    #[test]
    fn reverse_deltas_negates_effects() {
        let deltas = vec![AccountDelta {
            account_id: "bank".into(),
            balance_delta_paise: -10_000,
            inr_value_delta_paise: -10_000,
        }];

        assert_eq!(
            reverse_deltas(&deltas),
            vec![AccountDelta {
                account_id: "bank".into(),
                balance_delta_paise: 10_000,
                inr_value_delta_paise: 10_000,
            }]
        );
    }

    #[test]
    fn blocked_funds_prevent_balance_from_dropping_too_low() {
        let account = AccountBalanceContext {
            blocked_paise: 15_000,
            ..account("bank", "savings", 20_000)
        };
        let deltas = vec![AccountDelta {
            account_id: "bank".into(),
            balance_delta_paise: -10_000,
            inr_value_delta_paise: -10_000,
        }];

        assert!(!would_keep_balances_non_negative(&[account], &deltas));
    }
}
