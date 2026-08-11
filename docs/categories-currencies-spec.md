# Categories & currencies as data — implementation spec

Today both are `CHECK`-constrained enums, so adding a category or a currency means a table-recreate
migration plus edits in ~15 backend and ~11 frontend files. This turns them into rows.

## Do this in two sessions, in this order

The blast radius is roughly 45 files. One change that big is unreviewable, and the two halves have
different risk profiles:

| | Categories | Currencies |
|---|---|---|
| What a row carries | slug, label, colour | **behaviour**: minor-unit exponent, symbol, locale |
| Can a wrong row corrupt data? | No | **Yes** — the exponent decides how amounts are stored |
| Touches `money.ts` / `format.ts` | No | Yes |

**Session 1 is categories. Session 2 is currencies.** Ship and use session 1 before starting
session 2. Do not combine them in one branch.

---

# Session 1 — categories

## Schema

```sql
CREATE TABLE IF NOT EXISTS categories (
  slug       TEXT PRIMARY KEY,
  label      TEXT NOT NULL CHECK(length(label) > 0),
  color      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0   -- 1 = shipped by us, cannot be deleted
);
```

Seed with **exactly today's seven slugs** — `groceries`, `transport`, `media`, `entertainment`,
`utilities`, `maintenance`, `other` — carrying the colours currently hardcoded in
`Dashboard.tsx` (`COLORS`) and the labels from `CATEGORY_LABELS`. Because the slugs are unchanged,
**no existing expense row is rewritten**; the migration only drops a constraint.

Then recreate `expenses` and `budgets` without `CHECK(category IN ...)`, adding
`FOREIGN KEY(category) REFERENCES categories(slug)`. `foreign_keys = ON` is already set in
`config/database.ts`.

Follow the existing table-recreate pattern (it is in the file twice already, for `maintenance` and
for `BTC`). Make it idempotent the same way: read `sqlite_master.sql` and skip when it no longer
contains `CHECK(category IN`.

## Rules that are not obvious

- **`other` is undeletable.** `services/categorize.ts` falls back to it, and so does the Excel
  import when a row's category cannot be mapped. Losing it breaks both silently. Mark it
  `is_builtin = 1` and refuse deletion of any built-in.
- **Deleting a category that is in use must not silently orphan rows.** Return `409` with the
  usage count and require an explicit reassignment target (`DELETE /api/categories/:slug?reassignTo=other`).
  Never let the FK fail with a raw SQLite error.
- **`categorize.ts` maps keywords to slugs.** Its map stays code-side (it is our heuristic, not user
  data), but every slug it can emit must be guaranteed to exist — which the built-in rule ensures.
- Renaming a *label* is free. Renaming a *slug* is a data migration; do not offer it.

## Endpoints

`src/routes/categories.ts`, mounted like the rest in `server.ts` behind `requireAuth`:

- `GET /api/categories` → all rows, ordered by `sort_order` then `label`
- `POST /api/categories` → `{ slug, label, color }`; slug is `[a-z0-9-]+`, unique, not reserved
- `PUT /api/categories/:slug` → label, colour, sort order only
- `DELETE /api/categories/:slug` → refuses built-ins; refuses in-use without `reassignTo`

`middleware/validation.ts` currently validates against a hardcoded `VALID_CATEGORIES` array in two
places. It must query the table instead — the constraint moved, so validation has to move with it.

## Frontend

Ten components hardcode the list, the labels, or the colours: `Dashboard`, `Analytics`,
`InsightsStrip`, `Budgets`, `ExpenseForm`, `EditExpenseModal`, `ExpenseTable`, `ReceiptScan`,
`Settings`, `App`.

Load categories **once in `App.tsx`** and pass them down, exactly as `settings` and `fxRates`
already are. No new state library, no context — CLAUDE.md is explicit that this app is plain hooks
and prop drilling, and three of these components already take `settings` this way.

Category management UI belongs in `Settings`, not a new tab.

Delete `CATEGORY_LABELS` and `COLORS` from every component once the data arrives — four copies of
the label map exist today and the insights work added the fourth.

---

# Session 2 — currencies

## Do not let users invent currencies

This is the one design decision worth arguing about, so here is the reasoning.

A currency row carries its **minor-unit exponent**, and `config/money.ts` uses it to convert at the
model boundary: `toMinorUnits(50.99, 'USD')` is `5099`, `toMinorUnits(0.0005, 'BTC')` is `50000`.
If a user could type "decimals: 3", every amount stored under that currency would silently mean
something else. Worse, **changing the exponent after rows exist reinterprets all of them** — 5099
cents becomes 5.099 of something.

So: ship a **built-in ISO 4217 catalogue** (code, exponent, symbol, locale) plus BTC as an explicit
non-ISO entry, and let the user only **enable or disable** entries. EUR and GBP then cost one row
each, and the exponent is right by construction.

```sql
CREATE TABLE IF NOT EXISTS currencies (
  code        TEXT PRIMARY KEY,
  minor_units INTEGER NOT NULL,      -- 100 for cents, 100000000 for satoshis
  symbol      TEXT NOT NULL,
  locale      TEXT,                  -- formatting locale; see utils/format.ts
  enabled     INTEGER NOT NULL DEFAULT 0
);
```

**Hard rule: `minor_units` is immutable once any expense references the code.** Enforce it in the
model, not just the UI.

Seed the catalogue and enable `USD`, `PLN`, `BTC` so behaviour is unchanged on upgrade. Then
recreate `expenses`, `budgets` and `fx_rates` without their `CHECK(currency IN ...)`.

## What carries behaviour, and must move with the data

- `config/money.ts` — `MINOR_UNITS` is a hardcoded three-key `Record`. It becomes a lookup against
  the table, cached at startup (the app is single-process and synchronous, so a module-level map
  refreshed on write is enough).
- `frontend/src/utils/format.ts` — `CURRENCY_SYMBOLS`, the per-currency locale map, and the special
  BTC branch (`SATS_PER_BTC`, the sat/BTC display unit).
- `settings` — `defaultCurrency`, `primaryCurrency` and `defaultBtcUnit` are validated against
  `VALID_CURRENCIES` in `models/settings.ts`. `defaultBtcUnit` is BTC-specific and should stay
  special-cased rather than generalised.
- Disabling a currency that has expenses must keep those expenses readable. Disabled means "not
  offered for new entries", never "hidden from history".

---

## Tests

About 20 suites reference `'groceries'` or `'USD'`. Most keep passing, because the seeds preserve
today's values — that is the point of seeding with the existing slugs. What will break, and should:

- assertions on validation error text that lists the enum (`Category must be one of: …`)
- anything asserting a fixed category count

Add coverage for: the migration is idempotent (run `initializeDatabase()` twice); a built-in cannot
be deleted; deleting an in-use category without `reassignTo` returns 409; reassignment moves the
rows; a custom category survives a restart; and for session 2, that `minor_units` cannot change once
referenced.

## Definition of done

`npm run lint`, `npm run build`, `npm run test` all green with output shown. Nothing under `data/`,
no `*.db`, no `.env*` staged. Session 1 and session 2 land as separate branches.
