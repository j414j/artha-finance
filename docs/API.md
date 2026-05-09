# Artha API Reference

Base path: `/api/v1/`  
Error format: `{ "error": { "code": "SCREAMING_SNAKE", "message": "human readable" } }`  
Dates: ISO 8601 / DD/MM/YYYY in display  
Money: all amounts in **paise** (i64), never floats  
Auth: session cookie `session_id` (HttpOnly, SameSite=Lax)

## Data Ownership

- Users are peers; there are no Admin or Member roles.
- All domain data is private to the authenticated user.
- Account, transaction, budget, goal, investment, report, export, and audit endpoints must scope reads and writes by the authenticated `user_id`.
- Accounts and transactions are never hard-deleted through app APIs. Delete actions are soft deletes/archives and exclude those records from active views and calculations.

---

## Auth

### POST /api/v1/auth/register
Create a new user account.

**Body**
```json
{ "email": "user@example.com", "display_name": "Rahul Sharma", "password": "min8chars" }
```

**Response 201**
```json
{ "user": { "id": "uuid", "email": "...", "display_name": "...", "avatar_initials": "RS" } }
```

**Errors**: `BAD_REQUEST` (email taken, password too short)

---

### POST /api/v1/auth/login
Authenticate and start a session. Sets `session_id` HttpOnly cookie (30-day expiry).

**Body**
```json
{ "email": "user@example.com", "password": "..." }
```

**Response 200**
```json
{ "user": { "id": "uuid", "email": "...", "display_name": "...", "avatar_initials": "RS" } }
```

**Errors**: `BAD_REQUEST` (invalid credentials)

---

### POST /api/v1/auth/logout
Clear the session. Always succeeds (idempotent). No auth required.

**Response 204** (no body)

---

### GET /api/v1/auth/me
Return the currently authenticated user. Requires valid session cookie.

**Response 200**
```json
{ "user": { "id": "uuid", "email": "...", "display_name": "...", "avatar_initials": "RS" } }
```

**Errors**: `UNAUTHORIZED`

---

## Accounts

Account types:

| Type | Side | Class |
|---|---|---|
| `savings` | asset | Cash & Bank |
| `current` | asset | Cash & Bank |
| `demat` | asset | Investments |
| `mutual_fund` | asset | Investments |
| `real_estate` | asset | Real Estate |
| `other_asset` | asset | Other Assets |
| `loan` | liability | Loans |
| `credit_card` | liability | Credit Cards |
| `other_liability` | liability | Other Liabilities |

Liability balances are stored as positive outstanding amounts and subtracted when computing net worth.

### Account object

```json
{
  "id": "uuid",
  "name": "HDFC Savings",
  "type": "savings",
  "currency": "INR",
  "opening_balance_paise": 84200000,
  "opening_date": "2026-04-01",
  "balance_paise": 84200000,
  "inr_value_paise": 84200000,
  "color_hex": "#3A7FFF",
  "is_active": true,
  "last_updated": "2026-05-01 10:30:00",
  "notes": null,
  "side": "asset",
  "class_key": "cash_bank",
  "class_label": "Cash & Bank"
}
```

`inr_value_paise` is returned in base currency INR. For non-INR accounts, list and summary responses use the latest saved FX rate for `account.currency/INR` when available, falling back to the stored manual INR value when no rate exists. For `demat` and `mutual_fund` accounts, list and summary responses include brokerage cash plus current holdings value; holdings are converted to the account currency and INR when a saved FX rate is available.

### GET /api/v1/accounts/:id
Return a single active account with FX enrichment applied. For investment accounts (`demat`, `mutual_fund`), `balance_paise` includes holdings value and `cash_balance_paise` is the raw brokerage cash balance.

**Response 200**
```json
{
  "account": {
    "id": "uuid",
    "name": "Zerodha",
    "type": "demat",
    "currency": "INR",
    "balance_paise": 154000000,
    "cash_balance_paise": 4000000,
    "inr_value_paise": 154000000
  }
}
```

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`

---

### GET /api/v1/accounts/:id/balance-history
Return a daily balance timeline for the specified account over the last N days (default 30, max 365).

For regular accounts, `balance_paise` is the cash balance. For investment accounts (`demat`, `mutual_fund`), each point additionally includes `cash_paise` (brokerage cash), `holdings_paise` (total asset value at current prices), and `total_paise` (sum of both).

**Query params**: `days` (integer, 1–365, default 30)

**Response 200 — regular account**
```json
{
  "balance_history": [
    { "date": "2026-04-06", "balance_paise": 84200000 },
    { "date": "2026-04-07", "balance_paise": 84200000 }
  ]
}
```

**Response 200 — investment account**
```json
{
  "balance_history": [
    { "date": "2026-04-06", "balance_paise": 5000000, "cash_paise": 5000000, "holdings_paise": 32895400, "total_paise": 37895400 },
    { "date": "2026-04-07", "balance_paise": 5000000, "cash_paise": 5000000, "holdings_paise": 32895400, "total_paise": 37895400 }
  ]
}
```

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`

---

### GET /api/v1/accounts
List active accounts owned by the authenticated user, grouped for the balance sheet.

**Response 200**
```json
{
  "summary": {
    "total_assets_paise": 146000000,
    "total_liabilities_paise": 4650900,
    "net_worth_paise": 141349100
  },
  "asset_groups": [
    {
      "key": "cash_bank",
      "label": "Cash & Bank",
      "side": "asset",
      "total_inr_value_paise": 146000000,
      "accounts": []
    }
  ],
  "liability_groups": []
}
```

**Errors**: `UNAUTHORIZED`

---

### GET /api/v1/accounts/summary
Return owner-scoped account totals.

**Response 200**
```json
{
  "summary": {
    "total_assets_paise": 146000000,
    "total_liabilities_paise": 4650900,
    "net_worth_paise": 141349100
  }
}
```

**Errors**: `UNAUTHORIZED`

---

### POST /api/v1/accounts
Create an account owned by the authenticated user.

**Body**
```json
{
  "name": "HDFC Savings",
  "type": "savings",
  "currency": "INR",
  "opening_balance_paise": 84200000,
  "opening_date": "2026-04-01",
  "color_hex": "#3A7FFF",
  "notes": "Primary salary account"
}
```

On create, `balance_paise` is derived from `opening_balance_paise`; clients should not send a current/closing balance. For INR accounts, `inr_value_paise` is also derived from `opening_balance_paise`. For non-INR accounts, `inr_value_paise` is required as a manual base-currency fallback for periods where no FX rate exists.

**Response 201**
```json
{ "account": { "id": "uuid", "name": "HDFC Savings", "type": "savings" } }
```

**Errors**: `UNAUTHORIZED`, `BAD_REQUEST`

---

### PATCH /api/v1/accounts/:id
Update an active account owned by the authenticated user. All fields are optional.

**Body**
```json
{
  "name": "HDFC Savings",
  "opening_balance_paise": 85000000,
  "notes": null
}
```

**Response 200**
```json
{ "account": { "id": "uuid", "name": "HDFC Savings", "type": "savings" } }
```

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`

---

### DELETE /api/v1/accounts/:id
Archive an active account owned by the authenticated user. This is a soft delete only: the row remains in the database with `is_active = false` and is excluded from active account lists and calculations.

**Response 204** (no body)

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`

---

## Categories

Categories are private to the authenticated user and are grouped into an income/expense parent-child tree.

### Category object

```json
{
  "id": "uuid-or-default-id",
  "parent_id": null,
  "name": "Food",
  "type": "expense",
  "color_hex": "#F0A500",
  "icon_emoji": "FO",
  "is_default": true,
  "children": []
}
```

### GET /api/v1/categories
List active categories owned by the authenticated user.

**Response 200**
```json
{ "categories": [{ "id": "uuid", "name": "Food", "children": [] }] }
```

### POST /api/v1/categories
Create a category.

**Body**
```json
{
  "parent_id": null,
  "name": "Medical",
  "type": "expense",
  "color_hex": "#F04060",
  "icon_emoji": "MD"
}
```

**Response 201**
```json
{ "category": { "id": "uuid", "name": "Medical", "type": "expense" } }
```

### PATCH /api/v1/categories/:id
Update category name, parent, color, or icon. `type` cannot be changed after creation.

**Body**
```json
{ "name": "Healthcare", "parent_id": null, "icon_emoji": "HC" }
```

**Response 200**
```json
{ "category": { "id": "uuid", "name": "Healthcare" } }
```

### DELETE /api/v1/categories/:id
Archive a category. Any active transactions or split lines that reference it are reassigned to uncategorised.

**Response 204** (no body)

---

## Transactions

Transaction rows, splits, tags, account effects, summaries, and CSV exports are scoped to the authenticated owner. Deleting a transaction sets `deleted_at` and reverses the stored account balance effects; no transaction is hard-deleted through the API.

Transaction types:

| Type | Balance effect in Phase 3 |
|---|---|
| `income` | Asset account increases |
| `expense` | Asset account decreases, or credit-card liability increases |
| `transfer` | Source asset decreases; destination asset increases |
| `investment_buy` | Record-only until Phase 5 holdings/cash sub-ledger |
| `investment_sell` | Record-only until Phase 5 holdings/cash sub-ledger |
| `dividend` | Asset/investment account increases |
| `loan_repayment` | Source asset decreases; loan liability decreases |
| `credit_card_payment` | Source asset decreases; credit-card liability decreases |
| `valuation_update` | Account balance is set to the submitted amount |

### Transaction object

```json
{
  "id": "uuid",
  "account_id": "uuid",
  "account_name": "HDFC Savings",
  "transfer_account_id": null,
  "transfer_account_name": null,
  "type": "expense",
  "date": "2026-05-01",
  "description": "Groceries",
  "amount_paise": 300000,
  "account_currency": "INR",
  "inr_amount_paise": 300000,
  "category_id": "uuid",
  "category_name": "Groceries",
  "notes": null,
  "tags": ["home"],
  "splits": [],
  "is_recurring": false,
  "recurrence_frequency": null,
  "created_at": "2026-05-01 10:30:00",
  "updated_at": "2026-05-01 10:30:00"
}
```

### GET /api/v1/transactions
List active transactions, cursor-paginated by `date DESC, created_at DESC, rowid DESC`. Defaults to the current month when no date filter is supplied.

**Query params**

`cursor`, `limit` (1-100), `date_from`, `date_to`, `account_id`, `category_id`, `type`, `tag`, `search`, `amount_min`, `amount_max`, `sort=date_desc`

**Response 200**
```json
{
  "transactions": [],
  "next_cursor": "2026-05-01|2026-05-01 10:30:00|42"
}
```

### GET /api/v1/transactions/summary
Return count, income, expense, and net totals using the same filters as the list endpoint.

**Response 200**
```json
{
  "summary": {
    "count": 12,
    "total_income_paise": 15000000,
    "total_expense_paise": 4200000,
    "net_paise": 10800000
  }
}
```

### POST /api/v1/transactions
Create a transaction. All referenced accounts/categories must belong to the authenticated user. Income, expense, and dividend require a matching category unless an income/expense transaction uses splits. Splits must total exactly `amount_paise`.

For transactions on foreign-currency accounts, `fx_rate` (INR per 1 unit of account currency) may be supplied to record the exchange rate at transaction time. `inr_amount_paise` in responses is always the INR-equivalent value computed as `amount_paise × fx_rate` (or `amount_paise` for INR accounts). For `transfer` type, `fx_to_amount_paise` and `fx_fee_paise` are also accepted.

**Body**
```json
{
  "account_id": "uuid",
  "transfer_account_id": null,
  "type": "expense",
  "date": "2026-05-01",
  "description": "Groceries",
  "amount_paise": 300000,
  "category_id": "uuid",
  "notes": null,
  "tags": ["home"],
  "splits": [],
  "is_recurring": false,
  "recurrence_frequency": null
}
```

**Response 201**
```json
{ "transaction": { "id": "uuid", "type": "expense", "amount_paise": 300000 } }
```

### PATCH /api/v1/transactions/:id
Update an active transaction. The API reverses the original stored account effects and applies the new effects in one database transaction.

**Body**
```json
{
  "description": "Weekly groceries",
  "amount_paise": 325000,
  "tags": ["home", "food"]
}
```

**Response 200**
```json
{ "transaction": { "id": "uuid", "description": "Weekly groceries" } }
```

### DELETE /api/v1/transactions/:id
Soft delete an active transaction and reverse its stored account balance effects.

**Response 204** (no body)

### POST /api/v1/transactions/bulk
Apply one action to up to 100 active transactions.

**Body examples**
```json
{ "ids": ["uuid"], "action": "add_tag", "tag": "tax" }
```
```json
{ "ids": ["uuid"], "action": "categorize", "category_id": "uuid" }
```
```json
{ "ids": ["uuid"], "action": "soft_delete" }
```

Supported actions: `soft_delete`, `add_tag`, `remove_tag`, `categorize`.

**Response 200**
```json
{ "updated": 1 }
```

### GET /api/v1/transactions/export/csv
Export up to 10,000 filtered transactions as CSV. Uses the same filters as the list endpoint except cursor pagination.

**Response 200** `text/csv`

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`

---

## Budget

Budgets are scoped to the authenticated user and only apply to expense categories.

The budget model has two layers:

- `budget_base`: the recurring monthly template.
- `budget_months` + `budget_month_allocations`: a per-month snapshot copied from the base budget when that month is first opened or edited.

Editing the base budget does not mutate already materialized months. If a real base budget already exists, the backend materializes the current month and months with existing transaction activity using the old base values before saving the base edit, so later base changes do not rewrite previous budgets. Empty automatic snapshots are treated as uninitialized; once a base budget is created, those months are refreshed from the base instead of staying at zero. Monthly edits update only that selected month.

### Budget category object

```json
{
  "id": "uuid-or-default-id",
  "parent_id": "parent-id-or-null",
  "name": "Groceries",
  "color_hex": "#F0A500",
  "icon_emoji": "GR"
}
```

### GET /api/v1/budget/base

Return every active expense category with its base monthly amount. Categories without a base budget return `amount_paise: 0`.

**Response 200**
```json
{
  "allocations": [
    {
      "category_id": "uuid",
      "category": { "id": "uuid", "name": "Groceries" },
      "amount_paise": 1200000
    }
  ]
}
```

### PUT /api/v1/budget/base

Upsert base allocations. Omitted categories are unchanged. Sending `amount_paise: 0` removes that category from the recurring base template. Existing monthly snapshots are not changed.

**Body**
```json
{
  "allocations": [
    { "category_id": "uuid", "amount_paise": 1200000 }
  ]
}
```

**Response 200**
```json
{ "allocations": [ { "category_id": "uuid", "amount_paise": 1200000 } ] }
```

**Errors**: `UNAUTHORIZED`, `BAD_REQUEST`

---

### GET /api/v1/budget?year=&month=

Return the selected month budget. If the month does not have a snapshot yet, the backend creates one by copying the current base budget values for all active expense categories.

Expense transactions are attributed to the nearest budgeted category in their category ancestry. For example, if `Transport` is budgeted and `Fuel` is not, `Fuel` spend rolls up to `Transport`; if both are budgeted, `Fuel` spend stays on `Fuel`.

**Query params**

`year` and `month` are optional together. If both are omitted, the current server month is used.

**Response 200**
```json
{
  "budget": {
    "year": 2026,
    "month": 4,
    "month_label": "April 2026",
    "summary": {
      "total_budget_paise": 8500000,
      "spent_paise": 6842000,
      "remaining_paise": 1658000,
      "used_pct": 80.5,
      "expected_pct": 93.3,
      "days_elapsed": 28,
      "days_in_month": 30
    },
    "savings": {
      "income_paise": 15000000,
      "expense_paise": 8200000,
      "net_paise": 6800000,
      "savings_rate_pct": 45.3
    },
    "allocations": [
      {
        "category_id": "uuid",
        "category": { "id": "uuid", "name": "Groceries" },
        "amount_paise": 1200000,
        "is_manual_override": false
      }
    ],
    "items": [
      {
        "category_id": "uuid",
        "category": { "id": "uuid", "name": "Groceries" },
        "allocated_paise": 1200000,
        "spent_paise": 820000,
        "remaining_paise": 380000,
        "used_pct": 68.3,
        "expected_pct": 93.3,
        "status": "well_within",
        "is_manual_override": false
      }
    ],
    "unbudgeted": [
      {
        "category_id": "uuid",
        "category_name": "Gifts",
        "color_hex": "#C02040",
        "icon_emoji": "SH",
        "spent_paise": 250000
      }
    ]
  }
}
```

`status` is one of `over_budget`, `near_limit`, `ahead_of_pace`, `well_within`, or `on_track`.

---

### PUT /api/v1/budget/monthly

Upsert allocations for one month. If the month has not been materialized, it is first copied from the base budget, then the supplied category amounts are marked as manual overrides. Omitted categories keep their current monthly snapshot value.

Alias: `PUT /api/v1/budget/override`

**Body**
```json
{
  "year": 2026,
  "month": 4,
  "allocations": [
    { "category_id": "uuid", "amount_paise": 1000000 }
  ]
}
```

**Response 200**
```json
{ "budget": { "year": 2026, "month": 4, "items": [] } }
```

**Errors**: `UNAUTHORIZED`, `BAD_REQUEST`

---

### GET /api/v1/budget/history?year=&month=&months=

Return budget usage percentages and savings-rate trend for the trailing window ending at the selected month. `months` defaults to `6` and must be between `1` and `24`.

**Response 200**
```json
{
  "history": {
    "months": [
      { "year": 2025, "month": 11, "label": "Nov" }
    ],
    "rows": [
      {
        "category_id": "uuid",
        "category": { "id": "uuid", "name": "Groceries" },
        "values": [
          {
            "year": 2025,
            "month": 11,
            "allocated_paise": 1200000,
            "spent_paise": 940000,
            "used_pct": 78.3
          }
        ]
      }
    ],
    "savings_rate_trend": [
      {
        "year": 2025,
        "month": 11,
        "label": "Nov",
        "income_paise": 15000000,
        "expense_paise": 9000000,
        "savings_rate_pct": 40.0
      }
    ]
  }
}
```

**Errors**: `UNAUTHORIZED`, `BAD_REQUEST`

---

## Goals

Savings goals reserve funds against a `savings` or `current` account without moving the cash out of that account. The source account balance stays unchanged, but the backend treats `balance_paise - blocked_paise` as the spendable amount.

Any transaction or direct account balance edit that would reduce an account below its total active blocked amount is rejected.

### Goal object

```json
{
  "id": "uuid",
  "name": "Emergency Fund",
  "color_hex": "#F0A500",
  "target_amount_paise": 30000000,
  "source_account_id": "uuid",
  "source_account_name": "HDFC Savings",
  "target_date": "2026-12-31",
  "current_blocked_paise": 24000000,
  "completed_amount_paise": null,
  "display_amount_paise": 24000000,
  "remaining_paise": 6000000,
  "progress_pct": 80.0,
  "projected_completion_date": "2026-10-18",
  "required_monthly_paise": 1600000,
  "status": "active",
  "status_label": "ON TRACK",
  "status_tone": "green",
  "notes": null,
  "created_at": "2026-05-02 10:00:00",
  "completed_at": null
}
```

For active goals, `display_amount_paise` matches `current_blocked_paise`. For completed goals, it matches the captured completion amount.

### GET /api/v1/goals

Return active goals, completed goals, and source-account availability.

**Response 200**
```json
{
  "active_goals": [{ "...": "Goal" }],
  "completed_goals": [{ "...": "Goal" }],
  "account_availability": [
    {
      "account_id": "uuid",
      "account_name": "HDFC Savings",
      "total_balance_paise": 84200000,
      "blocked_paise": 31000000,
      "available_balance_paise": 53200000
    }
  ],
  "total_blocked_paise": 32800000
}
```

### GET /api/v1/goals/account-availability

Return only the source-account availability table.

**Response 200**
```json
{
  "accounts": [
    {
      "account_id": "uuid",
      "account_name": "HDFC Savings",
      "total_balance_paise": 84200000,
      "blocked_paise": 31000000,
      "available_balance_paise": 53200000
    }
  ],
  "total_blocked_paise": 32800000
}
```

### POST /api/v1/goals

Create a goal. `source_account_id` must reference an active `savings` or `current` account. Goal color is assigned automatically by the backend.

**Body**
```json
{
  "name": "Emergency Fund",
  "target_amount_paise": 30000000,
  "source_account_id": "uuid",
  "target_date": "2026-12-31",
  "notes": null
}
```

**Response 200**
```json
{ "goal": { "...": "Goal" } }
```

### PATCH /api/v1/goals/:id

Update an active goal. The source account cannot be changed while the goal still has blocked funds.

**Body**
```json
{
  "name": "Emergency Fund FY27",
  "target_amount_paise": 36000000,
  "target_date": null
}
```

**Response 200**
```json
{ "goal": { "...": "Goal" } }
```

### POST /api/v1/goals/:id/block

Block funds for an active goal.

**Body**
```json
{
  "amount_paise": 500000,
  "date": "2026-05-02",
  "notes": "Monthly transfer"
}
```

The request is rejected if the source account's available balance is lower than `amount_paise`.

**Response 200**
```json
{ "goal": { "...": "Goal" } }
```

### POST /api/v1/goals/:id/release

Release part of the currently blocked amount for an active goal.

**Body**
```json
{
  "amount_paise": 150000,
  "date": "2026-05-08",
  "notes": "Needed for expense"
}
```

The request is rejected if `amount_paise` exceeds the current blocked amount.

**Response 200**
```json
{ "goal": { "...": "Goal" } }
```

### POST /api/v1/goals/:id/complete

Manually mark an active goal complete. This does not require the target amount to be fully reached.

Any still-blocked amount is released automatically, `current_blocked_paise` becomes `0`, and `completed_amount_paise` captures the progress amount at completion time.

**Body**
```json
{
  "date": "2026-05-10",
  "notes": "Purchased the laptop"
}
```

`date` is optional; when omitted, the current server date is used.

**Response 200**
```json
{ "goal": { "...": "Goal" } }
```

### GET /api/v1/goals/:id/history

Return the goal event ledger in reverse chronological order.

**Response 200**
```json
{
  "events": [
    {
      "id": "uuid",
      "event_type": "block",
      "amount_paise": 500000,
      "date": "2026-05-02",
      "notes": "Monthly transfer",
      "created_at": "2026-05-02 10:30:00"
    }
  ]
}
```

Supported event types: `block`, `release`, `complete_release`, `cancel_release`.

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`

---

## Health

### GET /api/v1/health

**Response 200**
```json
{ "status": "ok" }
```

---

## Phase 5 — Investments & FX

### FX Rates

FX rate entries record the exchange rate between two currencies on a given date. The same pair can have multiple entries (one per day). All rates are stored as `f64`.

#### FX Rate object

```json
{
  "id": "uuid",
  "from_currency": "USD",
  "to_currency": "INR",
  "rate": 83.45,
  "date": "2026-05-01",
  "notes": null,
  "created_at": "2026-05-01 10:30:00"
}
```

#### GET /api/v1/fx-rates

List all FX rate entries for the authenticated user, ordered by `date DESC`.

**Query params**: `from_currency`, `to_currency` (optional filters, case-insensitive)

**Response 200**
```json
{ "fx_rates": [ { ...FxRate } ] }
```

---

#### GET /api/v1/fx-rates/latest

Return the most-recent rate for each distinct `(from_currency, to_currency)` pair. Recency is resolved by `date DESC, created_at DESC`; older rows remain in history.

**Response 200**
```json
{
  "latest": [
    { "from_currency": "USD", "to_currency": "INR", "rate": 83.45, "date": "2026-05-01" }
  ]
}
```

---

#### POST /api/v1/fx-rates

Create a new FX rate entry. Recording a new row is the normal way to update a pair while preserving history.

**Body**
```json
{
  "from_currency": "USD",
  "to_currency": "INR",
  "rate": 83.45,
  "date": "2026-05-01",
  "notes": null
}
```

Validation:
- `from_currency` and `to_currency`: required, 2–10 uppercase alphanumeric chars, must differ
- `rate`: must be > 0
- `date`: YYYY-MM-DD

**Response 201**
```json
{ "fx_rate": { ...FxRate } }
```

**Errors**: `UNAUTHORIZED`, `BAD_REQUEST`

---

#### DELETE /api/v1/fx-rates/:id

Hard-delete the FX rate entry (no soft-delete for FX rates).

**Response 204** (no body)

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`

---

### Instruments

An instrument represents a tradable security (equity, mutual fund, ETF, bond, gold, crypto, or other).

#### Instrument types

`equity`, `mf`, `etf`, `bond`, `gold`, `crypto`, `other`

#### Instrument object

```json
{
  "id": "uuid",
  "name": "Reliance Industries",
  "ticker": "RELIANCE",
  "type": "equity",
  "currency": "INR",
  "sector": "Energy",
  "geography": "India",
  "notes": null,
  "is_active": true,
  "created_at": "2026-05-01 10:30:00",
  "updated_at": "2026-05-01 10:30:00"
}
```

#### GET /api/v1/instruments

List all active instruments for the authenticated user, ordered alphabetically by name.

**Response 200**
```json
{ "instruments": [ { ...Instrument } ] }
```

---

#### GET /api/v1/instruments/:id

Get a single instrument plus its latest price snapshot.

**Response 200**
```json
{
  "instrument": {
    "id": "uuid",
    "name": "Reliance Industries",
    "ticker": "RELIANCE",
    "type": "equity",
    "currency": "INR",
    "sector": "Energy",
    "geography": "India",
    "notes": null,
    "is_active": true,
    "created_at": "...",
    "updated_at": "...",
    "latest_price": {
      "id": "uuid",
      "instrument_id": "uuid",
      "price_paise": 290000000,
      "date": "2026-05-01",
      "notes": null,
      "created_at": "..."
    }
  }
}
```

`latest_price` is `null` when no price snapshots exist.

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`

---

#### POST /api/v1/instruments

Create an instrument.

**Body**
```json
{
  "name": "Reliance Industries",
  "type": "equity",
  "ticker": "RELIANCE",
  "currency": "INR",
  "sector": "Energy",
  "geography": "India",
  "notes": null
}
```

Validation:
- `name`: required, 1–200 chars
- `type`: must be a valid instrument type
- `ticker`: optional, 1–20 chars, stored uppercase
- `currency`: optional, defaults to `INR`, 2–10 alphanumeric chars
- `sector`, `geography`: optional, 1–100 chars if provided
- `notes`: optional, max 2000 chars

**Response 201**
```json
{ "instrument": { ...Instrument } }
```

**Errors**: `UNAUTHORIZED`, `BAD_REQUEST`

---

#### PATCH /api/v1/instruments/:id

Update an instrument. All fields are optional. Pass `null` to clear optional fields (ticker, sector, geography, notes).

**Body**
```json
{ "name": "Reliance Industries Ltd", "sector": null }
```

**Response 200**
```json
{ "instrument": { ...Instrument } }
```

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`

---

#### DELETE /api/v1/instruments/:id

Soft-delete (archive) an instrument (`is_active = false`). Archived instruments are excluded from active lists. Instruments with active holdings cannot be archived.

**Response 204** (no body)

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`

---

### Price Snapshots

Manual price entries per instrument, one per date.

#### Price Snapshot object

```json
{
  "id": "uuid",
  "instrument_id": "uuid",
  "price_paise": 290000000,
  "date": "2026-05-01",
  "notes": null,
  "created_at": "2026-05-01 10:30:00"
}
```

#### GET /api/v1/instruments/:id/prices

List all price snapshots for the instrument, ordered by `date DESC`.

**Response 200**
```json
{ "prices": [ { ...PriceSnapshot } ] }
```

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`

---

#### POST /api/v1/instruments/:id/prices

Add a price snapshot.

**Body**
```json
{ "price_paise": 290000000, "date": "2026-05-01", "notes": null }
```

Validation:
- `price_paise`: >= 0
- `date`: YYYY-MM-DD

**Response 201**
```json
{ "price": { ...PriceSnapshot } }
```

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`

---

#### DELETE /api/v1/instruments/:id/prices/:pid

Delete a price snapshot (hard delete).

**Response 204** (no body)

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`

---

### Holdings

Computed view derived from `investment_buy` / `investment_sell` transactions and corporate actions. Holdings are not stored — they are always calculated on-the-fly.

#### HoldingView object

```json
{
  "instrument_id": "uuid",
  "instrument_name": "Reliance Industries",
  "instrument_ticker": "RELIANCE",
  "instrument_type": "equity",
  "instrument_currency": "INR",
  "instrument_sector": "Energy",
  "instrument_geography": "India",
  "account_id": "uuid",
  "account_name": "HDFC Demat",
  "quantity_held": 10.0,
  "avg_cost_per_unit_paise": 250000000,
  "invested_value_paise": 2500000000,
  "invested_value_inr_paise": 2500000000,
  "latest_price_paise": 290000000,
  "latest_price_date": "2026-05-01",
  "current_value_paise": 2900000000,
  "current_value_inr_paise": 2900000000,
  "unrealised_pnl_paise": 400000000,
  "unrealised_pnl_inr_paise": 400000000,
  "unrealised_pnl_pct": 16.0,
  "realised_pnl_paise": 0,
  "realised_pnl_inr_paise": 0
}
```

Native values are denominated in `instrument_currency`. `invested_value_inr_paise` uses the saved FX rate on or before each buy date, falling back to the latest saved FX rate if there is no historical rate. `current_value_inr_paise` uses the latest saved FX rate. If an instrument has no manual price snapshot, current value uses the latest buy price so a newly-created investment has a non-zero current value immediately.

Native current-value fields are `null` only when no price snapshot or buy-price fallback is available. INR fields can also be `null` when the required FX rate is not available.

#### GET /api/v1/investments/holdings

List all holdings for the authenticated user.

**Query params**: `account_id` (optional — filter to a single account)

**Response 200**
```json
{ "holdings": [ { ...HoldingView } ] }
```

**Errors**: `UNAUTHORIZED`

---

#### GET /api/v1/investments/holdings/summary

Aggregate summary across all holdings.

**Query params**: `account_id` (optional)

**Response 200**
```json
{
  "summary": {
    "total_invested_paise": 2500000000,
    "total_current_value_paise": 2900000000,
    "total_unrealised_pnl_paise": 400000000,
    "total_unrealised_pnl_pct": 16.0,
    "total_realised_pnl_paise": 0,
    "holdings_count": 3
  }
}
```

`total_current_value_paise`, `total_unrealised_pnl_paise`, and `total_unrealised_pnl_pct` are INR values and are `null` when no holdings have a current INR valuation.

**Errors**: `UNAUTHORIZED`

---

### Corporate Actions

Corporate actions (splits, bonuses, dividend reinvestments) adjust the quantity held in a position without a matching buy/sell transaction.

#### Corporate Action types

`split`, `bonus`, `dividend_reinvested`

#### Corporate Action object

```json
{
  "id": "uuid",
  "instrument_id": "uuid",
  "account_id": "uuid",
  "type": "bonus",
  "date": "2026-04-01",
  "quantity_delta": 5.0,
  "split_ratio": null,
  "price_per_unit_paise": null,
  "notes": null,
  "created_at": "2026-05-01 10:30:00"
}
```

For `dividend_reinvested`, `price_per_unit_paise` records the price at which units were issued.

#### GET /api/v1/investments/corporate-actions

List all corporate actions for the authenticated user.

**Query params**: `instrument_id` (optional filter)

**Response 200**
```json
{ "corporate_actions": [ { ...CorporateAction } ] }
```

---

#### POST /api/v1/investments/corporate-actions

Create a corporate action.

**Body**
```json
{
  "instrument_id": "uuid",
  "account_id": "uuid",
  "type": "bonus",
  "date": "2026-04-01",
  "quantity_delta": 5.0,
  "split_ratio": null,
  "price_per_unit_paise": null,
  "notes": null
}
```

Validation:
- `instrument_id`: must exist and belong to the authenticated user
- `account_id`: must exist, belong to the user, and be active
- `type`: must be `split`, `bonus`, or `dividend_reinvested`
- `date`: YYYY-MM-DD
- `quantity_delta`: non-zero (negative for reverse splits)
- `price_per_unit_paise`: required and >= 0 when type is `dividend_reinvested`

**Response 201**
```json
{ "corporate_action": { ...CorporateAction } }
```

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`

---

#### DELETE /api/v1/investments/corporate-actions/:id

Hard-delete a corporate action.

**Response 204** (no body)

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`

---

### Investment Transactions (extended fields)

When creating or updating a transaction of type `investment_buy` or `investment_sell`, the body may include investment-specific detail fields:

```json
{
  "account_id": "uuid",
  "type": "investment_buy",
  "date": "2026-05-01",
  "description": "Buy RELIANCE",
  "amount_paise": 2900000000,
  "instrument_id": "uuid",
  "quantity": 10.0,
  "price_per_unit_paise": 290000000,
  "fees_paise": 50000
}
```

For cross-currency transfers, the body may include FX fields:

```json
{
  "account_id": "uuid",
  "transfer_account_id": "uuid",
  "type": "transfer",
  "date": "2026-05-01",
  "description": "USD to INR transfer",
  "amount_paise": 83450000,
  "fx_rate": 83.45,
  "fx_to_amount_paise": 1000000,
  "fx_fee_paise": 20000
}
```

For a transfer between accounts with different currencies, `fx_rate` and `fx_to_amount_paise` are required. `fx_rate` is destination currency units per source currency unit; `fx_to_amount_paise` must equal `amount_paise * fx_rate` rounded to the nearest smallest unit. Same-currency transfers must not send FX fields.

These fields are stored on the transaction row. Investment-specific fields are stored in `investment_transaction_details` and used for holdings computation. The `amount_paise` on the parent transaction always represents the source-account debit/credit for balance-effect purposes.

For a cash `dividend`, `amount_paise` is the cash income amount and `category_id` must point to an income category. The body may include `instrument_id` to link the dividend to an instrument; quantity, price, and fee fields are ignored for dividend holdings and do not affect allocation.

Holdings summary totals are returned in INR. Invested totals use historical buy-date FX rates where available; current value and unrealised P&L use the latest saved FX rate for each instrument currency. Holding rows also include native-currency values plus nullable INR converted fields:

- `invested_value_inr_paise`
- `current_value_inr_paise`
- `unrealised_pnl_inr_paise`
- `realised_pnl_inr_paise`
