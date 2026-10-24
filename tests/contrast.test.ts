import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CATEGORY_HUES } from '@/globe';

/**
 * WCAG AA for every colour pair the app draws (Prompt 5.1): text at 4.5:1
 * (1.4.3), and what identifies a control or its state at 3:1 (1.4.11).
 * Colours come from the app's own tokens (src/ui/styles/index.css) and
 * Tailwind's palette, never copied by hand, and translucent ones are
 * blended over what they really sit on. Over the globe that is anything
 * from space to sunlit cloud, so those pairs are checked over white, the
 * worst case for light text. axe-core checks the same in a browser
 * (tests/e2e), but cannot see through to the globe's canvas.
 */

type Rgb = readonly [number, number, number];

const ROOT = join(import.meta.dirname, '..');

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function hex(value: string): Rgb {
  const digits = value.replace('#', '');
  return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)) as unknown as Rgb;
}

/** OKLCH (Tailwind 4's palette) to 8-bit sRGB, through OKLab and linear sRGB. */
function oklch(l: number, c: number, hDeg: number): Rgb {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return linear.map((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  }) as unknown as Rgb;
}

/** The app's tokens, from the @theme block. */
const THEME = new Map(
  [...read('src/ui/styles/index.css').matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map(
    (m) => [m[1] ?? '', hex(m[2] ?? '')] as const,
  ),
);

/** Tailwind's palette colours the app uses. */
function palette(name: string): Rgb {
  const match = read('node_modules/tailwindcss/theme.css').match(
    new RegExp(`--color-${name}:\\s*oklch\\(([\\d.]+)% ([\\d.]+) ([\\d.]+)\\)`),
  );
  if (!match) throw new Error(`no Tailwind colour ${name}`);
  return oklch(Number(match[1]) / 100, Number(match[2]), Number(match[3]));
}

function color(name: string): Rgb {
  if (name === 'white') return [255, 255, 255];
  const token = THEME.get(name);
  if (token) return token;
  return palette(name);
}

/** "ink/80" over `under`: alpha-blended in sRGB, as browsers composite. */
function paint(spec: string, under: Rgb): Rgb {
  const [name = '', alpha] = spec.split('/');
  const top = color(name);
  const a = alpha === undefined ? 1 : Number(alpha) / 100;
  return top.map((c, i) => a * c + (1 - a) * (under[i] ?? 0)) as unknown as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r = 0, g = 0, b = 0] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const WHITE: Rgb = [255, 255, 255];

/**
 * The surfaces things sit on: a stack of paints from the bottom up.
 * "globe" is the worst case under a translucent overlay: white cloud.
 */
const SURFACES: Readonly<Record<string, readonly string[]>> = {
  void: ['void'],
  panel: ['panel'],
  'panel hover': ['panel', 'white/10'],
  'panel faint hover': ['panel', 'white/5'],
  'accent tint': ['panel', 'accent/15'],
  'accent tint strong': ['panel', 'accent/20'],
  'amber notice': ['panel', 'amber-300/10'],
  'field over globe': ['globe', 'panel/90'],
  'chip over globe': ['globe', 'panel/80'],
  'label over globe': ['globe', 'void/80'],
  'scrubber over globe': ['globe', 'void/90'],
  accent: ['accent'],
  'accent hover': ['panel', 'accent/90'],
  ink: ['ink'],
  danger: ['red-400'],
  'danger hover': ['red-300'],
};

function surface(name: string): Rgb {
  const stack = SURFACES[name];
  if (!stack) throw new Error(`no surface ${name}`);
  return stack.reduce<Rgb>((under, spec) => (spec === 'globe' ? WHITE : paint(spec, under)), WHITE);
}

/** Text colour → the surfaces it is used on. WCAG 1.4.3: 4.5:1. */
const TEXT: Readonly<Record<string, readonly string[]>> = {
  ink: [
    'void',
    'panel',
    'panel hover',
    'panel faint hover',
    'accent tint',
    'amber notice',
    'field over globe',
    'chip over globe',
    'label over globe',
    'scrubber over globe',
  ],
  'ink/90': ['panel', 'panel faint hover'],
  'ink/80': ['panel', 'panel hover'],
  'ink/70': ['panel', 'panel hover'],
  muted: [
    'void',
    'panel',
    'panel hover',
    'panel faint hover',
    'field over globe',
    'scrubber over globe',
  ],
  accent: ['void', 'panel', 'panel faint hover', 'accent tint', 'accent tint strong'],
  void: ['accent', 'accent hover', 'ink', 'danger', 'danger hover'],
  'side-a': ['panel'],
  'side-b': ['panel'],
  'red-300': ['panel', 'void'],
};

/** What identifies a control or a state, and what it sits on. WCAG 1.4.11: 3:1. */
const NON_TEXT: readonly (readonly [string, string, string])[] = [
  // A text field's edge (search, sign-in, the composer, admin forms).
  ['edge', 'panel', 'field edge'],
  ['edge', 'void', 'field edge'],
  ['edge', 'field over globe', 'search field edge'],
  // The focus outline, on every surface it is drawn over.
  ['accent', 'void', 'focus outline'],
  ['accent', 'panel', 'focus outline'],
  // Selected states: an inverted pill, or an accent border.
  ['ink', 'panel', 'selected tab, chip and switch'],
  ['accent', 'panel', 'chosen side and kind'],
  // The scrubber: stories ahead of the playhead, and behind it.
  ['muted/65', 'void', 'histogram, ahead'],
  ['accent/80', 'void', 'histogram, behind'],
  // Discussion sides and the neutral stance, as bars and dots.
  ['side-a', 'panel', 'side A'],
  ['side-b', 'panel', 'side B'],
  ['muted', 'panel', 'neutral'],
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('colour contrast (WCAG AA)', () => {
  it.each(Object.entries(TEXT).flatMap(([fg, on]) => on.map((bg) => [fg, bg] as const)))(
    'text %s on %s reaches 4.5:1',
    (fg, bg) => {
      const under = surface(bg);
      expect(ratio(paint(fg, under), under)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(NON_TEXT)('%s on %s (%s) reaches 3:1', (fg, bg) => {
    const under = surface(bg in SURFACES ? bg : 'void');
    expect(ratio(paint(fg, under), under)).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(CATEGORY_HUES))(
    'the %s mark reaches 3:1 on the panel and the page',
    (_name, hue) => {
      const mark = hex(`#${hue.toString(16).padStart(6, '0')}`);
      expect(ratio(mark, surface('panel'))).toBeGreaterThanOrEqual(3);
      expect(ratio(mark, surface('void'))).toBeGreaterThanOrEqual(3);
    },
  );

  it('audits every text colour the UI uses', () => {
    const used = new Set<string>();
    for (const file of walk(join(ROOT, 'src/ui'))) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(
        /(?:^|[\s"'`:])text-((?:ink|muted|accent|void|side-a|side-b|white|black|(?:red|amber|green|sky|rose|emerald|yellow)-\d{2,3})(?:\/\d+)?)(?=[\s"'`]|$)/gm,
      )) {
        used.add(m[1] ?? '');
      }
    }
    expect([...used].filter((spec) => !(spec in TEXT))).toEqual([]);
  });
});
