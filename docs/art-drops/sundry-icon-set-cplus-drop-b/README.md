# Sundry C+ — Drop B (final icon drop)

This package contains **only the ten new icons** requested in the Drop B brief.
Nothing from the nav set or Drop A is redrawn or duplicated.

## Base icons
- receipt-scan
- compose
- receipt-view
- sign-out
- retry
- external-link
- recurring
- merchant
- calendar-week
- category

## Micro
- external-link — optical 14 px variant

The brief text says two icons are marked `[micro]`, but only `external-link` is actually marked 14px/[micro].
This pack does not guess an unmarked second icon.

## Production rules
- 24×24 master grid
- `svg/base/*.svg` uses `currentColor`
- no hardcoded colour values in deliverable SVGs
- same geometry across themes/states
- C+ filled / cut-out language
- no per-state colour folders in this drop, per brief

## Key decisions
### receipt-scan vs receipt-view
`receipt-scan` is a receipt inside a scan frame.
`receipt-view` is a receipt with an eye cut-out.
They remain recognisably related without becoming the same icon.

### compose vs edit
`compose` is a **keyboard/form**, not a pencil.
Drop A's `edit` remains the only pencil-style action.

### merchant vs category
`merchant` is a storefront ("who you paid").
`category` is a tag ("what for").

### calendar-week vs calendar
`calendar-week` uses a seven-day row plus a weekly band.
It is intentionally distinct from Drop A's date-range calendar.

### sign-out
Door + outward arrow, designed to remain unambiguous when rendered as a label-less 16 px sidebar control.
