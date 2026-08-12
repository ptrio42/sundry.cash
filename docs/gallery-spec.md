# Regenerating the gallery

The six PNGs in `gallery/` date from 28 July — before the UX rebuild, in the old dark palette, on
screens that no longer exist. Two of them (`analytics.png`, `currencies.png`) show destinations the
app deleted; `README.md` already stopped linking those two, so they are orphans on disk.

This is the last thing between the app and the landing page, and it is the first thing anyone
arriving from LinkedIn will look at.

## The hard rule, which predates this spec

**Never a real ledger.** `gallery/README.md` has said so since the images were first taken, and it is
the rule that matters most here: these files go in a public repo. Shoot the seeded demo database,
which exists precisely for this.

```
preview_start  demo-preview      # frontend :5175, backend :5176, ./data/demo.db
```

The seed anchors its dates on "today", so the windows read as current whenever this is run.

## Themes — light, plus one

The gallery is **light**. The brand is light, the default is light, and showing all six screens
twice reads as indecision rather than as choice.

**One dark shot: Home.** Dark is a full peer of light, not a fallback, and one frame proves it
without doubling the set. Name it so the pairing is obvious.

## The shot list

Seven files. The names change because the screens did — `dashboard.png` is a screen called Home now,
and two names describe nothing.

| File | Screen | What it has to show |
|---|---|---|
| `home.png` | Home | the hero. The headline, and findings **as section headings** with each section's own window beside it. This is the one frame that has to say what the product is |
| `expenses.png` | Expenses | the ledger with the filter bar and the summary row — the screen that absorbed Analytics |
| `budgets.png` | Budgets | the verdict line first, the month stepper, and the pace figure |
| `add.png` | the Add sheet, open over a screen | the two tabs, **Scan a receipt** and **Type it**, and the screen still visible underneath — the sheet is the point |
| `settings.png` | Settings → Currencies | one row per currency carrying enable, symbol, decimals **and its rate**, which is where the FX screen went |
| `mobile.png` | Home, phone width | the bottom bar with four destinations and the raised `+`, and no overflow sheet |
| `home-dark.png` | Home, dark | the same screen as `home.png`, so the pair reads as one product in two themes |

**Delete `analytics.png`, `currencies.png` and `dashboard.png`.** The first two are screens that no
longer exist; the third is the old name for `home.png`.

## Capture

- **Desktop 1360 wide at 2×**, as the existing set did. Height per screen, no fixed crop — a screen
  cut mid-section looks like a bug.
- **Phone 390×844 at 3×** for `mobile.png`.
- Scroll so the frame starts at the top of the content, not mid-page.
- Let charts finish animating. A recharts bar chart caught mid-transition renders as an empty axis,
  which is what a screenshot taken too eagerly looks like — and it is indistinguishable from a broken
  chart to anyone reading the README.

## Update `gallery/README.md` while you are there

Two of its instructions are now wrong:

- *"Capture in **dark mode**"* — light is the default and the gallery is light.
- *"on a browser set to **English**"* — dates are `en-GB` by decision now (`DISPLAY_LOCALE` in
  `utils/format.ts`), so the app no longer inherits the host locale. The browser's locale still
  shows through in the five `<input type="date">` controls, which render themselves; worth a line so
  the next person is not surprised by it.

Also replace the manual "add a few dozen expenses" procedure with the seed: it is reproducible, and
reproducibility is the whole reason the script has a `DB_PATH` guard.

Update the file table to the seven names above.

## Then `README.md`

It links four images and the names are changing. Check every link resolves after the rename, and
that the alt text describes what the new screens do rather than what the old ones were called.

## Definition of done

Seven files in `gallery/`, three deleted, both READMEs consistent with what is on disk, and every
image link in `README.md` resolving. No real ledger anywhere near it: confirm the backend was
pointed at `./data/demo.db` and not the default path.
