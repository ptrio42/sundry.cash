# Gallery

Screenshots used by the top-level [README](../README.md).

| File | View | Viewport |
| --- | --- | --- |
| `dashboard.png` | Dashboard — category donut, stacked trend, 13-week heatmap | 1360×860 @2x |
| `expenses.png` | All Expenses — search, filters, sorting, export | 1360×860 @2x |
| `budgets.png` | Monthly Budgets — burn-down and per-category progress | 1360×900 @2x |
| `currencies.png` | Currency Conversion — manual rates, per-currency totals | 1360×820 @2x |
| `mobile.png` | Dashboard on a phone, with the bottom tab bar | 390×844 @3x |

## Regenerating them

**Every screenshot must be taken against throwaway data — never a real ledger.** Point the backend at a
scratch database, seed it, and shoot that:

```bash
DB_PATH=/tmp/sundry-demo/expenses.db npm --prefix backend run dev
```

Then run the frontend (`npm --prefix frontend run dev`), add a few dozen expenses across several
categories, currencies and months, and set a budget or two so the charts have something to show. Capture
in **dark mode** with an **en-US** locale — the app formats dates and currency via `Intl`, so a Polish
locale renders `dd.mm.rrrr` and Polish month abbreviations in the charts.
