# UX rebuild — wave 3: three screens, in parallel

Wave 3 of `docs/ux-review-findings.md`. Read the report first. Waves 0–2 are merged: the shell has
four destinations and routing, and Home is the boot screen with the findings as its section headings.

Three independent jobs. **Run them as three sessions in three worktrees**, on branches
`feat/ux-wave-3a`, `-3b`, `-3c`.

**Nothing may be added to the report's list of 28 changes.** Anything found along the way is recorded
at the bottom of this file, not built. Wave 0 found a genuine defect this way and it cost nothing to
park it.

## File ownership

| Session | Owns |
|---|---|
| **3a** | `ExpenseForm.tsx`, `ReceiptScan.tsx`, a new `AddSheet.tsx`, `utils/route.ts` |
| **3b** | `ExpenseTable.tsx`, `Analytics.tsx` (deleted), `ExcelImport.tsx`, `utils/analytics` if any |
| **3c** | `Budgets.tsx` — fully independent, no shared files at all |

`App.tsx` is touched by **3a and 3b only**, and by a few lines each: 3a mounts the sheet, 3b drops a
view mount. Different regions, so expect a clean merge and resolve by hand if not. **3a merges
first** if both are ready.

`CurrencyScope` (wave 0) is the control. Wave 3 screens are allowed to switch to the shared option
set — that is what finally closes F9.

## Verification, all three

`npm run lint`, `npm run build`, `npm run test`, output shown, **plus both previews clicked
through**: `demo-preview` (:5175) and `empty-preview` (:5177). Wave 2's one real defect was found by
driving the demo, not by the suite — a "This month" window measured 31 days when 11 had happened,
so a finding divided by 31 while the headline above it divided by 11. The suite cannot see that.

---

# 3a — Add becomes a sheet

Changes 10 and 11; F7, F17.

## The sheet

Opens **over whatever screen you are on**, from anywhere, via the persistent "+ Add expense" in the
sidebar and the raised centre button in the mobile bar.

Two tabs at the top: **Scan a receipt** | **Type it**, opening on the method used last — Scan first
on mobile, Type on desktop, for a first visit. Fields exactly as today; this is a move, not a
redesign of the form.

`ReceiptScan` and `ExpenseForm` stop being destinations and become the sheet's two tabs. Recording is
an input method, not a place: two of ten nav slots held one file picker apiece (F17), and mobile had
already worked this out by promoting Scan into the bottom bar while burying Insights.

## Saving stops throwing you out of the room

`App.tsx` currently does `setCurrentView('table')` on success. No toast, no highlight — the only
evidence that anything happened is that the app moved you, and a second entry costs a navigation.
This fires on the most frequent action in the product, roughly twenty times a week.

On save: the sheet closes, **you stay exactly where you were**, and a line appears:

> Added — 24,90 zł · Groceries.  **Undo** · **Edit**

Undo removes the expense; Edit opens it in the existing `EditExpenseModal`.

## Routing

`utils/route.ts` already carries `add` as a destination with a comment saying this wave converts it:
it becomes the **sheet's open/closed state**, and browser Back closes the sheet rather than leaving
the app. The destination list drops to four.

## Tests

- The sheet opens over each destination and the one underneath stays rendered.
- Tab memory: the last method used is the one that opens next time.
- Save closes the sheet, does **not** navigate, and shows the confirmation.
- Undo removes the row; Edit opens the modal on it.
- Back closes the sheet; with the sheet closed, Back leaves the destination as before.

---

# 3b — Analytics folds into Expenses

Changes 4 and 12; F3, F8, F17.

Analytics is a *query* tool and the ledger is where you query. It duplicates the ledger's own filter
bar, and its bars are the same decomposition Home now renders (report R4).

## The screen

1. **Toolbar**: `Import…` and `Export ▾ (CSV · Excel)` side by side, same level. Import currently has
   a nav slot while Export is a button inside the table header — same job, two levels of hierarchy.
2. **One filter bar**, replacing Analytics' three stacked panels *and* the table's own:
   `Search · Categories · Currency · Date range (Last 30 days · This month · Last 12 months · Custom) · Clear`
3. **Summary row for the filtered set**: Total (converted, with natives beneath when mixed) · Count ·
   Per day · Largest.
4. The table as today.
5. Below it: spend over time, and the category breakdown bars.

## Arrive answering, not configuring

Analytics puts ~450px of controls before the first number, including **eleven category checkboxes,
all checked by default** — the largest control on screen doing nothing on arrival. That is the
founding complaint of this product reproduced verbatim (F8).

The filter bar arrives with a default range and no category selection at all, showing everything.
Categories filter *down* from there.

## Date ranges

Use the presets wave 0 fixed: `Last 30 days` means 30 days, and the whole previous calendar month is
reachable. Do not reintroduce the old `setMonth(now.getMonth() - 1)`.

## Tests

- The filter bar filters the table, the summary row and both charts from one state.
- Arrival shows every row: no category is pre-selected, and the summary reflects the whole ledger.
- Import and Export sit in the same toolbar and both still work.
- `Analytics.tsx` is gone and nothing routes to it.
- Its assertions that still describe behaviour Expenses has — conversion, per-currency subtotals,
  the day count — move rather than vanish.

---

# 3c — Budgets states a verdict

Changes 6, 7, 8, 9, 14; F4, F11.

Today, answering "did I blow anything?" means scanning ten cards, six of which have no limit and
still occupy full height around an empty box. When nothing is over, **no element on the screen says
so**: the user does the work and receives an absence.

## The screen, in order

1. **Month header** with `‹ ›`, defaulting to the current month. No future months.
2. **Verdict, first**: `2 over · 1 close · 5 on track`. The over and close ones listed one line each;
   on-track collapses to a single line.
3. **Pace**: `43% used · day 11 of 31 · on pace`, plus a 1px pace tick on each bar. Nothing on the
   screen currently says whether 43% on day 11 is good or bad.
4. The cumulative chart as today.
5. **Category list read-only by default.** Categories with no limit collapse into one line
   ("6 with no limit"). A single **Edit limits** toggle turns the list into today's inputs.
6. Currency scope gains `All → primary`, **read-only when combined**. Editing a limit requires
   selecting its native currency, and the UI says so.

## The caveat that must not be dropped

**Budgets have no month dimension.** `/api/budgets` returns a flat set of `{category, currency,
amount}` standing limits. Showing a past month is therefore a frontend change — that month's spend
against the *current* limits — and the screen must say so whenever a past month is displayed:
*"compared with your current limits"*.

That inaccuracy did not exist while past months were simply unavailable. It is the price of the
feature and stating it is what makes the price fair.

## Read and edit stop being the same widget

The limit is an input that **saves on blur**, and `saveDraft` treats a blank, NaN or ≤0 value as
*delete the budget* — no confirmation, no undo. Clicking into a figure to read it closely is one
stray keystroke from silently removing the limit (F11).

The read/edit split in point 5 resolves this: the destructive control is no longer the thing you
click in order to read.

## Tests

- Verdict counts match the rows, and a clean month says "on track" rather than nothing.
- Month stepper moves the window; future months are unreachable; the standing-limits caveat appears
  for any past month and not for the current one.
- Pace: day 11 of 31 at 43% reads "on pace"; the same percentage on day 3 does not.
- Read-only by default: no input is rendered until Edit limits is pressed.
- Combined scope is read-only, and editing prompts for the native currency.
- No-limit categories collapse to one line.

---

## Follow-ups found while implementing — not in this batch

*(add here; do not build them)*

- **F19, dates are locale-by-accident.** `formatDate` calls `Intl.DateTimeFormat(undefined)`, which
  falls back to the host OS locale — "11 sie 2025" renders in an English UI. Confirmed on the demo
  preview after wave 2. Not one of the 28, but it belongs in wave 4: it lands in every screenshot,
  and the gallery is regenerated right after.
