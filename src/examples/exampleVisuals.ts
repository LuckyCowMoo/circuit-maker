import { boxesOuterFirst } from '../model/doc';
import type { Doc } from '../model/types';
import { type Theme } from '../model/themes';

/** 0 = lightest (1-bit glue), 4 = hero / heavy cards. */
export type ExampleComplexity = 0 | 1 | 2 | 3 | 4;

export const GROUP_HUE: Record<string, number> = {
  Arithmetic: 168,
  Memory: 278,
  Displays: 38,
  Routing: 212,
  Games: 18,
  Tests: 220,
};

const COMPLEXITY: Record<string, ExampleComplexity> = {
  half: 0,
  full: 0,
  sr: 1,
  mem: 1,
  dff: 1,
  mux4: 1,
  dec2: 1,
  seg7: 1,
  adder4: 2,
  mul4: 2,
  div4: 2,
  mod4: 2,
  cmp4: 2,
  count4: 2,
  seg3: 2,
  adder8: 3,
  sub8: 3,
  reg8: 3,
  calc: 4,
  snake: 4,
  stress: 4,
};

export function exampleComplexity(id: string): ExampleComplexity {
  return COMPLEXITY[id] ?? 2;
}

export function groupHue(group: string): number {
  return GROUP_HUE[group] ?? 220;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return ln - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [255 * f(0), 255 * f(8), 255 * f(4)];
}

function channel(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const lum = (rgb: [number, number, number]) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const l1 = lum(a);
  const l2 = lum(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Section-coloured ink that stays readable on the card fill. */
function sectionInk(h: number, bg: [number, number, number]): string {
  let bestL = 16;
  let bestS = 72;
  let best = 0;
  for (const l of [12, 16, 20, 86, 92]) {
    const s = l > 50 ? 62 : 72;
    const score = contrastRatio(hslToRgb(h, s, l), bg);
    if (score > best) {
      best = score;
      bestL = l;
      bestS = s;
    }
  }
  return `hsl(${h}, ${bestS}%, ${bestL}%)`;
}

/** Card fill/border from section hue and bit-width tier. */
export function exampleCardColors(group: string, id: string): { bg: string; border: string; label: string } {
  const c = exampleComplexity(id);
  const h = groupHue(group);
  if (c === 4) {
    const bg = '#0c0c0e';
    return { bg, border: `hsl(${h}, 55%, 42%)`, label: '#f4f4f5' };
  }
  const l = 93 - c * 7;
  const s = 32 + c * 6;
  const bg = `hsl(${h}, ${s}%, ${l}%)`;
  const border = `hsl(${h}, ${s + 8}%, ${l - 12}%)`;
  return { bg, border, label: sectionInk(h, hslToRgb(h, s, l)) };
}

/** Accent for calculator (and other hero) icons — one per app theme. */
export function heroAccent(theme: Theme): string {
  switch (theme.id) {
    case 'paper':
      return theme.selection;
    case 'midnight':
      return theme.selection;
    case 'blueprint':
      return theme.on;
    default:
      return theme.selection;
  }
}

export function previewPath(themeId: string, exampleId: string): string {
  return `/example-previews/${themeId}/${exampleId}.svg`;
}

/** Above this many components, a hover picture is the boxes only. */
export const PREVIEW_PARTS_LIMIT = 120;

/** Example-card picture frame. Previews are padded out to this so nothing is cropped. */
export const PREVIEW_ASPECT = 4 / 3;

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Grow a preview's canvas to the card shape by adding background in the empty
 * bands. The circuit itself stays the same size.
 */
export function expandSvgCanvas(svg: string, aspect = PREVIEW_ASPECT): string {
  const vb = /viewBox="([^"]+)"/.exec(svg);
  if (!vb) return svg;
  const [x, y, w, h] = vb[1].trim().split(/[\s,]+/).map(Number);
  if (![x, y, w, h].every((n) => Number.isFinite(n)) || w <= 0 || h <= 0) return svg;
  if (Math.abs(w / h - aspect) < 1e-3) return svg;
  let nx = x;
  let ny = y;
  let nw = w;
  let nh = h;
  if (w / h > aspect) {
    nh = w / aspect;
    ny = y - (nh - h) / 2;
  } else {
    nw = h * aspect;
    nx = x - (nw - w) / 2;
  }
  let out = svg.replace(vb[0], `viewBox="${fmt(nx)} ${fmt(ny)} ${fmt(nw)} ${fmt(nh)}"`);
  out = out.replace(/<svg\b[^>]*>/, (tag) =>
    tag.replace(/\bwidth="[^"]*"/, `width="${fmt(nw)}"`).replace(/\bheight="[^"]*"/, `height="${fmt(nh)}"`),
  );
  return out.replace(/<rect\b[^>]*>/, (tag) => {
    const num = (name: string) => {
      const m = new RegExp(`\\b${name}="([^"]+)"`).exec(tag);
      return m ? Number(m[1]) : NaN;
    };
    const close = (a: number, b: number) => Math.abs(a - b) < 0.05;
    if (!close(num('x'), x) || !close(num('y'), y) || !close(num('width'), w) || !close(num('height'), h)) return tag;
    return tag
      .replace(/\bx="[^"]*"/, `x="${fmt(nx)}"`)
      .replace(/\by="[^"]*"/, `y="${fmt(ny)}"`)
      .replace(/\bwidth="[^"]*"/, `width="${fmt(nw)}"`)
      .replace(/\bheight="[^"]*"/, `height="${fmt(nh)}"`);
  });
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Thumbnail of a large example: the coloured boxes, without gates or wires. */
export function boxesPreviewSvg(doc: Doc, theme: Theme): string {
  const boxes = boxesOuterFirst(doc);
  let minX = 0;
  let minY = 0;
  let maxX = 200;
  let maxY = 120;
  if (boxes.length) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
  }
  const pad = Math.max(24, (maxX - minX + maxY - minY) * 0.02);
  const x = minX - pad;
  const y = minY - pad;
  const width = Math.max(1, maxX - minX + pad * 2);
  const height = Math.max(1, maxY - minY + pad * 2);
  const span = Math.max(width, height);
  const stroke = Math.max(2, span / 90);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" font-family="Inter, 'Segoe UI', system-ui, sans-serif">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${theme.bg}"/>`,
  ];
  for (const b of boxes) {
    const col = xml(b.color ?? theme.box);
    const rx = Math.min(b.w, b.h) * 0.06;
    parts.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${rx}" fill="${col}" fill-opacity="0.28" stroke="${col}" stroke-width="${stroke}"/>`,
    );
    if (!b.name) continue;
    const size = Math.min(b.h * 0.22, b.w / Math.max(4, b.name.length * 0.62), span / 28);
    if (size < span / 80) continue;
    parts.push(
      `<text x="${b.x + b.w - size * 0.45}" y="${b.y + size * 0.95}" font-size="${size}" font-weight="700" fill="${col}" text-anchor="end">${xml(b.name)}</text>`,
    );
  }
  parts.push('</svg>');
  return parts.join('\n');
}
