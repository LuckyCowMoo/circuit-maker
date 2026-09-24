import type { Component, ComponentKind, Point, Rect } from './types';
import { isGate } from './types';

export const GRID = 10;
export const PIN_LEN = 20;
export const PIN_SPACING = 20;
export const STROKE_W = 2.5;
export const BUBBLE_D = 10;
export const MAX_INPUTS = 256;
export const INPUT_WARN = 32;

export interface Geom {
  kind: ComponentKind;
  n: number;
  negate: boolean;
  /** Body size, excluding bubble and pin stubs. */
  w: number;
  h: number;
  /** XOR: x offset of the main body behind the extra back curve. */
  offset: number;
  /** OR/XOR: depth of the concave back curve. */
  depth: number;
  /** x where the output stub starts (body width plus bubble). */
  tip: number;
  /** Pin connection points, local to the body's top-left. */
  inputs: Point[];
  /** x where each input stub meets the body. */
  back: number[];
  output: Point | null;
  /** Local bounds including pin stubs. */
  bounds: Rect;
}

const KIND_INDEX: Record<ComponentKind, number> = {
  and: 0,
  or: 1,
  xor: 2,
  buffer: 3,
  switch: 4,
  button: 5,
  bulb: 6,
  marker: 7,
};

const cache = new Map<number, Geom>();

export function gateHeight(n: number): number {
  return Math.max(2, n) * PIN_SPACING;
}

function buildGate(kind: ComponentKind, n: number, negate: boolean): Geom {
  const h = gateHeight(n);
  const steps = Math.floor((h - 40) / 40);
  let w: number;
  let offset = 0;
  let depth = 0;
  if (kind === 'and') w = h >= 60 ? 60 : 50;
  else if (kind === 'buffer') w = Math.min(80, 40 + 10 * steps);
  else {
    w = Math.min(90, 60 + 10 * steps);
    depth = Math.min(h * 0.15, 14);
    if (kind === 'xor') {
      offset = 10;
      w += 10;
    }
  }
  const tip = w + (negate ? BUBBLE_D : 0);
  const inputs: Point[] = [];
  const back: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? h / 2 : PIN_SPACING / 2 + PIN_SPACING * i;
    inputs.push({ x: -PIN_LEN, y });
    const t = y / h;
    back.push(depth ? 4 * t * (1 - t) * depth : 0);
  }
  return {
    kind,
    n,
    negate,
    w,
    h,
    offset,
    depth,
    tip,
    inputs,
    back,
    output: { x: tip + PIN_LEN, y: h / 2 },
    bounds: { x: -PIN_LEN, y: 0, w: tip + 2 * PIN_LEN, h },
  };
}

function build(kind: ComponentKind, n: number, negate: boolean): Geom {
  if (isGate(kind)) return buildGate(kind, n, negate);
  const base = { kind, n: 0, negate: false, offset: 0, depth: 0, back: [] as number[] };
  switch (kind) {
    case 'switch':
    case 'button':
      return {
        ...base,
        w: 40,
        h: 40,
        tip: 40,
        inputs: [],
        output: { x: 40 + PIN_LEN, y: 20 },
        bounds: { x: 0, y: 0, w: 40 + PIN_LEN, h: 40 },
      };
    case 'bulb':
      return {
        ...base,
        w: 40,
        h: 40,
        tip: 40,
        inputs: [{ x: -PIN_LEN, y: 20 }],
        back: [3],
        output: null,
        bounds: { x: -PIN_LEN, y: 0, w: 40 + PIN_LEN, h: 40 },
      };
    default:
      return { ...base, w: 30, h: 40, tip: 30, inputs: [], output: null, bounds: { x: 0, y: 0, w: 30, h: 40 } };
  }
}

export function geomFor(kind: ComponentKind, n: number, negate: boolean): Geom {
  const gate = isGate(kind);
  const key = KIND_INDEX[kind] * 1_000_000 + (gate ? n * 2 + (negate ? 1 : 0) : 0);
  let g = cache.get(key);
  if (!g) {
    g = build(kind, gate ? n : 0, gate && negate);
    cache.set(key, g);
  }
  return g;
}

export const geomOf = (c: Component): Geom => geomFor(c.kind, c.inputs, c.negate);

export const snap = (v: number): number => Math.round(v / GRID) * GRID;

export function inputPos(c: Component, i: number): Point | null {
  const p = geomOf(c).inputs[i];
  return p ? { x: c.x + p.x, y: c.y + p.y } : null;
}

export function outputPos(c: Component): Point | null {
  const p = geomOf(c).output;
  return p ? { x: c.x + p.x, y: c.y + p.y } : null;
}

/** pin < 0 means the output pin. */
export function pinPos(c: Component, pin: number): Point | null {
  return pin < 0 ? outputPos(c) : inputPos(c, pin);
}

export const MARKER_FONT = 16;

export function markerLabelWidth(name: string): number {
  return name ? name.length * MARKER_FONT * 0.6 + 14 : 0;
}

/** The clickable body (plus marker label), without pin stubs. */
export function bodyRect(c: Component): Rect {
  const g = geomOf(c);
  const w = c.kind === 'marker' ? g.tip + markerLabelWidth(c.name) : g.tip;
  return { x: c.x, y: c.y, w, h: g.h };
}

/** Full world-space bounds, including pin stubs and marker label. */
export function componentBounds(c: Component): Rect {
  const b = geomOf(c).bounds;
  const extra = c.kind === 'marker' ? markerLabelWidth(c.name) : 0;
  return { x: c.x + b.x, y: c.y + b.y, w: b.w + extra, h: b.h };
}

export function componentCenter(c: Component): Point {
  const g = geomOf(c);
  return { x: c.x + g.tip / 2, y: c.y + g.h / 2 };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function rectInside(inner: Rect, outer: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInRect(p: Point, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.y >= r.y - pad && p.x <= r.x + r.w + pad && p.y <= r.y + r.h + pad;
}

export function inflate(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function unionRects(rects: Iterable<Rect>): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface WireCurve {
  a: Point;
  c1: Point;
  c2: Point;
  b: Point;
}

export function wireCurve(a: Point, b: Point): WireCurve {
  const dxAbs = Math.abs(b.x - a.x);
  const backwards = b.x < a.x;
  const dx = Math.max(30, dxAbs * 0.5 + (backwards ? Math.abs(b.y - a.y) * 0.25 + 30 : 0));
  return { a, c1: { x: a.x + dx, y: a.y }, c2: { x: b.x - dx, y: b.y }, b };
}

export function curveBounds(c: WireCurve): Rect {
  const x0 = Math.min(c.a.x, c.b.x, c.c2.x);
  const x1 = Math.max(c.a.x, c.b.x, c.c1.x);
  const y0 = Math.min(c.a.y, c.b.y);
  const y1 = Math.max(c.a.y, c.b.y);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function curvePoint(c: WireCurve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.a.x + b * c.c1.x + d * c.c2.x + e * c.b.x,
    y: a * c.a.y + b * c.c1.y + d * c.c2.y + e * c.b.y,
  };
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  let t = len ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function curveSvgPath(c: WireCurve): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(c.a.x)} ${f(c.a.y)}C${f(c.c1.x)} ${f(c.c1.y)} ${f(c.c2.x)} ${f(c.c2.y)} ${f(c.b.x)} ${f(c.b.y)}`;
}
