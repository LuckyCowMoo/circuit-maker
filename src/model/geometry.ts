import type { Component, ComponentKind, Point, Rect, Rotation } from './types';
import { bundleDest, bundleInput, bundleOutput, bundleSource, isGate, isRibbonPort } from './types';

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
/** Distance between lanes of a ribbon cable. */
export const RIBBON_PITCH = 16;

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
  /** One point per output lane. Ribbons and ribbon ports; absent means the single `output`. */
  outputs?: Point[];
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
  timer: 6,
  bulb: 7,
  rgb: 8,
  marker: 9,
  note: 11,
  port: 10,
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

/** Ribbon port with independently configurable cable/wire faces. */
function ribbonPortGeom(n: number, inputBundle: boolean, outputBundle: boolean): Geom {
  const count = Math.max(1, n);
  const h = count * RIBBON_PITCH;
  const w = 22;
  const lanes = (x: number) => Array.from({ length: count }, (_, i) => ({ x, y: RIBBON_PITCH / 2 + i * RIBBON_PITCH }));
  const inputs = inputBundle ? [{ x: -PIN_LEN, y: h / 2 }] : lanes(-PIN_LEN);
  const outputs = outputBundle ? [{ x: w + PIN_LEN, y: h / 2 }] : lanes(w + PIN_LEN);
  return {
    kind: 'port',
    n: count,
    negate: false,
    w,
    h,
    offset: 0,
    depth: 0,
    tip: w,
    inputs,
    back: inputs.map(() => 0),
    output: outputs[0],
    outputs,
    bounds: { x: -PIN_LEN, y: 0, w: w + 2 * PIN_LEN, h },
  };
}

function build(
  kind: ComponentKind,
  n: number,
  negate: boolean,
  w: number,
  h: number,
  inputBundle = false,
  outputBundle = false,
): Geom {
  if (isGate(kind)) return buildGate(kind, n, negate);
  const base = { kind, n: 0, negate: false, offset: 0, depth: 0, back: [] as number[] };
  switch (kind) {
    case 'switch':
    case 'button':
    case 'timer':
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
    case 'rgb': {
      const ys = [h / 4, h / 2, (3 * h) / 4];
      const inputs = inputBundle ? [{ x: -PIN_LEN, y: h / 2 }] : ys.map((y) => ({ x: -PIN_LEN, y }));
      // Meet the circular body at each pin's height (not the leftmost tangent).
      const cx = w / 2;
      const cy = h / 2;
      const r = Math.min(w, h) / 2 - 3;
      const edgeX = (y: number) => {
        const dy = y - cy;
        return cx - Math.sqrt(Math.max(0, r * r - dy * dy));
      };
      return {
        ...base,
        n: 3,
        w,
        h,
        tip: w,
        inputs,
        back: inputs.map((p) => edgeX(p.y)),
        output: null,
        bounds: { x: -PIN_LEN, y: 0, w: w + PIN_LEN, h },
      };
    }
    case 'port':
      if (n > 1) return ribbonPortGeom(n, inputBundle, outputBundle);
      return {
        ...base,
        w: PORT_SIZE,
        h: PORT_SIZE,
        tip: PORT_SIZE,
        inputs: [{ x: -PIN_LEN, y: PORT_SIZE / 2 }],
        back: [0],
        output: { x: PORT_SIZE + PIN_LEN, y: PORT_SIZE / 2 },
        bounds: { x: -PIN_LEN, y: 0, w: PORT_SIZE + 2 * PIN_LEN, h: PORT_SIZE },
      };
    case 'note':
      return { ...base, w, h, tip: w, inputs: [], output: null, bounds: { x: 0, y: 0, w, h } };
    default:
      return { ...base, w: 30, h: 40, tip: 30, inputs: [], output: null, bounds: { x: 0, y: 0, w: 30, h: 40 } };
  }
}

export function geomFor(
  kind: ComponentKind,
  n: number,
  negate: boolean,
  w = IO_SIZE,
  h = IO_SIZE,
  inputBundle = false,
  outputBundle = false,
): Geom {
  const gate = isGate(kind);
  const wide = kind === 'port' && n > 1;
  const io = kind === 'switch' || kind === 'button' || kind === 'timer' || kind === 'bulb' || kind === 'rgb' || kind === 'note';
  const key =
    KIND_INDEX[kind] * 1_000_000 +
    (inputBundle ? 500_000 : 0) +
    (outputBundle ? 250_000 : 0) +
    (gate || wide ? n * 2 + (negate ? 1 : 0) : io ? Math.round(w) * 1000 + Math.round(h) : 0);
  let g = cache.get(key);
  if (!g) {
    g = build(kind, gate || wide ? n : 0, gate && negate, w, h, inputBundle, outputBundle);
    cache.set(key, g);
  }
  return g;
}

export const geomOf = (c: Component): Geom =>
  geomFor(c.kind, c.inputs, c.negate, c.w, c.h, bundleInput(c), bundleOutput(c));

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
  if (pin >= 0) return inputPos(c, pin);
  const g = geomOf(c);
  const p = g.outputs?.[-pin - 1] ?? (pin === -1 ? g.output : null);
  return p ? applyXf(xformOf(c), p) : null;
}

/** Unit vector pointing away from the component at a pin. */
export function pinDir(c: Component, pin: number): Point {
  return applyDir(xformOf(c), { x: pin < 0 ? 1 : -1, y: 0 });
}

/** Where a connected wire meets the body (the stub is hidden once a pin is wired). */
export function attachPos(c: Component, pin: number): Point | null {
  const g = geomOf(c);
  const m = xformOf(c);
  if (pin < 0) {
    const p = g.outputs?.[-pin - 1] ?? (pin === -1 ? g.output : null);
    return p ? applyXf(m, { x: g.tip, y: p.y }) : null;
  }
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
  /** Extra cubics after the first, each starting where the previous one ended. */
  tail?: { c1: Point; c2: Point; b: Point }[];
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

/** Pin a wire end attaches to. A single wire into a cable-input port lands on that lane's wire pin. */
export function wireEndPin(c: Component, pin: number, cable = false): number {
  if (cable) return bundleDest(c) && pin >= 0 ? 0 : bundleSource(c) && pin < 0 ? -1 : pin;
  if (pin >= 0 && bundleInput(c) && !bundleOutput(c) && isRibbonPort(c)) return -1 - pin;
  if (pin < 0 && bundleOutput(c) && !bundleInput(c) && isRibbonPort(c)) return -pin - 1;
  return pin;
}
export function wireBetween(src: Component, dst: Component, input: number, lane = 0): WireCurve | null {
  const a = attachPos(src, wireEndPin(src, bundleSource(src) ? -1 : -1 - lane, false));
  const b = attachPos(dst, wireEndPin(dst, input, false));
  if (!a || !b) return null;
  return wireCurve(a, b, pinDir(src, -1), pinDir(dst, wireEndPin(dst, input, false)));
}

export function curveBounds(c: WireCurve): Rect {
  let x0 = Math.min(c.a.x, c.b.x, c.c1.x, c.c2.x);
  let x1 = Math.max(c.a.x, c.b.x, c.c1.x, c.c2.x);
  let y0 = Math.min(c.a.y, c.b.y, c.c1.y, c.c2.y);
  let y1 = Math.max(c.a.y, c.b.y, c.c1.y, c.c2.y);
  for (const s of c.tail ?? []) {
    x0 = Math.min(x0, s.c1.x, s.c2.x, s.b.x);
    x1 = Math.max(x1, s.c1.x, s.c2.x, s.b.x);
    y0 = Math.min(y0, s.c1.y, s.c2.y, s.b.y);
    y1 = Math.max(y1, s.c1.y, s.c2.y, s.b.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Thickness of one stripe in a ribbon cable. Stripes sit against each other. */
export const CABLE_PITCH = 4;

/**
 * One stripe of a ribbon cable. Stripe 0 is on the left of the direction of travel (the top of
 * a cable that runs to the right). Offsets stay at full width through both ends; the tip no
 * longer collapses onto the plug.
 */
function curveCorners(c: WireCurve): Point[] {
  const pts = [c.a, c.b];
  for (const s of c.tail ?? []) pts.push(s.b);
  return pts;
}

function orthoCorners(pts: Point[]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const dx = Math.abs(pts[i].x - pts[i - 1].x);
    const dy = Math.abs(pts[i].y - pts[i - 1].y);
    if (dx > 0.5 && dy > 0.5) return false;
  }
  return pts.length >= 2;
}

/** Offset an orthogonal polyline so each corner stays a sharp 90 degrees. */
function miterOffset(pts: Point[], off: number): Point[] {
  const dir = (i: number) => {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  };
  const normal = (d: Point) => ({ x: -d.y, y: d.x });
  const out: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i === 0 || i === pts.length - 1) {
      const d = dir(i === 0 ? 0 : pts.length - 2);
      const n = normal(d);
      out.push({ x: pts[i].x + n.x * off, y: pts[i].y + n.y * off });
      continue;
    }
    const n0 = normal(dir(i - 1));
    const n1 = normal(dir(i));
    const mx = n0.x + n1.x;
    const my = n0.y + n1.y;
    const denom = n0.x * mx + n0.y * my;
    const scale = Math.abs(denom) < 1e-6 ? 0 : off / denom;
    out.push({ x: pts[i].x + mx * scale, y: pts[i].y + my * scale });
  }
  return out;
}

export function cableStripe(curve: WireCurve, index: number, count: number, da?: Point, db?: Point): Point[] {
  const off = (index - (count - 1) / 2) * CABLE_PITCH;
  const corners = curveCorners(curve);
  if (orthoCorners(corners)) return miterOffset(corners, off);
  const startN = da ? { x: -da.y, y: da.x } : null;
  const endN = db ? { x: db.y, y: -db.x } : null;
  const pts: Point[] = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = curvePoint(curve, t);
    let nx: number;
    let ny: number;
    if (t < 0.001 && startN) {
      nx = startN.x;
      ny = startN.y;
    } else if (t > 0.999 && endN) {
      nx = endN.x;
      ny = endN.y;
    } else {
      const t0 = Math.max(0, t - 0.02);
      const t1 = Math.min(1, t + 0.02);
      const a = curvePoint(curve, t0);
      const b = curvePoint(curve, t1);
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      nx = -((b.y - a.y) / len);
      ny = (b.x - a.x) / len;
    }
    const nlen = Math.hypot(nx, ny) || 1;
    pts.push({ x: p.x + (nx / nlen) * off, y: p.y + (ny / nlen) * off });
  }
  return pts;
}

function cubicAt(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const u = 1 - t;
  const A = u * u * u;
  const B = 3 * u * u * t;
  const D = 3 * u * t * t;
  const E = t * t * t;
  return { x: A * a.x + B * c1.x + D * c2.x + E * b.x, y: A * a.y + B * c1.y + D * c2.y + E * b.y };
}

/** Cubic pieces of a wire, in order. */
export function curveSegments(c: WireCurve): { a: Point; c1: Point; c2: Point; b: Point }[] {
  const segs = [{ a: c.a, c1: c.c1, c2: c.c2, b: c.b }];
  let prev = c.b;
  for (const s of c.tail ?? []) {
    segs.push({ a: prev, c1: s.c1, c2: s.c2, b: s.b });
    prev = s.b;
  }
  return segs;
}

export function curvePoint(c: WireCurve, t: number): Point {
  const segs = curveSegments(c);
  const u = Math.max(0, Math.min(1, t)) * segs.length;
  const i = Math.min(segs.length - 1, Math.floor(u));
  const s = segs[i];
  return cubicAt(s.a, s.c1, s.c2, s.b, segs.length === 1 ? t : u - i);
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
  let d = `M${f(c.a.x)} ${f(c.a.y)}C${f(c.c1.x)} ${f(c.c1.y)} ${f(c.c2.x)} ${f(c.c2.y)} ${f(c.b.x)} ${f(c.b.y)}`;
  for (const s of c.tail ?? []) d += `C${f(s.c1.x)} ${f(s.c1.y)} ${f(s.c2.x)} ${f(s.c2.y)} ${f(s.b.x)} ${f(s.b.y)}`;
  return d;
}
