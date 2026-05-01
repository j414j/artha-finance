# Artha — Implementation Plan

## Decisions
- **Multi-user**: Yes, from Phase 1. Users are peers with no admin/member roles. Domain data is private per user, and all domain tables have a `user_id` FK from the start.
- **Deletion policy**: Accounts and transactions are never hard-deleted through app flows. Delete actions are soft deletes/archives scoped to the owning user.
- **Investment prices**: Manual-only. No live price feed.
- **Ticker bar**: Removed — serves no purpose for this use case.
- **Sankey chart**: Interactive (Recharts or custom SVG with real data, not static).

---

## Phase 0: Project Skeleton
**Goal**: `docker compose up --build` works end-to-end. No features.

### Backend
- `Cargo.toml` with axum, sqlx (sqlite, runtime-tokio), tokio, serde, bcrypt, uuid, chrono
- `src/main.rs`: Axum server, bind to 0.0.0.0:8080
- `src/db.rs`: SQLite pool setup via sqlx
- First migration: `0001_init.sql` (empty — just proves the pipeline runs)
- `GET /api/v1/health` → `{ "status": "ok" }`

### Frontend
- Vite + React 18 + TypeScript scaffold
- Tailwind CSS configured
- IBM Plex fonts (Mono, Sans, Sans Condensed) loaded via Google Fonts
- CSS variables from `docs/design.html` applied in `index.css`
- Blank `App.tsx` that renders "Artha" in the correct font

### Infrastructure
- `backend/Dockerfile` (multi-stage Rust build)
- `frontend/Dockerfile` (Node build + nginx serve)
- `docker-compose.yml` (backend, frontend, shared `data/` volume for SQLite)

### Completion marker
`docker compose up --build` → health endpoint returns 200, frontend loads in browser.

---

## Phase 1: Auth + App Shell
**Goal**: You can log in and see the empty-state app layout with all screen stubs.

### Backend
- Migration: `users` table (id, email, display_name, password_hash, avatar_initials, created_at)
- `POST /api/v1/auth/register` — bcrypt hash, create user
- `POST /api/v1/auth/login` — verify, set session cookie (signed, httponly)
- `POST /api/v1/auth/logout` — clear session
- `GET /api/v1/auth/me` — return current user from session
- Auth middleware: extract user from session cookie, reject unauthenticated requests
- No admin/member roles; every authenticated user can manage only their own domain data.

### Frontend
- Login page (matches design: dark bg, monospace inputs, accent button)
- Auth context + `useAuth` hook
- Protected route wrapper
- App shell:
  - Sidebar: 52px icon nav (Dashboard, Accounts, Transactions, Budget, Investments, Goals, Reports, Settings)
  - Topbar: "ARTHA FINANCE" title, tab navigation, privacy blur button, user avatar + date
  - Outlet for page content
- Route stubs for all 8 screens (just a placeholder heading each)
- Design system primitives:
  - `Button` (primary, ghost variants)
  - `Input`, `Select`
  - `Tag` (income, expense, transfer, invest variants)
  - `ProgressBar` (green, amber, red)
  - `MetricCard` (label + value + change)
  - Table base styles (th, td, hover row)

### Completion marker
Login → session persists on refresh → logout works → all sidebar nav items render stub pages.

---

## Phase 2: Accounts
**Goal**: Create and manage accounts; see a balance sheet with allocation chart.

### Backend
- Migration: `accounts` table
  - `id, user_id, name, type (enum: savings|current|credit_card|demat|mutual_fund|real_estate|loan|other_asset|other_liability), currency (ISO 4217), opening_balance_paise i64, opening_date, balance_paise i64, inr_value_paise i64, color_hex, is_active, archived_at, last_updated, notes`
- Migration: `audit_log` table for domain mutations
  - `id, user_id, action, entity_type, entity_id, diff_json, created_at`
- `GET /api/v1/accounts` — list active accounts for the authenticated user, grouped by asset/liability
- `POST /api/v1/accounts` — create account
- `PATCH /api/v1/accounts/:id` — update own account metadata/opening details
- `DELETE /api/v1/accounts/:id` — archive own account (set is_active = false, archived_at = now)
- `GET /api/v1/accounts/summary` — total assets, total liabilities, net worth for the authenticated user
- Audit account create/update/archive actions with the acting `user_id`

### Frontend
- Accounts screen:
  - Summary strip (total assets / liabilities / net worth)
  - Grouped table: Assets → Cash & Bank, Investments, Real Estate, Other; Liabilities → Loans, Credit Cards, Other Liabilities
  - Each row: color dot, name, currency tag, balance, INR value, last updated
  - Right sidebar: allocation donut chart (SVG), legend, loan progress bar
  - "+ Add Account" button → inline modal form
- Edit/archive account via row action menu (⋯)

### Completion marker
Add 3 accounts of different types → balance sheet renders correctly → net worth is sum of assets minus liabilities.

---

## Phase 3: Transactions
**Goal**: Log, browse, filter, and search all money movements.

### Backend
- Migrations:
  - `categories` table (id, user_id, name, type, color_hex, icon_emoji, is_default)
  - `transactions` table (id, user_id, account_id, type enum, date, description, amount_paise, category_id, notes, tags jsonb, is_recurring, created_at)
  - `transaction_splits` table (id, transaction_id, category_id, amount_paise, notes)
- Seed default categories per user on registration
- `GET /api/v1/transactions` — cursor-paginated; filters: date_from, date_to, account_id, category_id, type, tag, search (description LIKE), amount_min, amount_max
- `POST /api/v1/transactions` — create (with optional splits array)
- `PATCH /api/v1/transactions/:id` — update
- `DELETE /api/v1/transactions/:id` — soft delete own transaction
- `POST /api/v1/transactions/bulk` — bulk categorise / tag / soft delete
- `GET /api/v1/transactions/export/csv` — filtered CSV download
- `GET /api/v1/transactions/summary` — income/expense/net for current filter

### Frontend
- Transactions screen:
  - Filter bar: search box, date chip, account/category/type/amount/tag dropdowns, CSV export, "+ Add" button
  - Summary strip (count, total income, total expenses, net)
  - Bulk action bar (select all, bulk categorise/tag/soft delete)
  - TanStack Table with columns: checkbox, date, description, account, category, type tag, tags, amount, action menu
  - Cursor-based infinite scroll / load-more
- Add Transaction modal:
  - Type selector (Income, Expense, Transfer, Invest Buy, Invest Sell, Dividend, Loan Repay, CC Payment)
  - Prominent amount input
  - Fields: date, account, description, category, tags, notes
  - "Split into multiple categories" toggle → dynamic split rows
  - "Recurring transaction" checkbox
- Edit transaction inline (same modal, pre-filled)

### Completion marker
Add 10 transactions of mixed types → list renders with correct colours → filters narrow results → CSV downloads with correct data.

---

## Phase 4: Budget
**Goal**: Set monthly budgets per category and track actuals against them.

### Backend
- Migrations:
  - `budgets` table (id, user_id, category_id, monthly_limit_paise — base template)
  - `budget_overrides` table (id, user_id, category_id, year, month, limit_paise — per-month override)
- `GET /api/v1/budget?year=&month=` — returns each category with limit, actual spend (from transactions), %, status
- `PUT /api/v1/budget/base` — upsert base monthly limits for all categories
- `PUT /api/v1/budget/override` — upsert a single month override
- `GET /api/v1/budget/history?months=6` — per-category spend % for last N months

### Frontend
- Budget screen:
  - Month navigator (◀ Apr 2026 ▶) + elapsed days indicator
  - "Edit Base Budget" and "Monthly Override" buttons
  - Summary strip: total budget, spent, remaining, % used (with expected % for elapsed days)
  - Category cards grid (3 columns): name, progress bar, spent/limit, status label (✓ Under / ⚠ Near / ✗ Over)
  - Budget history table (6-month heat-map with colour-coded percentages)
  - Right sidebar: savings rate trend chart (Recharts LineChart), 6M average, unbudgeted spend list

### Completion marker
Set budgets for 5 categories → add matching transactions → cards show correct spend % → over-budget shows red border → history table populates across months.

---

## Phase 5: Investments
**Goal**: Track investment portfolio with manual prices and P&L.

### Backend
- Migration: `investment_holdings` table (id, user_id, account_id, symbol, name, instrument_type enum (stock|mf|etf|bond|other), units (real), avg_cost_paise, current_price_paise, last_price_updated)
- `GET /api/v1/investments` — list holdings with computed current_value, unrealised_pnl, pnl_pct
- `POST /api/v1/investments` — add holding
- `PATCH /api/v1/investments/:id` — update units, avg cost, or current price
- `DELETE /api/v1/investments/:id`
- `GET /api/v1/investments/summary` — invested_value, current_value, unrealised_pnl, pnl_pct, xirr (approximated or skipped for now)

### Frontend
- Investments screen:
  - Summary strip: invested value, current value, unrealised P&L (₹ + %), XIRR (if implemented)
  - Holdings table (TanStack Table): symbol, name, type tag, units, avg cost, current price, current value, P&L ₹, P&L %, last updated, action menu
  - "Update Price" inline edit on current_price cell
  - Right sidebar: allocation donut by instrument type + legend
  - "+ Add Holding" button → modal form

### Completion marker
Add 4 holdings of different types → update prices → P&L computes correctly → allocation donut reflects proportions.

---

## Phase 6: Goals
**Goal**: Set savings goals tied to accounts, track progress, block funds.

### Backend
- Migration: `goals` table (id, user_id, name, icon_emoji, target_amount_paise, source_account_id, target_date, blocked_amount_paise, status enum (active|completed|cancelled), created_at)
- `GET /api/v1/goals` — list goals with computed: remaining, progress_pct, required_per_month, projected_date, status label
- `POST /api/v1/goals` — create goal
- `PATCH /api/v1/goals/:id` — update goal or adjust blocked amount
- `DELETE /api/v1/goals/:id`
- `GET /api/v1/goals/account-availability` — per-account: total balance, blocked across goals, available

### Frontend
- Goals screen:
  - Goal cards (full-width stack): name, source account, progress bar, blocked/target amounts, remaining/target date/need-per-month grid, status badge (ON TRACK / SLIGHTLY BEHIND / AT RISK)
  - "Block Funds" button → modal to set blocked amount (validates against account available balance)
  - "History" button → simple contribution log
  - Right sidebar: account available balances table (total / blocked / available), total blocked callout

### Completion marker
Create 3 goals → block funds → available balance in sidebar reflects deductions → on-track / behind status computes correctly.

---

## Phase 7: Dashboard
**Goal**: Single-screen overview aggregating all modules.

### Backend
- `GET /api/v1/dashboard/summary` — net worth, total assets, total liabilities, current month income/expenses/net/savings rate
- `GET /api/v1/dashboard/networth-history?months=12` — monthly net worth snapshots (computed from accounts at end of each month, or best-effort from transaction history)
- `GET /api/v1/dashboard/cashflow-history?months=6` — monthly income + expense totals
- `GET /api/v1/dashboard/recent-transactions?limit=10` — latest 10 transactions

### Frontend
- Dashboard screen:
  - Top strip: net worth hero (value + MoM change + 12M sparkline), total assets tile (value + allocation bar), total liabilities tile (breakdown by type), current month cash flow tile (income/expenses/net savings/savings rate)
  - Body left: net worth over time area chart (Recharts, 12M, assets + net worth + liabilities lines)
  - Body centre: budget status preview (top 6 categories with progress bars, "View All →" link)
  - Body right (full height): recent transactions panel (date, description, amount, colour-coded)
  - Body bottom-left: monthly cash flow bar chart (6M grouped bars, income + expenses)

### Completion marker
All widgets populate from real data → net worth chart reflects account history → recent transactions match transactions screen.

---

## Phase 8: Reports + Cash Flow Sankey
**Goal**: Visual money flow diagram and exportable period reports.

### Backend
- `GET /api/v1/reports/cashflow?from=&to=` — income sources breakdown + expense category breakdown for a period, structured for Sankey rendering (nodes + flows with amounts)
- `GET /api/v1/reports/summary?from=&to=` — total income, expenses, investments, loan repayments, net saved for a period

### Frontend
- Reports screen:
  - Period selector (date range picker, presets: this month, last month, last quarter, custom)
  - Summary strip: total income, total expenses, investments, loan repayments, net saved (cash)
  - Interactive Sankey diagram: income sources (left) → expense categories / investments / savings (right), flows proportional to amount, hover tooltip showing exact amount
  - Export PDF button (print CSS `@media print` layout)

### Completion marker
Select a quarter → Sankey renders with real transaction data → node widths proportional → hover shows amounts → print produces clean PDF.

---

## Phase 9: Mobile + Final Polish
**Goal**: Fully functional on mobile; production-ready.

### Mobile
- Responsive breakpoints: ≤768px switches to mobile layout
- Bottom navigation bar (5 items: Dashboard, Accounts, Transactions, Budget, more)
- Mobile dashboard: stacked net worth hero, 2-column metric grid, horizontal-scroll recent transactions
- FAB (floating action button) → opens Add Transaction modal
- Touch-friendly tap targets throughout

### Polish
- Privacy blur toggle: blurs all monetary values site-wide; persists in localStorage
- 404 / error boundary pages
- Loading skeletons for all data-fetching states
- Empty states for all screens (no accounts yet, no transactions yet, etc.)
- Form validation with inline error messages

### Testing
- Backend: unit tests for financial calculations (P&L, savings rate, net worth), integration tests for all API endpoints
- Frontend: component tests for design system primitives, integration tests for Add Transaction flow

### Deployment
- Docker production hardening: non-root user, health checks, restart policies
- Environment variable config (DB path, session secret, CORS origin)
- `data/` volume mount for SQLite persistence
- Update `docs/REQUIREMENTS.md` and `CLAUDE.md` Current Status section

### Completion marker
Mobile layout renders correctly at 390px → privacy blur hides all numbers → all tests pass → `docker compose up` on a fresh machine produces a working app.
