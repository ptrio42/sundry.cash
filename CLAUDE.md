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
- **Categories and currencies are rows, not enums.** Both are real tables that `expenses` and
  `budgets` reference by foreign key, so validation must query them (`models/category.ts`,
  `models/currency.ts`) and never a literal array. The seven built-in categories are undeletable
  because `services/categorize.ts` can emit any of them.
- **A currency's `minor_units` is immutable once anything references it.** It is what
  `config/money.ts` multiplies by, so changing it reinterprets stored amounts rather than converting
  them. Users may only enable/disable entries from the shipped catalogue in
  `config/currencies.ts` — there is no POST, and adding a currency to the catalogue is a code change
  on purpose. `setMinorUnits` enforces this in the model so no caller can route around it.

## Code map

**backend/** — Express + TypeScript, layered:
- `src/server.ts` — app wiring, middleware, route mounts, graceful shutdown. Exports `app`; binds a
  port only when `NODE_ENV !== 'test'`.
- `src/routes/` — Express routers: `expenses`, `import`, `budgets`, `categories`, `currencies`, `fx`,
  `auth`, `settings`, `receipts`, `insights`. New endpoints go here.
- `src/models/` — better-sqlite3 prepared statements (`expense`, `budget`, `category`, `currency`,
  `fx`, `settings`, `insights`). All SQL lives here.
- `src/config/` — `database.ts` (schema + idempotent migrations + seeds), `currencies.ts` (the shipped
  ISO catalogue), `auth.ts` (HMAC tokens), `money.ts` (minor-unit conversion, via the currency table).
- `src/middleware/` — `auth` (`requireAuth`), `validation`.
- `src/services/` — `categorize.ts` (keyword auto-categorization, EN + PL); `receipt/` (OCR factory — see gotchas).
- `src/tests/` — Jest + supertest, 268 cases across 15 files (plus `env.ts` / `paths.ts` /
  `globalSetup.ts` / `globalTeardown.ts`, which are harness, not tests).

**frontend/** — React 18 + Vite, single-page UI (no state library — plain hooks). Four destinations
(Home / Expenses / Budgets / Settings) plus a persistent Add, addressed by `utils/route.ts`: a hash
router in ~80 lines with **no routing dependency**. Hash rather than `pushState` on purpose — the
latter needs every path answered with `index.html`, and nothing promises a self-hoster's static
server does, so `/expenses` would 404 on reload:
- `src/main.tsx` -> `src/components/App.tsx`. Feature components: `Home` (the boot screen — six
  sections over six endpoints, findings as section headings; `Dashboard`, `Insights` and
  `InsightsStrip` merged into it in wave 2), `Expenses` (the ledger *and* the query tool —
  `Analytics` merged into it in wave 3 and is deleted), `ExpenseTable` (the rows only, driven by
  `Expenses`), `Budgets`, `Fx`, `ExpenseForm`, `ExcelImport`, `EditExpenseModal`, `Login`,
  `Settings`, `ReceiptScan`, `CurrencyScope`. `Fx` and `ReceiptScan` have no nav entry until waves
  3–4 re-enter them from their new homes; `ExcelImport` is reached from the Expenses toolbar and
  from Home's empty-ledger Start card, and from no destination of its own.
- `src/services/api.ts` — central `apiFetch` wrapper (base `/api`, bearer from localStorage key
  `sundry-token`, 401 -> `auth-expired` window event). Add API calls here.
- `src/utils/` — `format.ts` (currency/date display, backed by a registry App refreshes),
  `categories.ts` (slug -> label/colour), `currencies.ts` (which currencies a control should offer —
  three different questions, see the file header), `insights.ts` (currency scoping for the four data
  endpoints), `home.ts` (Home's windows, its section arithmetic, and the sentence one finding becomes),
  `expenses.ts` (the Expenses query: range presets, filtering, the summary row and both charts —
  it imports `home.ts`'s window arithmetic rather than repeating it), `route.ts`, `export.ts`
  (client-side .xlsx). Charts: recharts. Styling: single dark-first `src/App.css`.

## Key design decisions (the non-obvious "why")

- **better-sqlite3, synchronous** — single-user self-hosted app; no async DB layer needed. The
  prepared statements in `models/` are the whole data layer.
- **Auth is opt-in** — enabled only when `APP_PASSWORD` is set; issues a 7-day HMAC bearer signed with
  `AUTH_SECRET || APP_PASSWORD`. **With no password the API is fully open** — fine for localhost,
  deliberate for self-hosting.
- **Types are duplicated per package** (`src/types/expense.types.ts` in each), not shared across the
  boundary — keep them in sync manually.
- **Categories and currencies are fetched once in `App.tsx` and prop-drilled**, exactly like
  `settings` and `fxRates`. A context or a store would be the third state mechanism in a codebase that
  deliberately has none. `ExpenseCategory` and `Currency` are therefore just `string` — the compiler
  cannot check a set the database owns, so the models do it at runtime.
- **`utils/format.ts` keeps a module-level currency registry** rather than taking the catalogue as an
  argument: it is called once per rendered amount, and threading it through every call site would be
  noise. `App` refreshes it (`setCurrencyRegistry`) before the setState that re-renders. Decimal places
  come from `minorUnits`, so the display can never imply more precision than the column holds.
- **Receipt OCR is pluggable and live** — `services/receipt/` selects an engine via
  `RECEIPT_OCR_PROVIDER` (default `tesseract`, `stub` under test). The router is mounted at
  `server.ts` (`app.use('/api/receipts', requireAuth, receiptRoutes)`) and drives a real two-step
  UI: scan -> review/edit -> save. The provider seam exists so Claude Vision can replace Tesseract
  without touching routes or frontend — don't collapse it.
- **`expenses.merchant` is write-only and has no UI** — the scanner detects a shop, `ReceiptScan`
  sends it alongside the description the user is free to rewrite, and only `models/insights.ts` ever
  reads it (`getMerchants` falls back to the description when it is NULL). It is deliberately absent
  from `Expense`, so no second "Merchant" box appears in a product whose pitch is simplicity, and an
  edit cannot overwrite what the receipt said. Nullable, never backfilled; its `ALTER TABLE` runs
  *after* the enum migrations in `database.ts`, which rebuild `expenses` from an explicit column list.
- **Insight selection lives on the server, and Home refetches findings per currency** —
  `/insights/summary?scope=primary|<code>&period=&window=` scores every candidate finding against the
  user's own window spend (`SCORING` in `models/insights.ts`, one exported block on purpose) and
  returns at most three. Ranking a PLN finding against a USD one requires converting first, so the
  scope is part of the question: clicking a currency button costs a round trip instead of a re-render,
  and buys one implementation of the merge instead of two. `period`/`window` are `/comparison`'s own
  pair, forwarded verbatim, so the findings measure the same window the sections they head do. Findings
  carry numbers and identifiers, **never sentences** — PL/EN is a roadmap item and an API that emitted
  English would have to be redone. The templates live in `utils/home.ts`.
- **The four data endpoints are scoped client-side, unlike the summary** — they only feed per-currency
  lists and totals, which Home already converts with `convertAmount`, so `utils/insights.ts` does the
  merge and a currency switch is a re-render. Nothing is ranked across currencies there, which is the
  whole reason the summary needs the server. `/insights/merchants` is asked for the maximum 100 rows
  because that endpoint's limit is a top-N *per currency* — a merchant dropped server-side cannot
  reappear in a client-side merge, and the UI says so when `truncated` comes back true.
- **Home carries two clocks and every section states its own** (ruling R2 of the UX report). The page
  control (`Last 30 days · This month · Last 12 months`, default 30 days) moves the headline, "Where it
  went" and the budget verdict; subscriptions, merchants and weekdays keep their own twelve months.
  Neither may be collapsed into the other: over 30 days a weekday has about four samples and the
  merchant list goes thin, and mixing a 12-month numerator with a 1-month denominator breaks
  `materiality`. Printing both windows is what makes this safe — do not "simplify" it to one control.
- **Home is not Expenses** — Expenses answers "how much on X between A and B?" and is driven by the
  user's filters; Home answers "what should I know that I did not ask about?" and is driven by the
  data. Home therefore has **no filter wall**: a default window, no category checkboxes, no required
  currency, no custom range. A section that needs configuring before it says anything belongs on
  Expenses, which is where wave 3 folded Analytics (ruling R4). Stated in both component headers;
  keep it.
- **Expenses computes everything client-side, from one query object.** The filter bar drives the
  table, the summary row and both charts through a single `LedgerQuery`; nothing on the screen asks
  the server. Analytics used to fetch its aggregates from `/expenses/stats/analytics` while the table
  filtered the same rows in the browser, so the two could describe different sets — and the search
  box settles it on its own, because the API has no search parameter and a chart fetched from it
  could never honour one. The endpoint still exists; the frontend has no caller.
- **Every control on Expenses arrives neutral** — no search, no category, every currency, `All time`.
  Analytics opened with eleven category checkboxes all ticked (F8), and a ledger defaulting to a
  30-day window would be the same mistake pointed the other way: the screen shows what it has, and
  the controls narrow from there. `Last 30 days` means thirty days (F2); any other window, including
  a whole past calendar month, is reachable through `Custom`.
- **Budget limits have no month dimension**, so Home scales them: the allowance is the standing monthly
  limit times `monthsInWindow(days)` (1 for both month-length windows, 12 for the year), and the
  section says which limits it compared against. Comparing a year of spending with one monthly limit
  would report everybody as 1100% over.
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
2. `npm run test` passes; add/extend tests for behavior changes (268 backend + 352 frontend cases;
   every frontend component has a suite, so a regression should be caught rather than shipped).
3. Command output shown as evidence.
4. Nothing sensitive staged (see hard rules).

## Pointers

- Setup & self-hosting: `docs/DEPLOYMENT.md`. Feature/endpoint reference: `README.md` (secondary to code).
- CI: `.github/workflows/ci.yml` (lint + typecheck + build + test for both packages + docker build).
- Personal / sandbox-only notes: put them in a gitignored `CLAUDE.local.md`, never here.
