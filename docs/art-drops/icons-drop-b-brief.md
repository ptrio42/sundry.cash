# Sundry icons — drop B brief

Standalone brief for the last ten icons. Drop A (`sundry-icon-set-cplus-drop-a`, 22 icons) and the
nav set (`sundry-icon-set-cplus`, 7 icons) are delivered and in the repo; **do not redraw anything
from either**.

## System rules — unchanged from both previous drops

- **24×24 master grid.** Same geometry across themes and states; theme and state are colour-only.
- **`svg/base/*.svg` on `currentColor`, no hardcoded hex.** This is the only folder the app reads.
  Per-theme colour folders are handoff convenience.
- **C+ language:** simple filled forms with intentional cut-outs and negative space.
- **A `svg/micro/` variant wherever an icon renders at 14px.** Drop A established this: cut-outs
  that read at 24px close up at 14, so those get geometry optically simplified rather than the same
  path scaled down. Two icons below need it, marked **[micro]**.

## Colour — decided, so it does not need solving again

Icons **inherit the accent through `currentColor`** rather than carrying their own. The nav set named
`#5F865F` for light-active; the app's `--accent` is `#4D6B4D`, because a nav item's label is *text*
(4.5:1) where an icon is graphics (3:1). One green, and the existing contrast test covers icons for
free. **Do not ship per-state colour values for these ten** — the base SVGs are the deliverable.

---

## The ten

### Recording — the two that matter most

These label the two tabs of the Add sheet, side by side, at 20px. Recording an expense is the action
performed roughly twenty times a week, so this pair is the highest-value work in the drop.

| Icon | Where |
|---|---|
| **receipt-scan** | tab **"Scan a receipt"** — the camera path |
| **compose** | tab **"Type it"** — the manual path |

**The one real trap in this drop.** `compose` must read as *the manual alternative to the camera*,
and drop A already contains an `edit` icon for changing an existing row. Two icons meaning "write" in
the same product, one next to a camera and one on a table row, must not converge. If a pencil is the
obvious answer for both, one of them is wrong — `compose` may be better as a keyboard, or a form, or
a hand-written line.

| Icon | Where | Size |
|---|---|---|
| **receipt-view** | "View receipt" on a ledger row that has an image attached | 16px |

### Account and system

| Icon | Where | Size |
|---|---|---|
| **sign-out** | two callers: a **label-less** button in the sidebar (`title="Sign out"`, currently 🔓) and a labelled one in Settings. Must be unambiguous with no text beside it | 16px |
| **retry** | the error banner's "Retry" | 16px |
| **external-link** | the demo banner's **"What Sundry is →"** — replaces a literal `→` inline in a sentence | 14px **[micro]** |

### Home's section marks — decorative, lowest priority

Four headings on the boot screen. The findings are already the headings and the type does the work,
so these tie the screen together rather than carrying meaning. Build them last, and skip them if the
budget runs out.

| Icon | Section |
|---|---|
| **recurring** | "Subscriptions" |
| **merchant** | "Where you shop" |
| **calendar-week** | "When you spend" |
| **category** | "Where it went" |

Two constraints:

- **`merchant` and `category` must not converge.** "Where you shop" and "Where it went" are two
  sections apart on the same screen and answer different questions — one is *who you paid*, the other
  *what for*.
- **`calendar-week` must differ from drop A's `calendar`.** That one marks a date-range control; this
  one marks a weekday pattern. Same screen, different jobs.

---

## Scope notes

**No per-row cadence icon.** The earlier brief asked for one; checking the code, cadence renders as
text in a table cell — "Monthly", "Quarterly" — so a mark per row would be redundant. `recurring` is
a section heading only.

**Nothing else is missing.** After these ten, every icon-bearing control in the app is covered.

## Suggested order

1. `receipt-scan` + `compose` — the Add sheet's two tabs
2. `receipt-view`, `sign-out`, `retry`, `external-link`
3. the four section marks

---

## Status — delivered

All ten. 10/10 base SVGs on `currentColor` with no hardcoded hex, `micro` supplied for
`external-link` alone — the only one marked for it — and `perStateColorFilesIncluded: false`, which
is the inheritance decision honoured rather than worked around.

Every semantic constraint in this brief is answered in the drop's own manifest, so the reasoning
survives without this file:

- **`compose`** — "Keyboard/form metaphor so it cannot be confused with Drop A edit/pencil." This
  was the one real trap and it was taken head-on rather than resolved with a second pencil.
- **`receipt-view`** — receipt plus eye, distinct from `receipt-scan`'s scan frame.
- **`retry`** — circular, distinct from drop A's `undo`.
- **`merchant`** storefront = *who you paid*; **`category`** tag = *what for*. The two sections that
  sit apart on Home now read apart.
- **`calendar-week`** — a seven-day pattern, distinct from drop A's date-range `calendar`.
- **`sign-out`** — door plus outward arrow, "designed to read without a label", which is what the
  sidebar's label-less caller needs.

**The icon system is complete: 7 nav + 22 drop A + 10 drop B = 39.** Every icon-bearing control in
the app is covered. What remains is wiring them in — replacing the emoji in `NAV`, and the literal
`↑ ↓ ⇅ →` still in the components.
