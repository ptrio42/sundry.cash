# UX rebuild — waves 0 and 1

Implements the first two waves of `docs/ux-review-findings.md`. Read that report first: it is the
reasoning, this is the work order. Findings are cited as F-numbers and changes as their numbers from
the report's §3.

**Nothing may be added to the report's list of 28 changes.** Anything discovered along the way goes
on a follow-up list, not into this batch. That rule is the only thing that makes "everything before
publication" finish.

## Two deliberate departures from the report's §8 sequencing

Both were decided after the report, and the reasons are worth keeping:

1. **The shared currency-scope control is extracted in wave 0**, not in the report's step 5. Steps
   for Home, Expenses and Budgets all want it; in the report's order they would each be built with
   the old controls and retrofitted — which is how F9 (four controls, four behaviours) happened in
   the first place.
2. **Routing lands in wave 1 with the navigation shell**, not last. The report defers it because
   "the route table must match the final navigation" — that condition is satisfied once wave 1 fixes
   the navigation, and every later session then gets working URLs to test with.

## Verification, both waves

`npm run lint`, `npm run build`, `npm run test`, output shown. Then **click through both preview
instances** — this is part of done, not a nicety:

```
preview_start  demo-preview    # :5175, seeded ledger
preview_start  empty-preview   # :5177, empty ledger — first-run states are being designed here
```

---

# Wave 0 — things that are simply wrong

One session, serial. No design decisions in this wave: every item is a defect or a no-op refactor.

## 0.1 The weekend sentence contradicts the Insights tab (F10, change 19)

`InsightsStrip.tsx:95` destructures `{ weekendPerDay, weekdayPerDay, ratio }` from a payload that
also carries `days`, and never renders it. Its five sibling templates all print `${days}`
(`category_moved` at :66, `category_new` at :71, `merchant_drip` at :90). Result: the strip says
"about 206,98 zł a day" over 30 days while the tab says 197,21 zł over 366, with no window on either
sentence to explain the difference.

Add `days` to the destructure and render it in **both** branches (`ratio > 1` and the weekday case).

**Do not unify the two windows.** The report rules on this (R3, and §4 R2): `/insights/summary`
scores over 30 days because `materiality` divides by spend *in the window*, and a year of coffees
measured against a month of spending scores above 1 every time; `/insights/patterns` needs 12 months
or a weekday has ~4 samples. They measure different things deliberately. The defect is the missing
label, not the difference.

## 0.2 "Last 30 Days" returns 31 days including this month (F2, change 20)

`Analytics.tsx`, `getDateRange('month')` does `start.setMonth(now.getMonth() - 1)`. On 11 August that
is 11 Jul – 11 Aug: 31 days, a third of them in the current month. Verified live — with the preset
active the same screen prints "31 days".

- Make the preset mean 30 days.
- Add a **calendar month** option, because "last month" is currently unanswerable anywhere in the
  product and Custom Range demands two typed dates and knowing when July ended.
- The day count printed in the tile subtitle must agree with the preset label.

## 0.3 A new user is shown a large red negative for having started (F4, §9)

`Budgets.tsx:131-133`: `totalBudget = 0` when no limits are set, so `remaining = −totalSpent`, and
`:170` colours it `--danger`.

Verified: an empty install reads `Remaining $0.00` in green; the red `−$250.00` appears **the moment
the first expense is saved**. It fires on the first thing a new user does.

When `totalBudget === 0`, the Remaining tile renders a neutral placeholder and keeps the existing
"set a limit below" hint. Do not compute a negative against a budget that does not exist.

## 0.4 Nine text roles below WCAG AA (F14, change 22)

`--text-dim` is `#6b7480` — **3.36:1** on `--surface-2`, **3.65:1** on `--surface`. It has exactly
**nine** uses in `App.css` (stat subtitles, category bar stats, field hints, pagination count, input
placeholders, …) and fails in all of them.

Delete the token and point all nine at `--text-muted` (`#9aa3b2` dark, `#5c6675` light). This is one
token fewer, not one more — the report's net token change across all 28 recommendations is −1.

## 0.5 The light theme is unfinished (F14, change 23)

`:root[data-theme='light']` overrides twelve variables — including `--text-dim` — but **not**
`--accent`, `--danger`, `--info`, `--warning` or `--violet`. Consequence: the active navigation
label renders at **1.92:1** on white.

Add light-theme values for the four semantic colours. `--violet` too if it carries text.

## 0.6 The Wipe Database confirm button is the least legible text in the product (F14, change 24)

`.btn-danger` is white on `--danger` `#f87171`: **2.77:1**. It is the confirm control on the only
irreversible action in the app. Give it a dark foreground.

## 0.7 The donut legend fails ten out of ten labels in light mode (F14, change 25)

`Dashboard.tsx:240` sets `style={{ color: color(entry.category) }}` on the legend item **and**
renders a colour swatch. The rule against exactly this is already written at `App.css:654`: *"the
colour is user data and one value has to work on both themes … carried by a swatch rather than by
the text colour"*.

Stop colouring the text. Keep the swatch. (The donut itself is replaced in wave 2; this fix is for
the interim and the pattern outlives it.)

## 0.8 Extract one currency-scope control — no behaviour change

Four screens render a currency control and no two agree (F9). `Fx`, `Dashboard`, `Analytics`,
`Budgets`, `Insights` and `ExpenseTable` all touch this; `Dashboard` derives `presentCurrencies`
itself while `Budgets` calls `relevantCurrencies(...)` with a different input set, and Budgets offers
no "All" at all.

Extract a single `CurrencyScope` component into `frontend/src/components/`, taking the currencies to
offer and the current scope, emitting the new one. **Behaviour must not change in this wave** —
each screen keeps the option set it has today. The wave that owns each screen switches it to the
shared option set.

The point is to have one implementation before three screens are rebuilt against it, not to fix F9
yet.

**Do not unify the plumbing underneath** (report R5): the strip refetches per scope because ranking
across currencies requires converting before scoring, while the Insights tab scopes client-side
because it only displays per-currency lists. Same control, same options, different mechanics — as
today.

---

# Wave 1 — the navigation shell

One session, serial. **This session is the sole owner of `App.tsx`.** It exists so that later waves
work inside a single screen each and never contend for this file.

The screens behind the new destinations are, for now, **the existing components unchanged**. "Home"
renders today's Dashboard. That intermediate state is expected and must be working and green.

## 1.1 Four destinations plus one persistent action (report §2)

```
Desktop sidebar            Mobile bottom bar
  Sundry                   [ Home ] [ Expenses ] ( + ) [ Budgets ] [ Settings ]
  [ + Add expense ]        the + is a raised centre button, not a tab
  Home
  Expenses
  Budgets
  Settings
  ──────────
  Light / Dark
```

- **No "More" sheet.** Five slots, five things; the overflow existed because ten items did not fit.
- Nav labels and page titles must agree. Today four disagree: Import Excel → "Import from Excel",
  Budgets → "Monthly Budgets", Currencies → "Currency Conversion", Settings → "Preferences" (F12).
- Normalise the mobile bar's accessible names: four tabs set `aria-label` to a long form while
  rendering a short one, the fifth relies on its content (report R6). One strategy, not two.

**Mapping while the screens are still the old ones:** Home → `Dashboard`; Expenses → `ExpenseTable`;
Budgets → `Budgets`; Settings → `Settings`. `Analytics`, `Insights`, `Fx`, `ExcelImport`,
`ReceiptScan` and `ExpenseForm` lose their nav entries in this wave and are reached from within their
new homes in waves 2–4. **Do not delete those components** — later waves move them.

Until wave 3 builds the Add sheet, "+ Add expense" opens `ExpenseForm` as it is today. Keep the
placement final and the content temporary; do not invent an interim sheet that wave 3 throws away.

## 1.2 Wipe Database leaves primary navigation (F15, change 15)

It sits in the sidebar footer in red, next to the theme toggle, and one row below "Light mode" on
mobile. Move it to a danger zone at the bottom of Settings. Keep both confirmations.

Red currently means three different things — "irreversible", "over budget", "spending rose". Taking
the permanent one out is what lets the other two read as signal.

## 1.3 The tagline becomes a status line (F18, change 16)

`App.tsx:420` renders "Track your spending, stay on budget" under every page title, unconditionally,
on all ten screens. It pitches a budgeting app; the product's thesis is noticing. It never carries
information and costs ~22px everywhere.

Replace it with a per-screen line stating **what you are looking at and over what period**. Where a
screen has no window yet, it states the scope it does have. Wave 2 fills in the real windows.

Delete card titles that echo the page title one line above ("All Expenses" / "All Expenses") —
change 28's second half.

## 1.4 Routing (F13, change 17)

There is no router: the URL never changes, reload always lands on the blank Add Expense form, back
leaves the app, nothing is bookmarkable or shareable.

- One route per destination. Hash or a small `pushState` hook — **no router dependency**, in a repo
  that deliberately has no state library and no router (CLAUDE.md).
- Browser Back moves between destinations; on mobile it closes the Add sheet rather than leaving.
- Reload returns to the destination you were on.
- Filter and scope parameters come later, with the screens that own them. Do not build a parameter
  scheme for filters that do not exist yet.

**Do not change the boot destination in this wave.** The report is explicit and it is right: flipping
the app to open on Home is worthless until Home is worth opening. It happens at the end of wave 2.

## Tests

Extend the existing suites rather than adding a parallel structure.

- `App.test.tsx`: four destinations render; the removed entries are absent; Wipe Database is not in
  the nav; the tagline is gone and a status line is present.
- Routing: each destination sets its URL; a reload at that URL renders that destination; Back returns
  to the previous one.
- Mobile: five slots, no overflow sheet, one accessible-name strategy.
- Wave 0's fixes each get a case: the weekend sentence contains its window; "Last 30 Days" reports 30;
  `totalBudget === 0` renders no negative; `.btn-danger` and the light-theme tokens are asserted at
  the CSS level if the suite already has a pattern for that, otherwise verified in the browser pass
  and noted in the PR.

## Definition of done

Lint, build and tests green with output shown. Both preview instances clicked through, including the
empty one. Nothing under `data/`, no `*.db`, no `.env*` staged. The intermediate state — new shell,
old screens — is fully working; no destination is a dead end.
