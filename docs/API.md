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

On create, `balance_paise` is derived from `opening_balance_paise`; clients should not send a current/closing balance. For INR accounts, `inr_value_paise` is also derived from `opening_balance_paise`. For non-INR accounts, `inr_value_paise` is required as a manual base-currency value until FX rates are implemented.

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
Archive an unused category. Categories referenced by active transactions or splits cannot be archived until reassignment/merge exists.

**Response 204** (no body)

**Errors**: `UNAUTHORIZED`, `NOT_FOUND`, `BAD_REQUEST`

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
List active transactions, cursor-paginated by `date DESC, id DESC`. Defaults to the current month when no date filter is supplied.

**Query params**

`cursor`, `limit` (1-100), `date_from`, `date_to`, `account_id`, `category_id`, `type`, `tag`, `search`, `amount_min`, `amount_max`, `sort=date_desc`

**Response 200**
```json
{
  "transactions": [],
  "next_cursor": "2026-05-01|uuid"
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

## Health

### GET /api/v1/health

**Response 200**
```json
{ "status": "ok" }
```
