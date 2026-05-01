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

## Health

### GET /api/v1/health

**Response 200**
```json
{ "status": "ok" }
```
