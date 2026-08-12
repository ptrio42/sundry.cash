/**
 * The stylesheet, tested as data.
 *
 * This is the test wave 0 could not write, because the suite had no pattern for
 * reading CSS: jsdom applies no external stylesheet, so nothing rendered here
 * can be asked what colour it is. Reading `App.css` as a string and doing the
 * arithmetic ourselves answers the question the renderer cannot — and it is
 * worth the setup now, because the brand wave changes every colour in the
 * product and the icon drop after it changes more.
 *
 * Three things are enforced:
 *
 *  1. **Parity.** A token carrying a colour must be declared in both themes.
 *     The light theme spent most of its life missing `--accent`, `--danger`,
 *     `--info` and `--warning` entirely, which is how an active nav label came
 *     to render at 1.92:1 there. The rule is mechanical rather than a hand-kept
 *     list: a token whose *value* contains a colour literal is theme-dependent,
 *     full stop, so a new one cannot be added to one block only.
 *  2. **Contrast.** Every foreground the app can put on every surface it can put
 *     it on, including the surface a `-soft` tint composites to, at AA.
 *  3. **No literals in the body.** A colour written into a rule instead of a
 *     token is a colour one theme picked and the other inherited — seven of them
 *     were sitting in this file at the values the dark theme wanted.
 *
 * `?raw` rather than `node:fs`: the package has no `@types/node`, and Vite hands
 * the same string to `tsc`, to vitest and to the browser build.
 */

import { describe, it, expect } from 'vitest';
import appCss from '../App.css?raw';

/* ---------- colour maths (WCAG 2.1 relative luminance) ---------- */

type Rgb = [number, number, number];

const parseHex = (value: string): Rgb => {
  let h = value.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb;
};

const luminance = ([r, g, b]: Rgb): number => {
  const [lr, lg, lb] = [r, g, b].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const RGBA = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/;

/** A token value as an opaque colour, compositing any alpha over `base`. */
const resolve = (value: string, base: Rgb): Rgb => {
  if (value.startsWith('#')) return parseHex(value);
  const m = RGBA.exec(value);
  if (!m) throw new Error(`not a colour: ${value}`);
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  return [+m[1], +m[2], +m[3]].map((c, i) =>
    Math.round(c * alpha + base[i] * (1 - alpha))) as Rgb;
};

/* ---------- reading the stylesheet ---------- */

/** Comments carry hex codes in their prose; nothing here should see them. */
const source = appCss.replace(/\/\*[\s\S]*?\*\//g, '');

const declarationsIn = (block: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(name, value.trim());
  }
  return out;
};

/**
 * `:root` is declared twice on purpose — geometry and type first, then the light
 * palette — so both are collected. `:root[data-theme='dark']` cannot match here:
 * the attribute selector sits between `:root` and the brace.
 */
const collect = (pattern: RegExp): Map<string, string> => {
  const merged = new Map<string, string>();
  for (const [, body] of source.matchAll(pattern)) {
    for (const [k, v] of declarationsIn(body)) merged.set(k, v);
  }
  expect(merged.size).toBeGreaterThan(0);
  return merged;
};

const LIGHT = collect(/:root\s*\{([^}]*)\}/g);
const DARK = collect(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/g);

/** Hex, rgb() or rgba() anywhere in the value. Named colours are not used. */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;
const carriesColour = (value: string) => COLOUR_LITERAL.test(value);

const THEMES: [string, Map<string, string>][] = [['light', LIGHT], ['dark', DARK]];

/* ---------- what lands on what ---------- */

/** Every opaque background a string of text can sit on. */
const SURFACES = ['--bg', '--bg-elevated', '--surface', '--surface-2', '--surface-3'];

/**
 * The surfaces a `-soft` tint is ever laid over. `--surface-3` is missing on
 * purpose and not by oversight: it is a bar track, a tooltip and a field fill —
 * `.rank-bar-track`, `.recharts-default-tooltip`, `.category-label-input`,
 * `.btn-secondary:hover` — and no rule in the file puts a tint on top of one.
 * It is still checked for every opaque pair above.
 */
const TINT_BASES = ['--bg', '--bg-elevated', '--surface', '--surface-2'];

/** Foreground rank -> the tint built from it, where there is one. */
const FOREGROUNDS: { token: string; soft?: string }[] = [
  { token: '--text' },
  { token: '--text-muted' },
  { token: '--accent', soft: '--accent-soft' },
  { token: '--danger', soft: '--danger-soft' },
  { token: '--warning', soft: '--warning-soft' },
  { token: '--info', soft: '--info-soft' },
];

const AA = 4.5;
/** SC 1.4.11: the boundary that identifies a control, not its label. */
const AA_NON_TEXT = 3;

describe('theme tokens — parity', () => {
  it.each(THEMES)('declares every colour token the other theme has (%s)', (name, theme) => {
    const other = name === 'light' ? DARK : LIGHT;
    const missing = [...theme]
      .filter(([, value]) => carriesColour(value))
      .map(([token]) => token)
      .filter(token => !other.has(token));

    expect(missing).toEqual([]);
  });

  it('keeps the tokens that carry no colour out of the pair', () => {
    // Geometry and type are declared once. If one of these ever grows a colour
    // it stops being structural and the parity rule above starts covering it,
    // which is the whole reason the rule reads values rather than a list.
    for (const token of ['--radius', '--font', '--mono', '--font-display', '--sidebar-w']) {
      expect(LIGHT.has(token)).toBe(true);
      expect(carriesColour(LIGHT.get(token)!)).toBe(false);
      expect(DARK.has(token)).toBe(false);
    }
  });

  it('anchors both themes on the three colours the drop froze', () => {
    // docs/art-drops/sundry-brand-final/brand-tokens.json. If one of these
    // drifts, the app is no longer the brand it shipped.
    expect(LIGHT.get('--bg')).toBe('#F7F7F5');
    expect(LIGHT.get('--text')).toBe('#1A1A1A');
    expect(LIGHT.get('--accent-fill')).toBe('#7DA27D');
    expect(DARK.get('--bg')).toBe('#1A1A1A');
    expect(DARK.get('--text')).toBe('#F7F7F5');
    expect(DARK.get('--accent-fill')).toBe('#7DA27D');
  });
});

describe.each(THEMES)('theme contrast — %s', (_name, theme) => {
  const colour = (token: string, base: Rgb = [255, 255, 255]) => {
    const value = theme.get(token);
    if (value === undefined) throw new Error(`${token} is not declared in this theme`);
    return resolve(value, base);
  };

  /* The cases are built from token *names* and nothing is looked up until one
     runs. Resolving here instead would mean a token missing from one theme took
     the whole file down during collection, hiding the parity test that says so
     in one line. */
  const onSurface = SURFACES.flatMap(surface =>
    FOREGROUNDS.map(({ token }) => [token, surface] as [string, string]));

  const onTint = TINT_BASES.flatMap(base =>
    FOREGROUNDS.flatMap(({ token, soft }) => (soft
      // A tint carries the two text ranks wherever it is used, and the hue it
      // was built from — `.demo-banner` puts --text and an --accent link on
      // --accent-soft; `.over-badge` puts --danger on --danger-soft.
      ? ['--text', '--text-muted', token].map(fg => [fg, soft, base] as [string, string, string])
      : [])));

  it.each(onSurface)('%s on %s clears AA', (fg, surface) => {
    expect(contrast(colour(fg), colour(surface))).toBeGreaterThanOrEqual(AA);
  });

  it.each(onTint)('%s on %s over %s clears AA', (fg, soft, base) => {
    expect(contrast(colour(fg), colour(soft, colour(base)))).toBeGreaterThanOrEqual(AA);
  });

  it('reads charcoal on a sage fill, never white', () => {
    // The drop's own rule, and the measurement behind it: white on #7DA27D is
    // 2.86:1. Every filled control in the app takes --accent-contrast.
    expect(contrast(colour('--accent-contrast'), colour('--accent-fill'))).toBeGreaterThanOrEqual(AA);
    expect(theme.get('--accent-contrast')).toBe('#1A1A1A');
  });

  it('gives the sage fill an edge that reads against the page', () => {
    // Sage on off-white is 2.67:1, so the fill cannot bound itself on light.
    // `--accent` is the 1px inset ring every sage fill carries.
    for (const surface of ['--bg', '--surface', '--bg-elevated']) {
      expect(contrast(colour('--accent'), colour(surface))).toBeGreaterThanOrEqual(AA_NON_TEXT);
    }
  });

  it('labels a danger fill with --bg, the one value that inverts', () => {
    // `.btn-danger`, `.error-banner button`, `.btn-bulk-delete`. White here
    // measured 2.77:1 — the failure F14 named.
    expect(contrast(colour('--bg'), colour('--danger'))).toBeGreaterThanOrEqual(AA);
  });
});

describe('the stylesheet body', () => {
  const body = source
    .replace(/:root\s*\{[^}]*\}/g, '')
    .replace(/:root\[data-theme='dark'\]\s*\{[^}]*\}/g, '');

  it('spends no colour outside the token blocks', () => {
    // What this stops: `.error-banner` was bordered `rgba(248, 113, 113, 0.4)`,
    // a colour the dark theme chose, which the light theme then inherited
    // whether it suited it or not. Seven of these were in here.
    const literals = body.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g) ?? [];
    expect(literals).toEqual([]);
  });

  it('gives Newsreader exactly three strings and no table', () => {
    // §3 of the brand spec: the wordmark, Home's headline, the finding
    // sentences. A serif at 14px in a dense column of amounts is harder to scan
    // than the system sans, and the ledger is where people read numbers.
    const selectors = [...body.matchAll(/([^{}]+)\{[^}]*font-family:\s*var\(--font-display\)/g)]
      .map(([, selector]) => selector.trim().split('\n').pop()!.trim());

    expect(selectors.sort()).toEqual(['.headline, .finding', '.login-card h1']);
  });
});

/**
 * The other half of "no literals": a stylesheet with a perfect token set is
 * still only as good as what the components ask it for. Three of the app's
 * biggest accent areas — the heatmap ramp, its legend and the cumulative-spend
 * line — carried `#34d399` inline, which is the accent from *before* this brand
 * and measures 1.79:1 on the off-white the app now opens on. `theme.test.ts`
 * could not have seen them; this can.
 */
describe('components spend no colour of their own', () => {
  const modules = import.meta.glob<string>(
    ['../components/*.tsx', '../utils/*.ts'],
    { query: '?raw', import: 'default', eager: true },
  );

  /* Block comments cover JSX's `{/* … *␘/}` too, and a `//` that starts a line
     cannot be inside a string here. Prose is allowed to quote a hex — the
     comment explaining why a literal was removed is the main reason to. */
  const code = (text: string) => text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  /**
   * The one exception, and it is not a theme colour: a category's hue is user
   * data (`docs/categories-currencies-spec.md`), stored per row and applied
   * inline as a swatch. These literals are the seed the backend ships and the
   * default a new category is created with.
   */
  const IS_CATEGORY_DATA = /\bslug:|CATEGORY_COLOR/;

  const offenders = Object.entries(modules).flatMap(([path, text]) =>
    code(text)
      .split('\n')
      .map((line, i) => ({ line, at: `${path.split('/').pop()}:${i + 1}` }))
      /* A hex has to be the whole of a quoted string to count. `\b` alone reads
         the CSS selector `` `#add-tab-${method}` `` in AddSheet as the colour
         #add — "add" being three hex digits. */
      .filter(({ line }) =>
        /['"`]#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})['"`]/.test(line)
        || /\brgba?\(|\bhsla?\(/.test(line))
      .filter(({ line }) => !IS_CATEGORY_DATA.test(line))
      .map(({ at, line }) => `${at}  ${line.trim()}`));

  it('leaves every colour to a token, bar the category palette', () => {
    expect(offenders).toEqual([]);
  });

  it('is looking at something', () => {
    // A glob that matched nothing would make the case above pass forever.
    expect(Object.keys(modules).length).toBeGreaterThan(15);
  });
});

describe('the display face', () => {
  const faces = [...appCss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => body);

  it('is served by this app and by nobody else', () => {
    // Loading Newsreader from Google would hand every visitor's IP to
    // fonts.gstatic.com, from a product whose pitch is that it hands your data
    // to nobody — and the demo instance is public.
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      const src = /src:\s*([^;]+);/.exec(face)![1];
      expect(src).toMatch(/url\('\.\/assets\/fonts\/[\w-]+\.woff2'\)/);
      expect(src).not.toMatch(/https?:|\/\//);
    }
  });

  it('covers the alphabet Polish amounts are written in', () => {
    // `24,90 zł` needs latin-ext. One subset would render the ł from a fallback
    // serif, mid-sentence, in the one place the app speaks in its own voice.
    const ranges = faces.map(face => /unicode-range:\s*([^;]+);/.exec(face)![1]);
    expect(ranges.some(r => r.includes('U+0100-02BA'))).toBe(true);
    expect(ranges.some(r => r.includes('U+0000-00FF'))).toBe(true);
  });

  it('swaps rather than blocking', () => {
    for (const face of faces) expect(face).toMatch(/font-display:\s*swap/);
  });
});
