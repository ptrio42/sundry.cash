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
  `auth`, `settings`, `receipts`, `insights`. New endpoints go here. `GET /categories/suggest` exposes
  `services/categorize.ts` so the manual form can guess a category too (change 21) — it ran on the
  import and the scan paths and nowhere else. `GET /expenses/people` answers with the "who added it"
  names in the ledger and is registered **before** `/:id`, like `/export`.
- `src/models/` — better-sqlite3 prepared statements (`expense`, `budget`, `category`, `currency`,
  `fx`, `settings`, `insights`, `rateLimit`). All SQL lives here.
- `src/config/` — `database.ts` (schema + idempotent migrations + seeds), `currencies.ts` (the shipped
  ISO catalogue), `auth.ts` (HMAC tokens, `AUTH_REQUIRED`, the boot assertion), `security.ts` (trust
  proxy, the CORS allowlist, the API's helmet/CSP options), `money.ts` (minor-unit conversion, via the
  currency table).
- `src/middleware/` — `auth` (`requireAuth`), `rateLimit` (the SQLite store for the per-IP login
  limiter plus the per-instance backstop), `validation`.
- `src/services/` — `categorize.ts` (keyword auto-categorization, EN + PL); `receipt/` (OCR factory — see gotchas).
- `src/tests/` — Jest + supertest, 339 cases across 18 files (plus `env.ts` / `paths.ts` /
  `globalSetup.ts` / `globalTeardown.ts`, which are harness, not tests).

**frontend/** — React 18 + Vite, single-page UI (no state library — plain hooks). Four destinations
(Home / Expenses / Budgets / Settings) plus a persistent Add, addressed by `utils/route.ts`: a hash
router in ~110 lines with **no routing dependency**. Hash rather than `pushState` on purpose — the
latter needs every path answered with `index.html`, and nothing promises a self-hoster's static
server does, so `/expenses` would 404 on reload. Add is not one of them: `#/expenses/add` is a
*second segment*, the Add sheet's open/closed state over the destination it covers:
- `src/main.tsx` -> `src/components/App.tsx`. Feature components: `Home` (the boot screen — six
  sections over six endpoints, findings as section headings; `Dashboard`, `Insights` and
  `InsightsStrip` merged into it in wave 2), `Expenses` (the ledger *and* the query tool —
  `Analytics` merged into it in wave 3b and is deleted), `ExpenseTable` (the rows only, driven by
  `Expenses`), `AddSheet` (the overlay, plus the `AddedLine` confirmation the shell renders after a
  save), `Budgets`, `ExpenseForm`, `ExcelImport`, `EditExpenseModal`, `Login`, `Settings`,
  `ReceiptScan`, `CurrencyScope`. `ExpenseForm` and `ReceiptScan` are the sheet's two tabs rather
  than screens (wave 3a); **`Fx` is gone** — the rate editor is a control on each row of Settings'
  Currencies section since wave 4 (change 13); `ExcelImport` is reached from the Expenses toolbar and
  from Home's empty-ledger Start card, and from no destination of its own. **Nothing is unreachable.**
- `src/services/api.ts` — central `apiFetch` wrapper (base `/api`, bearer from localStorage key
  `sundry-token`, 401 -> `auth-expired` window event). Add API calls here.
- `src/utils/` — `format.ts` (currency/date display, backed by a registry App refreshes),
  `categories.ts` (slug -> label/colour), `currencies.ts` (which currencies a control should offer —
  three different questions, see the file header), `insights.ts` (currency scoping for the four data
  endpoints), `home.ts` (Home's windows, its section arithmetic, and the sentence one finding becomes),
  `expenses.ts` (the Expenses query: range presets, filtering, the summary row and both charts),
  `budgets.ts` (the month stepper's arithmetic and the pace band), `who.ts` (this device's "who added
  it" name, its three storage states and the normalisation the backend mirrors), `route.ts`, `export.ts`
  (client-side CSV — the .xlsx comes from the backend's `GET /expenses/export`, called via
  `exportExpensesXlsx` in `services/api.ts`). **Both import their shared arithmetic from `home.ts`** — window ranges in one
  case, the over/close classification in the other — rather than re-implementing it, which is how
  the app ended up with four currency controls that disagreed. Charts: recharts. Styling: single
  light-first `src/App.css`; brand assets in `src/assets/` (the two logo cuts, the two symbol cuts,
  the two Newsreader subsets) and PWA icons in `public/icons/`.

## Key design decisions (the non-obvious "why")

- **better-sqlite3, synchronous** — single-user self-hosted app; no async DB layer needed. The
  prepared statements in `models/` are the whole data layer.
- **Auth is opt-in, unless it is required** — enabled only when `APP_PASSWORD` is set; issues a 7-day
  HMAC bearer signed with `AUTH_SECRET || APP_PASSWORD`. **With no password the API is fully open** —
  fine for localhost, deliberate for self-hosting, and catastrophic on a public host, which is what
  `AUTH_REQUIRED` exists to make impossible (see Gotchas and `docs/hosted-security.md` §3.1).
- **Types are duplicated per package** (`src/types/expense.types.ts` in each), not shared across the
  boundary — keep them in sync manually.
- **Categories and currencies are fetched once in `App.tsx` and prop-drilled**, exactly like
  `settings` and `fxRates`. A context or a store would be the third state mechanism in a codebase that
  deliberately has none. `ExpenseCategory` and `Currency` are therefore just `string` — the compiler
  cannot check a set the database owns, so the models do it at runtime.
- **Dates take a locale the code picks; amounts take one the data carries.** `DISPLAY_LOCALE`
  (`en-GB`) in `utils/format.ts` feeds every `Intl.DateTimeFormat` in the frontend. `Intl`'s
  `undefined` resolves to the *host OS*, so an English interface on a Polish laptop rendered
  `11 sie 2025` in the ledger and `sierpień 2026` as a Budgets heading (F19). PL/EN is a roadmap item
  and the seam for it is deliberate: turn the constant into `let` plus a setter, exactly as
  `registry`/`setCurrencyRegistry` already work, and no call site changes. The five
  `<input type="date">` controls stay in the *browser's* locale — that is the control rendering
  itself, not us formatting anything.
- **`utils/format.ts` keeps a module-level currency registry** rather than taking the catalogue as an
  argument: it is called once per rendered amount, and threading it through every call site would be
  noise. `App` refreshes it (`setCurrencyRegistry`) before the setState that re-renders. Decimal places
  come from `minorUnits`, so the display can never imply more precision than the column holds.
- **Receipt OCR is pluggable and live** — `services/receipt/` selects an engine via
  `RECEIPT_OCR_PROVIDER` (default `tesseract`, `stub` under test). The router is mounted at
  `server.ts` (`app.use('/api/receipts', requireAuth, receiptRoutes)`) and drives a real two-step
  UI: scan -> review/edit -> save. The provider seam exists so Claude Vision can replace Tesseract
  without touching routes or frontend — don't collapse it.
- **`expenses.who` is a label, not a login** — several people already share one instance and one
  password, so anyone can add an expense under any name; the column only says which device recorded
  the row. The name lives in `localStorage` under `sundry-who`, **per device and never on the
  server**: one name per instance is exactly what the feature exists to avoid, so there is no
  server-side fallback for an empty key. Three states, not two — absent (the Add sheet asks), a name,
  and the empty *skip* sentinel that "Not now" writes so the prompt cannot come back. `utils/who.ts`
  owns all of it and all three creation paths read it at save time. Nullable and never backfilled;
  its `ALTER TABLE` runs *after* the enum migrations for the same reason `merchant`'s does. Unlike
  `merchant` it is editable — there is no receipt to contradict, so a typo has to be fixable. The
  ledger's Who column and person filter appear only once **more than one** name is in the ledger, and
  both are computed from the whole ledger rather than the filtered set. Home is untouched: a
  per-person breakdown is a question you ask, and that belongs on Expenses. See
  `docs/who-label-spec.md`.
- **`expenses.merchant` is write-only and has no UI** — the scanner detects a shop, `ReceiptScan`
  sends it alongside the description the user is free to rewrite, and only `models/insights.ts` ever
  reads it (`getMerchants` falls back to the description when it is NULL). It is deliberately absent
  from `Expense`, so no second "Merchant" box appears in a product whose pitch is simplicity, and an
  edit cannot overwrite what the receipt said. Nullable, never backfilled; its `ALTER TABLE` runs
  *after* the enum migrations in `database.ts`, which rebuild `expenses` from an explicit column list.
- **Recording is an input method, not a place** — `AddSheet` opens over whatever destination you are
  on, and saving closes it, leaves you there and prints one line (`Added — 24,90 zł · Groceries.
  Undo · Edit`). Both halves are deliberate: Scan and Type held two of ten nav slots for one file
  picker apiece (F17), and saving used to `navigate('expenses')` while saying nothing, so the only
  evidence of the most frequent action in the product was that the app had moved you (F7). Two
  consequences worth keeping: the confirmation has **no timer**, because a line that dismisses itself
  takes Undo with it; and the sheet's default tab is resolved **at render, not at mount** — the sheet
  is mounted with the shell, before layout, and `window.innerWidth` is 0 then, which makes every
  `max-width` query true and would open a desktop on Scan (`isPhone` in `AddSheet.tsx` guards the
  same case for a cold load straight into `#/home/add`).
- **The sidebar collapses to a rail, and the rail keeps all seven controls.** The toggle sits in the
  brand row; collapsed, it sits *on* the mark and is revealed by hovering or focusing it, because a
  68px column has no row to spare for a chevron. Three things are load-bearing. **The collapsed shell
  overrides `--sidebar-w`, never `grid-template-columns`** — a media query adds no specificity, so a
  `.shell.sidebar-collapsed` naming the track outranked the phone rule that flattens the shell to one
  column, and a phone belonging to someone who had collapsed the sidebar on a desktop kept a 68px
  first track the hidden sidebar no longer occupied: auto-placement put the *content* in it and the
  app rendered 68px wide. **The labels stay in the DOM** and become the tooltips, so the accessible
  name of every control survives a `display: none` that would have left a rail of unlabelled
  pictures. And **the mark swaps to the square cut**, since the horizontal lockup's own stated minimum
  is 120px. Desktop-only by construction rather than by a check: it all lives inside `.sidebar`, which
  under 680px is `display: none`, and a phone has a bottom bar and nothing to collapse. The choice is
  remembered in `sundry-sidebar`, read in the state initialiser — unlike the theme it needs no inline
  script, because nothing paints a sidebar before React exists.
- **Insight selection lives on the server, and Home refetches findings per currency** —
  `/insights/summary?scope=primary|<code>&period=&window=` scores every candidate finding against the
  user's own window spend (`SCORING` in `models/insights.ts`, one exported block on purpose) and
  returns at most three. Ranking a PLN finding against a USD one requires converting first, so the
  scope is part of the question: clicking a currency button costs a round trip instead of a re-render,
  and buys one implementation of the merge instead of two. `period`/`window` are `/comparison`'s own
  pair, forwarded verbatim, and they move the **spending** findings only. Findings
  carry numbers and identifiers, **never sentences** — PL/EN is a roadmap item and an API that emitted
  English would have to be redone. The templates live in `utils/home.ts`.
- **A finding's stated window is the window of the data its section renders**, and `materiality`
  divides by the spend in *that* window — `FINDING_WINDOW` in `models/insights.ts` declares which of
  Home's two clocks each kind runs on, and the compiler makes a seventh kind declare one. The habit
  findings (`weekend_skew`, `merchant_drip`) therefore measure twelve months whatever the page control
  says, and are scored against twelve months of spending. Wave 2 required every *section* to state its
  window and not a finding and its section to share one, which put `about 206,98 zł a day over the
  last 30 days` fifteen pixels above a chart saying 186,47 over 366
  (`docs/fix-finding-window-spec.md`). Do not "simplify" the two denominators into one: a share is
  only meaningful in the frame it was measured in, and it is what keeps every score inside 0..1.
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
  merchant list goes thin. Printing both windows is what makes this safe — do not "simplify" it to one
  control — and printing them is only half of it: the finding heading a section has to measure the
  window that section renders (see the bullet above).
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
  would report everybody as 1100% over. **Budgets' month stepper is the same fact from the other end**
  — it moves the *spending* window only, so any past month is measured against today's limits and the
  screen prints that caveat. Do not remove it to tidy the layout: the inaccuracy is the price of the
  feature and the sentence is what makes the price fair.
- **On Budgets, reading and editing are two states, not one widget** (F11). The limit input saves on
  blur and treats a blank, NaN or ≤ 0 value as *delete*, so while the list was always editable a stray
  keystroke on a figure you clicked to read removed it silently. The list is text until **Edit limits**
  is pressed — keep the toggle. It is also why the combined `All → primary` scope is read-only: a limit
  is stored in one currency, and writing back an edit made against a converted figure would rewrite it
  at today's rate.
- **Light-first, and the palette is derived, not picked.** `docs/art-drops/sundry-brand-final/`
  freezes three colours — charcoal `#1A1A1A`, sage `#7DA27D`, off-white `#F7F7F5`. Everything else in
  `App.css` is derived from them and measured: `src/tests/theme.test.ts` recomputes every
  foreground/surface pair in both themes and fails under 4.5:1. **`:root` is the light theme and
  `[data-theme='dark']` is the override**, which is the inversion of what it was — light used to be
  structurally the exception, which is how it spent most of its life with no `--accent`, `--danger`,
  `--info` or `--warning` at all. Dark is a full peer, not a fallback. Three consequences worth
  keeping: **sage is a fill, never text on light** (2.67:1 on off-white, so `--accent` is a darker
  sibling at 36% lightness and `--accent-fill` keeps the frozen value for backgrounds, which then
  take charcoal and a 1px `--accent` edge); **no colour literal may appear outside the token blocks**
  in `App.css` or in a component, which the same suite enforces — the exception is a category's hue,
  which is user data; and **the anti-flash rule in `index.html` follows the default**, so it is
  off-white now, with a blocking inline script that stamps `data-theme` from `sundry-theme` before
  first paint. That key is deliberately not the old bare `theme`: the dark-first shell wrote `dark`
  into it on every mount for everyone, so reading it would have shipped the whole rebrand to
  first-time visitors only.
- **Newsreader has exactly three strings** — the wordmark, Home's headline, the finding sentences.
  Self-hosted (`src/assets/fonts/`, licence served at `/fonts/OFL.txt`) rather than loaded from
  Google, because the pitch is that the app hands your data to nobody and the demo is public. Tables,
  controls and every figure stay on `--font`.

## Gotchas

- **`npm run install:all` installs all three package roots** (root tooling + backend + frontend).
  A bare `npm install` at root only gets `concurrently` / `cross-env`, so `npm run dev` then fails
  with missing modules in the sub-packages.
- **Node 24, and better-sqlite3 12 is what makes it free.** Docker images and CI both pin Node 24;
  `.nvmrc` says 24 and `engines` declares `>=24`. better-sqlite3 is a native module shipping one
  prebuilt binary per Node ABI, and Node 24 is ABI 137: **11.x publishes none for it**, so the image
  would run node-gyp and need a C++ toolchain; 12.x publishes one, so the image downloads it. That is
  the entire reason for the bump — after touching either version, **read the build log and confirm
  `prebuild-install` fetched a binary rather than `node-gyp` compiling one**. Do not go to 13.x: it
  publishes no prebuilds for any ABI at all. The runtime is 24 rather than 22 so `crypto.argon2()`
  (Node ≥ 24.7; `node:24-alpine` is on 24.19) is available to the hosted auth work without a native
  dependency — `docs/hosted-security.md` §2.1. `engines` says `>=24` and not `>=24.7.0` on purpose:
  nothing calls `crypto.argon2()` yet, so the change that first does is the one that raises the floor.
- **`npm ci` proves nothing about the prebuild, and the new npm warns about it.** `npm ci` hides
  install-script output unless you pass `--foreground-scripts`, so a build log showing a clean
  `npm ci` is equally consistent with a download and a compile — check the image instead: a
  downloaded prebuild leaves `build/Release/better_sqlite3.node` and nothing else, while node-gyp
  leaves a `Makefile`, `obj.target/` and `*.o` (and roughly doubles the package on disk, 12 MB to
  27 MB). The alpine image has no `cc`, `make` or `python3` at all, so a missing prebuild fails the
  build rather than silently compiling. Separately, the npm in `node:24-alpine` (11.17) now prints
  `allow-scripts ... not yet covered by allowScripts` for better-sqlite3 and tesseract.js. It still
  runs them, so the binary is there — but both packages depend on install scripts, so if that
  default ever flips to blocking, the image would ship without the native module.
- **`RECEIPT_OCR_PROVIDER=claude` throws "not implemented"** — only `tesseract` and `stub` work today.
- **A failed `createWorker` does not reject — it never settles.** tesseract.js 7.0.0 rejects its own
  promise only for the `load` action; the `loadLanguage` rejection a failed language download produces
  goes to `errorHandler` and is then swallowed by a trailing `.catch(() => {})` in `src/createWorker.js`.
  A scan therefore hung until nginx answered 504, and `errorHandler` was handed a *string*, so the
  original `cause` never reached the log. `services/receipt/tesseract.ts` rejects from the handler and
  keeps a wall-clock ceiling as a backstop; both ceilings must stay under `proxy_read_timeout` on
  `location ^~ /api` in `frontend/nginx.conf`, or the proxy hides the message. **Never mock
  `createWorker` as rejecting** — the test that did passed while the real thing hung.
- **`pol` and `eng` language data ships in the image**, staged from the `@tesseract.js-data` packages by
  `npm run tessdata`. The CDN fallback is still there for any other language, but it is an *unpinned*
  jsdelivr path (`npm/@tesseract.js-data/<lang>/4.0.0_best_int`, resolved to latest), so nothing that
  matters should depend on it. `langPath` names one directory and one filename form for all languages
  at once and does not fall back per language — which is why the bundle is only used when it covers
  every entry in `RECEIPT_OCR_LANGS`.
- **Tests run against a temp DB, never the real one.** `jest.config.js` wires `src/tests/env.ts` as a
  `setupFile` that repoints `DB_PATH` at `$TMPDIR/sundry-test-data/` before any app module loads —
  `receiptsDir()` derives from `DB_PATH`, so uploaded images are isolated too. Never remove this:
  without it the suite writes fixtures straight into `backend/data/expenses.db`.
- **Reset the local DB** by deleting `backend/data/expenses.db` — it is recreated on next backend start.
- **`config/database.ts` swallows migration errors on purpose** ("Continue even if migration fails"), so a
  failed migration is silent. Anything that depends on a table existing must check for itself and treat
  absence as an error, never as "not yet" — the auth work in `docs/hosted-security.md` turns on this.
- **The `AUTH_SECRET` fallback still exists and is now loud.** With it empty, `getSecret()` falls back to
  `APP_PASSWORD` and the bearer token becomes an HMAC over known plaintext (`{exp}`) keyed by the password
  itself — one leaked token is an offline, unthrottled cracker. Kept working for backward compatibility;
  the backend warns at boot and **refuses to start** when `AUTH_REQUIRED` is also set.
- **`AUTH_REQUIRED` is the difference between a laptop and a host.** Unset, auth stays opt-in and a
  missing password means an open API — unchanged, deliberate. Set, a missing password (or a missing
  `AUTH_SECRET`) is fatal at boot and every guarded route answers **503**, never `next()`. If you add a
  route, mount it behind `requireAuth` and that comes free; a route that reads auth state itself must
  treat "cannot tell" as a refusal, never as "not required".
- **`TRUST_PROXY` is a hop count, and both directions of wrong are bad.** It counts the proxies that
  *append* to `X-Forwarded-For`: 1 for the bundled nginx (the default), 2 behind an additional front
  proxy such as Caddy or Fly. Too low and every visitor resolves to the proxy's address, so one
  stranger's failed logins throttle the owner; too high and a visitor can forge the address the limiter
  counts. `backend/src/config/security.ts` documents the values and `src/tests/security.test.ts` pins
  the resolved `req.ip` for each chain.
- **The CSP admits `index.html`'s two inline blocks by hash.** Edit the anti-flash `<script>` or
  `<style>` by one character and the shipped app loads with no theme and no pre-paint background —
  silently, because nginx serves the policy and nothing in dev does. `frontend/src/tests/csp.test.ts`
  recomputes both hashes and fails with the replacement to paste into
  `frontend/security-headers.conf`. Never "fix" it by adding `'unsafe-inline'` to `script-src`.
- **nginx `add_header` does not merge**: a `location` that sets any header of its own discards every
  header inherited from the server block. That is why the security headers live in
  `frontend/security-headers.conf` and are `include`d per location — and why `location ^~ /api` does
  *not* include them, since Express sets its own and `add_header` would append a second copy.
- **A container healthcheck must say `127.0.0.1`, never `localhost`.** busybox `wget` resolves
  `localhost` to `[::1]` first; nginx's `listen 80` is IPv4-only, so the frontend's probe collected
  "Connection refused" forever and the container reported `unhealthy` while serving every request —
  which `depends_on`, `--wait` and any orchestrator gate believe. The compose network declares no
  `enable_ipv6`, so the only IPv6 address either container has is `::1` on `lo`: making nginx
  `listen [::]:80` would have built a listener for the probe alone. The backend's probe passed only
  because Node's `app.listen(PORT)` binds dual-stack.

## Definition of done

1. `npm run lint` reports zero errors, and `npm run build` passes (strict) for the touched package(s).
2. `npm run test` passes; add/extend tests for behavior changes (339 backend + 720 frontend cases;
   every frontend component has a suite, so a regression should be caught rather than shipped).
3. Command output shown as evidence.
4. Nothing sensitive staged (see hard rules).

## Pointers

- Setup & self-hosting: `docs/DEPLOYMENT.md`. Feature/endpoint reference: `README.md` (secondary to code).
- Selling Sundry as a hosted product: `docs/hosted-security.md` — the threat model, every auth parameter with
  the published source that sets it, what we deliberately do not do, and the incident plan. Read it before
  touching `config/auth.ts` or anything about instances someone pays for.
- CI: `.github/workflows/ci.yml` (lint + typecheck + build + test for both packages + docker build).
- Personal / sandbox-only notes: put them in a gitignored `CLAUDE.local.md`, never here.
