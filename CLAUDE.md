# Artha — Personal Finance App

## Project Overview
Self-hosted family finance app for ~5 users. Rust backend (Axum + SQLite),
React + TypeScript frontend. See docs/requirements.md for full spec.

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

## Current Status
[Update this as you build — what's done, what's in progress]
