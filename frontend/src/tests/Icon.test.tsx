/**
 * Tests for `Icon`, and for the 39 drawings it carries.
 *
 * Two halves, and the second is the unusual one.
 *
 * The component half is small — it picks a variant by size, it always renders
 * `aria-hidden`, and an unknown name is an error rather than an empty box.
 *
 * The other half tests the *artwork*, which is the thing nothing else can catch.
 * `Icon.tsx` is generated from `docs/art-drops/` by `scripts/generate-icons.mjs`,
 * so the compiler proves the JSX parses and proves nothing about whether a shape
 * still inherits its colour. A path that came back from a drop with a hex on it
 * would render fine, in one theme, and be invisible in the other — which is the
 * exact failure the whole `currentColor` decision exists to prevent. So every
 * one of the 46 drawings is rendered and walked here.
 *
 * `black` and `white` inside a `<mask>` are the one exception, and they are not
 * colour: a mask's channel is alpha, so those two values mean "keep" and "cut".
 * 22 of the 46 drawings are built that way.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { Icon, ICON_NAMES, MICRO_ICON_NAMES, MICRO_MAX, type IconName } from '../components/Icon';

/**
 * The drawing of one icon at one size, as markup — with the per-instance mask
 * ids flattened back to stable tokens.
 *
 * Two renders of the same icon are deliberately *not* identical markup (see the
 * minting case below), so a geometry comparison has to take the one thing that
 * legitimately varies out of the way first.
 */
const draw = (name: IconName, size?: number): string => {
  const { container, unmount } = render(<Icon name={name} size={size} />);
  const svg = container.querySelector('svg');
  if (!svg) throw new Error(`no <svg> for "${name}"`);
  const html = svg.innerHTML;
  unmount();

  return [...html.matchAll(/id="([^"]+)"/g)]
    .map(m => m[1])
    .reduce((acc, id, i) => acc.split(id).join(`mask${i}`), html);
};

const svgOf = (name: IconName, size?: number) => {
  const { container } = render(<Icon name={name} size={size} />);
  return container.querySelector('svg') as SVGSVGElement;
};

/**
 * Every element of a drawing, paired with whether it is inside a `<mask>` or
 * `<defs>` — where `fill`/`stroke` are alpha channel, not colour.
 */
const shapesOf = (svg: SVGSVGElement) =>
  [...svg.querySelectorAll('*')].map(el => ({
    tag: el.tagName,
    fill: el.getAttribute('fill'),
    stroke: el.getAttribute('stroke'),
    inMask: el.closest('mask, defs') !== null,
  }));

describe('Icon — the set', () => {
  it('carries all 39 drawings the three drops delivered', () => {
    // 7 nav + 22 drop A + 10 drop B. A regenerate that silently dropped a file
    // would otherwise only show up as a blank space on a screen nobody opened.
    expect(ICON_NAMES).toHaveLength(39);
    expect(new Set(ICON_NAMES).size).toBe(39);
  });

  it('renders an <svg> for every name it accepts', () => {
    for (const name of ICON_NAMES) {
      const svg = svgOf(name);
      expect(svg, name).not.toBeNull();
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      // Not one empty box among them: every drawing has shapes in it.
      expect(svg.querySelectorAll('path, rect, circle, polygon').length, name).toBeGreaterThan(0);
    }
  });

  it('fails loudly on a name it does not have', () => {
    // `IconName` guards the call sites the compiler can see. This is the other
    // ones — a name arriving from data, or a typo cast through `as`.
    // React logs the throw on its way past; the spy keeps the run readable
    // without hiding a failure, since the assertion is the throw itself.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => svgOf('spaceship' as IconName)).toThrow(/unknown name "spaceship"/);
    } finally {
      quiet.mockRestore();
    }
  });
});

describe('Icon — colour is never its own', () => {
  it('spends nothing but currentColor, at every size, in all 46 drawings', () => {
    const offenders: string[] = [];

    for (const name of ICON_NAMES) {
      for (const size of [MICRO_MAX, 24]) {
        for (const shape of shapesOf(svgOf(name, size))) {
          if (shape.inMask) continue;
          for (const [attr, value] of [['fill', shape.fill], ['stroke', shape.stroke]] as const) {
            if (value === null || value === 'none') continue;
            if (value === 'currentColor') continue;
            offenders.push(`${name}@${size} <${shape.tag} ${attr}="${value}">`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('lets the root <svg> carry the inheritance, so a container decides the colour', () => {
    expect(svgOf('home').getAttribute('fill')).toBe('currentColor');
  });

  it('reads black and white inside a mask as alpha, not as a colour', () => {
    // The guard above skips `mask, defs` subtrees. If a redraw ever moved those
    // values out into the drawing itself, this is what says the skip stopped
    // being safe: masked drawings must actually have a mask.
    const masked = shapesOf(svgOf('add'));
    expect(masked.some(s => s.inMask && s.fill === 'white')).toBe(true);
    expect(masked.some(s => s.inMask && s.fill === 'black')).toBe(true);
    expect(masked.filter(s => !s.inMask).every(s => s.fill === 'currentColor')).toBe(true);
  });

  it('mints a fresh id per instance, so two of the same icon are still valid markup', () => {
    // 22 drawings define a `<mask>`. The ids in the drop are fixed strings, so
    // without minting, a page holding two Add buttons — the sidebar's and the
    // mobile bar's — would put `addMask` in the document twice.
    const { container } = render(<><Icon name="add" /><Icon name="add" /></>);
    const ids = [...container.querySelectorAll('[id]')].map(el => el.id);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // And each drawing points at its own, not at the other one's.
    for (const svg of container.querySelectorAll('svg')) {
      const maskId = svg.querySelector('mask')?.id;
      const ref = svg.querySelector('[mask]')?.getAttribute('mask');
      expect(ref).toBe(`url(#${maskId})`);
    }
  });
});

describe('Icon — the micro cut', () => {
  it('knows the seven the drops drew a 14px variant for', () => {
    expect([...MICRO_ICON_NAMES].sort()).toEqual([
      'external-link',
      'info',
      'sort-ascending',
      'sort-descending',
      'sort-none',
      'trend-down',
      'trend-up',
    ]);
    expect(MICRO_MAX).toBe(14);
  });

  /**
   * Only two of the seven were actually redrawn — the drops shipped the other
   * five as copies of their base geometry. So these two are the whole evidence
   * that the switch fires at all, and it is worth knowing that: if a future drop
   * redraws `trend-up`, this test starts covering it without being touched.
   */
  const REDRAWN: IconName[] = ['info', 'external-link'];

  it('draws the optical variant at 14px and below', () => {
    for (const name of REDRAWN) {
      expect(draw(name, MICRO_MAX), name).not.toBe(draw(name, 24));
      expect(draw(name, 10), name).toBe(draw(name, MICRO_MAX));
    }
  });

  it('switches at exactly 14, not around it', () => {
    for (const name of REDRAWN) {
      expect(draw(name, MICRO_MAX + 1), name).toBe(draw(name, 24));
    }
  });

  it('falls back to base for the other thirty-two, silently', () => {
    const fallsBack = ICON_NAMES.filter(n => !MICRO_ICON_NAMES.includes(n));
    expect(fallsBack).toHaveLength(32);

    for (const name of fallsBack) {
      // No throw, no empty box, and the same drawing as at full size — a missing
      // micro variant is the normal case, not an error.
      expect(draw(name, 12), name).toBe(draw(name, 24));
    }
  });
});

describe('Icon — accessibility', () => {
  it('is always hidden, whatever it is drawing', () => {
    for (const name of ICON_NAMES) {
      expect(svgOf(name).getAttribute('aria-hidden'), name).toBe('true');
    }
  });

  it('carries no name of its own for a screen reader to find', () => {
    // The drops ship a `<title>` in every file; it is stripped on the way in.
    // A control's name belongs to the control — either its visible label or its
    // `aria-label` — and a titled icon inside one announces it twice.
    for (const name of ICON_NAMES) {
      expect(svgOf(name).querySelector('title'), name).toBeNull();
    }
  });

  it('stays out of the tab order in every browser', () => {
    // IE-era SVGs are focusable by default and Edge kept it; `focusable="false"`
    // is what keeps a decorative shape from becoming a tab stop.
    expect(svgOf('home').getAttribute('focusable')).toBe('false');
  });
});

describe('Icon — sizing', () => {
  it('draws at 20px when nobody says otherwise', () => {
    const svg = svgOf('home');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
  });

  it('takes the size it is given, on both axes', () => {
    const svg = svgOf('home', 26);
    expect(svg.getAttribute('width')).toBe('26');
    expect(svg.getAttribute('height')).toBe('26');
  });

  it('always answers to `.icon`, which is the only hook the stylesheet has', () => {
    // A bare `svg {}` rule would reach every recharts axis in the document, so
    // App.css is scoped to this class and nothing else.
    expect(svgOf('home').getAttribute('class')).toBe('icon');
    expect(svgOf('home').classList.contains('icon')).toBe(true);
  });

  it('keeps that class when it is given another', () => {
    const { container } = render(<Icon name="home" className="extra" />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.classList.contains('icon')).toBe(true);
    expect(svg.classList.contains('extra')).toBe(true);
  });
});

/**
 * The wave's own assertion, made against the source rather than the screen.
 *
 * `App.tsx` and `ExpenseTable.tsx` are the two files the icon spec singles out,
 * and this is the change that is supposed to leave no font character behind in
 * them. A rendering test cannot say that: it can only prove that what it looked
 * for is there, never that nothing else is. Reading the files is the only way to
 * ask "and nothing else".
 */
describe('the shell has no font character left in it', () => {
  const sources = import.meta.glob<string>(
    ['../components/App.tsx', '../components/ExpenseTable.tsx'],
    { query: '?raw', import: 'default', eager: true },
  );

  /* U+FE0F is the second half of ⚙️, ☀️, ℹ️ and ⚠️ — strip only the base
     codepoint and an invisible variation selector ships on its own, with a test
     that still passes. */
  const EMOJI = /\p{Extended_Pictographic}|\uFE0F/gu;

  /** Every character the spec's "what is being replaced" table names. */
  const REPLACED = ['\u{1F3E0}', '\u{1F4CB}', '\u{1F3AF}', '\u2699', '\uFF0B',
                    '\u2600', '\u{1F319}', '\u{1F513}', '\u21C5', '\u2191', '\u2193'];

  it('is looking at both files', () => {
    // A glob that matched nothing would make the cases below pass forever.
    expect(Object.keys(sources)).toHaveLength(2);
  });

  it('holds no emoji, variation selectors included', () => {
    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      [...text.matchAll(EMOJI)].map(m => `${path.split('/').pop()}  ${JSON.stringify(m[0])}`));

    expect(offenders).toEqual([]);
  });

  it('holds none of the characters the icons replaced', () => {
    // Wider than the emoji rule on purpose: the Add button's ＋ was a fullwidth
    // plus and the sort indicator was three arrows, none of which is an emoji.
    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      REPLACED.filter(ch => text.includes(ch)).map(ch => `${path.split('/').pop()}  ${JSON.stringify(ch)}`));

    expect(offenders).toEqual([]);
  });

  it('leaves the punctuation that was never an icon', () => {
    // The other half of the rule, and the one worth writing down: an arrow that
    // reads as a word inside a sentence is not a picture waiting to happen. The
    // ledger's page counter is the case still standing in these two files.
    const table = sources[Object.keys(sources).find(k => k.endsWith('ExpenseTable.tsx')) as string];
    expect(table).toContain('\u00B7');
  });
});
