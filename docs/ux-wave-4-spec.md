# UX rebuild — wave 4: closing it out

The last wave of `docs/ux-review-findings.md`. Waves 0–3 are merged. Afterwards the 28 changes are
done and the gallery, the landing page and the deploy can follow.

One session, serial. Nothing here is parallelisable and most of it is small.

**The "nothing may be added" rule now inverts.** For four waves everything found was parked; this
wave is where the parked list gets triaged. Build what is listed below and nothing else — the rest
of the follow-ups stay parked for after publication, and they are named at the end so the decision is
explicit rather than forgotten.

## Verification

`npm run lint`, `npm run build`, `npm run test`, output shown, **plus both previews clicked
through**: `demo-preview` (:5175) and `empty-preview` (:5177). Two of the three defects this rebuild
found came from driving the app, not from the suite.

---

## 1. FX folds into Settings → Currencies (change 13)

The last of the 28 that is still a screen. `Fx` is already unmounted from `App.tsx` and unreachable —
it lives in the repo waiting for this.

Two destinations answered to the word "currencies" (F12): the nav opened `Fx`, titled "Currency
Conversion" — a rate editor — while Settings held its own **Currencies** section for enabling and
disabling them. Which one was right depended on knowing the implementation split between rates and
availability.

**One row per currency in Settings, carrying enable, symbol, decimals *and its rate*.** After this,
`Fx.tsx` is deleted and its assertions move to `Settings.test.tsx`.

Keep what the Fx screen knew: it edits a **base** ("Base: PLN") rather than a scope, so this is not a
`CurrencyScope` — wave 0 left it out for exactly that reason and it stays out.

## 2. Dates stop guessing the locale (F19)

Not one of the 28, and it is here because it lands in every screenshot and the gallery is regenerated
straight after this wave.

Amounts are locale **by design**: `formatCurrency` reads `info.locale` from the currencies table, so
`65 048,41 zł` is right. Dates are locale **by accident**: `formatDate` and `monthLabel` call
`Intl.DateTimeFormat(undefined)`, which falls back to the host OS locale — so an English UI renders
`11 sie 2025`, and since wave 3c `sierpień 2026` is a **heading**, the largest instance of the bug in
the product.

Pick the locale deliberately rather than inheriting it. `en-GB` matches the interface language and
keeps dates short and unambiguous; the point is that it is a decision the code makes, not one the
operating system makes for it. PL/EN is a roadmap item — leave a seam, do not build it.

## 3. Suggest a category in the manual form (change 21)

The last unbuilt change of the 28, and easy to lose because it needs a small endpoint.

`services/categorize.ts` runs on the import and scan paths but **not** on the manual form, so the
20×/week action asks for a decision the app could already make. It is backend-only with no frontend
import, so expose it:

`GET /api/categories/suggest?description=...` → `{ category: slug }`, behind `requireAuth` like the
rest, returning `other` when nothing matches.

In the form: as the description is typed, pre-select the suggested category. **A suggestion, not a
lock** — the user changes it and the change sticks; do not re-suggest over an explicit choice.

## 4. Finish change 14, or record that it is finished

`CurrencyScope` is used by `Home`, `Expenses` and `Budgets` — every screen with a scope. Change 14
also asks that the control be **shown only when the window holds more than one currency**, and that
all three offer the same option set.

Verify that on the demo (three currencies) and the empty install (one). If it already holds, say so
in the wave's commit rather than changing anything.

## 5. The two unsettled items from the report's §9

- **`defaultCurrency` vs `primaryCurrency` divergence.** Budgets opens on the former, Home converts
  to the latter. Both are PLN on the demo, so the trap is latent. Set them differently and compare;
  fix or document, whichever the behaviour deserves.
- **Whether a newly added row is findable** in Expenses. Wave 3a replaced the forced navigation with
  an inline confirmation carrying Undo and Edit, which may have dissolved this — check rather than
  assume.

## 6. Sweep

Small, real, and all recorded during earlier waves:

- **`.time-grouping` is unreferenced CSS** — orphaned when the Dashboard's grouping control left in
  wave 2. Delete it, and any other rule the sweep finds with no caller.
- **The bulk-assign `<select>` has no accessible name.** `ExpenseTable`'s `.bulk-category-select` is
  bare — no `<label>`, no `aria-label`. A screen reader announces an unnamed combo box. One attribute.
- **The README links `gallery/analytics.png` under an "Analytics" heading**, for a screen that no
  longer exists. Fix the prose now; the images are regenerated after this wave.
- **`${daysInPeriod} days` does not pluralise** — a one-day range reads "1 days". Check whether 3b
  carried this into Expenses.
- **Three tokens are declared and never used**: `--violet`, `--accent-strong`, `--danger-strong`.
  Delete them, or give `--violet` a light-theme value if something starts using it.

## Explicitly still parked — for after publication

Named so that leaving them is a decision:

- The mobile filter bar is 603px tall and the first number sits at 813px (measured at 375×812). Any
  fix adds a control or trades discoverability, so it is a design decision, not a bug fix.
- **The two exports disagree about the filter**: CSV writes the filtered rows, Excel calls
  `/expenses/export` and writes the whole ledger. Both behaviours predate the rebuild; putting them
  in one menu is what made the disagreement visible. Either the endpoint learns the filter or the
  menu says which is which.
- The Budgets chart's Y axis rounds satoshis to zero — a BTC-scoped chart labels every gridline "₿0".
  It wants the currency's own decimals.
- No CSS-level contrast suite; contrast is verified in the browser and the numbers go in the PR.
- The root `package-lock.json` is out of sync with `package.json` (missing `engines`). Its own commit.

## Definition of done

Lint, build and tests green with output shown. Both previews clicked through. Nothing under `data/`,
no `*.db`, no `.env*` staged. **All 28 changes from the report are then complete** — say so in the
commit, because the next thing that happens is the gallery, the landing page and a public URL.
