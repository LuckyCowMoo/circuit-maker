import type { Component, ComponentKind, Point, Rect, Rotation } from './types';
import { isGate } from './types';

export const GRID = 10;
export const PIN_LEN = 20;
export const PIN_SPACING = 20;
export const STROKE_W = 2.5;
export const BUBBLE_D = 10;
export const MAX_INPUTS = 256;
export const INPUT_WARN = 32;
export const IO_SIZE = 40;
export const IO_MIN = 20;
export const IO_MAX = 400;
export const PORT_SIZE = 20;

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
  /** Pin connection points, local to the unrotated body's top-left. */
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
  port: 8,
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

function build(kind: ComponentKind, n: number, negate: boolean, w: number, h: number): Geom {
  if (isGate(kind)) return buildGate(kind, n, negate);
  const base = { kind, n: 0, negate: false, offset: 0, depth: 0, back: [] as number[] };
  switch (kind) {
    case 'switch':
    case 'button':
      return {
        ...base,
        w,
        h,
        tip: w,
        inputs: [],
        output: { x: w + PIN_LEN, y: h / 2 },
        bounds: { x: 0, y: 0, w: w + PIN_LEN, h },
      };
    case 'bulb':
      return {
        ...base,
        w,
        h,
        tip: w,
        inputs: [{ x: -PIN_LEN, y: h / 2 }],
        back: [3],
        output: null,
        bounds: { x: -PIN_LEN, y: 0, w: w + PIN_LEN, h },
      };
    case 'port':
      return {
        ...base,
        w: PORT_SIZE,
        h: PORT_SIZE,
        tip: PORT_SIZE,
        inputs: [{ x: 0, y: PORT_SIZE / 2 }],
        back: [0],
        output: { x: PORT_SIZE, y: PORT_SIZE / 2 },
        bounds: { x: 0, y: 0, w: PORT_SIZE, h: PORT_SIZE },
      };
    default:
      return { ...base, w: 30, h: 40, tip: 30, inputs: [], output: null, bounds: { x: 0, y: 0, w: 30, h: 40 } };
  }
}

export function geomFor(kind: ComponentKind, n: number, negate: boolean, w = IO_SIZE, h = IO_SIZE): Geom {
  const gate = isGate(kind);
  const io = kind === 'switch' || kind === 'button' || kind === 'bulb';
  const key =
    KIND_INDEX[kind] * 1_000_000 + (gate ? n * 2 + (negate ? 1 : 0) : io ? Math.round(w) * 1000 + Math.round(h) : 0);
  let g = cache.get(key);
  if (!g) {
    g = build(kind, gate ? n : 0, gate && negate, w, h);
    cache.set(key, g);
  }
  return g;
}

export const geomOf = (c: Component): Geom => geomFor(c.kind, c.inputs, c.negate, c.w, c.h);

export const snap = (v: number): number => Math.round(v / GRID) * GRID;

// ---------------------------------------------------------------- orientation

/** Affine map from a component's local frame to the world, in canvas order (a b c d e f). */
export interface Xf {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Unrotated body size: the box that rotation turns and `x`, `y` positions. */
export function localSize(c: Component): { w: number; h: number } {
  const g = geomOf(c);
  return { w: g.tip, h: g.h };
}

const oriented = (c: Component) => c.kind !== 'marker';

export function xformOf(c: Component): Xf {
  const { w: W, h: H } = localSize(c);
  const rot = oriented(c) ? c.rot : 0;
  let m: Xf;
  switch (rot) {
    case 1:
      m = { a: 0, b: 1, c: -1, d: 0, e: H, f: 0 };
      break;
    case 2:
      m = { a: -1, b: 0, c: 0, d: -1, e: W, f: H };
      break;
    case 3:
      m = { a: 0, b: -1, c: 1, d: 0, e: 0, f: W };
      break;
    default:
      m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  }
  if (oriented(c) && c.flip) m = { a: -m.a, b: -m.b, c: m.c, d: m.d, e: m.e + m.a * W, f: m.f + m.b * W };
  m.e += c.x;
  m.f += c.y;
  return m;
}

export const applyXf = (m: Xf, p: Point): Point => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

const applyDir = (m: Xf, v: Point): Point => ({ x: m.a * v.x + m.c * v.y, y: m.b * v.x + m.d * v.y });

/** Size of the body after rotation. */
export function rotatedSize(c: Component): { w: number; h: number } {
  const s = localSize(c);
  return oriented(c) && c.rot % 2 === 1 ? { w: s.h, h: s.w } : s;
}

/** Changes rotation/flip while keeping the body centre in place (snapped to the grid). */
export function reorient(c: Component, rot: Rotation, flip: boolean): void {
  const before = componentCenter(c);
  c.rot = rot;
  c.flip = flip;
  const s = rotatedSize(c);
  c.x = snap(before.x - s.w / 2);
  c.y = snap(before.y - s.h / 2);
}

// ---------------------------------------------------------------- pins

export function inputPos(c: Component, i: number): Point | null {
  const p = geomOf(c).inputs[i];
  return p ? applyXf(xformOf(c), p) : null;
}

export function outputPos(c: Component): Point | null {
  const p = geomOf(c).output;
  return p ? applyXf(xformOf(c), p) : null;
}

/** pin < 0 means the output pin. */
export function pinPos(c: Component, pin: number): Point | null {
  return pin < 0 ? outputPos(c) : inputPos(c, pin);
}

/** Unit vector pointing away from the component at a pin. */
export function pinDir(c: Component, pin: number): Point {
  return applyDir(xformOf(c), { x: pin < 0 ? 1 : -1, y: 0 });
}

/** Where a connected wire meets the body (the stub is hidden once a pin is wired). */
export function attachPos(c: Component, pin: number): Point | null {
  const g = geomOf(c);
  const m = xformOf(c);
  if (pin < 0) return g.output ? applyXf(m, { x: g.tip, y: g.output.y }) : null;
  const p = g.inputs[pin];
  return p ? applyXf(m, { x: g.back[pin] ?? 0, y: p.y }) : null;
}

// ---------------------------------------------------------------- rects

export const MARKER_FONT = 16;

export function markerLabelWidth(name: string): number {
  return name ? name.length * MARKER_FONT * 0.6 + 14 : 0;
}

/** The clickable body (plus marker label), without pin stubs. */
export function bodyRect(c: Component): Rect {
  const s = rotatedSize(c);
  const w = c.kind === 'marker' ? s.w + markerLabelWidth(c.name) : s.w;
  return { x: c.x, y: c.y, w, h: s.h };
}

/** Full world-space bounds, including pin stubs and marker label. */
export function componentBounds(c: Component): Rect {
  const b = geomOf(c).bounds;
  if (c.kind === 'marker') return { x: c.x + b.x, y: c.y + b.y, w: b.w + markerLabelWidth(c.name), h: b.h };
  const m = xformOf(c);
  const p = applyXf(m, { x: b.x, y: b.y });
  const q = applyXf(m, { x: b.x + b.w, y: b.y + b.h });
  const x = Math.min(p.x, q.x);
  const y = Math.min(p.y, q.y);
  return { x, y, w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) };
}

export function componentCenter(c: Component): Point {
  const s = rotatedSize(c);
  return { x: c.x + s.w / 2, y: c.y + s.h / 2 };
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

// ---------------------------------------------------------------- wires

export interface WireCurve {
  a: Point;
  c1: Point;
  c2: Point;
  b: Point;
}

const RIGHT: Point = { x: 1, y: 0 };
const LEFT: Point = { x: -1, y: 0 };

/**
 * Curve from an output at `a` (leaving in direction `da`) to an input at `b` (entered from
 * direction `db`, which points away from the input's component).
 */
export function wireCurve(a: Point, b: Point, da: Point = RIGHT, db: Point = LEFT): WireCurve {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const along = vx * da.x + vy * da.y;
  const perp = Math.abs(vx * da.y - vy * da.x);
  const k = Math.max(30, Math.abs(along) * 0.5 + (along < 0 ? perp * 0.25 + 30 : 0));
  return { a, c1: { x: a.x + da.x * k, y: a.y + da.y * k }, c2: { x: b.x + db.x * k, y: b.y + db.y * k }, b };
}

/** The curve of a wire from `src`'s output to input `input` of `dst`. */
export function wireBetween(src: Component, dst: Component, input: number): WireCurve | null {
  const a = attachPos(src, -1);
  const b = attachPos(dst, input);
  if (!a || !b) return null;
  return wireCurve(a, b, pinDir(src, -1), pinDir(dst, input));
}

export function curveBounds(c: WireCurve): Rect {
  const x0 = Math.min(c.a.x, c.b.x, c.c1.x, c.c2.x);
  const x1 = Math.max(c.a.x, c.b.x, c.c1.x, c.c2.x);
  const y0 = Math.min(c.a.y, c.b.y, c.c1.y, c.c2.y);
  const y1 = Math.max(c.a.y, c.b.y, c.c1.y, c.c2.y);
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
