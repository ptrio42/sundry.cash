# Gallery

Screenshots used by the top-level [README](../README.md).

> **Every image in this folder predates the UX rebuild and is being replaced.** The four waves that
> ended with wave 4 merged six screens into four and changed what every one of them shows, so the
> table below describes what the app looks like *now* — which is what the next capture should show —
> rather than what these files contain. Two of the old files (`analytics.png`, `currencies.png`) are
> pictures of screens that no longer exist; the README no longer links either.

| File | View | Viewport |
| --- | --- | --- |
| `dashboard.png` → rename to `home.png` | Home — the headline, findings as section headings, where it went, subscriptions, merchants, weekdays | 1360×860 @2x |
| `expenses.png` | Expenses — the ledger and the query tool in one: filter bar, summary row, spend over time and spend by category | 1360×940 @2x |
| `budgets.png` | Budgets — the verdict, the month stepper, the pace band, and the read/edit split | 1360×900 @2x |
| *(new)* `add.png` | The Add sheet over another screen, with its Type / Scan tabs | 1360×860 @2x |
| *(new)* `settings.png` | Settings — one row per currency carrying enable, symbol, decimals and rate | 1360×860 @2x |
| ~~`analytics.png`~~ | Deleted with the screen in wave 3b — Expenses answers this now | — |
| ~~`currencies.png`~~ | Deleted with the screen in wave 4 — the rate editor is a Settings control | — |
| `mobile.png` | Home on a phone, with the bottom tab bar and the raised **+** | 390×844 @3x |

## Regenerating them

**Every screenshot must be taken against throwaway data — never a real ledger.** Point the backend at a
scratch database, seed it, and shoot that:

```bash
DB_PATH=/tmp/sundry-demo/expenses.db npm --prefix backend run dev
```

Then run the frontend (`npm --prefix frontend run dev`), add a few dozen expenses across several
categories, currencies and months, and set a budget or two so the charts have something to show.

Capture in **dark mode**, on a browser set to **English**.

The old caveat here said the *whole* interface followed the host locale. Half of that is fixed: since
wave 4 dates come from `DISPLAY_LOCALE` in `frontend/src/utils/format.ts` rather than the operating
system, and amounts have always taken theirs from the currencies table — so charts, headings and the
ledger render identically wherever you shoot. **Form controls still do not.** A browser set to Polish
renders `<input type="date">` as `dd.mm.rrrr` and shows an FX rate as `0,25` rather than `0.25`; that
is the control drawing itself, and no constant in this repo can change it. It shows up in exactly two
shots — `add.png` and `settings.png`.
