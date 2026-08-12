# Fix: a finding must be measured over the window of the section it heads

A regression from wave 2, found by driving the demo after wave 4. **Not a new feature and not one of
the 28** — it is the contradiction the whole rebuild set out to remove, rebuilt in a new form.

Must land before the gallery: it sits in the first screenful of the boot screen.

## What is on screen

```
Weekends cost more — about 206,98 zł a day over the last 30 days,
                     against 88,77 zł on weekdays.
When you spend                        Last 12 months · 12 Aug 2025 – 12 Aug 2026
[ the weekday chart ]
```

Measured at the API on the demo ledger:

| | weekend/day | weekday/day | window |
|---|---|---|---|
| the sentence, from `/insights/summary` | 206,98 | 88,77 | **30 days** |
| the chart beneath it, from `/insights/patterns` | 186,47 | 66,94 | **366 days** |

The sentence is the heading of a chart that says something else.

**Two findings are affected, not one.** `weekend_skew` (from `patterns`) and `merchant_drip` (from
`merchants`) both quote `days: 30` while their sections render 366. `category_moved` and
`category_new` are fine — their section follows the page window too. `recurring_total` and
`recurring_stopped` are fine because they quote no window at all.

## Why it got through

The wave 2 spec required **every section to state its window**, and every section does. It never
required a **finding and the section it heads to share one**. Two rules that are each correct
collided:

- `/insights/summary` scores over the page window, because `materiality` divides by spend **in the
  window**.
- The habit sections use 12 months, because over 30 days a weekday has about four samples.

The report warned about exactly this outcome (R2): *"skipping it reproduces the current contradiction
(F10) on a single screen, where it would be worse."* It is worse — the disagreeing numbers are now
fifteen pixels apart rather than in two tabs.

## The fix

**Each finding is computed over its own natural window, and `materiality` divides by the spend in
that same window.**

- Comparison-derived findings (`category_moved`, `category_new`) keep the page window, as now.
- Habit-derived findings (`weekend_skew`, `merchant_drip`) are computed over the habit window — the
  same one their section renders — and their `days` reports it.
- `materiality = moneyAtStake / totalSpendInTheFindingsOwnWindow`.

That last line is the load-bearing one. `materiality` means *what share of your spending is this*,
and a share is only meaningful measured in the frame the finding was measured in. Dividing a
twelve-month merchant total by thirty days of spending is what produced scores above 1 in the first
place — the very failure R2 names. Scoring each finding as a share of its own window keeps every
score in 0..1 and keeps them comparable, because they are all shares.

`getSummary` therefore needs the window total twice — once per window. At single-user scale that is
one extra aggregate.

## The alternative, and why not

Letting the **frontend** fill each sentence's numbers from the payload its section already fetches
is cheaper and needs no backend change. It is rejected because it fixes the numbers and not the
ranking: a weekend skew present over 30 days but absent over 12 months would still be *selected*,
and the sentence would then claim something the chart under it visibly contradicts. Wrong numbers are
better than a wrong claim.

## The invariant, and a test that pins it

State it in `models/insights.ts` beside `SCORING`:

> **A finding's stated window is the window of the data its section renders.** A finding that heads a
> section it was not measured over is a caption for a different chart.

Test it as an invariant rather than case by case, so a seventh finding kind cannot reintroduce it:

- For every `FindingKind` the scorer can emit, the `days` it reports equals the window of the
  analysis it came from. Findings that quote no window are exempt, and the test says which those are
  rather than skipping silently.
- On a fixture where the two windows disagree, `weekend_skew` reports the habit window's numbers, not
  the page window's.
- `materiality` for a habit finding divides by habit-window spend: a merchant worth 10% of twelve
  months does not score as though it were 10% of thirty days.
- A frontend case: the sentence heading a section and the section's own window label state the same
  period.

## Definition of done

`npm run lint`, `npm run build`, `npm run test`, output shown. **Both previews clicked through**, and
the specific check is that the weekend sentence and the chart under it now agree — this defect was
invisible to the suite and visible in one screenshot. Nothing under `data/`, no `*.db`, no `.env*`
staged.
