# The landing page

Static files, served by Caddy at the apex (`sundry.cash`, `www.sundry.cash` — see
`deploy/Caddyfile`, which roots them at `/srv/sundry/landing`). No build step, no framework, no
JavaScript at all. Four pages over one stylesheet:

| | |
| --- | --- |
| `index.html` | the landing page |
| `run-it-yourself/index.html` | everything technical — Docker, the data folder, the variables |
| `terms/index.html`, `privacy/index.html` | placeholders until a lawyer has written them |

The three others are directories with an `index.html` inside, so a static file server resolves
`/terms/` through its own index handling. `terms.html` at the root would need the server to add the
extension, and `file_server` does not.

Written to `docs/landing-content-spec.md`, which replaced everything the page *says*
(`docs/landing-spec.md` is the first version, and is history). What follows is what the spec left to
the implementation.

## The rule the page has to keep

**Zero third-party requests.** Not "few" — none. A page arguing that the product hands your data to
nobody, while handing every visitor's IP to a font CDN, refutes itself in its own network panel.
So every asset is copied into `assets/` and served from this domain:

| | Copied from | Why not linked |
| --- | --- | --- |
| `assets/fonts/*.woff2` | `frontend/src/assets/fonts/` | The app self-hosts Newsreader for the same reason |
| `assets/fonts/OFL.txt` | `frontend/public/fonts/` | The licence travels with the font, and the page links it |
| `assets/logo-horizontal-*.svg` | `frontend/src/assets/brand/` | The wordmark is outlined, so it needs no font either |
| `assets/favicon-64.png`, `assets/apple-touch-icon.png` | `frontend/public/icons/` | — |
| `assets/shots/*.webp` | `gallery/*.png`, converted | See below |

Verified rather than intended: loaded over `python3 -m http.server`,
`performance.getEntriesByType('resource')` returns eight entries on the landing page with every
picture forced to load, four on each of the others, and none of them leaves the origin. Re-run that
check on every page after any edit — it is the one claim on the site that a single careless `<link>`
turns into a lie.

**The copies are copies, and copies drift.** If the brand assets or the font subsets change in
`frontend/`, they have to be re-copied here. Nothing enforces it, because the alternative — a build
step — would trade a rare manual step for a permanent one.

## The screenshots

`gallery/` holds seven PNGs at 2× (one at 3×), 2.7 MB in total, which is a lot to send a phone on a
LinkedIn tap. They are re-encoded to WebP at 2040 px wide (780 for the phone shot), which is 2× the
widest box the page ever gives them:

```bash
for f in home home-dark expenses budgets add settings; do
  cwebp -q 80 -sharp_yuv -resize 2040 0 gallery/$f.png -o landing/assets/shots/$f.webp
done
cwebp -q 80 -sharp_yuv -resize 780 0 gallery/mobile.png -o landing/assets/shots/mobile.webp
```

All seven are converted; the page shows four of them (`home`/`home-dark`, `add`, `budgets`,
`mobile`), one per step plus the hero. `expenses.webp` and `settings.webp` stay in `assets/shots/`
against the next edit — 265 KB, and re-encoding them is the only alternative.

2.7 MB becomes 696 KB. **WebP only, with no PNG fallback**, which is a deliberate trade: a fallback
would duplicate the 2.7 MB of PNGs inside this directory to serve browsers older than 2020 — and a
browser that cannot decode WebP cannot run the React app the pictures are of.

Every `<img>` carries `width`/`height` (the intrinsic pixels of the WebP, not the CSS box) so the
page cannot reflow while they load, and everything below the fold is `loading="lazy"`.

`assets/og-image.png` is the LinkedIn/Slack card, 1200×630, cropped from the top of `home.png` and
padded to the brand off-white. It stays a PNG: the crawlers that read `og:image` are not the
browsers that render the page.

```bash
ffmpeg -i gallery/home.png \
  -vf "scale=1160:-1,crop=1160:590:0:0,pad=1200:630:20:20:0xF7F7F5" \
  -frames:v 1 landing/assets/og-image.png
```

## The four quoted findings

The sentences in *What it notices* are the app's real output, and the page says so, which makes
them the easiest thing here to get quietly wrong. Two traps, both hit once already:

- **The seed re-anchors on the day it runs**, so a `demo.db` left on disk from an earlier day
  answers with different figures than the gallery screenshots were shot against. Quoting the two
  next to each other is a contradiction a reader can find in one click.
- **The numbers in `docs/landing-spec.md` and `docs/ux-review-findings.md` are older still.** They
  are illustrations of the *shape*, not output to copy.

So regenerate them, against the same anchor the screenshots use, and never transcribe:

```bash
DB_PATH=/tmp/landing-check.db npm --prefix backend run seed -- --anchor=2026-08-12 --force
cd backend && PORT=5397 DB_PATH=/tmp/landing-check.db npx ts-node src/server.ts &
curl -s 'http://localhost:5397/api/insights/summary?scope=primary&limit=10&period=month&window=rolling'
```

`scope=primary` is the `All → PLN` the shots are taken in; the PLN-only scope answers differently
and mixing the two is how you end up with a weekend figure from one and a weekday figure from the
other. The payload carries numbers only — the sentences live in `findingSentence` in
`frontend/src/utils/home.ts`, and the amounts go through `formatCurrency`, so `1734,88 zł` has no
thousands separator while `11 092,28 zł` does. The cheap way to confirm a rendering is right: the
`category_moved` and `category_new` sentences from the same run must match, character for
character, the two lines visible in `gallery/home.png`.

## Colour and type

`styles.css` copies its tokens out of `frontend/src/App.css` rather than re-picking them — the app
derives its whole palette from the three colours the brand drop freezes and measures every pair at
4.5:1, and a landing page that re-chose them would drift from the product it advertises.

Two differences from the app, both deliberate:

- **The theme switch.** The app stores a choice and stamps `data-theme`; this page has no
  JavaScript, so it follows `prefers-color-scheme`. Same tokens, different switch.
- **Newsreader has one job here** — headlines, and the finding sentences the app itself sets in it.
  Every `h1` is Newsreader, including the three on the other pages; every `h2`, every control and
  every figure stays on the system sans. The wordmark is an SVG with outlined glyphs, so it carries
  its own type.

Contrast was recomputed from the tokens for every foreground/surface pair the page actually uses,
in both themes: the lowest text pair is 5.55:1 (`--accent` links on `--bg`, light). The one element
under 3:1 is the decorative rail on the privacy list, and `styles.css` says so where it is set.

## The gates

Three things on the page are dead ends today, and each one blocks publishing:

1. **`https://demo.sundry.cash` does not resolve** until the demo instance is deployed. The page
   links it in three places. Deploy first, or the strongest asset on the page is a dead link.
2. **The Stripe Checkout link does not exist.** The pricing button carries
   `https://buy.stripe.com/REPLACE_ME` so it cannot be mistaken for a working one; swap in the real
   payment link, with the 30-day trial and the €5 / €49 prices configured.
3. **The terms and the privacy policy carry real content.** Both are placeholders saying so. The
   pricing block links the terms for the 14-day withdrawal right, the model withdrawal form and the
   trader's identity — consumer law requires those before a buyer is bound, and a placeholder
   supplies none of them.

One more thing that is true but temporary: **the repository is not public yet**, so *Run it
yourself* says the source is available on request. The moment it is public, that sentence becomes a
link.

**No `/.well-known/security.txt`.** RFC 9116 makes `Contact` mandatory, no role address has been
chosen, and a file naming an invented one is worse than no file at all.

## Checking it

```bash
python3 -m http.server 5391 --bind 127.0.0.1   # from inside landing/
```

Then, in the browser's console:

```js
performance.getEntriesByType('resource').filter(e => !e.name.startsWith(location.origin))
```

An empty array is the whole test, and it has to be run on all four pages — `/`, `/run-it-yourself/`,
`/terms/`, `/privacy/`. Below the fold the pictures are `loading="lazy"`, so force them
(`[...document.images].forEach(i => i.loading = 'eager')`) before counting, or the count is of the
top of the page only.

Read every page at 375 px wide and in both colour schemes, and check that
`document.documentElement.scrollWidth === window.innerWidth`; the pages have no other states.
