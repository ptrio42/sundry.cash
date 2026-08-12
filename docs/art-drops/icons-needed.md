# Icons still needed — brief for the next drop

Companion to `sundry-icon-set-cplus`, which covers navigation: home, expenses, budgets, settings,
add, light-mode, dark-mode. Everything below is what the app actually contains — compiled from the
components, not guessed, with where each one appears so size and weight can be judged.

## Carry over from the C+ set

Same rules, so the two drops read as one system:

- **24×24 master grid**, same geometry across themes and states, colour-only variation.
- **`svg/base/*.svg` on `currentColor`** — this is what the app uses. The per-theme colour folders
  are useful for design handoff but the app never reads them.
- Same C+ language: filled forms with intentional cut-outs.

**One new constraint the nav set did not have to meet.** The C+ README targets 20–24 px. About a
third of the icons below render **inline in text at 14–16 px** — sort arrows in a table header, the
trend arrow beside `+53.2%`. Cut-outs that read at 24 px close up at 14. Those are marked **[14px]**
and may need a simplified form at that size rather than the same path scaled down.

## Contrast note from the set already delivered

`#5F865F` (light active) measures **3.87:1** on off-white. Fine for an icon — WCAG's non-text
threshold is 3:1 — but **it fails as text**, which needs 4.5:1. A nav item carries an icon *and* a
label, so the active label takes the darker `#4D6B4D` (5.55:1) while the icon keeps `#5F865F`. Worth
knowing before any of the below doubles as a text colour.

---

## 1. Table and list controls

| Icon | Where | Size |
|---|---|---|
| **sort-ascending** | sortable column headers in the ledger — currently `↑` | **[14px]** |
| **sort-descending** | same — currently `↓` | **[14px]** |
| **sort-none** | unsorted column — currently `⇅`, needs to read as *available*, not *active* | **[14px]** |
| **edit** | row action, `btn-edit`, and the Undo line's "Edit" | 16px |
| **delete** | row action and bulk delete, `btn-delete` / `btn-bulk-delete` | 16px |
| **check / select-all** | "Select all expenses", bulk selection state | 16px |
| **undo** | the confirmation line after saving — "Added — 24,90 zł · Groceries. Undo" | 16px |

## 2. Navigation and disclosure

| Icon | Where | Size |
|---|---|---|
| **chevron-left** | Budgets month stepper, "Previous month" | 20px |
| **chevron-right** | "Next month" — and must be visibly disabled at the current month | 20px |
| **chevron-down** | the `Export ▾` menu, and select affordances | 16px |
| **close** | three callers today: `modal-close`, `receipt-modal-close`, `close-badge`. One icon | 16–20px |

## 3. The Expenses toolbar and filter bar

| Icon | Where | Size |
|---|---|---|
| **search** | the search field, which is the one filter the API cannot do | 16px |
| **filter** | the filter bar, and the "Clear" affordance | 16px |
| **calendar** | the date-range control and its Custom option | 16px |
| **import** | `Import…`, beside Export at the same level | 16px |
| **export / download** | `Export ▾ (CSV · Excel)` | 16px |

## 4. Recording

| Icon | Where | Size |
|---|---|---|
| **receipt-scan / camera** | the Add sheet's **Scan a receipt** tab | 20px |
| **keyboard / compose** | the Add sheet's **Type it** tab — must read as the *manual* alternative to the camera, not as "edit" | 20px |
| **receipt-view** | "View receipt" on a row that has an image attached | 16px |

## 5. Home's sections

Each section heading could carry a mark. Low priority — the findings are the headings and the type
already does the work — but they would tie the screen together.

| Icon | Section |
|---|---|
| **recurring / repeat** | "Subscriptions", and the per-row cadence (weekly, monthly, quarterly, yearly) |
| **merchant / storefront** | "Where you shop" |
| **calendar-week** | "When you spend" — distinct from the plain calendar above |
| **category** | "Where it went", and the category picker in the form and bulk-assign |

## 6. State and meaning

These carry information rather than decorating a control, so they matter more than section marks.

| Icon | Where | Size |
|---|---|---|
| **trend-up** | beside a rise: the headline's "9% more", `+53.2%` on a category row | **[14px]** |
| **trend-down** | beside a fall | **[14px]** |
| **over-budget / alert** | the Budgets verdict, "Transport 141% over", and Home's exceptions line | 16px |
| **on-track** | the other half of the verdict — "5 on track" | 16px |
| **info** | the caveats the product deliberately prints: "compared with your current limits", and the merchant list's truncation notice | 14–16px |

**trend-up and trend-down must not be the only signal.** The percentages are already coloured and
signed; the arrows reinforce, they do not replace. Someone who cannot distinguish the colours still
reads `+53.2%`.

## 7. Account and system

| Icon | Where | Size |
|---|---|---|
| **sign-out** | "Sign out", shown only when a password is set | 16px |
| **retry** | the error banner's "Retry" | 16px |
| **external-link** | the demo banner's link out to sundry.cash | 14px |

---

## Not needed

So the agent does not draw them:

- **Currency** — the scope control uses currency *codes and symbols* (`All → PLN`, `BTC (₿)`), which
  are more precise than any glyph.
- **Analytics / chart** — that destination no longer exists; querying lives in the ledger.
- **Merchant vs category** must stay visually distinct: "Where you shop" and "Where it went" sit two
  sections apart on the same screen and answer different questions.

## Priority, if the drop is split

1. Sections 1–3 — controls the user touches on every visit.
2. Section 6 — these carry meaning, and the product's whole pitch is that it tells you things.
3. Sections 4, 7.
4. Section 5 — decorative; the screen works without it.

---

## Status — drop A delivered

`sundry-icon-set-cplus-drop-a` covers **22 icons**: sections 1, 2, 3 and 6 above, which is exactly
priorities 1 and 2. All 22 base SVGs use `currentColor` with no hardcoded hex, and the six marked
**[14px]** ship a separate `svg/micro/` set — *"24x24 geometry optically simplified for 14px
render"*. That was the one constraint the nav set had not had to meet.

**Settled while this landed: icons inherit the accent, they do not carry their own.** The set names
`#5F865F` for light-active; the brand's `--accent` is `#4D6B4D`, because a nav item's *label* is text
and needs 4.5:1 where an icon needs 3:1. Since the base SVGs use `currentColor`, an icon inside the
active item takes the label's colour automatically — so one green, not two fifteen pixels apart, and
the brand wave's contrast test covers the icons without a line being added to it. Keeping the lighter
green would be a deliberate extra rule, not the default.

### Still open — drop B

Ten icons, priorities 3 and 4:

- **Recording** (§4): `receipt-scan / camera`, `keyboard / compose`, `receipt-view`
- **Account and system** (§7): `sign-out`, `retry`, `external-link`
- **Home's sections** (§5, decorative): `recurring / repeat`, `merchant / storefront`,
  `calendar-week`, `category`

The recording pair matters most of the six non-decorative ones: they label the Add sheet's two tabs,
and `keyboard / compose` has to read as the *manual alternative to the camera* rather than as "edit"
— which is a different icon in the same product.
