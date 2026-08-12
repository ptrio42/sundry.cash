# Sundry C+ Core Icon Set

Final core iconography for **sundry.cash**.

## Included icons
- Home
- Expenses
- Budgets
- Settings
- Add
- Light mode
- Dark mode

## Design rules
- 24×24 master grid.
- Same geometry in light and dark themes.
- Theme/state changes are color-only.
- C+ language: simple filled forms with intentional cut-outs / negative space.
- Designed to remain readable at 20–24 px navigation sizes.
- `svg/base/*.svg` uses `currentColor` and is the preferred implementation for the app.

## UI state colors
Light:
- inactive `#5E666E`
- active `#5F865F`

Dark:
- inactive `#F2F2F0`
- active `#9FC49F`

Brand sage remains `#7DA27D` for larger fills/buttons. The active light-theme icon tone is intentionally darker so small UI icons retain useful contrast on the off-white UI.

## Recommended implementation
Inline the base SVG and control its `color` from CSS. This avoids maintaining separate geometry for themes.

Example:
```html
<svg class="sundry-icon" data-state="active" viewBox="0 0 24 24">
  <!-- copy path/group from svg/base/home.svg -->
</svg>
```

A sprite file and CSS tokens are included for implementation convenience.

## Notes
The icon shapes are production vectors created for this pack rather than traced/rasterized from the exploration boards.
