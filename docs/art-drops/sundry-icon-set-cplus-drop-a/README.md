# Sundry C+ — Drop A

Production extension of `sundry-icon-set-cplus`.

## Included
### Table/list controls
sort-ascending, sort-descending, sort-none, edit, delete, check, select-all, undo

### Navigation/disclosure
chevron-left, chevron-right, chevron-down, close

### Expenses toolbar/filter bar
search, filter, calendar, import, export

### State/meaning
trend-up, trend-down, alert, on-track, info

## Rendering rules
- 24×24 master grid.
- `svg/base/*.svg` uses `currentColor` and is the app implementation source.
- Same geometry in light/dark; color/state changes only.
- C+ language: compact filled forms with deliberate negative-space cuts.
- Use `svg/micro/*.svg` for **14 px** instances where supplied. These are optical variants, not just scaled-down 24 px paths.
- Micro variants: info, sort-ascending, sort-descending, sort-none, trend-down, trend-up.

## Important semantic distinctions
- `check` = confirmation/checkmark action.
- `select-all` = selection control.
- `on-track` = semantic status badge; do not substitute `check`.
- `undo` and future `retry` should remain visually distinct.
- `import` and `export` are intentionally mirrored constructions.
- `sort-none` is deliberately neutral and should use inactive color.
- trend arrows reinforce signed percentages; they are never the only signal.

## Colors
Light inactive icon: `#5E666E`
Light active icon: `#5F865F`
Light active **text label**: `#4D6B4D`
Dark inactive icon: `#F2F2F0`
Dark active icon: `#9FC49F`

The darker active label token is intentional: the icon green and text green have different contrast requirements.

## Suggested sizes
- sort/trend/info/external-like inline micro UI: 14 px optical variant where available
- table/list actions: 16 px
- disclosure: 16–20 px
- standard toolbar icons: 16 px
- semantic badges: 16 px
