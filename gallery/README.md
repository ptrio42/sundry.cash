# Gallery

Screenshots used by the top-level [README](../README.md).

Seven files, shot on 12 August 2026 against the seeded demo ledger. Six are light, because the
brand is light and the default is light; one is dark, because dark is a full peer of light and one
frame proves that without showing every screen twice.

| File | View | Viewport |
| --- | --- | --- |
| `home.png` | Home — the headline, findings as section headings, and each section's own window beside it | 1360×1385 @2x |
| `expenses.png` | Expenses — the ledger and the query tool in one: filter bar, summary row, spend over time and spend by category | 1360×2957 @2x |
| `budgets.png` | Budgets — the verdict line, the month stepper, the pace figure and the read/edit split | 1360×1270 @2x |
| `add.png` | The Add sheet over Expenses, with its **Scan a receipt** / **Type it** tabs and the screen still visible underneath | 1360×900 @2x |
| `settings.png` | Settings — one row per currency carrying enable, symbol, decimals and its rate, which is where the FX screen went | 1360×1223 @2x |
| `mobile.png` | Home on a phone: the bottom bar's four destinations and the raised **+** | 390×844 @3x |
| `home-dark.png` | Home again, in dark, so the pair reads as one product in two themes | 1360×1385 @2x |

## Regenerating them

**Every screenshot must be taken against the demo ledger — never a real one.** These files go in a
public repo. `backend/src/scripts/seed.ts` exists precisely for this: it refuses to write to the
default database (the owner's real expenses), it is deterministic, and it anchors every date on the
day it runs, so the windows read as current whenever the set is reshot.

```bash
DB_PATH=./data/demo.db npm --prefix backend run seed   # add --force to overwrite an existing demo
```

Then start the stack against that file — the `demo-preview` config in `.claude/launch.json` is the
same thing wired up (frontend `:5175`, backend `:5176`, `./data/demo.db`):

```bash
npx concurrently -k \
  "cross-env PORT=5176 DB_PATH=./data/demo.db npm --prefix backend run dev" \
  "cross-env VITE_DEV_PORT=5175 VITE_API_TARGET=http://localhost:5176 npm --prefix frontend run dev"
```

Leave `DEMO_MODE` unset. It is what puts the honesty banner above the shell on the public demo, and
these images are pictures of the product rather than of that instance.

### Capture

- **Desktop 1360 wide at 2×.** Height is chosen per screen and ends in the gap *between* two
  sections — a card cut in half looks like a bug rather than a crop. `home.png` stops after
  Subscriptions; `settings.png` stops after Currencies.
- **Phone 390×844 at 3×** for `mobile.png`.
- Start the frame at the top of the content, not mid-page.
- **Light is the default**, so nothing needs setting for the six light shots; `home-dark.png` wants
  `localStorage['sundry-theme'] = 'dark'` and a *reload*, since the blocking script in `index.html`
  stamps `data-theme` before first paint and a hash change never re-runs it.
- **Let the charts finish.** recharts animates for 1.5 s, and resizing the viewport restarts it —
  so wait after the resize, not only after the load. A bar chart caught mid-transition is an empty
  axis, and nobody reading the README can tell that from a broken chart.
- `expenses.png` is shot with the **This month** preset. The ledger arrives at `All time`, which is
  every row the demo holds and puts both charts a mile below the fold; pressing a preset is the
  screen doing its job, and it is what lets one frame hold the filter bar, the summary row and both
  charts at once.

### One locale caveat

Dates and amounts render identically wherever you shoot: since wave 4 dates come from
`DISPLAY_LOCALE` in `frontend/src/utils/format.ts` rather than the operating system, and amounts have
always taken their format from the currencies table. **Form controls still draw themselves.** A
browser set to Polish renders `<input type="date">` as `12.08.2026` and an FX rate — an
`<input type="number">` — as `0,25` rather than `0.25`. It shows up in exactly two shots, `add.png`
and `settings.png`, and it is the control rendering itself: no constant in this repo can change it,
and on macOS neither can Chrome's `--lang`, which takes that format from the OS.
