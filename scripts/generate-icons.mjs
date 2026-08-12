#!/usr/bin/env node
/**
 * Generates `frontend/src/components/Icon.tsx` from the three art drops in
 * `docs/art-drops/`.
 *
 * The drops are the archive and the app never reads from them at runtime, so the
 * geometry has to be copied into the bundle somehow. Doing that by hand across 46
 * files is transcription work, and a mistyped path coordinate is a bug no test
 * would name. This script is how the copy stays honest: re-run it when a drop
 * lands and diff the result.
 *
 *   node scripts/generate-icons.mjs
 *
 * It is deliberately not wired into `npm run build`. The generated file is
 * committed, the drops change about once a quarter, and a build step that reads
 * from `docs/` would make the docs directory load-bearing for compilation.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DROPS = join(ROOT, 'docs', 'art-drops');
const OUT = join(ROOT, 'frontend', 'src', 'components', 'Icon.tsx');

/** The three drops, in the order they were delivered. */
const SOURCES = [
  { dir: 'sundry-icon-set-cplus', label: 'nav set' },
  { dir: 'sundry-icon-set-cplus-drop-a', label: 'drop A' },
  { dir: 'sundry-icon-set-cplus-drop-b', label: 'drop B' },
];

/** Below this size the optical variant is used, for the seven that ship one. */
const MICRO_MAX = 14;

/* ---------------------------------------------------------------- read ---- */

const listSvg = (dir) => {
  try {
    return readdirSync(dir).filter(f => f.endsWith('.svg')).sort();
  } catch {
    return [];
  }
};

/** name -> { base: markup, micro?: markup, from: dropLabel } */
const icons = new Map();

for (const { dir, label } of SOURCES) {
  for (const variant of ['base', 'micro']) {
    const from = join(DROPS, dir, 'svg', variant);
    for (const file of listSvg(from)) {
      const name = basename(file, '.svg');
      const entry = icons.get(name) ?? { from: label };
      if (entry[variant]) throw new Error(`duplicate ${variant} icon "${name}"`);
      entry[variant] = readFileSync(join(from, file), 'utf8');
      icons.set(name, entry);
    }
  }
}

/* ------------------------------------------------------------ transform ---- */

/**
 * SVG attributes React spells differently. The drops use a small, closed
 * vocabulary — anything outside it is a new construction the generator has not
 * been taught, so it throws rather than emitting a silently-dropped attribute.
 */
const ATTR = {
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'fill-opacity': 'fillOpacity',
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-opacity': 'strokeOpacity',
  'stroke-dasharray': 'strokeDasharray',
};
const PASS_THROUGH = new Set([
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'rx', 'ry', 'r', 'cx', 'cy',
  'width', 'height', 'fill', 'stroke', 'mask', 'id', 'transform', 'points',
  'opacity', 'viewBox',
]);
const ELEMENTS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'g', 'defs', 'mask', 'clipPath']);

const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z-]+="[^"]*")*)\s*(\/?)>/g;
const ATTR_PAIR = /([a-zA-Z-]+)="([^"]*)"/g;

/**
 * Turns one drop SVG into JSX children.
 *
 * Two rewrites matter beyond the syntax:
 *
 *  - `<title>` is dropped. The component renders every icon `aria-hidden`, with
 *    the accessible name on the control, so a title here would be a second name
 *    a screen reader might reach.
 *  - every `id` and every `url(#id)` is minted per instance. 22 of the 46 files
 *    carry a `<mask>`, and the same icon rendered twice on a page would otherwise
 *    put the same id in the document twice. It renders correctly — browsers take
 *    the first match and the definitions are identical — but it is invalid, and
 *    "it happens to work" is not a thing to leave in a file nobody will re-read.
 */
function toJsx(svg, indent) {
  const inner = svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>[\s\S]*$/, '');

  const ids = new Set();
  const out = [];
  let depth = 0;
  let cursor = 0;
  let match;

  TAG.lastIndex = 0;
  while ((match = TAG.exec(inner)) !== null) {
    const between = inner.slice(cursor, match.index).trim();
    if (between) throw new Error(`unexpected text content: "${between}"`);
    cursor = TAG.lastIndex;

    const [, closing, tag, attrText, selfClosing] = match;
    if (!ELEMENTS.has(tag)) throw new Error(`unknown element <${tag}>`);

    if (closing) {
      depth -= 1;
      out.push(`${indent}${'  '.repeat(depth)}</${tag}>`);
      continue;
    }

    const attrs = [];
    ATTR_PAIR.lastIndex = 0;
    let pair;
    while ((pair = ATTR_PAIR.exec(attrText)) !== null) {
      const [, rawName, rawValue] = pair;
      if (rawName === 'xmlns' || rawName === 'role') continue;

      const name = ATTR[rawName] ?? rawName;
      if (!PASS_THROUGH.has(name) && !Object.values(ATTR).includes(name)) {
        throw new Error(`unknown attribute "${rawName}"`);
      }

      if (name === 'id') {
        ids.add(rawValue);
        attrs.push(`id={u('${rawValue}')}`);
        continue;
      }
      const url = /^url\(#([^)]+)\)$/.exec(rawValue);
      if (url) {
        ids.add(url[1]);
        attrs.push(`${name}={\`url(#\${u('${url[1]}')})\`}`);
        continue;
      }
      // Whitespace in `d`/`points` is significant only as a separator; collapse
      // it so the generated line is one line rather than the drop's pretty-print.
      const value = (name === 'd' || name === 'points')
        ? rawValue.replace(/\s+/g, ' ').trim()
        : rawValue;
      attrs.push(`${name}="${value}"`);
    }

    const pad = `${indent}${'  '.repeat(depth)}`;
    const open = attrs.length ? `<${tag} ${attrs.join(' ')}` : `<${tag}`;
    if (selfClosing) {
      out.push(`${pad}${open} />`);
    } else {
      out.push(`${pad}${open}>`);
      depth += 1;
    }
  }
  if (depth !== 0) throw new Error('unbalanced tags');

  return { jsx: out.join('\n'), usesIds: ids.size > 0 };
}

/** One entry of the BASE / MICRO maps. */
function entry(name, svg) {
  const { jsx, usesIds } = toJsx(svg, '    ');
  const lines = jsx.split('\n');
  const single = lines.length === 1;
  const body = single ? lines[0].trim() : `(\n${jsx}\n  </>\n  )`;
  const wrapped = single ? body : `(\n    <>\n${jsx.split('\n').map(l => `  ${l}`).join('\n')}\n    </>\n  )`;
  return `  '${name}': ${usesIds ? 'u' : '()'} => ${single ? body : wrapped},`;
}

/* ----------------------------------------------------------------- emit ---- */

const names = [...icons.keys()].sort();
const microNames = names.filter(n => icons.get(n).micro);

for (const name of names) {
  if (!icons.get(name).base) throw new Error(`icon "${name}" ships a micro variant but no base`);
}

const provenance = SOURCES
  .map(({ dir, label }) => {
    const mine = names.filter(n => readdirSync(join(DROPS, dir, 'svg', 'base')).includes(`${n}.svg`));
    return ` *   ${label.padEnd(8)} ${String(mine.length).padStart(2)}  ${dir}`;
  })
  .join('\n');

const file = `/**
 * The 39 icons, inlined.
 *
 * GENERATED by \`scripts/generate-icons.mjs\` from \`docs/art-drops/\`. Re-run that
 * script rather than editing this file; the drops are the source of truth and
 * this is a transcription of them.
 *
${provenance}
 *
 * Why the geometry is in a TypeScript module and not somewhere more obvious:
 *
 *  - **\`<img src="…">\` cannot work.** An \`<img>\` renders in its own document and
 *    inherits no \`color\`, so every \`currentColor\` in these files would resolve to
 *    black. The whole point of the drop is that one geometry serves both themes,
 *    and \`<img>\` is the trap in the obvious approach.
 *  - **A sprite plus \`<use href>\`** works, and the drops ship sprites, but it buys
 *    a request, a cache-busting story and a \`public/\` path that has to stay stable.
 *    All 39 are 19 KB before compression — less than one of the two font subsets
 *    already shipping — so there is nothing to win and machinery to lose.
 *  - **\`vite-plugin-svgr\`** is a build dependency in a repo that deliberately has
 *    neither a router nor a state library. One component is less than one plugin.
 *
 * Colour is not decided here. Every shape is \`currentColor\`, so an icon is
 * whatever colour its container's text is — which is why \`theme.test.ts\` can go
 * on being the only place that knows what the app's colours are.
 */

import { useId, type ReactElement } from 'react';

/**
 * Mints a document-unique id from the one the drop wrote. See the generator's
 * header: 22 of the 46 files carry a \`<mask>\`, and two instances of the same
 * icon on one page would otherwise repeat its id.
 */
type Mint = (id: string) => string;

/** A drawing is the children of the \`<svg>\`, not the \`<svg>\`. */
type Variant = (u: Mint) => ReactElement;

/** At or below this size the optical variant is used, for the seven that ship one. */
export const MICRO_MAX = ${MICRO_MAX};

export const ICON_NAMES = [
${names.map(n => `  '${n}',`).join('\n')}
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** The seven with a hand-drawn 14px cut. The other thirty-two fall back to base. */
export const MICRO_ICON_NAMES: readonly IconName[] = [
${microNames.map(n => `  '${n}',`).join('\n')}
];

const BASE: Record<IconName, Variant> = {
${names.map(n => entry(n, icons.get(n).base)).join('\n')}
};

const MICRO: Partial<Record<IconName, Variant>> = {
${microNames.map(n => entry(n, icons.get(n).micro)).join('\n')}
};

export type IconProps = {
  name: IconName;
  /** Rendered box in CSS pixels. ${MICRO_MAX} or below picks the micro cut where one exists. */
  size?: number;
  className?: string;
};

/**
 * Always \`aria-hidden\`. Two cases and they are not the same: an icon beside its
 * own label is decorative and the label carries the meaning; an icon alone in a
 * control means the *button* needs an \`aria-label\`. Neither case wants a name on
 * the \`<svg>\`, and a component that offered one would invite the third, wrong
 * answer — a picture that announces itself twice.
 */
export function Icon({ name, size = 20, className }: IconProps): ReactElement {
  const instance = useId().replace(/[^a-zA-Z0-9]/g, '');

  const micro: Variant | undefined = size <= MICRO_MAX ? MICRO[name] : undefined;
  const base: Variant | undefined = BASE[name];
  const draw = micro ?? base;

  // Loudly, not as an empty box: a typo in a name is invisible otherwise, and
  // \`IconName\` only guards the call sites the compiler can see.
  if (!draw) throw new Error(\`Icon: unknown name "\${String(name)}"\`);

  return (
    <svg
      className={className ? \`icon \${className}\` : 'icon'}
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {draw(id => \`\${id}-\${instance}\`)}
    </svg>
  );
}
`;

writeFileSync(OUT, file);
console.log(`${names.length} icons (${microNames.length} with a micro cut) -> ${OUT.replace(ROOT + '/', '')}`);
