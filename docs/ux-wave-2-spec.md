# UX rebuild — wave 2: Home

Wave 2 of `docs/ux-review-findings.md`. Read the report first, and §4 R1–R3 in particular: this wave
is where its rulings are cashed in.

The largest wave, and the only one that touches the backend. Waves 0 and 1 are merged: the shell
has four destinations, routing works, and **Home currently renders today's Dashboard unchanged**.

**Nothing may be added to the report's list of 28 changes.** Anything found along the way is
recorded at the bottom of this file, not built.

## What this wave does

Merges `Dashboard` and `Insights` into one screen and makes the findings the headline rather than a
notice box. Today's split is organised by technique — overview, query, ranking — and the report's
F3 is that a user has no basis for choosing between them. Both of them also render the same category
decomposition, twice.

Afterwards, "what am I missing?" is the first thing on the first screen, which is the point of the
whole exercise: it is the question competitors cannot answer and Sundry buries it at nav item seven.

## The single most important detail: two clocks, both stated

This is ruling R2 and skipping it reproduces the current contradiction (F10) on a single screen,
where it would be worse.

A page-wide window control is **wrong** here, and it is worth knowing why so nobody simplifies it
back:

- Forcing the habit sections to 30 days leaves about four samples per weekday, and the merchant list
  goes thin.
- Forcing the spending sections to 12 months breaks scoring: `materiality` in `models/insights.ts`
  divides by spend **in the window**, so a year of coffees measured against a month of spending
  scores above 1 every time.

So Home carries two:

| Sections | Window |
|---|---|
| Headline, Where it went, Budget exceptions | the **page window** control: `Last 30 days · This month · Last 12 months`, default 30 days |
| Subscriptions, Where you shop, When you spend | their **own longer window**, printed in the section header |

**The governing rule: every section states its window.** Sections following the page control say so
once, at the top. The Insights tab already does this correctly at `Insights.tsx:317` and `:368` —
keep that behaviour and extend it.

This also resolves F1, where four tiles are all-time and say so nowhere while a chart beside them
plots one month.

## Backend — the only change

`/insights/summary` takes `scope`, `limit` and `anchor`. Add **`period`** and **`window`**, with the
same values and defaults `/insights/comparison` already accepts (`week|month|year`,
`rolling|calendar`, default rolling month). The scoring is unchanged; only the window it scores over
becomes a parameter.

Validation goes through the same helpers as the sibling routes, and `CurrencyModel.exists` rather
than `isEnabled` — a summary of history in a since-disabled currency is still answerable.

## Home, section by section

Order matters: this is the reading order, and it is the product's argument.

Every section **renders nothing when it has nothing to say** — the same progressive disclosure the
dashboard already applies to absent currencies. A section that shows an empty box costs more than one
that is not there.

### 1. Headline

> You spent **4 812 zł** in the last 30 days · ≈160 zł/day · **12% more** than the 30 before

One sentence, largest type on the page. It answers "is this more than usual, overall?", which today
is only ever answered per-category.

This is the slot the **decided** "typical monthly income" number later fills ("46% of a typical
month") — and the only place it will appear. Do not build an income screen or a savings-rate chart;
the report refuses both explicitly (§5).

### 2. Where it went — replaces the donut *and* Analytics' bars

Categories ranked by amount: name, amount, share, and change against the previous window. Top 6 plus
"everything else".

The donut goes (change 27). Ranked bars keep every number, add the delta the donut could not show,
and stop spending resolution on slices thinner than their own padding gap. Delete the centre total
too — it repeats the headline at a second rank 130px away (change 28).

### 3. Budget exceptions — only when there are any

> Groceries 12% over with 9 days left · 1 close · 5 on track

Answers "did I blow anything?" without a trip to Budgets. Renders nothing when no limits are set —
which is also the state that used to produce a large red negative.

### 4. Subscriptions · 5. Where you shop · 6. When you spend

The Insights tab's existing blocks, moved intact. They already carry their own windows and state
them; keep that.

`When you spend` takes the weekday bars **and** the 13-week heatmap — both answer "when", and the
heatmap ramp moves to a p90 anchor so ordinary days stop collapsing into three identical greens
(change 27).

## Findings become section headlines

`/insights/summary` stops filling a callout box. Each finding it returns becomes **the heading of the
section that proves it**: the weekend claim above the weekday chart, the category mover above the
category list, the stopped subscription above the subscriptions table.

One claim, one place. A box at the top repeating three of the page's own sentences would duplicate
*itself* — which is exactly what R3 rules against.

**At most one section may be promoted** directly under the headline, when its finding scores far
above the rest. That is the only reordering allowed; otherwise the order above is fixed.

`InsightsStrip.tsx` is therefore deleted as a component. **The scoring is not** — `/insights/summary`
keeps ranking, and the sentence templates it holds (the only place in the app that writes prose about
money, and where PL/EN will branch) move to where the headings are rendered. Do not lose the comment
explaining why the API refuses to emit sentences.

## Type hierarchy (change 26, F6)

Measured today: a stat value is **27.2px/700** and outranks the page `h1` at 24px, while a finding
sentence is **14.72px/400** — the only text on the screen with neither weight nor colour of its own.
The thing doing the outranking is `662`, an integer with no unit, window or action.

- Finding sentences → **22.4px / 600**
- Stat values → **20px / 700**

This is not a legibility fix. The sentence already measures 13.11:1 against its panel; it is easy to
read and easy to skip, and only the second matters.

**No design system, no token overhaul.** The report considered one and refused it (§5): the reading
failure is on one screen and costs two changed declarations.

## Empty Home — no tour

A single Start card: **Import a spreadsheet** (inline picker) · **Add your first expense** · *"See it
with 18 months of sample data →"* linking to the public demo instance.

**No in-app seeding.** `backend/src/scripts/seed.ts` refuses unless `DB_PATH` is set explicitly, is
not the real ledger, and the ledger is empty. That guard protects a real ledger; a button would have
to weaken it.

Sections then appear as data earns them, which the components already do.

## Last: flip the boot destination

`BOOT_DESTINATION` in `App.tsx` becomes `'home'`.

**Do this at the end of the wave, not the start.** The line is worthless before Home is worth
opening, and it is the one change that alters what every user sees first.

## What is deleted, what survives

- **Deleted:** `Dashboard.tsx`, `Insights.tsx`, `InsightsStrip.tsx` → one `Home.tsx`. `Analytics.tsx`
  survives untouched — wave 3 folds it into Expenses, and it has no nav entry until then.
- **Their suites move rather than vanish.** `Dashboard.test.tsx`, `Insights.test.tsx` and
  `InsightsStrip.test.tsx` become `Home.test.tsx`; every assertion that still describes behaviour
  Home has must survive the move. Currency scoping, conversion into the primary currency, the
  single-currency default, and each sentence template are all still real.
- `CurrencyScope` (wave 0) is the control. Home is the first screen allowed to switch to the shared
  option set rather than keeping its own.

## Tests

- Every section renders from its payload, and is absent when that payload is empty.
- **Each section states a window**, and the habit sections state a different one from the page — the
  regression that F1 and F10 were.
- The page window control moves the spending sections and **not** the habit sections.
- A finding renders as its section's heading, not as a separate box.
- Promotion: the top-scoring section moves under the headline; the rest keep their order.
- Empty ledger renders the Start card and no sections, and issues no `/insights` requests.
- `/insights/summary` accepts `period` and `window`, rejects unknown values, and defaults to a
  rolling month (backend suite).
- Type: assert the rendered classes, not pixel values — the CSS is not under test, the ranking is.

## Definition of done

`npm run lint`, `npm run build`, `npm run test`, output shown. **Both previews clicked through** —
`demo-preview` (:5175) and `empty-preview` (:5177); the empty one is where the Start card lives.
Nothing under `data/`, no `*.db`, no `.env*` staged.

## Follow-ups found while implementing — not in this batch

*(add here; do not build them)*
