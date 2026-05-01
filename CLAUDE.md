# Artha — Personal Finance App

## Project Overview
Self-hosted personal finance app for ~5 users on one instance. Rust backend
(Axum + SQLite), React + TypeScript frontend. See docs/REQUIREMENTS.md for
full spec.

## Design Reference
The file docs/design.html is the visual design reference.
ALL frontend work must match this design exactly:
- Color system: use the CSS variables defined in that file as your source of truth
- Font stack: IBM Plex Mono (numbers/data), IBM Plex Sans Condensed (labels/headers),
  IBM Plex Sans (body)
- Spacing, density, and information hierarchy must match the Bloomberg-style
  dense layout shown in the design
- Do NOT use any component library that imposes its own visual style
  (no MUI, no Chakra, no Shadcn defaults). Build components from scratch
  using Tailwind utilities that match the design tokens.

## Tech Stack
- Backend: Rust, Axum, SQLite via sqlx, tokio async runtime
- Frontend: React 18, TypeScript, Vite, Tailwind CSS, Recharts, TanStack Table
- Auth: session cookies + bcrypt
- Deployment: Docker Compose

## Code Conventions
- All monetary values stored as i64 paise (smallest unit). Never use f64 for money.
- API prefix: /api/v1/
- Error format: { "error": { "code": "...", "message": "..." } }
- Dates: store as ISO 8601 strings in SQLite, display as DD/MM/YYYY
- All list endpoints use cursor-based pagination
- Any time a backend API is modified/created it should be updated in docs/API.md.
- All frontend interactions with backend should be based on latest version of docs/API.md

## Database
SQLite file at data/artha.db. Run migrations with: cargo sqlx migrate run
Schema is in backend/migrations/. Never modify existing migration files.

## Commands
- Backend dev: cd backend && cargo watch -x run
- Frontend dev: cd frontend && npm run dev
- Full stack: docker compose up --build
- Run tests: cargo test (backend), npm test (frontend)

## Reccomendations
- Do not use high effort models for low cognition tasks, use them when planning architecture/solving complex issues. Spawn cheaper agents to do work that can be delegated.
- Create test cases where possible, aim for high coverage in terms of source lines and edge cases both.
- Follow idiomatic code guidelines, keep the code modularised and remember SOLID and DRY principles etc
- When there is any doubt, ask the user. DO NOT MAKE ASSUMPTIONS unless it is obvious.

## Implementation Plan
Full phase-by-phase plan is in `docs/PLAN.md`. Phases at a glance:
- **Phase 0** — Project skeleton (Docker, Vite, Axum, health check)
- **Phase 1** — Auth + app shell + design system primitives
- **Phase 2** — Accounts (balance sheet, allocation chart)
- **Phase 3** — Transactions (CRUD, filters, CSV, splits)
- **Phase 4** — Budget (monthly tracking, history, savings rate)
- **Phase 5** — Investments (holdings, manual prices, P&L)
- **Phase 6** — Goals (block funds, progress tracking)
- **Phase 7** — Dashboard (aggregate charts, recent transactions)
- **Phase 8** — Reports + Sankey (interactive cash flow diagram)
- **Phase 9** — Mobile responsive + polish + tests + production Docker

Key decisions: multi-user from Phase 1 with per-user private data (all domain tables have user_id), no admin/member roles, accounts and transactions are soft-deleted only, investment prices manual-only, no ticker bar, Sankey is interactive with real data.

## Current Status

 *Keep updating this as work happens*
 
- [x] Phase 0 — complete
- [x] Phase 1 — complete
- [x] Phase 2 — complete
- [x] Phase 3 — complete
- [x] Phase 4 — complete
- [x] Phase 5 — complete
- [x] Phase 6 — complete
- [x] Phase 7 — complete
- [ ] Phase 8 — not started
- [ ] Phase 9 — not started

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- For cross-module "how does X relate to Y" questions, prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"` over grep — these traverse the graph's EXTRACTED + INFERRED edges instead of scanning files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)
