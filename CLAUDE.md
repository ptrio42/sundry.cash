# Expense Tracker — CLAUDE.md

Self-hosted, single-user personal expense tracker. Two-package **TypeScript monorepo**:
`backend/` (Express + better-sqlite3 REST API) and `frontend/` (React 18 + Vite SPA).
The root `package.json` orchestrates both with `concurrently` — **this is NOT an npm-workspaces
repo**, so dependencies and most scripts are per-package.

This repo is a **portfolio / CV showcase**: clarity for a first-time reader and a clean git
history matter as much as the code itself.

## Commands (run from repo root)

```bash
npm run install:all         # install backend + frontend deps — REQUIRED first (see hard rules)
npm run dev                 # both servers: backend :5000 (cross-env PORT=5000) + Vite :5173 (auto-opens)
npm run build               # backend: tsc -> dist/ ; frontend: tsc && vite build
npm run test                # backend Jest (--runInBand), then frontend Vitest
docker compose up --build   # full stack behind nginx -> http://localhost:8847
```

Per-package (from `backend/` or `frontend/`): `npm run dev | build | test`; frontend also
`preview`, `test:watch`; backend also `start` (`node dist/server.js`).
In-session preview: `.claude/launch.json` config **app** runs the root `npm run dev` on port
5173 — use `preview_start`.

## Hard rules

- **NEVER commit the database, `.env` files, or real personal/financial data.** This app stores
  real expenses in SQLite; a live `backend/data/expenses.db` sits on disk (gitignored). Before any
  `git add`, confirm nothing under `data/`, no `*.db` / `*.db-journal`, and no `.env*` is staged.
  Never paste the DB's contents into chat, PRs, or artifacts. If asked to commit one of these, stop
  and flag it instead.
- **Verify before "done": run `npm run build` (typecheck) and `npm run test`, and show the output.**
  `tsc` is strict (`noUnusedLocals` / `noUnusedParameters`) and fails the build on unused vars. A
  change is not finished until both pass — do not assert success without evidence.
- **Edit the per-package Dockerfiles, not the root ones.** `backend/Dockerfile` + `frontend/Dockerfile`
  are what `docker-compose.yml` and CI actually build. Root `Dockerfile.backend` / `Dockerfile.frontend`
  are legacy duplicates — don't wire new work into them.
- **Money is stored as integer minor units** (cents / satoshis) via `backend/src/config/money.ts`.
  Convert only at the model boundary — never put a float in the `amount` column.
- **Categories and currencies are CHECK-constrained enums.** Adding one requires a migration in
  `backend/src/config/database.ts` (follow the existing table-recreate pattern), not just a type change.

## Code map

**backend/** — Express + TypeScript, layered:
- `src/server.ts` — app wiring, middleware, route mounts, graceful shutdown. Exports `app`; binds a
  port only when `NODE_ENV !== 'test'`.
- `src/routes/` — Express routers: `expenses`, `import`, `budgets`, `fx`, `auth`. New endpoints go here.
- `src/models/` — better-sqlite3 prepared statements (`expense`, `budget`, `fx`). All SQL lives here.
- `src/config/` — `database.ts` (schema + idempotent migrations + FX seed), `auth.ts` (HMAC tokens),
  `money.ts` (minor-unit conversion).
- `src/middleware/` — `auth` (`requireAuth`), `validation`.
- `src/services/` — `categorize.ts` (keyword auto-categorization, EN + PL); `receipt/` (OCR factory — see gotchas).
- `src/tests/` — Jest + supertest, ~46 cases across 6 files.

**frontend/** — React 18 + Vite, single-page tabbed UI (no router, no state library — plain hooks):
- `src/main.tsx` -> `src/components/App.tsx`. Feature components: `Dashboard`, `Analytics`, `Budgets`,
  `Fx`, `ExpenseForm`, `ExpenseTable`, `ExcelImport`, `EditExpenseModal`, `Login`.
- `src/services/api.ts` — central `apiFetch` wrapper (base `/api`, bearer from localStorage key
  `expense-tracker-token`, 401 -> `auth-expired` window event). Add API calls here.
- `src/utils/` — `format.ts`, `export.ts` (client-side .xlsx). Charts: recharts. Styling: single
  dark-first `src/App.css`.

## Key design decisions (the non-obvious "why")

- **better-sqlite3, synchronous** — single-user self-hosted app; no async DB layer needed. The
  prepared statements in `models/` are the whole data layer.
- **Auth is opt-in** — enabled only when `APP_PASSWORD` is set; issues a 7-day HMAC bearer signed with
  `AUTH_SECRET || APP_PASSWORD`. **With no password the API is fully open** — fine for localhost,
  deliberate for self-hosting.
- **Types are duplicated per package** (`src/types/expense.types.ts` in each), not shared across the
  boundary — keep them in sync manually.
- **Receipt OCR is pluggable but dormant** — `services/receipt/` selects an engine via
  `RECEIPT_OCR_PROVIDER` (default `tesseract`, `stub` under test). It is **not mounted on any route** —
  scaffolding, not a live feature.
- **Dark-first UI** — `index.html` sets the dark background before React mounts to avoid a flash.

## Gotchas

- **`npm install` at root installs only `concurrently` / `cross-env`** — not the sub-packages. Always
  `npm run install:all` first, or dev/build/test fail with missing modules.
- **Node 18 vs 20** — Docker pins `node:18-alpine`, CI runs Node 20. Keep new code Node-18-compatible.
- **`RECEIPT_OCR_PROVIDER=claude` throws "not implemented"**, and the whole receipt service is
  route-less dead code — don't assume it is reachable.
- **README drifts from code** — the README mentions only USD/PLN and 5 categories; the code supports
  **USD/PLN/BTC**, 7 categories, auth, FX conversion, budgets, and export. **Trust the code**, and fix
  the README rather than the code when they disagree.
- **Reset the local DB** by deleting `backend/data/expenses.db` — it is recreated on next backend start.
- `umbrel-app.yml` still has placeholder `yourusername` GitHub URLs.

## Definition of done

1. `npm run build` passes (strict, zero errors) for the touched package(s).
2. `npm run test` passes; add/extend tests for behavior changes. The **frontend is under-tested** (one
   component test only), so new UI logic especially warrants a test.
3. Command output shown as evidence.
4. Nothing sensitive staged (see hard rules).

## Pointers

- Setup & self-hosting: `docs/DEPLOYMENT.md`. Feature/endpoint reference: `README.md` (secondary to code).
- CI: `.github/workflows/ci.yml` (typecheck + build + test for both packages + docker build).
- Personal / sandbox-only notes: put them in a gitignored `CLAUDE.local.md`, never here.
