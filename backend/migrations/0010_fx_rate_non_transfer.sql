-- Backfill fx_rate for existing non-INR, non-transfer transactions
-- using the closest fx_rates entry on or before the transaction date
UPDATE transactions
SET fx_rate = (
    SELECT fxr.rate
    FROM fx_rates fxr
    JOIN accounts a ON a.id = transactions.account_id
    WHERE fxr.user_id = transactions.user_id
      AND fxr.from_currency = a.currency
      AND fxr.to_currency = 'INR'
      AND fxr.date <= transactions.date
    ORDER BY fxr.date DESC
    LIMIT 1
)
WHERE transactions.fx_rate IS NULL
  AND transactions.type != 'transfer'
  AND transactions.account_id IN (
    SELECT id FROM accounts WHERE currency != 'INR'
  );
