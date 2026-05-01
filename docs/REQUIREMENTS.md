# Personal Finance App — Product Requirements Document

**Version:** 1.0  
**Date:** April 2026  
**Status:** Draft

---

## Table of Contents

1. [Overview](#1-overview)
2. [Users & Authentication](#2-users--authentication)
3. [Core Financial Model](#3-core-financial-model)
4. [Accounts](#4-accounts)
5. [Transactions](#5-transactions)
6. [Budgets](#6-budgets)
7. [Savings Goals](#7-savings-goals)
8. [Investment Accounts](#8-investment-accounts)
9. [Reports & Visualisations](#9-reports--visualisations)
10. [Data Management](#10-data-management)
11. [Technical Architecture](#11-technical-architecture)
12. [Non-Functional Requirements](#12-non-functional-requirements)

---

## 1. Overview

A self-hosted personal finance web application for a small family-scale installation (up to 5 private users). The app provides comprehensive tracking of net worth, assets, liabilities, transactions, budgets, savings goals, and investments — with a strong emphasis on rich visualisations and analytics.

The reference project is [we-promise/sure](https://github.com/we-promise/sure) (a community fork of Maybe Finance). This app aims to improve upon it with deeper investment tracking, better analytics, XIRR calculation, a budget rollover system, savings goal blocking, and a more resource-efficient backend suitable for self-hosting on constrained hardware.

### 1.1 Design Philosophy

- **Manual-entry first.** No bank sync or third-party data provider dependencies. The user is in full control of their data.
- **Visualisation-rich.** Every module has charts and analytics. The app should feel like a financial dashboard, not a spreadsheet.
- **Resource-efficient.** Designed to run on a low-spec home server. The backend must have a small memory and CPU footprint.
- **Family-scale.** Built for 4–5 users, not thousands. Architecture decisions (database choice, infra) should reflect this.
- **Privacy-first.** All data stays on the user's own server. No telemetry, no external calls except optional FX rate fetching.

---

## 2. Users & Authentication

### 2.1 User Model

- The app supports a small number of users (maximum ~5) on the same self-hosted instance.
- Users are peers. There are no Admin or Member roles in the product model.
- Each user owns their own accounts and financial data.
- Accounts, balances, transactions, budgets, goals, investments, reports, exports, and audit records are scoped to the authenticated owner and are not visible to other users.
- User creation can be handled by the local registration flow or another local setup mechanism; all created users have the same capabilities.
- Each user has a display name, email address, and password.

### 2.2 User Capabilities

Every authenticated user can perform the following actions on their own data:

| Capability | User |
|---|---|
| View own accounts, balances, transactions, budgets, goals, investments, and reports | ✅ |
| Add/edit own transactions | ✅ |
| Soft-delete own transactions | ✅ |
| Add/edit own accounts | ✅ |
| Archive/soft-delete own accounts | ✅ |
| Manage own budgets & goals | ✅ |
| Export own data | ✅ |

### 2.3 Authentication

- Session-based authentication with secure HTTP-only cookies.
- Passwords stored as bcrypt hashes.
- Session expiry configurable (default: 30 days with remember-me, 24 hours without).
- No OAuth or social login required.
- A **Privacy Mode** toggle (accessible from the navbar) blurs all monetary values across the entire app. State persists in localStorage. Useful for screen-sharing or using the app in public.

### 2.4 Audit Trail

- Every create, update, and delete action on transactions, accounts, budgets, and goals is logged with a timestamp and the user who performed it.
- Audit log entries are scoped to the owning user and are visible to that user in settings.
- Accounts and transactions are never hard-deleted through normal application flows. Delete actions are soft deletes/archives: records are retained in the database and visible in the audit log but excluded from active calculations and views.

---

## 3. Core Financial Model

### 3.1 Net Worth

Net Worth = Total Assets − Total Liabilities

This is the central metric of the app and is displayed prominently on the dashboard.

### 3.2 Asset Classes

Assets are grouped into the following top-level classes. Each class can contain one or more accounts.

| Class | Examples |
|---|---|
| Cash & Bank | Savings account, current account, cash in hand, FD |
| Investments | Stocks, mutual funds, ETFs, bonds, gold, crypto |
| Real Estate | Property owned (manually valued) |
| Other Assets | Vehicles, jewellery, receivables, any custom asset |

### 3.3 Liability Classes

| Class | Examples |
|---|---|
| Loans | Home loan, car loan, personal loan, education loan |
| Credit Cards | Outstanding credit card balance |
| Other Liabilities | Any custom liability |

### 3.4 Multi-Currency

- Each user has a **base currency** configured at setup (e.g. INR).
- Each account can be denominated in any currency.
- A manual FX rate can be set per currency pair, or optionally fetched from a free public API (e.g. exchangerate.host).
- All summary views (net worth, balance sheet, dashboard) convert values to the base currency using the stored FX rate.
- FX rates are stored with a timestamp so historical net worth calculations use the rate that was in effect at the time.

---

## 4. Accounts

### 4.1 Account Model

Each account belongs to exactly one user and to one asset class or liability class. It has the following properties:

| Field | Description |
|---|---|
| Name | User-defined name (e.g. "HDFC Savings", "Zerodha Demat") |
| Type | The class it belongs to (Cash, Investment, Real Estate, Loan, Credit Card, etc.) |
| Currency | Account denomination currency |
| Opening Balance | Balance at the time the account was created in the app |
| Opening Date | Date from which tracking begins |
| Is Active | Whether the account is active or archived |
| Notes | Optional free-text description |
| Icon / Colour | Visual identifier for the account in charts |

### 4.2 Account Balance

- For **Cash & Bank** accounts: balance is computed as Opening Balance + sum of all credit transactions − sum of all debit transactions.
- For **Loan** accounts: balance represents the outstanding liability. Recorded as a positive number; shown as a negative in net worth.
- For **Credit Card** accounts: balance represents the current outstanding amount (liability).
- For **Real Estate** and **Other Asset** accounts: balance is set manually by the user as a "valuation update" with a date. The most recent valuation is used in net worth.
- For **Investment** accounts: balance is computed as brokerage cash + current market value of all holdings (based on latest recorded prices).

### 4.3 Account List View

- Shows all accounts grouped by class (Assets / Liabilities).
- Each account shows: name, currency, current balance (in account currency and base currency), last updated date.
- Subtotals per class and grand totals for assets, liabilities, and net worth shown at the top.
- Only the owning user can view, edit, or archive an account.
- Ability to archive accounts (hides from main view but retains all data and history). Accounts are not hard-deleted.

---

## 5. Transactions

Transactions belong to the user who owns the related account. Users can only view, create, edit, soft-delete, and export their own transactions.

### 5.1 Transaction Types

| Type | Description |
|---|---|
| Income | Money coming in to an account (salary, freelance, rental income, etc.) |
| Expense | Money going out of an account (purchases, bills, etc.) |
| Transfer | Movement of money between two accounts (internal, does not affect net worth) |
| Investment Buy | Purchase of an investment instrument (within an investment account) |
| Investment Sell | Sale of an investment instrument |
| Dividend | Dividend received into an investment account |
| Loan Repayment | Payment reducing a loan liability |
| Credit Card Payment | Transfer from a bank account to pay off a credit card |
| Valuation Update | Manual update of value for Real Estate / Other Asset accounts |

### 5.2 Transaction Fields

| Field | Required | Description |
|---|---|---|
| Date | ✅ | Date the transaction occurred |
| Type | ✅ | One of the types above |
| Amount | ✅ | Transaction amount in account currency |
| Account | ✅ | The account this transaction belongs to |
| Category | ✅ (for income/expense) | User-defined category |
| Description | ✅ | Short description / merchant name |
| Notes | ❌ | Long-form free text notes |
| Tags | ❌ | One or more user-defined tags (e.g. #vacation, #medical) |
| Transfer Destination | ✅ (for transfers) | The destination account |
| Linked Goal | ❌ | Link a transfer to a savings goal (for goal blocking) |

### 5.3 Categories

- Categories are user-defined and organised into a two-level hierarchy: **parent category → sub-category**.
- Default categories are seeded on first run (e.g. Food → Groceries, Food → Dining Out, Transport → Fuel, etc.).
- Each category has a name, type (income or expense), colour, and optional icon.
- Categories can be renamed, merged, or deleted (with reassignment of existing transactions).
- A transaction can belong to only one category.

### 5.4 Recurring Transactions

- A transaction can be marked as **recurring** with a frequency: daily, weekly, fortnightly, monthly, quarterly, annually.
- Recurring transactions generate a reminder/stub on their due date which the user can confirm, edit, or skip.
- The recurring template stores all transaction fields; confirmed instances are saved as normal transactions.

### 5.5 Split Transactions

- A single transaction can be split into multiple sub-transactions, each with its own category and amount.
- The sum of sub-transaction amounts must equal the total transaction amount.
- Example: a ₹3,000 supermarket bill split into ₹2,000 Groceries + ₹1,000 Household.

### 5.6 Transaction List View

- Paginated list of all transactions, defaulting to current month.
- Filter by: date range, account(s), category, type, tag, amount range, description search.
- Sort by: date, amount, category.
- Inline edit and soft delete (with confirmation).
- Bulk actions: bulk categorise, bulk tag, bulk soft delete.
- CSV export of filtered results.

### 5.7 CSV Import

- Import transactions from a CSV file.
- A mapping interface lets the user map CSV columns to transaction fields.
- Duplicate detection: flag rows that appear to match an existing transaction (same date, amount, description).
- User reviews flagged duplicates before confirming import.
- Mapping profiles can be saved per account/bank for repeat imports.

---

## 6. Budgets

### 6.1 Budget Model

- A **Base Budget** defines monthly allocations for each expense category.
- The base budget is copied into a month snapshot when that month is first opened or edited.
- Editing the base budget does not rewrite already materialized month snapshots, so previous months keep their historical allocations.
- For any given month, the user can edit **monthly overrides** — increase, decrease, or clear specific category allocations for that month only without changing the base.
- Budget allocations are per-category; income categories are excluded.

### 6.2 Budget Tracking

- For each category with a budget, the app tracks: allocated amount, amount spent so far (sum of expense transactions in that category for the month), remaining amount, and percentage used.
- A **burn rate indicator** shows whether spending pace is ahead of or behind the budget. For example, if you are 20 days into a 30-day month and have used 90% of the grocery budget, the indicator flags this.
- Categories over 100% are highlighted in red; 80–100% in amber; below 80% in green.

### 6.3 Budget Views

- **Monthly Budget Dashboard:** card grid showing all budgeted categories with progress bars for the selected month.
- **Budget vs Actual Chart:** horizontal bar chart per category, sorted by % used, for the selected month.
- **Budget History Table:** month-by-month view of allocated vs actual per category for the last 12 months.
- **Rollover Analysis:** for each category, how much was unspent each month — shown as a bar chart. Useful for identifying consistently over-allocated categories.
- **Unbudgeted Spending:** a separate section showing expenses in categories that have no budget allocation.
- The user can navigate between months using prev/next arrows or a month picker.

---

## 7. Savings Goals

### 7.1 Goal Model

Each savings goal has the following fields:

| Field | Description |
|---|---|
| Name | E.g. "Emergency Fund", "Goa Trip", "New Laptop" |
| Target Amount | The total amount to be saved |
| Target Date | Optional deadline |
| Source Account | The Cash account from which funds are blocked |
| Current Blocked Amount | Running total of funds blocked towards this goal |
| Status | Active, Completed, Cancelled |
| Notes | Optional description |

### 7.2 Fund Blocking

- To contribute to a goal, the user performs a **Block Funds** action specifying an amount from a source cash account.
- The blocked funds are **not moved** — they remain in the source account. However, the account's **Available Balance** = Account Balance − Total Blocked Funds.
- The app always displays both the account's total balance and its available balance (unblocked).
- The user can also **unblock** (release) funds from a goal partially or fully at any time.
- All block/unblock actions are logged as goal transactions with a date and optional note.

### 7.3 Goal Progress & Tracking

- Progress bar showing blocked amount vs target amount.
- If a target date is set, the app computes whether the user is **on track**: given the target date and amount remaining, what monthly saving is required, vs the average monthly blocking rate observed so far.
- **Projected completion date** at the current average blocking rate.
- On-track / behind / ahead status indicator shown on the goal card.

### 7.4 Goals Overview

- Card grid showing all active goals with: name, progress bar, blocked/target amounts, target date, on-track status.
- Completed goals are shown in a separate "Completed" section.

---

## 8. Investment Accounts

Investment accounts are a specialised account type under the Assets class. They have all the properties of a regular account plus the features described in this section.

### 8.1 Investment Account Cash

- Each investment account has a **Brokerage Cash** balance — uninvested cash sitting in the account.
- When money is transferred into an investment account from a bank account, it increases the brokerage cash.
- When a buy transaction is executed, it decreases the brokerage cash.
- When a sell transaction is executed, it increases the brokerage cash.
- Dividends credited in cash also increase the brokerage cash.

### 8.2 Instruments

Each instrument (holding) has the following properties:

| Field | Description |
|---|---|
| Name | Full name of the instrument (e.g. "Reliance Industries Ltd") |
| Ticker / Symbol | Optional short code (e.g. RELIANCE, NIFTY50) |
| Instrument Type | Equity, Mutual Fund, ETF, Bond, Gold, Crypto, Other |
| Currency | Denomination currency |
| Sector | Optional (e.g. Technology, Banking, FMCG) |
| Geography | Optional (e.g. India, US, Global) |
| Notes | Any free-text notes |

Instruments are scoped to the owning user and can be shared across that user's investment accounts (defined once, used in multiple accounts).

### 8.3 Investment Transactions

| Type | Fields | Effect |
|---|---|---|
| Buy | Date, Instrument, Quantity, Price per unit, Brokerage/fees, Account | Decreases brokerage cash, creates/increases holding |
| Sell | Date, Instrument, Quantity, Price per unit, Brokerage/fees, Account | Increases brokerage cash, decreases holding, records realised P&L |
| Dividend (Cash) | Date, Instrument, Amount, Account | Increases brokerage cash, recorded as dividend income |
| Dividend (Reinvested) | Date, Instrument, Quantity, Price per unit | Increases holding quantity, no cash movement |
| Stock Split / Bonus | Date, Instrument, Split ratio | Adjusts quantity and average cost accordingly |

### 8.4 Price Snapshots

- The user can record a **price snapshot** for any instrument at any time: instrument, price, date.
- Multiple snapshots over time build a price history for each instrument.
- The **latest snapshot** is used as the current price for unrealised P&L calculations.
- Price history is displayed as a line chart on the instrument detail page.

### 8.5 Holdings & P&L Calculations

For each holding in an investment account:

- **Quantity Held** = sum of buy quantities + reinvested dividend quantities − sell quantities (adjusted for splits/bonuses)
- **Average Buy Price** = weighted average of all buy transactions (FIFO or weighted average, configurable)
- **Invested Value** = Quantity Held × Average Buy Price
- **Current Value** = Quantity Held × Latest Price Snapshot
- **Unrealised P&L** = Current Value − Invested Value (shown in ₹ and %)
- **Realised P&L** = sum of (sell price − avg buy price) × quantity sold, across all sell transactions, net of fees

### 8.6 Portfolio-Level Metrics

- **Total Invested Value** = sum of invested value across all holdings
- **Total Current Value** = sum of current value across all holdings
- **Total Unrealised P&L** = Total Current Value − Total Invested Value
- **Total Realised P&L** = sum of all realised P&L from sell transactions
- **Total Dividend Income** = sum of all dividend transactions
- **XIRR** (Extended Internal Rate of Return) — computed per holding and overall portfolio using the dates and amounts of all cash flows (buys, sells, dividends). This is the most accurate measure of investment performance accounting for timing of cash flows.
- **Absolute Return %** = (Current Value − Invested Value) / Invested Value × 100

---

## 9. Reports & Visualisations

All report views support a **date range selector** with presets: This Month, Last Month, Last 3 Months, Last 6 Months, This Year, Last Year, Last 12 Months, All Time, and Custom Range.

---

### 9.1 Dashboard (Home)

The main landing page after login. Shows the most important metrics at a glance.

**Metrics Cards (top row):**
- Net Worth (with change vs last month, ₹ and %)
- Total Assets
- Total Liabilities
- This Month: Income vs Expenses vs Net Savings

**Charts:**
- Net Worth over time — line chart (last 12 months by default, selectable range)
- Asset allocation — donut chart (by asset class)
- This month's budget status — compact horizontal bars per category
- Recent transactions — last 10 transactions table

---

### 9.2 Net Worth & Balance Sheet

**Net Worth Over Time:**
- Line chart with monthly net worth snapshots
- Optionally overlaid with total assets and total liabilities as separate lines
- Hover tooltip shows exact values for that month

**Balance Sheet:**
- Side-by-side table: Assets (left) vs Liabilities (right)
- Assets grouped by class with subtotals; liabilities grouped by class with subtotals
- Grand total row showing Net Worth
- Printable / exportable as PDF

**Asset Allocation:**
- Donut chart: % breakdown by asset class (Cash, Investments, Real Estate, Other)
- Second donut: breakdown within Investments by instrument type (Equity, MF, ETF, etc.)
- Treemap: all accounts sized by their value

**Liability Breakdown:**
- Loan-wise outstanding amounts (bar chart)
- For each loan: original amount, amount paid, outstanding, projected payoff date based on current repayment pace

---

### 9.3 Cash Flow

**Sankey Diagram:**
- Left nodes: income sources (by category, e.g. Salary, Freelance, Rental)
- Middle nodes: broad expense categories
- Right nodes: Savings, Investments, Loan Repayments
- Thickness of flows proportional to amounts
- Selectable time period

**Monthly Cash Flow Bar Chart:**
- Grouped bars: Income (green), Expenses (red), Net Savings (blue) per month
- Last 12 months shown by default
- Hover tooltip with exact values

**Cumulative Cash Flow:**
- Area chart showing cumulative income and cumulative expenses from the start of the year
- The gap between the two lines represents cumulative savings

**Income vs Expense Trend:**
- Two line charts overlaid — monthly income and monthly expenses — over a selectable period
- Highlights months where expenses exceeded income

---

### 9.4 Spending Analytics

**Category-wise Spend:**
- Horizontal bar chart, ranked by spend amount, for the selected period
- Colour-coded by category
- Shows amount and % of total spending
- Click a category to drill down to its transactions

**Category Drilldown:**
- When a category is selected: show a transaction list for that category in the period
- Mini line chart showing that category's spend trend over the last 12 months
- Sub-category breakdown if applicable

**Top Merchants / Descriptions:**
- Table of most frequent and highest-spend descriptions (merchants)
- Shows: description, transaction count, total amount, average transaction

**Spending Heatmap:**
- Calendar heatmap view (like GitHub contribution graph) showing daily spend intensity
- Useful for identifying spending clusters (payday, weekend patterns, etc.)

**Day-of-Month Spending Pattern:**
- Bar chart showing average spend per day of month (1st–31st)
- Helps identify recurring charges, salary credit days, EMI dates

**Period Comparison:**
- Side-by-side comparison of any two periods (e.g. this month vs last month, this year vs last year)
- Category-wise delta table: which categories increased or decreased and by how much

---

### 9.5 Budget Reports

**Monthly Budget Dashboard:**
- Card grid, one card per budgeted category
- Each card: category name, icon, allocated amount, spent amount, remaining amount, progress bar (colour coded), burn rate indicator

**Budget vs Actual Chart:**
- Horizontal bar chart per category for the selected month
- Two bars per category: allocated (grey) and actual (coloured)
- Over-budget bars extend past the allocated bar in red

**Budget History:**
- Table: rows = categories, columns = months (last 12)
- Each cell shows spent/allocated with colour coding
- Useful for spotting consistently over or under-budgeted categories

**Rollover Analysis:**
- Bar chart per category: how much was unspent per month over the last 12 months
- Helps the user right-size their budgets

**Savings Rate:**
- Monthly savings rate (%) = Net Savings / Income × 100
- Line chart over time
- Average savings rate for the selected period

---

### 9.6 Investment Reports

**Portfolio Overview:**
- Holdings table: Instrument | Type | Quantity | Avg Buy Price | Current Price | Invested Value | Current Value | Unrealised P&L (₹) | Unrealised P&L (%) | XIRR
- Sortable by any column
- Colour-coded P&L (green positive, red negative)

**Portfolio Composition:**
- Donut chart: by instrument type (Equity, MF, ETF, Bond, Gold, Crypto)
- Donut chart: by individual holding (top 10 + others)
- Donut chart: by sector (if sectors tagged)
- Donut chart: by geography (if tagged)

**Portfolio Performance Chart:**
- Area chart: Invested Value vs Current Value over time (based on price snapshots)
- Shows unrealised P&L visually as the gap between the two areas

**Individual Instrument Detail:**
- Price history line chart (from manual price snapshots)
- All transactions for this instrument (buys, sells, dividends)
- Computed metrics: quantity held, avg buy price, invested value, current value, unrealised P&L, XIRR, total dividends received

**Realised P&L Report:**
- Table of all sell transactions with: instrument, buy date, sell date, quantity, avg buy price, sell price, gross P&L, fees, net P&L
- Subtotals by instrument and grand total
- Filtered by date range (useful for tax year)

**Dividend Income Report:**
- Monthly dividend income bar chart
- Table: date, instrument, amount, type (cash / reinvested)
- Annual dividend total and dividend yield (if applicable)

**XIRR Summary:**
- Table showing XIRR per holding and overall portfolio XIRR
- Brief explanation of what XIRR means for non-technical users

---

### 9.7 Savings Goals Report

**Goals Overview:**
- Card grid with all active goals
- Each card: name, progress bar (blocked/target), target date, on-track status badge, projected completion date

**Goal Detail:**
- Timeline chart: blocking history over time (cumulative blocked amount line vs target line)
- All block/unblock transactions for this goal
- Monthly blocking rate chart

---

### 9.8 Exportable Reports

The following reports can be exported as PDF or CSV:

| Report | Formats |
|---|---|
| Monthly Financial Summary | PDF |
| Annual Year-in-Review | PDF |
| Balance Sheet (any date) | PDF, CSV |
| Transaction List (filtered) | CSV |
| Realised P&L (tax year) | PDF, CSV |
| Dividend Income (tax year) | PDF, CSV |
| Full Data Export | CSV (all tables) |

**Monthly Financial Summary** (PDF) includes: net worth and change, total income, total expenses, savings rate, top 5 expense categories, budget adherence summary, portfolio value and change.

**Annual Year-in-Review** (PDF) includes: net worth growth over the year (chart), best and worst months, category totals for the year, investment performance summary, total dividends, goals progress.

**Tax Year Report** (PDF) includes: realised capital gains/losses per instrument, total dividend income — structured to assist with Indian ITR filing.

---

## 10. Data Management

### 10.1 Backup & Restore

- Each authenticated user can export and restore their own data where the app provides import/export flows.
- Whole-instance database backups are a server-operator concern and must not be exposed in a way that lets one app user download another user's data.
- Optional automatic daily backups can be configured to a local directory on the server by the deployment operator.

### 10.2 Full Data Export

- Export all of the current user's data as a zip of CSV files (one per entity type: accounts, transactions, holdings, price snapshots, etc.)
- Intended for data portability — the user should never feel locked in.

### 10.3 CSV Import

- As described in Section 5.7.
- Available for transactions only (not accounts or holdings — those are created through the UI).

### 10.4 Data Integrity

- All monetary values stored as integers in the smallest currency unit (paise for INR, cents for USD) to avoid floating-point errors.
- Soft deletes on accounts and transactions — records retained in DB, excluded from active views and calculations.
- Audit log as described in Section 2.4.

---

## 11. Technical Architecture

### 11.1 Backend

| Concern | Choice | Rationale |
|---|---|---|
| Language | Rust | Compiled, very low memory footprint, fast startup |
| Async Runtime | Tokio | Industry standard async runtime for Rust |
| Web Framework | Axum | Built on Tokio, ergonomic, well-maintained |
| Database | SQLite (via sqlx) | Single file, zero-config, excellent for single-family scale, easy backup |
| Migrations | sqlx migrate | Built-in, version-controlled schema migrations |
| Auth | Session cookies + bcrypt | Simple, secure, no external dependency |
| Serialisation | serde + serde_json | Standard in Rust ecosystem |
| PDF Generation | wkhtmltopdf or Typst | For exportable reports |
| FX Rates | exchangerate.host (optional) | Free, no API key required for basic usage |

### 11.2 Frontend

| Concern | Choice | Rationale |
|---|---|---|
| Framework | React (Vite) | Component model well suited to dashboard UI |
| Language | TypeScript | Type safety, better DX |
| Styling | Tailwind CSS | Utility-first, consistent design system |
| Charts | Recharts + D3.js | Recharts for standard charts; D3 for Sankey diagram |
| State Management | Zustand or React Query | Lightweight; React Query for server state caching |
| Table | TanStack Table | Powerful, headless, handles sorting/filtering |

### 11.3 Deployment

- Distributed as a **Docker Compose** setup (single `compose.yml`).
- Services: `app` (Rust backend + serves static frontend build), `caddy` (reverse proxy with HTTPS via Let's Encrypt or self-signed cert).
- The SQLite database file is mounted as a Docker volume for persistence.
- Environment configured via a `.env` file.
- A single `docker compose up -d` should be all that is needed to run the app.
- The frontend is compiled to static files and served by the Rust backend (no separate Node.js process in production).

### 11.4 API Design

- RESTful JSON API.
- All endpoints under `/api/v1/`.
- Authentication via session cookie.
- Consistent error response format: `{ "error": { "code": "...", "message": "..." } }`.
- Pagination on all list endpoints using cursor-based pagination.
- Domain endpoints must scope all reads and writes by the authenticated `user_id`.

### 11.5 Database Schema (High-Level Entities)

- `users` — id, name, email, password_hash, base_currency, created_at
- `accounts` — id, user_id, name, type, currency, opening_balance, opening_date, is_active, archived_at, notes
- `transactions` — id, user_id, date, type, amount, account_id, category_id, description, notes, created_by, deleted_at
- `transaction_tags` — transaction_id, tag
- `categories` — id, user_id, name, parent_id, type (income/expense), colour
- `recurring_templates` — id, user_id, frequency, next_due_date, template fields mirroring transactions
- `budget_base` — id, user_id, category_id, amount_paise
- `budget_months` — id, user_id, year, month
- `budget_month_allocations` — id, user_id, budget_month_id, category_id, amount_paise, is_manual_override
- `goals` — id, user_id, name, target_amount, target_date, account_id, status, notes
- `goal_transactions` — id, user_id, goal_id, date, amount (positive=block, negative=unblock), notes
- `instruments` — id, user_id, name, ticker, type, currency, sector, geography, notes
- `investment_transactions` — id, user_id, account_id, instrument_id, type, date, quantity, price, fees, notes
- `price_snapshots` — id, user_id, instrument_id, price, date
- `fx_rates` — id, user_id, from_currency, to_currency, rate, date
- `audit_log` — id, user_id, action, entity_type, entity_id, diff_json, created_at
- `valuation_updates` — id, user_id, account_id, value, date, notes

---

## 12. Non-Functional Requirements

### 12.1 Performance

- Dashboard and all report pages must load within 2 seconds on the target server hardware.
- All API responses must return within 500ms under normal load (1–2 concurrent users).
- The backend process must consume less than 50MB of RAM at idle and less than 150MB under normal usage.
- SQLite is sufficient at this scale; no migration to a heavier DB should be necessary.

### 12.2 Security

- All communication over HTTPS (enforced by reverse proxy).
- HTTP-only, Secure, SameSite=Strict cookies for sessions.
- CSRF protection on all state-mutating endpoints.
- Input validation and sanitisation on all API inputs.
- No sensitive data (passwords, session tokens) logged anywhere.
- Per-user export files should be downloadable only by the authenticated owner. Whole-instance backup files are handled by the deployment operator outside normal app user access.
- All domain data access must include ownership checks so users cannot access another user's accounts, transactions, budgets, goals, investments, reports, exports, or audit records.

### 12.3 Reliability

- The app must handle server restarts gracefully with no data loss (SQLite WAL mode enabled).
- All database writes use transactions where multiple tables are affected.
- Automated daily backup to a configurable local directory.

### 12.4 Usability

- The app must be fully functional on desktop browsers (Chrome, Firefox, Safari).
- Mobile-responsive layout — all views must be usable on a phone screen, though the primary UX is designed for desktop.
- Privacy Mode (blur toggle) available on all pages.
- All monetary values display with currency symbol and thousand separators.
- Date format configurable per user (DD/MM/YYYY default for Indian users).

### 12.5 Maintainability

- Backend code organised into clear modules: `auth`, `accounts`, `transactions`, `budgets`, `goals`, `investments`, `reports`.
- Frontend organised into feature folders mirroring the backend modules.
- All database schema changes managed through versioned migration files.
- A `docker compose` development setup with hot-reload for both backend (`cargo watch`) and frontend (Vite HMR).

---

*End of Requirements Document v1.0*
