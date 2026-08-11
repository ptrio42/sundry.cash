# Insights — implementation spec

Answers the one question Sundry could not answer: **what changed?** `getAnalytics` only does
`GROUP BY category, currency`; there was no period-over-period comparison anywhere in the backend.

- **Slice 1 — `comparison` + `recurring`. SHIPPED** (`feat/insights`, plus `ce4f690`). Ran on the
  existing schema, no migration.
- **Slice 2 — `merchants` + `patterns`. SHIPPED.** `merchants` added one nullable column
  (`expenses.merchant`, no UI field, no backfill); `patterns` needed nothing. Two deviations from the
  query below, both noted where they appear: `lower_unicode` wraps the whole `COALESCE`, so a scanned
  merchant and a hand-typed description fold to the same key; and `limit` applies **per currency**,
  because ranking one `ORDER BY total_minor` across currencies compares satoshis with grosze — and
  with a `LIMIT` on the end, that silently deletes a whole currency from the report.
- **Slice 3 — `summary` + the strip refactor. SHIPPED.** Specced at the end of this file, with the
  four deviations recorded there. It was originally held back to calibrate severity thresholds
  against the real ledger first; that step was **deliberately skipped** (2026-08-11) to keep moving.
  The design compensates rather than pretends: scores are normalised by the user's own window spend
  instead of absolute money, so a big swing on a trivial category self-eliminates without anyone
  picking a floor for it, and every constant sits in one exported block so tuning later is a
  one-file edit. Synthetic fixtures remain fine for mechanics and edge cases but **circular for
  calibration** — you would invent a distribution, tune to it, and learn only about your own guess.
  When the numbers do get tuned, tune them on the live database and then pin the behaviour with
  fixtures.

## Constraints (apply to every slice)

- **Never sum across currencies.** Minor units differ per currency (cents vs satoshis). Every
  aggregate keeps the `currency` dimension or takes an explicit currency filter. See the existing
  discipline in `src/models/expense.ts` (`getStatsByCategory`, `getAnalytics`).
- **No LLM, no network.** Deterministic SQL + JS. Zero marginal cost, testable, works offline,
  consistent with the privacy positioning.
- Amounts leave the model layer in **major units** (existing convention); `toMajorUnits` at the
  boundary only.
- **Categories and currencies are rows now, not enums.** Validate by querying `models/category.ts`
  and `models/currency.ts` — never against a literal array. Note the distinction the existing code
  already makes: `routes/insights.ts` uses `CurrencyModel.exists()` rather than `isEnabled()`,
  because history can contain a currency that has since been disabled. Reading the past and
  offering a choice for the future are not the same check.

## Files

- `src/models/insights.ts` — new; prepared statements + the JS analysis passes.
- `src/routes/insights.ts` — new; two GET routes, validation, error shape matching existing routers.
- `src/server.ts` — mount `app.use('/api/insights', requireAuth, insightsRoutes)`.
- `src/tests/insights.test.ts` — new.

---

## `GET /api/insights/comparison`

Query params:

| param | values | default |
|---|---|---|
| `window` | `rolling` \| `calendar` | `rolling` |
| `period` | `week` \| `month` \| `year` | `month` |
| `anchor` | `YYYY-MM-DD` | today |
| `currency` | currency code | all (rows keep the currency dimension) |

**`rolling` is the default on purpose.** Comparing a partial calendar month against a full previous
month reports "-70%" on the 3rd of the month. Rolling compares equal-length windows: the N days
ending at `anchor` vs the N days before that.

One pass, both windows:

```sql
SELECT
  category,
  currency,
  SUM(CASE WHEN date >= @curStart THEN amount ELSE 0 END) AS current_minor,
  SUM(CASE WHEN date <  @curStart THEN amount ELSE 0 END) AS previous_minor,
  SUM(CASE WHEN date >= @curStart THEN 1 ELSE 0 END)      AS current_count,
  SUM(CASE WHEN date <  @curStart THEN 1 ELSE 0 END)      AS previous_count
FROM expenses
WHERE date >= @prevStart AND date <= @curEnd
GROUP BY category, currency
```

Response:

```json
{
  "window": "rolling",
  "period": "month",
  "current":  { "start": "2026-07-12", "end": "2026-08-10" },
  "previous": { "start": "2026-06-12", "end": "2026-07-11" },
  "byCategory": [
    { "category": "groceries", "currency": "PLN",
      "current": 1412.00, "previous": 1053.50,
      "delta": 358.50, "deltaPct": 34.0,
      "currentCount": 22, "previousCount": 19 }
  ]
}
```

Edge cases:
- `previous == 0 && current > 0` → `deltaPct: null` (not `Infinity`), plus `"isNew": true`.
- A category present in only one window still emits a row, with `0` on the missing side.
- `deltaPct` rounded to one decimal; `delta` in major units.

---

## `GET /api/insights/recurring`

Finds repeating charges — the forgotten-subscription report.

| param | values | default |
|---|---|---|
| `since` | `YYYY-MM-DD` | 12 months before today |
| `minOccurrences` | integer >= 2 | `3` |

Candidates in SQL, analysis in JS (SQLite has no `stddev`; better-sqlite3 is synchronous so the
JS pass is free at this data size):

```sql
SELECT
  lower_unicode(TRIM(description)) AS key,
  currency,
  COUNT(*)                         AS n,
  GROUP_CONCAT(date)               AS dates,
  GROUP_CONCAT(amount)             AS amounts
FROM expenses
WHERE date >= @since
GROUP BY key, currency
HAVING n >= @minOccurrences
```

**Not `LOWER()`.** SQLite's built-in folds ASCII only: `LOWER('ŻABKA')` and `LOWER('Żabka')` both
give `'Żabka'`, but `'żabka'` stays distinct. One merchant spelled both ways splits into two series
that can each fall below the occurrence threshold, so the subscription vanishes from the report
rather than merely being misgrouped. `lower_unicode` is registered on the connection in
`config/database.ts` and delegates to JS `toLowerCase()`; the prebuilt better-sqlite3 binaries
have no ICU.

JS pass per candidate:
1. Sort dates ascending, compute gaps in days.
2. Median gap classifies cadence: `weekly` 6–8, `monthly` 27–34, `quarterly` 88–95,
   `yearly` 360–370. Anything else → drop the candidate (it is not recurring, just frequent).
3. Amount stability: all within ±15% of the median → `"stable"`, else `"variable"`.
4. `monthlyCost = medianAmount * (30.44 / medianGap)`.
5. `likelyCancelled = (today - lastSeen) > 1.8 * medianGap`.
6. `totalPaid` = sum since `firstSeen`. This is the number that makes someone act — surface it.

```json
{ "recurring": [
    { "label": "netflix", "currency": "PLN", "cadence": "monthly",
      "medianAmount": 43.00, "monthlyCost": 43.00, "totalPaid": 602.00,
      "occurrences": 14, "firstSeen": "2025-06-12", "lastSeen": "2026-08-05",
      "amountStability": "stable", "likelyCancelled": false }
] }
```

Note: `GROUP_CONCAT` ordering is not guaranteed by SQLite — sort in JS, do not rely on insertion
order. Descriptions are matched case-insensitively after trimming; fuzzier merchant matching waits
for the `merchant` column in a later slice.

---

## Frontend

**No new tab.** A strip of at most three sentences at the top of `Dashboard`. The precedent is
already in the codebase: `presentCurrencies` in `Dashboard.tsx` hides currencies absent from the
data — same progressive-disclosure principle. Simplicity is the product; a fifth tab is a
regression.

Add the two calls to `src/services/api.ts` (the central `apiFetch` wrapper), not inline `fetch`.

## Tests

Seed fixtures with **hardcoded dates** — never `new Date()`, or the suite rots. Cover:

- rolling vs calendar window boundaries (including the "3rd of the month" case)
- `previous == 0` → `deltaPct: null`, `isNew: true`
- multi-currency: PLN and BTC rows never merge
- recurring: a true monthly series is detected; an irregular one with the same count is rejected
- recurring: variable amounts flagged `"variable"`; a stopped series flagged `likelyCancelled`
- empty DB → empty arrays, HTTP 200, no crash

## Definition of done

`npm run lint`, `npm run build`, `npm run test` all pass with output shown; new cases added to the
backend suite; nothing under `data/`, no `*.db`, no `.env*` staged.

---

# Slice 2 — `merchants` + `patterns`

Two endpoints, one nullable column between them. Both extend `models/insights.ts` and
`routes/insights.ts` rather than adding files.

## `GET /api/insights/merchants`

"Twenty coffees at 15 zł is 300 zł a month" — the spend that hides in small, frequent, unremarkable
transactions.

### The column, and why it must not become a visible field

`services/receipt/parse.ts` already detects a merchant and returns it on `ReceiptExtraction`, but
nothing persists it: `ReceiptScan.tsx:81` pre-fills the **description** box with `result.merchant`
and the user edits it freely before saving. So the description already *is* the merchant most of
the time.

That kills the obvious design. Adding a second user-facing "Merchant" field to a product whose
entire pitch is simplicity would be a bad trade — one more box to fill in, for a report.

Do this instead:

```sql
ALTER TABLE expenses ADD COLUMN merchant TEXT;
```

- Nullable, **no UI field, no backfill.** SQLite takes `ADD COLUMN` directly; this is not a table
  recreate (the schema already carries `currency` added the same way).
- `ReceiptScan` sends the OCR-detected merchant alongside the description it already sends —
  captured silently at scan time, never shown as an input. If the user rewrites the description,
  the detected merchant stays as detected; that is the point.
- Every manual entry and every historical row leaves it `NULL`, and the query falls back to the
  description. Nothing is lost, nothing has to be migrated.

### Query

```sql
-- Shipped as lower_unicode(COALESCE(NULLIF(TRIM(merchant), ''), TRIM(description))): folding only
-- the description branch would leave a scanned 'Żabka' and a typed 'żabka' as two merchants, which
-- the test below requires them not to be.
SELECT
  lower_unicode(COALESCE(NULLIF(TRIM(merchant), ''), TRIM(description))) AS key,
  currency,
  SUM(amount) AS total_minor,
  COUNT(*)    AS n,
  MIN(date)   AS first_seen,
  MAX(date)   AS last_seen
FROM expenses
WHERE date >= @since AND date <= @until
GROUP BY key, currency
-- Shipped as ORDER BY currency, total_minor DESC, with `limit` taken per currency in JS (the same
-- "candidates in SQL, analysis in JS" split `recurring` uses). `total_minor` counts *that
-- currency's* minor units, so one flat ranking puts 0.0002 BTC (20 000 satoshis) above 100 zł
-- (10 000 grosze) — and since the same comparison decides what LIMIT cuts, a whole currency can
-- vanish from the report with only `truncated: true` to show for it. On the shipped default set
-- (USD, PLN, BTC) that is the normal case, not an edge one.
ORDER BY total_minor DESC
LIMIT @limit
```

`lower_unicode`, not `LOWER` — the built-in folds ASCII only, so `żabka` and `Żabka` would be two
merchants. It is registered on the connection in `config/database.ts`; see the note there.

Query params: `since` (default 12 months back), `until` (default today), `currency` (optional),
`limit` (default 20, max 100, **per currency**). Response rows carry `key`, `currency`, `total`,
`count`, `average`, `firstSeen`, `lastSeen`, all in major units, currency dimension kept.

**Log the truncation.** If `limit` cuts any currency's list, say so in the payload
(`truncated: true`) rather than silently implying the top 20 is everything.

## `GET /api/insights/patterns`

When you spend, not what on.

```sql
SELECT
  CAST(strftime('%w', date) AS INTEGER) AS dow,   -- 0 = Sunday .. 6 = Saturday
  currency,
  SUM(amount) AS total_minor,
  COUNT(*)    AS n
FROM expenses
WHERE date >= @since AND date <= @until
GROUP BY dow, currency
```

**The one thing that is easy to get wrong: compare per day, never totals.** A week has five
weekdays and two weekend days, so weekday totals win 5:2 on an even spread and the finding would be
noise. Divide by the number of each kind of day *actually inside the window* — not by 5 and 2, since
an arbitrary window does not contain whole weeks.

Return, per currency: `byWeekday[7]`, plus `weekendPerDay` / `weekdayPerDay` and the ratio between
them. A ratio near 1.0 is not a story and the frontend should say nothing.

## Tests

Same rules as slice 1 — hardcoded dates, no `new Date()`. Cover:

- merchant column absent (`NULL`) falls back to the description; present, it wins
- `żabka` / `Żabka` / `ŻABKA` collapse to one merchant, and a receipt-sourced merchant merges with
  a manually typed one
- an empty-string merchant behaves as `NULL` (hence the `NULLIF`)
- merchants: currencies never merge; `truncated` is set when `limit` bites
- patterns: an even spread across all seven days yields a ratio of ~1.0, not a weekday "win"
- patterns: a window that is not a whole number of weeks still divides by the right day counts
- empty DB → empty arrays, HTTP 200

## Frontend

Neither endpoint gets a tab or a chart in this slice. They exist so `summary` has findings to rank.
Wire them into `InsightsStrip` only if a sentence genuinely earns one of the three slots — otherwise
leave the UI alone and let slice 3 decide.

---

# Slice 3 — `summary`, and the strip stops thinking

Finishes insights. Three things that only make sense together:

1. `GET /api/insights/summary` — composes all four existing analyses, scores each candidate, returns
   the top findings.
2. `merchants` and `patterns` gain their first consumer. Today nothing in the product reads them.
3. `InsightsStrip` becomes a renderer. The selection logic it carries now
   (`InsightsStrip.tsx`, the three `lines.push` blocks) moves to the server.

Doing these separately means writing the selection logic twice and throwing one copy away.

## Calibration: the constraint this design works around

The severity thresholds were meant to be tuned against the real ledger first. That is not happening,
so **the design must not depend on absolute magic numbers.** Two rules follow, and they are the
point of this slice:

- **Score relative to the user's own spending, never in absolute money.** "Groceries rose 400" means
  nothing; "groceries rose 400, which is 18% of everything spent in the window" ranks itself. A 30%
  jump on a 2 zł category self-eliminates without anyone picking a floor for it.
- **Every constant lives in one exported block at the top of the scorer**, with a comment saying what
  moving it does. Tuning later must be a one-file edit, not an archaeology exercise.

Where a starting value is needed, take it from what `InsightsStrip` does today. Those numbers have
been running on the real ledger since slice 1 without complaint, which makes them a far better prior
than a fresh guess.

## Scope and currency

The strip currently merges and converts client-side, and re-scopes without refetching. That has to
move: ranking a PLN finding against a USD one requires conversion, so the server needs to know the
scope.

`GET /api/insights/summary?scope=primary|<code>`

- `scope=<code>` — only that currency, no conversion.
- `scope=primary` — every currency converted into `settings.primaryCurrency` via the `fx_rates`
  table, then combined. The backend already owns both (`models/fx.ts`, `models/settings.ts`); it
  does not need the client to supply rates.

**The trade, stated so nobody silently reverts it:** clicking a currency button now costs a round
trip instead of a re-render. At single-user scale that is milliseconds, and it buys one
implementation of the merge instead of two. Add `scope` to the strip's fetch dependency array
alongside `expenses`.

## The API returns data, never sentences

Findings carry numbers and identifiers; the frontend writes the prose. i18n (PL/EN) is the next
roadmap item and an API that emits English strings would have to be redone. No exceptions, however
convenient.

```ts
type FindingKind =
  | 'category_moved'     // comparison: biggest mover present in both windows
  | 'category_new'       // comparison: spend where there was none
  | 'recurring_total'    // recurring: what active subscriptions cost per month
  | 'recurring_stopped'  // recurring: likelyCancelled — money that stopped
  | 'merchant_drip'      // merchants: many small purchases adding up
  | 'weekend_skew';      // patterns: weekendRatio far from 1

interface Finding {
  kind: FindingKind;
  severity: number;          // 0..1, for ranking only — do not render it
  currency: Currency;        // the scope's display currency
  data: Record<string, unknown>;  // per-kind, typed as a discriminated union
}
```

`GET /api/insights/summary` → `{ scope, currency, windowDays, findings: Finding[] }`, sorted by
severity descending, capped at `limit` (default 3, max 10).

## Scoring

One formula for every kind, so scores are comparable:

```
materiality = min(1, moneyAtStake / totalSpendInWindow)
surprise    = kind-specific, 0..1
severity    = sqrt(materiality * surprise)
```

The geometric mean is deliberate: something huge but unsurprising, and something startling but
trivial, both rank below something that is *both*. An arithmetic mean would let one term carry a
finding on its own.

`surprise` per kind:

| Kind | `moneyAtStake` | `surprise` |
|---|---|---|
| `category_moved` | `abs(current - previous)` | `min(1, abs(pct) / SURPRISE_PCT_FULL)` |
| `category_new` | `current` | `1` — categorically new |
| `recurring_total` | sum of `monthlyCost` | `RECURRING_BASE` (steady, not news) |
| `recurring_stopped` | `monthlyCost` of the stopped charge | `1` |
| `merchant_drip` | merchant `total` | `min(1, count / DRIP_COUNT_FULL)` |
| `weekend_skew` | `abs(weekendPerDay - weekdayPerDay) * weekendDays` | `min(1, abs(ratio - 1) / SKEW_FULL)` |

Constants block, with starting values and what each one does:

```ts
export const SCORING = {
  MIN_SEVERITY: 0.05,      // below this a finding is not worth a slot; fewer sentences beats filler
  MIN_MATERIALITY: 0.02,   // under 2% of window spend, drop regardless of how surprising
  SURPRISE_PCT_FULL: 50,   // a 50% move scores full surprise; larger does not score more
  RECURRING_BASE: 0.4,     // subscriptions are steady by nature — real money, low novelty
  DRIP_COUNT_FULL: 15,     // visits at one merchant for full "this adds up" weight
  SKEW_FULL: 0.8,          // weekend/weekday ratio 1.8 (or 0.2) is as skewed as it scores
  MIN_DRIP_COUNT: 5        // fewer visits than this is not a pattern
};
```

Returning **fewer than `limit`** findings, or none, is a correct outcome. A quiet month should say
nothing rather than pad with noise — the strip already renders nothing when the list is empty.

## Behaviour to preserve from today's strip

- Cancelled charges stay out of the "costs per month" figure; `totalPaid` still appears.
- `isNew` is re-derived after currencies are merged — a category new in one currency may not be new
  once combined.
- At most one `category_moved` and one `category_new`; the strip never listed every category.
- Window lengths are measured, not assumed equal (`previousDays` is computed separately).

## Frontend

`InsightsStrip` loses the whole `useMemo` that builds sentences. It fetches
`getInsightsSummary(scope)` and maps each finding to one `<p className="insight">`, formatting
numbers through `formatCurrency` and category slugs through the `categories` prop it already takes.

Delete `getInsightsComparison` / `getInsightsRecurring` from the strip — but keep them in `api.ts`;
they are a public part of the API and have their own tests.

## Tests

Hardcoded dates, no `new Date()`, as with every slice. Cover:

- ranking: a large-but-dull finding loses to a smaller startling one, and the geometric mean is what
  makes that happen (assert the ordering, not the float)
- `MIN_SEVERITY` and `MIN_MATERIALITY` each drop a finding on their own
- a 30% move on a category worth 0.5% of the window never appears
- `scope=primary` converts and combines; `scope=USD` neither converts nor includes other currencies
- every `FindingKind` can be produced by some fixture — a kind no fixture reaches is dead code
- an empty ledger and a quiet window both yield `findings: []`, HTTP 200
- the strip renders one `<p>` per finding and nothing at all for an empty list

## What shipped differently

Four deviations from the above, all in `models/insights.ts` and commented where they appear.

- **One finding per kind, not just one per comparison kind.** The spec caps `category_moved` and
  `category_new` at one each; the same rule now covers all six. Three sentences about three
  different things beat three about the same thing, and it makes the cap a rule rather than a
  special case for the two kinds that happened to need it first.
- **`merchants` and `patterns` run over the comparison's own window**, not their twelve-month
  default. `materiality` divides by what was spent in *this* window, so a year of coffees measured
  against a month of spending would score above 1 every time.
- **`weekend_skew` needs spend on both sides**, not just days on both sides. A window with nothing
  at all at the weekend gives a ratio of 0, which is a fact about how sparse the ledger is rather
  than about when this person spends — the same "cannot say" `getPatterns` already returns `null`
  for when a side has no days in it.
- **A currency with no FX rate is dropped from both sides of the ratio**, where the frontend's
  `convertAmount` returns 0. Zero is fine for a table cell; here it would leave the money in the
  denominator every other finding is measured against, quietly inflating all of them.

Plus one addition: `summary` takes an `anchor` like `/comparison` does, so an "as of" answer can be
pinned by a test instead of moving with the calendar.

## Definition of done

`npm run lint`, `npm run build`, `npm run test` green with output shown. Nothing under `data/`, no
`*.db`, no `.env*` staged. After this, insights is finished: five endpoints, one consumer, no
selection logic left on the client.
