# Insights tab — implementation spec

Five endpoints compute a great deal; three sentences reach the screen. `comparison` returns every
category × currency with deltas and counts, `recurring` returns every detected subscription with its
cadence and lifetime total, `merchants` returns up to twenty per currency, `patterns` returns seven
weekday buckets — and the frontend calls exactly one function, `getInsightsSummary`. `merchants` and
`patterns` do not even have clients in `api.ts`.

This adds the screen that shows the rest.

## What does not change

**The strip stays.** The argument it was built on still holds: an insight you have to navigate to is
an insight nobody reads. Three sentences at the top of the Dashboard are seen whether or not anyone
goes looking. The tab is a different job — for when someone *does* want to dig — and it does not
replace them.

The header comment in `InsightsStrip.tsx` says a fifth tab "would cost more than it gives". Two
things about it are now wrong: there are already nine tabs, not four, and the reasoning it applies
to the strip does not extend to a detail view. Correct the comment rather than leaving a stale
argument in the file.

## Insights is not Analytics

They will look adjacent, so state the split in both files and keep it:

| | Answers | Driven by |
|---|---|---|
| **Analytics** | "how much did I spend on X between A and B?" | the user's filters |
| **Insights** | "what should I know that I did not ask about?" | the data |

Analytics has period and category pickers. **Insights has no filter wall** — at most the currency
scope. If a block needs the user to configure it before saying anything, it belongs in Analytics.

## Missing API clients

`api.ts` has `getInsightsComparison`, `getInsightsRecurring` and `getInsightsSummary`. Add
`getInsightsMerchants` and `getInsightsPatterns`, matching the existing shape (build the query with
`URLSearchParams`, go through `apiFetch`, no inline `fetch`).

## Currency scope — deliberately unlike the strip

Reuse the **Dashboard's** pattern: currency buttons for the currencies present in the data, plus a
combined "All → primary" view, converting client-side with `convertAmount`.

This differs from the strip on purpose. The strip moved scope to the server because ranking a PLN
finding against a USD one requires converting *before* scoring. The tab displays per-currency lists
and totals — the same thing the Dashboard already does client-side. Do not add `scope` to the four
data endpoints for this.

**One caveat to handle rather than ignore:** `merchants` returns the top N *per currency*. Merging
several currencies client-side and re-ranking gives an approximate list, because a merchant that
placed 21st in PLN was already dropped server-side. In the combined view, request a larger `limit`
(the endpoint allows up to 100) and, if the response still reports `truncated`, say so in the UI —
a silently short list reads as a complete one.

## The four blocks

Each answers one question, and **renders nothing when it has nothing to say**. Same progressive
disclosure the Dashboard already uses for absent currencies; an empty block is worse than no block.

### 1. Subscriptions — from `recurring`

The most actionable data in the product and currently invisible. A table: what repeats, cadence,
median amount, **monthly cost**, **total paid since it started**, first and last seen.

- Separate the active from the `likelyCancelled`; the stopped ones are a second, quieter list.
- Sum the active monthly cost as a header figure — that number is the reason someone cancels
  something.
- `amountStability: 'variable'` deserves a marker: a subscription whose price moves is worth a look.

### 2. Where the money goes — from `merchants`

Ranked by total, per currency. Two columns that matter beyond the total: **count**, and the average.
Flag the "drip" case — many small purchases with a large total — since that is the spend people do
not notice. `SCORING.MIN_DRIP_COUNT` already defines what counts as many; reuse it rather than
inventing a second threshold.

### 3. When you spend — from `patterns`

Seven bars, one per weekday, using **`perDay`, not totals** — the endpoint already returns both, and
totals would make weekdays win five to two on an even spread. Beside them, weekend vs weekday per
day and the ratio. Say nothing when `weekendRatio` is null or near 1.0.

### 4. What changed — from `comparison`

The full table the strip only ever shows one row of: every category, current window against
previous, delta and percentage, both windows labelled with their dates. Sort by absolute delta.
`deltaPct: null` renders as "new", never as "—" or "0%".

## Layout

Stacked blocks, one column, in the order above — subscriptions first because it is the one that
makes someone act. Reuse the existing card/table styling from `App.css`; no new visual language.
Charts through **recharts**, already a dependency and already used by Dashboard and Analytics.

## Tests

`frontend/src/tests/Insights.test.tsx`, in the style of the existing component suites (mock
`../services/api`, assert on rendered output, hardcoded fixtures and dates):

- each block renders from its endpoint's payload, and is absent entirely when that payload is empty
- subscriptions: active and cancelled are separated; the header total counts only the active ones
- merchants: `truncated: true` surfaces a visible caveat rather than a silently short list
- patterns: the bars read from `perDay`; a ratio near 1.0 produces no weekend/weekday claim
- comparison: a category with `deltaPct: null` renders as new, not as a zero
- currency scope: switching to a native currency neither converts nor includes other currencies
- a failing endpoint degrades that block only — the tab must not go blank because one call 500s

## Definition of done

`npm run lint`, `npm run build`, `npm run test` green with output shown. The Dashboard strip is
unchanged in behaviour. Nothing under `data/`, no `*.db`, no `.env*` staged.

**Coordination:** a demo-hardening session may be running in a separate worktree and owns
`App.tsx`'s banner and tab-visibility logic. This work also edits `App.tsx` (one nav entry, one view
mount). Keep those edits minimal and expect to resolve that file by hand. Do not update the test
counts in `CLAUDE.md` — they are reconciled once, after the parallel branches merge.
