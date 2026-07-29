# Sundry — CLAUDE.md

Self-hosted, single-user personal expense tracker. Two-package **TypeScript monorepo**:
`backend/` (Express + better-sqlite3 REST API) and `frontend/` (React 18 + Vite SPA).
The root `package.json` orchestrates both with `concurrently` — **this is NOT an npm-workspaces
repo**, so dependencies and most scripts are per-package.

Optimize for a first-time reader: small, focused commits and code that explains its own
constraints. Where something non-obvious is load-bearing, leave the reason in a comment.

## Commands (run from repo root)

```bash
npm run install:all         # install backend + frontend deps — REQUIRED first (see hard rules)
npm run dev                 # both servers: backend :5000 (cross-env PORT=5000) + Vite :5173 (auto-opens)
npm run build               # backend: tsc -> dist/ ; frontend: tsc && vite build
npm run test                # backend Jest (--runInBand), then frontend Vitest
npm run lint                # ESLint (flat config) for both packages
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
- **Verify before "done": run `npm run lint`, `npm run build` (typecheck) and `npm run test`, and
  show the output.** `tsc` is strict (`noUnusedLocals` / `noUnusedParameters`) and fails the build on
  unused vars; ESLint (flat config, per package) gates on errors while leaving warnings visible. A
  change is not finished until all three pass — do not assert success without evidence.
- **Money is stored as integer minor units** (cents / satoshis) via `backend/src/config/money.ts`.
  Convert only at the model boundary — never put a float in the `amount` column.
- **Categories and currencies are CHECK-constrained enums.** Adding one requires a migration in
  `backend/src/config/database.ts` (follow the existing table-recreate pattern), not just a type change.

## Code map

**backend/** — Express + TypeScript, layered:
- `src/server.ts` — app wiring, middleware, route mounts, graceful shutdown. Exports `app`; binds a
  port only when `NODE_ENV !== 'test'`.
- `src/routes/` — Express routers: `expenses`, `import`, `budgets`, `fx`, `auth`, `settings`,
  `receipts`. New endpoints go here.
- `src/models/` — better-sqlite3 prepared statements (`expense`, `budget`, `fx`, `settings`). All SQL
  lives here.
- `src/config/` — `database.ts` (schema + idempotent migrations + FX seed), `auth.ts` (HMAC tokens),
  `money.ts` (minor-unit conversion).
- `src/middleware/` — `auth` (`requireAuth`), `validation`.
- `src/services/` — `categorize.ts` (keyword auto-categorization, EN + PL); `receipt/` (OCR factory — see gotchas).
- `src/tests/` — Jest + supertest, 99 cases across 10 files (plus `env.ts` / `paths.ts` /
  `globalSetup.ts` / `globalTeardown.ts`, which are harness, not tests).

**frontend/** — React 18 + Vite, single-page tabbed UI (no router, no state library — plain hooks):
- `src/main.tsx` -> `src/components/App.tsx`. Feature components: `Dashboard`, `Analytics`, `Budgets`,
  `Fx`, `ExpenseForm`, `ExpenseTable`, `ExcelImport`, `EditExpenseModal`, `Login`, `Settings`,
  `ReceiptScan`.
- `src/services/api.ts` — central `apiFetch` wrapper (base `/api`, bearer from localStorage key
  `sundry-token`, 401 -> `auth-expired` window event). Add API calls here.
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
- **Receipt OCR is pluggable and live** — `services/receipt/` selects an engine via
  `RECEIPT_OCR_PROVIDER` (default `tesseract`, `stub` under test). The router is mounted at
  `server.ts` (`app.use('/api/receipts', requireAuth, receiptRoutes)`) and drives a real two-step
  UI: scan -> review/edit -> save. The provider seam exists so Claude Vision can replace Tesseract
  without touching routes or frontend — don't collapse it.
- **Dark-first UI** — `index.html` sets the dark background before React mounts to avoid a flash.

## Gotchas

- **`npm run install:all` installs all three package roots** (root tooling + backend + frontend).
  A bare `npm install` at root only gets `concurrently` / `cross-env`, so `npm run dev` then fails
  with missing modules in the sub-packages.
- **Node 22** — Docker images and CI both pin Node 22; `.nvmrc` says 22 and `engines` declares
  `>=18`. better-sqlite3 is a native module: on Node releases without a prebuild it compiles from
  source, which needs a C++ toolchain.
- **`RECEIPT_OCR_PROVIDER=claude` throws "not implemented"** — only `tesseract` and `stub` work today.
- **Tests run against a temp DB, never the real one.** `jest.config.js` wires `src/tests/env.ts` as a
  `setupFile` that repoints `DB_PATH` at `$TMPDIR/sundry-test-data/` before any app module loads —
  `receiptsDir()` derives from `DB_PATH`, so uploaded images are isolated too. Never remove this:
  without it the suite writes fixtures straight into `backend/data/expenses.db`.
- **Reset the local DB** by deleting `backend/data/expenses.db` — it is recreated on next backend start.

## Definition of done

1. `npm run lint` reports zero errors, and `npm run build` passes (strict) for the touched package(s).
2. `npm run test` passes; add/extend tests for behavior changes (99 backend + 95 frontend cases;
   every frontend component has a suite, so a regression should be caught rather than shipped).
3. Command output shown as evidence.
4. Nothing sensitive staged (see hard rules).

## Pointers

- Setup & self-hosting: `docs/DEPLOYMENT.md`. Feature/endpoint reference: `README.md` (secondary to code).
- CI: `.github/workflows/ci.yml` (lint + typecheck + build + test for both packages + docker build).
- Personal / sandbox-only notes: put them in a gitignored `CLAUDE.local.md`, never here.
