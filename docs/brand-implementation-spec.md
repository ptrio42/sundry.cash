# Brand implementation — palette, typeface, assets, and a light default

Puts `docs/art-drops/sundry-brand-final/` into the app. Three jobs that have to happen together
because each one breaks the others if done alone: the palette inverts, the default theme flips, and
the assets are replaced.

**Nav icons are not in this wave.** A separate drop replaces the emoji (🏠 📋 🎯 ⚙️) later; leave
them alone and leave room for them.

## What the drop froze

`brand-tokens.json` locks three colours and nothing else:

```
charcoal  #1A1A1A     sage  #7DA27D     off-white  #F7F7F5
```

The README adds the usage rule that matters: *"Sage is reserved primarily for the upper receipt bar
/ UI accents."* Three anchors; the UI needs about twenty tokens. **The rest are derived here, and
every derived pair is contrast-checked** — this is the wave most likely to undo wave 0.

Newsreader is SIL OFL 1.1 and deliberately absent from the package.

---

## 1. Sage is a fill, never text on light

Measured, not estimated:

| pair | ratio | |
|---|---|---|
| `#7DA27D` text on `#F7F7F5` | **2.67:1** | fails AA |
| `#7DA27D` text on `#E9ECE8` | **2.40:1** | fails AA |
| white text on `#7DA27D` fill | **2.86:1** | fails AA |
| `#1A1A1A` text on `#7DA27D` fill | 6.08:1 | passes |
| `#7DA27D` on `#1A1A1A` | 6.08:1 | passes |
| `#1A1A1A` on `#F7F7F5` | 16.23:1 | passes |

2.67:1 is **worse than the `--text-dim` wave 0 deleted** at 3.36:1. Shipping brand sage as
`--accent` on a light theme reintroduces exactly the failure that wave closed.

So:

- **Sage keeps its exact frozen value where it is a fill or a dark-theme accent.** The brand is not
  being altered — it is being used the way its own README says.
- **A darker sibling carries text and icons on light.** Same hue and saturation (h 120°, s 17%),
  lightness dropped from 56%:

  | lightness | hex | on `#F7F7F5` |
  |---|---|---|
  | 40% | `#557755` | 4.71:1 |
  | **36%** | **`#4D6B4D`** | **5.56:1** |
  | 32% | `#445F44` | 6.59:1 |

  **Take `#4D6B4D`.** 4.71:1 clears AA by four hundredths, which is not a margin; 5.56:1 survives a
  future tweak to the background.

- **Anything filled with sage takes charcoal text**, never white.
- Dark theme: `#7CA17C` at 6.03:1 on charcoal is fine as-is, so the accent there is the brand value.

## 2. The token structure inverts

Today `:root` is dark and `:root[data-theme='light']` overrides it — the light theme is
*structurally the exception*. That is how it ended up missing `--accent`, `--danger`, `--info` and
`--warning` until wave 0 added them.

Flipping only the default value keeps that trap and points it at the theme most people will now see.

**`:root` becomes light. `:root[data-theme='dark']` becomes the override.** Every token declared in
the base must have a counterpart in the override — no partial theme, in either direction.

Derive from the anchors:

```
--bg          #F7F7F5   off-white, the brand colour
--surface     #FFFFFF
--text        #1A1A1A   charcoal, 16.23:1 on --bg
--accent      #4D6B4D   the derived sage (see §1)
--accent-contrast        charcoal, for text on a sage fill
```

`--text-muted`, the three surfaces, both borders, `--danger`, `--warning`, `--info` and the `-soft`
tints are derived and **each one is checked against the surface it lands on**. Keep the two text
ranks wave 0 settled on — do not reintroduce a third.

`--font` and `--mono` stay as they are. See §3.

**Dark stays a full peer, not a degraded fallback.** The app lived in it for its whole life and the
toggle keeps working; expense tracking happens in the evening.

## 3. Newsreader has a narrow job

**Wordmark, the Home headline, and the finding sentences. Nothing else.**

Those sentences are the product's voice — *"Weekends cost more — about 197,21 zł a day over the last
366 days"* — and an editorial serif is what makes them read as prose rather than as a caption. That
is the whole argument for the typeface being in the app at all.

**Tables, controls and every figure stay in `--font`.** A serif at 14px in a dense column of amounts
is harder to scan than the system sans, and the ledger is where people actually read numbers.

**Self-hosted.** Loading it from Google Fonts would send every visitor's IP to Google, from a product
whose pitch is that it does not hand your data to anyone — and the demo instance is about to be
public. Fetch the woff2 files, serve them from the app's own static assets, `font-display: swap`.
OFL 1.1 requires the licence to travel with the font: include it.

Add one token — `--font-display` — rather than reaching for the family name at call sites.

## 4. Assets

Replace, do not add alongside:

- `frontend/public/icons/` — the five current PNGs come from `favicon-*`, `symbol-*` and
  `app-icon-*` in the drop. Keep the existing filenames so `manifest.webmanifest` and
  `apple-touch-icon` references do not move.
- `manifest.webmanifest` — `background_color` and `theme_color` go from `#0e1013` to `#F7F7F5`.
- `index.html` — `theme-color` and the pre-mount `html { background: #0e1013 }` invert to off-white.
  That line exists to stop a flash before React mounts; it has to follow the default or it
  reintroduces the flash it was written to prevent, in the other direction.
- `App.tsx:440` — the sidebar `<img className="logo" src="/icons/icon-192.png">` becomes the
  horizontal logo. Prefer `logo-horizontal-*-outlined.svg`: it carries no font dependency, which is
  what "outlined" is for.
- Light and dark variants exist for the logo, the symbol and the app icon. The sidebar mark must
  follow the active theme, not be picked once at build time.

## 5. Tests

- **A contrast test over the token pairs**, both themes: text on each surface, accent on each
  surface, and text on each filled accent. This is the test wave 0 could not write because the
  suite had no pattern for reading CSS — it is worth the setup now, because this wave changes every
  colour in the product and the next one changes them again.
- Both themes declare the same token set. A token present in one and missing in the other fails.
- The theme toggle still switches, and the choice still persists.
- The finding sentences and the Home headline use `--font-display`; a table cell does not.
- No `@font-face` src points at a remote host.

## 6. Then, and only then

The gallery. Six PNGs in `gallery/` date from 28 July — before the rebuild, in the old palette, on
screens that no longer exist. Regenerating them before the brand lands means shooting twice.

## Definition of done

`npm run lint`, `npm run build`, `npm run test`, output shown. **Both previews clicked through in
both themes** — `demo-preview` (:5175) and `empty-preview` (:5177). Nothing under `data/`, no
`*.db`, no `.env*` staged.
