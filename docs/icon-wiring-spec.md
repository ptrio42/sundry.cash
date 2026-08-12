# Wiring the icons in

Three drops are in `docs/art-drops/`: the nav set (7), drop A (22), drop B (10) — **39 icons**,
every one on `currentColor` with no hardcoded hex. None of them is referenced by the app yet.

This is the last code change before the gallery. After it, no glyph in the UI is a font character.

## What is being replaced

| Today | Where |
|---|---|
| `🏠 📋 🎯 ⚙️` | `App.tsx` `NAV` — the four destinations |
| `＋` | the persistent Add button |
| `☀️ 🌙` | the theme toggle |
| `🔓` | the label-less sign-out button |
| `⇅ ↑ ↓` | `ExpenseTable.tsx:139-140`, the sort indicator |
| `→` | `App.tsx:472`, "What Sundry is →" in the demo banner |

**Leave `All → PLN` alone.** That arrow is not an icon — it is punctuation inside a label meaning
*converted into*, and it appears in `CurrencyScope`, `Budgets` and `Home`. Replacing it with a glyph
would turn a readable phrase into a rebus.

## How they are consumed

**One `Icon.tsx` with the path data inlined, and a `name` prop.** All 39 base SVGs together are
19 KB before compression — smaller than one of the two font subsets already shipping — so there is
nothing to gain from lazy-loading and a lot to lose in machinery.

Rejected, with reasons, so nobody re-opens them:

- **`<img src="…">` cannot work.** An `<img>` renders in its own document and does not inherit
  `color`, so `currentColor` resolves to black and the whole inheritance decision dies. This is the
  trap in the obvious approach.
- **A sprite plus `<use href>`** works and the drops ship sprites, but it costs a request, a
  cache-busting story, and a `public/` path that must stay stable. The gain is nil at 19 KB.
- **`vite-plugin-svgr`** is a build dependency in a repo that deliberately has neither a router nor
  a state library. One component is less than one plugin.

The component:

- takes `name`, and `size` in pixels (default 20)
- renders `<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">`
- **picks the `micro` variant automatically at 14px or below**, for the seven that ship one:
  `info`, `sort-ascending`, `sort-descending`, `sort-none`, `trend-down`, `trend-up`,
  `external-link`. A `micro` that does not exist falls back to `base` — silently, because that is
  the correct behaviour, not an error.

Copy the SVGs into `frontend/src/assets/icons/` as the source of truth for the generated map, or
inline the paths directly in `Icon.tsx`. Either way `docs/art-drops/` stays the archive and the app
never reads from it.

## Colour — already decided, nothing to solve

Icons inherit through `currentColor`. The nav set names `#5F865F` for light-active and the app's
`--accent` is `#4D6B4D`, because a nav *label* is text at 4.5:1 where an icon is graphics at 3:1 —
so the icon follows the label and there is one green rather than two.

**Do not give any icon a colour of its own.** `theme.test.ts` already fails on colour spent outside
the token blocks, and that test is what keeps this true.

## Accessibility

Two cases, and they are not the same:

- **Icon beside its own label** — the four nav items, Add, the Add sheet's two tabs. Decorative:
  `aria-hidden="true"` on the SVG, the label carries the meaning. This is what the existing
  `<span className="nav-icon" aria-hidden="true">` already does; keep it.
- **Icon alone, no visible text** — the sidebar's sign-out (`title="Sign out"` today), the modal
  close buttons, the sort indicator. The *button* needs an `aria-label`; the SVG stays
  `aria-hidden`. A screen reader must never be handed a nameless control because the label became a
  picture.

The sort indicator additionally needs `aria-sort` on the column header — it is state, not
decoration, and today it is a character a screen reader will read aloud as "up arrow".

**Trend arrows are reinforcement, never the signal.** `+53.2%` keeps its sign and its colour; the
arrow is added to them. Someone who cannot distinguish the colours still reads the number.

## Tests

- Every `name` the component accepts renders an `<svg>`; an unknown name fails loudly rather than
  rendering an empty box.
- At `size <= 14` the seven with a micro variant render it, and the other thirty-two fall back to
  base without complaint.
- No rendered icon carries a `fill` or `stroke` other than `currentColor`.
- The nav renders four icons and four labels, and the labels are still the accessible names.
- The sign-out button has an accessible name with no visible text.
- The sort indicator reflects the active column and direction, and the header carries `aria-sort`.
- No emoji remain in `App.tsx` or `ExpenseTable.tsx` — assert on the source, since this is the wave
  that is supposed to remove them.

## Definition of done

`npm run lint`, `npm run build`, `npm run test`, output shown. **Both previews clicked through in
both themes** — `demo-preview` (:5175) and `empty-preview` (:5177) — because an icon that inherits
the wrong colour looks fine in one theme and disappears in the other. Nothing under `data/`, no
`*.db`, no `.env*` staged.

## Then

The gallery. Six PNGs in `gallery/` date from 28 July: before the rebuild, in the old palette, on
screens that no longer exist. This is the last change that alters what a screenshot shows.

---

## As built

32 call sites, 20 of the 39 icons, one component, one generator.

**`Icon.tsx` is generated**, by `scripts/generate-icons.mjs`, from `docs/art-drops/`. Hand-copying 46
files is transcription work and a mistyped coordinate is a bug no test would name; re-run the script
when a drop lands and read the diff. It is not wired into `npm run build` — the generated file is
committed, and a build step reading from `docs/` would make that directory load-bearing for
compilation.

Two things the spec did not anticipate, both in the artwork:

- **22 of the 46 drawings define a `<mask>`**, with a fixed id. The same icon twice on one page — the
  sidebar's Add and the mobile bar's — would put that id in the document twice, so the component
  mints a fresh one per instance from `useId`.
- **`black` and `white` appear inside those masks**, which is alpha and not colour. The test that
  proves every shape is `currentColor` therefore skips `mask`/`defs` subtrees, and a second case
  asserts the skip is still safe by requiring masked drawings to actually have a mask.

Five of the seven micro variants are byte-identical to their base — only `info` and `external-link`
were really redrawn — so those two are the whole evidence that the size switch fires.

### Where this departed from the spec

- **The sign-out button is not label-less.** `App.tsx` renders the word *Logout* beside it, so it is
  the decorative case: `aria-hidden` icon, no `aria-label`, because one there would override a name
  that already works. The spec's rule is right; its example was the wrong control.
- **`aria-sort` was already there**, correct and three-state, on all three sortable headers. The test
  now asserts it rather than the wave adding it.
- **`⤼ Skipped` in `ExcelImport` became `undo`, not `retry`.** The drops ship no skip mark. `retry` is
  a ring that reads as *run it again* — an action that card does not offer. `undo` is the arc shape
  the character actually had.
- **`ℹ️` and `⚠️` keep a hue** (`--info`, `--warning`) rather than inheriting body text. They were
  colour emoji; `currentColor` alone would have been a loss of signal. Both tokens are already
  measured at AA against their own `-soft` surface, so this is the token system rather than an icon
  spending a colour of its own.
- **Two sites beyond the table**, both the exact twin of one that is on it: `ExpenseTable`'s
  pagination arrows (`chevron-left`/`chevron-right`) and Home's `See it with 18 months of sample
  data →` (`external-link`, the same link shape as the demo banner's).

### Deliberately not done

`calendar`, `calendar-week`, `category`, `delete`, `edit`, `export`, `filter`, `merchant`,
`on-track`, `recurring`, `retry`, `search`, `select-all`, `trend-down`, `trend-up` — 15 of the 39 —
have no call site. Every one would be a *new* decoration on a control that has no glyph today, and
this wave replaces glyphs rather than adding pictures. Each is a place with a *word* doing the job,
not a place with a character pretending to be a picture: `Date range:`, `Search:`, `Categories:`,
`Edit`, `Delete`, `Retry`, `4 on track`, and Home's six section headings. Putting a mark on any of
them is a design decision — and it immediately asks the next one, since the three filter legends sit
in one bar and the six headings in one column.

The one exception, fixed here because it is an inconsistency rather than a matter of taste:
**Expenses' `Import…` and `Export ▾` are two `aria-expanded` disclosures side by side in one
toolbar**, and once Export's caret became a crisp `chevron-down`, they were promising the same thing
two different ways. Import takes the same caret, and drops its ellipsis — two marks for one promise
is worse than either. Home's `Import a spreadsheet` is deliberately left plain: it is the lead action
on an empty page, not one of a pair.
