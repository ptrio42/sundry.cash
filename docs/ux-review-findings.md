# UX / information-architecture review — findings and proposal

Answers `docs/ux-review-brief.md`. **This is a proposal, not code.** Nothing in the application was
changed. Implementation follows as a separate, reviewed spec.

Reviewed against the seeded demo instance (`demo-preview`, 662 expenses, 18 months, "today" =
2026-08-11), then cross-checked against source. Four independent perspectives were run — information
architecture, first-time user, advocate for the thesis, visual craft — and every load-bearing claim
below was verified a second time before it was written down. Where the perspectives disagreed, the
disagreement is stated and a recommendation is given rather than an average.

**The criterion throughout is *less thinking per task*, not *fewer things*.** Every addition carries
the question it answers that nothing today answers. Additions that could not carry that sentence were
dropped, and the ones that were deliberately refused are listed at the end.

---

## 0. The one-paragraph version

Sundry's machinery already answers the question its competitors cannot — *what am I missing?* — and
the product renders that answer in the smallest, lightest type on the page, seventh in a ten-item
menu, two taps deep on a phone. Meanwhile the screen that greets you is a blank form, and the numbers
printed largest on the overview are an all-time total and a **count of rows**, neither of which says
what period it covers. The fix is not to remove features. It is to reorganise four screens around the
four questions the product exists to answer, state every window on screen, and let the findings be the
headline rather than a notice box. One addition is genuinely unavoidable (a URL per view); the rest is
re-shelving, plus a handful of one-line corrections to things that are simply wrong.

---

## 1. Findings, ranked by how much thinking they cost

Rank is thinking-cost × likelihood, not severity in the abstract. "Confidently wrong" ranks above
"confused", because a user who pauses recovers and a user who is misled does not.

### F1 — Three time windows on one screen, one of them labelled *(produces wrong answers)*

The Dashboard's four tiles (`TOTAL SPENT 65 048,41 zł`, `EXPENSES 662`, `AVERAGE`, `LARGEST`) are
**all-time** and say so nowhere. Immediately beside them "Trend by Category" plots about one month;
below, the heatmap says "last 13 weeks"; the strip at the top scores over 30 days. Only the heatmap
states its window.

Verified: the tile total equals the Currencies screen's "all currencies combined" figure, and the
count equals every row in the database. Four blocks share identical card chrome, which asserts they
share a frame of reference. They do not.

**Cost:** the most likely single failure in this review is a user accepting `65 048,41 zł` — or the
donut beside it — as the answer to "where did my money go last month". No pause occurs, so no
recovery occurs.

### F2 — "Last month" cannot be answered anywhere in the product

- **Budgets** shows the current month only. `currentMonthKey()` is computed from `new Date()` and no
  control can change it. Asked as posed, job three **fails**.
- **Analytics** offers Last 7 Days / Last 30 Days / Last Year / Custom Range — no calendar month. And
  "Last 30 Days" is mislabelled: `getDateRange('month')` does `setMonth(now.getMonth() - 1)`, so on
  11 Aug it returns **11 Jul – 11 Aug — 31 days, a third of which is this month**. A user who picks the
  obviously-correct preset gets a wrong answer to a right question.
- The only correct path is Custom Range, which requires two typed dates and knowing when July ended.

**Note for the spec:** budgets have **no month dimension** — `/api/budgets` returns a flat set of
`{category, currency, amount}` standing limits. Showing a past month is therefore a frontend change
(compare that month's spend against the current limit), but the screen must say so: "compared with
your current limits". That caveat is the price of the feature and must not be dropped.

### F3 — Dashboard / Analytics / Insights: three destinations, no basis for choosing

Organised by technique (overview / query / ranking) rather than by question. The cost is paid before
any work starts, on every visit. The overlap is real, not aesthetic: the Dashboard's donut and
Analytics' bars are the same decomposition rendered twice, and the two stat-tile sets are near-identical
but differ just enough to make you check — Dashboard has `LARGEST`, Analytics has `AVERAGE PER DAY`;
one says `EXPENSES`, the other `TOTAL EXPENSES`.

### F4 — Budgets never states a verdict

Answering "was anything blown?" means scanning ten cards, **six of which have no limit set** and still
occupy full height around an empty "No limit" box. In the demo nothing is over — and **no element on
the screen says so.** The user does the work and receives an absence rather than an answer. Nothing
compares spend against pace either: 43% used on day 11 of 31 is about 7 points ahead of the calendar,
and no pixel says it.

### F5 — The differentiator is the least reachable thing in the product

"What am I missing?" is the fourth question and the reason Sundry is not a budgeting app. Its machinery
— subscriptions totalling 554,89 zł/month, a stopped gym membership with 1192 zł paid, Żabka at 102
purchases averaging 15,96 zł — lives at nav item **7 of 10** behind a lightbulb, and on mobile inside a
"More" sheet, **four rows above a red "Wipe Database"**. The lightbulb is also the icon products use for
hints about themselves, so the label reads as *help*.

### F6 — The type hierarchy is the thesis stated backwards

Measured in the live DOM and confirmed in `App.css`:

| element | computed |
|---|---|
| `.summary-card .value` (stat tile number) | **27.2px / 700** |
| `.topbar h1` (page title) | 24px / 700 |
| `h3` (card title) | 16.8px / 700 |
| **`.insights-strip .insight` (the finding)** | **14.72px / 400** |

Two consequences. The stat value **outranks the page H1** — and the thing doing it is `662`, an integer
with no unit, window or action. And the finding sentence is the only element on the Dashboard with no
weight and no colour of its own: every other text role was deliberately styled; the sentences were the
one thing nobody ranked.

This is **not** a legibility problem. The sentence measures **13.11:1** against its panel — the
highest-contrast text on the screen. It is easy to read and easy to skip, and only the second matters.

### F7 — Saving an expense throws you out of the screen you are in

`App.tsx:193` does `setCurrentView('table')` on success. No toast, no highlight, no "saved" — the only
evidence of success is that the app moved you. The new row is prepended but nothing marks it. There is
no "save and add another", so a second entry costs a navigation.

Small per instance; it fires on the most frequent action in the product, roughly twenty times a week.

### F8 — Analytics asks you to configure before it says anything

Roughly 450px of controls before the first number: Time Period, **11 category checkboxes all checked by
default**, Currency. All-checked means the largest control on the screen is doing nothing on arrival —
100% setup cost, 0% information. This is the founding complaint ("too much setup before it was useful")
reproduced verbatim.

### F9 — The currency control is different on all four screens that have one

| screen | options |
|---|---|
| Dashboard | All → PLN, BTC, EUR, PLN |
| Insights | All → PLN, BTC, EUR, PLN |
| Analytics | All Currencies, BTC, EUR, PLN, **USD** |
| Budgets | BTC, EUR, PLN, USD — **no "All" at all** |

Dashboard and Insights hide currencies absent from the data; the other two do not. And Budgets is
**silently single-currency**: it filters `if (e.currency !== currency) continue`, so `BUDGETED 3250,00 zł`
is the PLN slice, not the budget. A user reasonably reads an all-clear that covers one currency and four
of ten categories. Separately, "All → PLN" sits beside "PLN" and the difference (converted-and-combined
vs native-only) must be inferred.

### F10 — The app contradicts itself about weekends *(one unrendered field)*

- Dashboard strip: *"Weekends cost more — about **206,98 zł** a day, against **88,77 zł** on weekdays."*
- Insights tab: *"Weekends cost more — **197,21 zł** a day against **90,79 zł** — a ratio of 2.17×"*

Verified at the API: `/insights/summary` returns `windowDays: 30`; `/insights/patterns` defaults to
**366 days**. Two windows, same claim.

**The cause is one line, not a design flaw.** `InsightsStrip.tsx:95` destructures
`{ weekendPerDay, weekdayPerDay, ratio }` and never `days` — although `days` **is** in the payload
(`expense.types.ts:264-269`) and every sibling case renders it (`category_moved:66`, `category_new:71`,
`merchant_drip:90` all print `${days}`). The tab labels its own window at `Insights.tsx:317` and `:368`.
So one of six sentence templates silently drops a field it is handed, and it is precisely the one that
disagrees.

**The two windows must not be unified.** Moving the strip to 12 months breaks its scoring —
`materiality` divides by spend *in the window*, so a year of coffees measured against a month of
spending scores above 1 every time. Moving the tab to 30 days leaves ~4 samples per weekday. They
measure different things on purpose; the requirement is that each says which.

### F11 — On Budgets, the number you read and the control that destroys it are the same widget

The limit is an input that **saves on blur**, and `saveDraft` (`Budgets.tsx:100-101`) treats a blank,
NaN or ≤0 value as *delete the budget* — no confirmation, no undo. Clicking into a figure to read it
closely is one stray keystroke away from silently removing the limit.

### F12 — Two destinations answer to the word "currencies"

Nav **Currencies** opens a page titled **"Currency Conversion"** — an FX-rate editor. **Settings**
(titled **"Preferences"**) contains **its own "Currencies" section** for enabling and disabling them,
plus "Show all 60 currencies". Which one is right depends on knowing the implementation split between
rates and availability. A user concludes from the Fx screen that the app supports exactly four
currencies.

Nav labels and page titles also disagree in four places: Import Excel → "Import from Excel",
Budgets → "Monthly Budgets", Currencies → "Currency Conversion", Settings → "Preferences".

### F13 — Nothing is addressable

There is no router. The URL never changes; **a reload always lands on the blank Add Expense form**,
whatever you were doing. No back button, no bookmark, no deep link, no shareable state. On mobile,
browser Back leaves the app rather than closing the More sheet.

### F14 — Contrast failures, including on the most destructive button in the product

All ratios computed from the actual hex values and independently reproduced.

| text | on | ratio | AA |
|---|---|---|---|
| `--text-dim` `#6b7480` | `--surface-2` `#1e222b` | **3.36:1** | **FAIL** |
| `--text-dim` `#6b7480` | `--surface` `#171b22` | **3.65:1** | **FAIL** |
| `.btn-danger` `#ffffff` | `--danger` `#f87171` | **2.77:1** | **FAIL** |

`--text-dim` carries **nine** text roles (stat subtitles, category bar stats, field hints, pagination
count, input placeholders, …) and fails in every one. `.btn-danger` is the **confirm button on the Wipe
Database dialog** — the most consequential control in the product is its least legible text.

**Light mode is unfinished.** `:root[data-theme='light']` overrides `--text`, `--text-muted`,
`--text-dim`, `--accent-contrast` and `--accent-soft`, but **not** `--accent`, `--danger`, `--info`,
`--warning` or `--violet`. So the active nav label renders at **1.92:1** on white and every donut legend
label fails: gifts `#a3e635` at **1.51:1**, ten of ten below AA.

That last one is self-inflicted and the codebase already knew: `App.css:654` states *"the colour is user
data and one value has to work on both themes, so it is carried by a swatch rather than by the text
colour — a hue picked to read on the dark surface would fail contrast on the light one."*
`Dashboard.tsx:240` then sets `style={{ color: color(entry.category) }}` on the legend `<li>` **and**
renders the swatch. The rule is written down 400 lines from the code that breaks it.

### F15 — A destructive action is in primary navigation

"Wipe Database" sits permanently in the sidebar footer in red, adjacent to the theme toggle, and on
mobile one row below "Light mode". It is guarded by two `window.confirm`s, which you learn only by
clicking. Keeping it always-on in the same hue that means "over budget" and "spending went up" trains
the eye to discount red on the two screens where red is a signal.

### F16 — The overview leads with what is easy to compute

`TOTAL SPENT`, `EXPENSES` (a count), `AVERAGE`, `LARGEST`. A row count is not a fact about money, an
arithmetic mean over mixed categories is not actionable, and a maximum is a single outlier. They occupy
the largest type on the screen and the band directly under the fold-line.

### F17 — Scan Receipt and Import Excel are destinations holding one file input each

Two of ten nav slots — 20% of the navigation — for a single file picker apiece. Meanwhile Import's
mirror image, **Export, is two buttons inside the All Expenses card header**. Same job, two levels of
hierarchy. Mobile had already worked out that this is wrong, promoting Scan into the bottom bar while
burying Insights.

### F18 — The tagline pitches a different product, on all ten screens

`App.tsx:420` renders "Track your spending, stay on budget" unconditionally under every page title.
That is a budgeting app's line, on a product whose thesis is noticing. It never carries information
and costs ~22px on every screen.

### F19 — Locale by accident

Amounts are locale-by-*design*: `formatCurrency` reads `info.locale` from the currencies table, so
`65 048,41 zł` is correct. Dates are locale-by-*accident*: `formatDate` calls
`Intl.DateTimeFormat(undefined)`, which falls back to the host OS locale — hence "8 lip",
"sierpień 2026", "15 sie 2025" in an English UI. Low cost to read (dates stay short and sort correctly),
high cost in every screenshot of a product pitched as finished. Already on the backlog; it belongs
before any public asset ships, not before the hierarchy work.

### F20 — Small, cheap, real

- Card titles echo page titles one line below them ("All Expenses"/"All Expenses").
- On a fresh install the default currency is **USD**, and the form asks for **Amount before Currency**.
- The manual form runs **no auto-categorisation** although `services/categorize.ts` exists and runs on
  the import and scan paths. It is backend-only (no frontend import), so this needs a small endpoint.
- The donut renders 10 slices with a 10-item legend; below ~3% a slice is thinner than its own 2°
  padding gap and cannot be resolved.
- The heatmap ramp is anchored on the single largest day, so ordinary days land in three
  near-identical greens — 91 days drawn, about 10 distinguishable.
- Five of the seven built-in category colours are byte-identical to semantic tokens (groceries =
  `--accent`, utilities = `--danger`, entertainment = `--warning`, …), so every colour has two jobs.
- ~40 Edit/Delete buttons render at once in All Expenses, with heavier chrome than the data they act on.
- `defaultCurrency` (which Budgets opens on) and `primaryCurrency` (which Dashboard converts to) can
  diverge; both are PLN in the demo, so the trap is latent.

---

## 2. Recommended information architecture

**Four destinations, one persistent action, no overflow.**

```
Desktop sidebar            Mobile bottom bar
──────────────────         ────────────────────────────────────
  Sundry                   [ Home ] [ Expenses ] ( + ) [ Budgets ] [ Settings ]
  [ + Add expense ]        the + is a raised centre button, not a tab
  Home
  Expenses
  Budgets
  Settings
  ──────────
  Light / Dark
```

"Wipe Database" moves to a danger zone at the bottom of Settings. The repeated tagline is replaced by a
**status line** stating what you are looking at and over what period.

### + Add expense — a sheet, not a destination

Opens over whatever screen you are on, from anywhere. Two tabs at the top: **Scan a receipt** | **Type
it**, opening on the method used last (Scan first on mobile, Type on desktop). Fields as today. On save
the sheet closes, **you stay where you were**, and a line appears: *"Added — 24,90 zł · Groceries.
Undo · Edit"*.

### Home — the boot screen

Currency scope renders **only when the window holds more than one currency**; the FX caveat collapses to
a clause on the headline ("converted at your rates").

1. **Headline** — "You spent **4 812 zł** in the last 30 days · ≈160 zł/day · 12% more than the 30
   before". This is the slot the decided "typical monthly income" number later fills ("46% of a typical
   month"), and it is the *only* place it appears.
2. **Where it went** — categories ranked by amount: name, amount, share, change vs the previous window.
   Top 6 plus "everything else". Replaces both the donut and Analytics' bars.
3. **Budgets** — exceptions only: *"Groceries 12% over with 9 days left · 1 close · 5 on track"*.
   Renders nothing when no limits are set.
4. **Subscriptions** — monthly total, the active table, then "Looks stopped".
5. **Where you shop** — merchant rows with "adds up" flags.
6. **When you spend** — weekday bars and the 13-week heatmap together.

**Findings become the headline of the section that proves them.** `/insights/summary` stops filling a
callout box and instead supplies the sentence heading its own section — the weekend claim above the
weekday chart, the category mover above the category list, the stopped subscription above the
subscriptions table. One claim, one place. Sections with nothing to say render nothing. At most **one**
section may be promoted directly under the headline when its finding scores far above the rest.

**Windows are per-section, and every section states its own.** See §4, ruling R2 — this is where the
reviewers disagreed and it is the single most important detail on this screen.

### Expenses — the ledger, the query tool, and the door for bulk data

1. Toolbar: `Import…` and `Export ▾ (CSV · Excel)` side by side, same level.
2. **One** filter bar — Search · Categories · Currency · Date range (`Last 30 days · This month ·
   Last 12 months · Custom`) · Clear — replacing both Analytics' three stacked panels and the table's
   own filter bar.
3. Summary row for the filtered set: Total (converted, natives beneath when mixed) · Count · Per day ·
   Largest.
4. The table as today.
5. Below it: spend over time, and the category breakdown bars.

### Budgets

1. Month header with **‹ ›**, defaulting to the current month, no future months, and the standing-limits
   caveat whenever a past month is shown.
2. **Verdict first**: "2 over · 1 close · 5 on track", with the over and close ones listed one line each;
   on-track collapses to a single line.
3. Pace: "43% used · day 11 of 31 · on pace", plus a 1px pace tick on each bar.
4. The cumulative chart as today.
5. Category list **read-only by default**; categories with no limit collapse into one line ("6 with no
   limit"). A single **Edit limits** toggle turns the list into today's inputs — which also resolves F11,
   since the destructive control is no longer the thing you click to read.
6. Currency scope gains `All → primary`, read-only when combined; editing a limit requires selecting its
   native currency, and the UI says so.

### Settings

Preferences → **Currencies** (one row per currency carrying enable, symbol, decimals **and its rate**)
→ Categories → **Danger zone** (Wipe Database).

### First run — no tour

Home with a single Start card: **Import a spreadsheet** (inline picker) · **Add your first expense** ·
*"See it with 18 months of sample data →"* linking to the public demo instance. Sections then appear as
the data earns them, which the components already do.

**No in-app seeding.** `backend/src/scripts/seed.ts` refuses unless `DB_PATH` is explicitly set, is not
the real ledger, and the ledger is empty. That guard exists to protect a real ledger and a UI button
would have to weaken it.

---

## 3. Every change, with the question it answers

Each line ties to one of: **Q1** where am I burning money · **Q2** where could I save · **Q3** what are
my spending habits · **Q4** what am I missing.

| # | Change | Justification | Q |
|---|---|---|---|
| 1 | Every section states its own time window | Removes the silent "over what period?" behind every number on the overview | Q1 |
| 2 | Open on Home, not a blank form | A product that tells you things must not ask you to work first | Q4 |
| 3 | Merge Dashboard + Insights into Home; findings become section headlines | Ends three destinations for one question and puts the differentiator first | Q4 |
| 4 | Merge Analytics into Expenses as one filter bar | Querying belongs with the ledger; deletes a duplicate decomposition and a duplicate filter UI | Q1 |
| 5 | Headline states total, per-day and change vs the previous window | Answers "is this more than usual, overall?" — today comparison only ever surfaces per-category | Q1 |
| 6 | Budget exceptions block on Home and Budgets | Answers "did I blow anything?" — today you scan ten cards and a clean month says nothing | Q2 |
| 7 | Month stepper on Budgets, with the standing-limits caveat | Answers "how did last month end?" — unanswerable today | Q2 |
| 8 | Pace verdict and tick | Answers "is 43% on day 11 good or bad?" — nothing states it today | Q2 |
| 9 | Budgets read-only by default, one Edit limits toggle | Separates reading from configuring, and stops a stray keystroke deleting a limit | Q2 |
| 10 | Scan and Type become tabs in one Add sheet, reachable anywhere | Recording is an input method, not a place; frees two nav slots for the same job | Q1 |
| 11 | Stay put after saving, with an inline confirmation and Undo | Answers "did it save, and how do I fix it without losing what I was reading?" | Q1 |
| 12 | Import moves beside Export in the Expenses toolbar | Same job, one level of hierarchy — and on an empty Home, Import becomes the lead action | Q1 |
| 13 | FX rates fold into Settings → Currencies, one row per currency | One word, one place; a rate editor is configuration, not a destination | Q1 |
| 14 | One currency-scope control, one option set, shown only when >1 currency is present | Ends four controls with four behaviours, and stops Budgets implying an all-clear it cannot give | Q1 |
| 15 | Wipe Database moves to a Settings danger zone | An irreversible action does not belong in primary navigation beside a theme toggle | — |
| 16 | Tagline replaced by a per-screen status line | Answers "what am I looking at, over what period?" instead of pitching a different product | Q1 |
| 17 | URLs and a working back button | Answers "how do I get back to what I was reading?" — impossible today | — |
| 18 | Empty-Home Start card, no tour | Answers "what do I do first?" without a tour the UI would have failed by needing | Q4 |
| 19 | Render `days` in the weekend sentence | The app stops contradicting itself; the field is already in the payload | Q3 |
| 20 | Fix "Last 30 Days" to mean 30 days, and add a calendar-month option | A preset that returns 31 days including this month answers the wrong question silently | Q1 |
| 21 | Suggest a category from the description in the manual form | Removes a decision from the 20×/week task, using a categoriser that already exists | Q1 |
| 22 | Delete `--text-dim`, point its nine roles at `--text-muted` | Nine text roles currently fail WCAG AA; this is one fewer token, not one more | — |
| 23 | Complete the light theme (`--accent`, `--danger`, `--info`, `--warning`) | Eight failures including the active nav label at 1.92:1 | — |
| 24 | Give `.btn-danger` a dark foreground | The Wipe Database confirm button is the least legible text in the product at 2.77:1 | — |
| 25 | Stop colouring donut legend text; keep the swatch | Ten of ten labels fail in light mode — the rule is already written at `App.css:654` | — |
| 26 | Finding sentences to 22.4px/600; stat values to 20px/700 | The claim stops being the quietest text and a row count stops outranking the page title | Q4 |
| 27 | Donut to top-5 + "Other"; heatmap ramp anchored on p90 | Both charts currently spend their resolution on values the reader cannot distinguish | Q3 |
| 28 | Delete the donut centre total and the duplicate card titles | The same number at two ranks 130px apart, and one word said twice | — |

---

## 4. Where the perspectives disagreed

### R1 — Does the Insights tab survive a merge? **Ruling: yes, merged into Home; no separate tab.**

The advocate argued that merging Insights into a screen with a time control turns it into Analytics and
deletes the fourth question — "Insights is not Analytics" is written into both component headers, and a
block that needs configuring before it says anything belongs in Analytics.

The IA lens argued for one Home carrying both.

**The advocate's objection is about a filter wall, and the proposal has none.** Home renders immediately
on a default window with no category checkboxes, no required currency and no custom range. A default
that answers on arrival is not configuration. The objection does not apply — **except in one specific,
which is real and is ruled on next.**

### R2 — One window for all of Home, or one per section? **Ruling: one per section, each stated.**

This is the most important detail in the proposal, and the reviewers walked past each other on it.

The IA proposal had a single window control governing the whole page. That breaks two things the
insights spec deliberately arranged: over 30 days the weekday chart has about four samples per weekday
and the merchant list goes thin; over 12 months `materiality` — which divides by spend *in the window* —
scores a year of coffees against a month of spending and returns above 1 every time.

So Home carries **two clocks, both stated**:

- **Spending sections** (headline, where it went, budget exceptions) follow the page window control:
  `Last 30 days · This month ‹ › · Last 12 months`, default 30 days.
- **Habit sections** (subscriptions, merchants, weekday) keep their own longer window and **print it in
  the section header**, exactly as the Insights tab already does at `Insights.tsx:317` and `:368`.

The governing rule, which resolves F1 and F10 together: **every section states its window; sections
sharing the page window say so once at the top.** This is what makes the merge safe, and skipping it
reproduces the current contradiction on a single screen, where it would be worse.

### R3 — Does the Dashboard strip survive? **Ruling: the box dies, the scoring lives — but fix the clause now.**

The advocate said keep both and fix one line. The IA lens said the strip does not survive as a strip.
Visual craft declined to arbitrate and said so: making the sentences large before deciding what the
screen is for would make a *duplicate* loud, since two of the strip's three lines are verbatim the tab's
top two rows.

Both are right about different horizons. Once Insights content is on Home, a box at the top repeating
three of that page's own sentences duplicates *itself* — so the box goes and findings become section
headlines. But the scoring survives untouched: `/insights/summary` keeps ranking, and the advocate's
defence of server-side scoping stands (see R5).

**Sequencing matters here.** The weekend contradiction is live today and costs one line
(`InsightsStrip.tsx:95` — destructure `days`, render it). **Do that now**, independently of the merge.
It is a correctness fix, not a design decision, and it should not wait behind an IA change.

### R4 — Where does Analytics go? **Ruling: into Expenses, not into Home.**

The advocate proposed collapsing Dashboard + Analytics; the IA lens proposed Analytics → Expenses and
Dashboard + Insights → Home.

The IA split is right, and the advocate's own reasoning is why: collapsing Analytics into the overview
would put a filter wall on the home screen, which the advocate vetoes elsewhere in the same document.
Analytics is a *query* tool and the ledger is where you query; Home is a *standing answer*.

### R5 — Unify the currency mechanism across the app? **Ruling: unify the control, not the mechanism.**

The four different currency controls (F9) should become one control with one option set. But the
*implementation* asymmetry the advocate defends must survive: the strip refetches per scope because
ranking a PLN finding against a USD one requires converting **before** scoring, while the Insights tab
scopes client-side because it only displays per-currency lists. Unifying that costs real work in either
direction and buys nothing. **Same control, same options; different plumbing underneath, as today.**

### R6 — A factual dispute, resolved against my own earlier note

I recorded from the accessibility tree that the mobile "More" button has **no accessible name**. Visual
craft challenged it from source. **Visual craft is right.** The button renders a visible
`<span class="bottom-nav-label">More</span>` that is not `aria-hidden` and, verified live, is
`display: block` — so its accessible name computes to "More". The tree I read was reporting the
`aria-label` *attribute*, which only that button lacks.

The real issue is much smaller: the four primary tabs set `aria-label` to the long form ("Scan Receipt")
while rendering the short one ("Scan"), and the fifth relies on content. Two naming strategies in one
five-button bar. It passes WCAG 2.5.3; normalise it in passing. And it becomes moot if the More sheet
is deleted.

---

## 5. What was deliberately not proposed

The brief warned that a UX pass reliably produces a design system, a five-step tour, theme settings and
a fifth chart. All four were considered and refused:

- **No design system, no token overhaul.** The strongest available argument for one is real —
  `App.css` holds ~20 distinct font sizes between 10.6px and 27.2px, with pairs 0.48px apart, and that
  absence of ranking is *why* the important text ended up smaller than the unimportant text. It is
  recorded as diagnosis, not as a work item. The reading failure is on one screen and costs **two
  changed declarations**. Net token change across every recommendation here is **−1**.
- **No tour, no onboarding checklist.** If it needs a tour the UI failed; and in a single-user
  self-hosted app the tour is seen once, by the person who installed it.
- **No theme settings.** A toggle already exists.
- **No fifth chart.** There are already five visualisations. Two of them (donut, heatmap) are being made
  *more* readable rather than joined by a sixth.
- **No quick-add FAB.** Add is already primary on both layouts; the defect is the post-save teleport, not
  reach.
- **No dashboard customisation.** The most thesis-destroying idea available: it makes configuring the
  dashboard the first task, for a product whose founding complaint is setup cost.
- **No command palette, no notifications, no savings-goal feature, no empty-state illustrations.**
- **No income ledger.** Income stays a single number in Settings, surfaced in at most one line of the
  Home headline. The moment an Income screen or a savings-rate chart appears, that is the ledger arriving
  through the back door.
- **No re-hueing of category colours.** The semantic collisions are real, but re-colouring seven database
  rows to disambiguate from five CSS variables is a migration in service of taste. The one place the
  collision causes a *reading* failure — the donut legend — is fixed by not colouring text.

**The single unavoidable addition is routing** — both the IA lens and the advocate reached it
independently. Everything else above is re-shelving, or printing a number the code already holds.
Nothing else produces "take me back to where I was", and the re-organisation makes it more necessary,
not less: five destinations with sub-views need addressability more than ten flat ones. Budget: hash or
a small `pushState` hook, one route per destination plus filter params, **no router dependency** in a
repo that deliberately has no state library.

---

## 6. What this costs

Stated plainly, because every one of these is a real loss to someone:

- **The stacked "Trend by Category" chart** goes; seasonality across all categories at once is only
  partly recovered by filtering Expenses to one category.
- **The donut** goes; ranked bars keep every number and add the delta but lose the part-of-a-whole
  gestalt.
- **The word "Insights" leaves the navigation.** For a portfolio piece this is a genuine cost: a reviewer
  scanning nav labels for the clever bit no longer finds one. The bet is that the clever bit being the
  first thing on the home screen beats it having a label.
- **Budget history is approximate** — past months compare against current limits, because the data has no
  month dimension. This inaccuracy did not exist while past months were simply unavailable. It must be
  stated on screen.
- **Scanning costs two taps** the first time you switch methods, until the sheet remembers.
- **Wipe Database** costs two clicks instead of one; **Import** loses its nav slot.
- **The strip's fixed three lines** go: someone who read exactly three sentences and left now scrolls.
  Mitigated by the headline and the one promoted section, not eliminated.
- **Analytics' server-side aggregation** over unloaded ranges goes. The client already loads the whole
  ledger, so nothing breaks now — but it becomes a scaling ceiling.

---

## 7. Where the proposed structure still fails the 5-second test

Honest results for `[+ Add expense] Home · Expenses · Budgets · Settings`:

- **Record a receipt** → the + button. Passes for "record"; **partial fail on the word "receipt"** —
  someone hunting for "Scan" sees no such label until the sheet opens. Recovery is one tap, but the first
  move is a guess.
- **Where did the money go last month?** → Home or Expenses. Both work, which is itself a small failure:
  two right answers means a moment of choosing.
- **Did I blow a budget?** → Budgets, cleanly — and Home answers it without navigating at all.
- **The word "Analytics"/"Reports" has no home.** Users trained on other trackers will look for it and
  must learn that querying lives under Expenses.
- **"Home" says where it is, not what is on it.** "Overview" says what it is and reads worse in a
  five-slot mobile bar. Genuinely close; **Home** is picked because the boot screen should carry the
  label that never surprises.

---

## 8. Sequencing

1. **Corrections that need no IA decision** — render `days` in the weekend sentence (F10); fix the
   "Last 30 Days" range (F2); delete `--text-dim` and complete the light theme (F14); dark foreground on
   `.btn-danger`; stop colouring donut legend text. All are wrong today and cheap.
2. **Build Home** — merge Dashboard and Insights, per-section windows, findings as section headlines,
   `/insights/summary` gaining the `period`/`window` params `/comparison` already takes. *Then* flip the
   boot view; that line is worthless before Home is worth opening.
3. **Add becomes a sheet** with the post-save confirmation replacing the forced navigation. Frees two
   nav slots, independent of step 2.
4. **Merge Analytics into Expenses**; one filter bar; Import beside Export.
5. **Fold FX into Settings → Currencies**; Wipe to the danger zone; extract the one shared
   currency-scope control.
6. **Rebuild Budgets**: verdict, month stepper with the caveat, read/edit split, `All → primary`.
7. **Routing, status line, tagline removal, duplicate headings.** Last, because the route table must
   match the final navigation.

---

## 9. Not verified — settle these before the spec commits

- ~~**All empty and first-run states.**~~ **Settled 2026-08-11** against a genuinely empty database
  (`empty-preview` launch config, `./data/empty.db`). The prediction holds, and the trigger is worse
  than predicted: on a completely empty install Budgets reads `Remaining $0.00` in green, and the red
  negative appears **the moment the first expense is saved** — one expense of $250 renders
  `Remaining −$250.00` in `--danger` `#f87171`. It is not a first-launch state; it fires on the first
  thing a new user does. Also observed on the empty install: default currency is **USD** while the
  month header reads **"sierpień 2026"** (F19, locale by accident), and all seven categories render
  full-height `$0.00` rows.
- ~~**The Analytics day-count mismatch.**~~ **Settled 2026-08-11**: with the "Last 30 Days" preset
  active the screen prints **"31 days"**. The label and the figure contradict each other on the same
  view, confirming F2 end to end.
- **`defaultCurrency` vs `primaryCurrency` divergence** — Budgets opens on the former, Dashboard converts
  to the latter. Both are PLN in the demo, so the trap is latent. Set them differently and compare.
- **Whether a newly added row is findable** in All Expenses — no highlight, no scroll handling, so
  visibility depends on prior scroll position.
