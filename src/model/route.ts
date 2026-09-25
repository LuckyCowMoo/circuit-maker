import type { Component, Doc, Point, Rect } from './types';
import {
  attachPos,
  bodyRect,
  curveBounds,
  curvePoint,
  inflate,
  pinDir,
  pointInRect,
  rectsOverlap,
  wireCurve,
  wireEndPin,
  type WireCurve,
} from './geometry';

const CELL = 220;
const CORNER_OUT = 14;
/** Extra clearance past the shared corner, in a few steps so nearby wires separate. */
const CORNER_SPREAD = [0, 3, 6, 9];

/** How wires are drawn. `curve` is a plain bend, `avoid` bends around objects, `square` is orthogonal. */
export type WireStyle = 'curve' | 'avoid' | 'square';

export function wireStyleOf(stored: string | null): WireStyle {
  if (stored === '0' || stored === 'curve') return 'curve';
  if (stored === 'square') return 'square';
  return 'avoid';
}

export interface AvoidMap {
  parts: { id: string; r: Rect }[];
  boxes: { id: string; r: Rect }[];
  partCells: Map<number, number[]>;
  boxCells: Map<number, number[]>;
  curves: Map<string, WireCurve>;
  /** Lane index for square routing, so overlapping runs sit a gap apart. */
  squareLanes: Map<string, number>;
}

function cellKey(ix: number, iy: number): number {
  return (ix * 73856093) ^ (iy * 19349663);
}

function paint(cells: Map<number, number[]>, r: Rect, index: number): void {
  const x0 = Math.floor(r.x / CELL);
  const y0 = Math.floor(r.y / CELL);
  const x1 = Math.floor((r.x + r.w) / CELL);
  const y1 = Math.floor((r.y + r.h) / CELL);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iy = y0; iy <= y1; iy++) {
      const k = cellKey(ix, iy);
      const list = cells.get(k);
      if (list) list.push(index);
      else cells.set(k, [index]);
    }
  }
}

function query(cells: Map<number, number[]>, r: Rect): number[] {
  const x0 = Math.floor(r.x / CELL);
  const y0 = Math.floor(r.y / CELL);
  const x1 = Math.floor((r.x + r.w) / CELL);
  const y1 = Math.floor((r.y + r.h) / CELL);
  const seen = new Set<number>();
  const out: number[] = [];
  for (let ix = x0; ix <= x1; ix++) {
    for (let iy = y0; iy <= y1; iy++) {
      const list = cells.get(cellKey(ix, iy));
      if (!list) continue;
      for (const i of list) if (!seen.has(i)) {
        seen.add(i);
        out.push(i);
      }
    }
  }
  return out;
}

function mix(h: number, n: number): number {
  return Math.imul(h ^ (n | 0), 0x9e3779b1);
}

function mixStr(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return h;
}

/** Changes when a wire's path might change. Camera and signal state do not affect it. */
function layoutStamp(doc: Doc): number {
  let h = 2166136261;
  h = mix(h, doc.components.size);
  h = mix(h, doc.wires.size);
  h = mix(h, doc.boxes.size);
  for (const c of doc.components.values()) {
    h = mixStr(h, c.id);
    h = mix(h, c.x);
    h = mix(h, c.y);
    h = mix(h, c.w);
    h = mix(h, c.h);
    h = mix(h, c.rot);
    h = mix(h, c.inputs);
    h = mix(h, c.flip ? 1 : 0);
  }
  for (const b of doc.boxes.values()) {
    h = mixStr(h, b.id);
    h = mix(h, b.x);
    h = mix(h, b.y);
    h = mix(h, b.w);
    h = mix(h, b.h);
  }
  for (const w of doc.wires.values()) {
    h = mixStr(h, w.id);
    h = mixStr(h, w.from);
    h = mixStr(h, w.to);
    h = mix(h, w.input);
    h = mix(h, w.lane ?? 0);
    h = mix(h, w.cable ? 1 : 0);
  }
  return h;
}

let built: { doc: Doc; stamp: number; map: AvoidMap } | null = null;

function buildMap(doc: Doc): AvoidMap {
  const parts: AvoidMap['parts'] = [];
  const boxes: AvoidMap['boxes'] = [];
  const partCells = new Map<number, number[]>();
  const boxCells = new Map<number, number[]>();
  for (const c of doc.components.values()) {
    if (c.kind === 'marker') continue;
    const r = bodyRect(c);
    paint(partCells, r, parts.length);
    parts.push({ id: c.id, r });
  }
  for (const b of doc.boxes.values()) {
    const r = { x: b.x, y: b.y, w: b.w, h: b.h };
    paint(boxCells, r, boxes.length);
    boxes.push({ id: b.id, r });
  }
  return { parts, boxes, partCells, boxCells, curves: new Map(), squareLanes: squareLanes(doc) };
}

/** Bodies and boxes a wire may bend around. Reused until the layout changes. */
export function avoidMap(doc: Doc): AvoidMap {
  const stamp = layoutStamp(doc);
  if (built && built.doc === doc && built.stamp === stamp) return built.map;
  const map = buildMap(doc);
  built = { doc, stamp, map };
  return map;
}

/** Drop cached wire curves so the next draw matches a fresh load. */
export function invalidateRoutes(): void {
  built = null;
}

function livesInside(box: Rect, p: Point, dir: Point): boolean {
  const inset = inflate(box, -2);
  if (inset.w > 0 && inset.h > 0 && pointInRect(p, inset)) return true;
  if (!pointInRect(p, inflate(box, 6))) return false;
  const cx = box.x + box.w / 2 - p.x;
  const cy = box.y + box.h / 2 - p.y;
  return cx * dir.x + cy * dir.y > 0;
}

/** Rects overlapping `area` that this wire should stay out of, inflated by `pad`. */
export function blockRects(map: AvoidMap, srcId: string, dstId: string, a: Point, da: Point, b: Point, db: Point, pad: number, area: Rect): Rect[] {
  const out: Rect[] = [];
  const span = inflate(area, pad + 24);
  for (const i of query(map.boxCells, span)) {
    const box = map.boxes[i];
    if (livesInside(box.r, a, da) && livesInside(box.r, b, db)) continue;
    const r = inflate(box.r, pad);
    if (rectsOverlap(r, span)) out.push(r);
  }
  for (const i of query(map.partCells, span)) {
    const part = map.parts[i];
    if (part.id === srcId || part.id === dstId) continue;
    const r = inflate(part.r, pad);
    if (rectsOverlap(r, span)) out.push(r);
  }
  return out;
}

function segHits(p: Point, q: Point, rects: Rect[]): boolean {
  const x0 = Math.min(p.x, q.x);
  const y0 = Math.min(p.y, q.y);
  const x1 = Math.max(p.x, q.x);
  const y1 = Math.max(p.y, q.y);
  for (const r of rects) {
    if (x1 < r.x || x0 > r.x + r.w || y1 < r.y || y0 > r.y + r.h) continue;
    if (pointInRect(p, r) || pointInRect(q, r)) return true;
    const edges: [Point, Point][] = [
      [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }],
      [{ x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }],
      [{ x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }],
      [{ x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }],
    ];
    for (const [c, d] of edges) if (cross(p, q, c, d)) return true;
  }
  return false;
}

function cross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d2 = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
  const d3 = (d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x);
  const d4 = (d.x - c.x) * (b.y - c.y) - (d.y - c.y) * (b.x - c.x);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function curveEnd(c: WireCurve): Point {
  const tail = c.tail;
  return tail && tail.length ? tail[tail.length - 1].b : c.b;
}

function curveHits(c: WireCurve, rects: Rect[], a: Point, b: Point): boolean {
  const end = curveEnd(c);
  const span = Math.hypot(end.x - c.a.x, end.y - c.a.y);
  const steps = Math.max(16, Math.min(64, Math.ceil(span / 36)));
  let prev = c.a;
  for (let i = 1; i <= steps; i++) {
    const p = curvePoint(c, i / steps);
    const nearA = Math.hypot(prev.x - a.x, prev.y - a.y) < 14 && Math.hypot(p.x - a.x, p.y - a.y) < 14;
    const nearB = Math.hypot(prev.x - b.x, prev.y - b.y) < 14 && Math.hypot(p.x - b.x, p.y - b.y) < 14;
    if (!nearA && !nearB && segHits(prev, p, rects)) return true;
    prev = p;
  }
  return false;
}

/**
 * Join waypoints with the same cubic as a floating wire. `slack` caps the handle length so a
 * detour stays next to the obstacle instead of bowing out across the whole span.
 */
function chainCurves(pts: Point[], travel: Point[], slack = Infinity): WireCurve {
  const segs: WireCurve[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const leave = travel[i];
    const into = travel[i + 1];
    const p = pts[i];
    const q = pts[i + 1];
    const vx = q.x - p.x;
    const vy = q.y - p.y;
    const k1 = Math.min(slack, Math.max(20, Math.abs(vx * leave.x + vy * leave.y) * 0.5));
    const k2 = Math.min(slack, Math.max(20, Math.abs(vx * into.x + vy * into.y) * 0.5));
    segs.push({
      a: p,
      c1: { x: p.x + leave.x * k1, y: p.y + leave.y * k1 },
      c2: { x: q.x - into.x * k2, y: q.y - into.y * k2 },
      b: q,
    });
  }
  const first = segs[0];
  return {
    a: first.a,
    c1: first.c1,
    c2: first.c2,
    b: first.b,
    tail: segs.length > 1 ? segs.slice(1).map((s) => ({ c1: s.c1, c2: s.c2, b: s.b })) : undefined,
  };
}

/** Stable per wire, so each connection keeps its own corner offsets. */
export function routeSeed(srcId: string, dstId: string, input: number, lane: number): number {
  let h = mixStr(2166136261, srcId);
  h = mixStr(h, dstId);
  h = mix(h, input);
  return mix(h, lane) || 1;
}

/**
 * Corners just outside `r`. `seed` shifts each one a few pixels further out, differently
 * on each axis, so wires that share a corner do not lie on the same point.
 */
function inflatedCorners(r: Rect, seed: number, scale = 1): Point[] {
  const signs = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  const pts: Point[] = [];
  for (let i = 0; i < 4; i++) {
    let h = seed;
    h = mix(h, i + 1);
    h = mix(h, Math.round(r.x));
    h = mix(h, Math.round(r.y));
    h = mix(h, Math.round(r.w));
    h = mix(h, Math.round(r.h));
    const extraX = seed ? CORNER_SPREAD[(h >>> 0) % CORNER_SPREAD.length] : 0;
    const extraY = seed ? CORNER_SPREAD[((h >>> 8) >>> 0) % CORNER_SPREAD.length] : 0;
    const sx = signs[i][0];
    const sy = signs[i][1];
    const x0 = sx < 0 ? r.x : r.x + r.w;
    const y0 = sy < 0 ? r.y : r.y + r.h;
    pts.push({ x: x0 + sx * (CORNER_OUT + extraX) * scale, y: y0 + sy * (CORNER_OUT + extraY) * scale });
  }
  return pts;
}

function dist(p: Point, q: Point): number {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

function unit(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Two corners on one side of `rect`, ordered along the wire. `sign` picks which side. */
function sideCorners(corners: Point[], a: Point, dir: Point, perp: Point, sign: number): Point[] {
  const scored = corners.map((c) => {
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    return { c, side: dx * perp.x + dy * perp.y, along: dx * dir.x + dy * dir.y };
  });
  scored.sort((p, q) => sign * q.side - sign * p.side);
  return [scored[0], scored[1]].sort((p, q) => p.along - q.along).map((s) => s.c);
}

function samePoint(p: Point, q: Point): boolean {
  return Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5;
}

const PIN_STUB = 14;

/** Pull a point that sits on a pin back along the segment, so the pin lead may enter the padding. */
function trimStub(pt: Point, other: Point, end: Point): Point {
  if (dist(pt, end) >= PIN_STUB) return pt;
  const ox = other.x - end.x;
  const oy = other.y - end.y;
  const od = Math.hypot(ox, oy) || 1;
  const keep = Math.min(PIN_STUB, od);
  return { x: end.x + (ox / od) * keep, y: end.y + (oy / od) * keep };
}

/** Segment hits a rect outside the short lead into either wire end. */
function hitsBody(p: Point, q: Point, rects: Rect[], a: Point, b: Point): boolean {
  let p2 = p;
  let q2 = q;
  if (dist(p, a) < PIN_STUB) p2 = trimStub(p, q, a);
  else if (dist(p, b) < PIN_STUB) p2 = trimStub(p, q, b);
  if (dist(q, b) < PIN_STUB) q2 = trimStub(q, p2, b);
  else if (dist(q, a) < PIN_STUB) q2 = trimStub(q, p2, a);
  return segHits(p2, q2, rects);
}

/**
 * Drop a corner when the run from the previous bend to the next already misses the obstacles.
 * Later corners go first, so a far corner is removed before it can justify deleting the near one.
 */
function pruneCorners(path: Point[], from: Point, to: Point, rects: Rect[], a: Point, b: Point): Point[] {
  const pts = [from, ...path, to];
  for (let i = pts.length - 2; i >= 1; i--) {
    if (!hitsBody(pts[i - 1], pts[i + 1], rects, a, b)) pts.splice(i, 1);
  }
  return pts.slice(1, -1);
}

/** Corners to walk so the wire passes just outside `rect` on the shorter side. */
function aroundRect(from: Point, to: Point, rect: Rect, a: Point, dir: Point, perp: Point, others: Rect[], seed: number, scale: number): Point[] {
  const corners = inflatedCorners(rect, 0, scale);
  let best: Point[] | null = null;
  let bestLen = Infinity;
  for (const sign of [1, -1]) {
    let path = sideCorners(corners, a, dir, perp, sign);
    const spare = () => corners.filter((c) => !path.some((p) => samePoint(p, c)));
    if (hitsBody(from, path[0], [rect], a, to)) {
      const extra = spare().sort((p, q) => dist(from, p) - dist(from, q))[0];
      if (extra) path = [extra, ...path];
    }
    const last = path[path.length - 1];
    if (hitsBody(last, to, [rect], a, to)) {
      const extra = spare().sort((p, q) => dist(to, p) - dist(to, q))[0];
      if (extra) path = [...path, extra];
    }
    path = pruneCorners(path, from, to, [rect, ...others], a, to);
    if (!path.length) continue;
    const pts = [from, ...path];
    let blocked = false;
    for (let i = 0; i < pts.length - 1; i++) {
      if (hitsBody(pts[i], pts[i + 1], [rect, ...others], a, to)) blocked = true;
    }
    if (blocked) continue;
    let len = 0;
    const whole = [...pts, to];
    for (let i = 1; i < whole.length; i++) len += dist(whole[i - 1], whole[i]);
    if (len < bestLen) {
      bestLen = len;
      best = path;
    }
  }
  const path = best ?? sideCorners(corners, a, dir, perp, 1);
  if (!seed) return path;
  const varied = inflatedCorners(rect, seed, scale);
  return path.map((p) => {
    const i = corners.findIndex((c) => samePoint(c, p));
    return i < 0 ? p : varied[i];
  });
}

/**
 * Pass just outside each obstacle's corners, nearer side first. Later obstacles add their
 * own corners, so the wire can go over one object and under the next.
 */
function weave(a: Point, da: Point, b: Point, db: Point, blocking: Rect[], seed: number, scale: number): WireCurve | null {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy) || 1;
  const dir = { x: vx / len, y: vy / len };
  const perp = { x: -dir.y, y: dir.x };
  const ordered = [...blocking].sort((p, q) => {
    const mid = (r: Rect) => (r.x + r.w / 2 - a.x) * dir.x + (r.y + r.h / 2 - a.y) * dir.y;
    return mid(p) - mid(q);
  });
  const pts: Point[] = [a];
  for (let i = 0; i < ordered.length; i++) {
    const from = pts[pts.length - 1];
    const others = ordered.filter((_, j) => j !== i);
    for (const c of aroundRect(from, b, ordered[i], a, dir, perp, others, seed, scale)) {
      if (!samePoint(c, pts[pts.length - 1])) pts.push(c);
    }
  }
  if (!samePoint(pts[pts.length - 1], b)) pts.push(b);
  if (pts.length < 3) return null;
  const curve = bendCurve(pts, da, db, dir, 28 * scale);
  return curveHits(curve, blocking, a, b) ? null : curve;
}

function bendCurve(pts: Point[], da: Point, db: Point, dir: Point, slack: number): WireCurve {
  const travel: Point[] = pts.map(() => dir);
  travel[0] = da;
  travel[travel.length - 1] = { x: -db.x, y: -db.y };
  for (let i = 1; i < pts.length - 1; i++) travel[i] = unit(pts[i + 1].x - pts[i - 1].x, pts[i + 1].y - pts[i - 1].y);
  return chainCurves(pts, travel, slack);
}

/** Curve from `a` (leaving along `da`) to `b` (approached along `db`), bent around each obstacle on its nearer side. */
export function bendAround(a: Point, da: Point, b: Point, db: Point, rects: Rect[], seed = 0): WireCurve {
  const direct = wireCurve(a, b, da, db);
  if (!rects.length || !curveHits(direct, rects, a, b)) return direct;
  const bounds = inflate(curveBounds(direct), 48);
  const near = rects.filter((r) => rectsOverlap(r, bounds));
  const blocking: Rect[] = [];
  for (const r of near) if (curveHits(direct, [r], a, b)) blocking.push(r);
  if (!blocking.length) return direct;
  // Full corner clearance first. If that bend still cuts a neighbour, bring every
  // corner in together, down to a quarter of the offset, and keep the first fit.
  let fallback: WireCurve | null = null;
  for (let scale = 1; scale >= 0.25 - 1e-6; scale -= 0.15) {
    const curve = weave(a, da, b, db, blocking, seed, scale);
    if (!curve) continue;
    fallback ??= curve;
    if (!curveHits(curve, near, a, b)) return curve;
  }
  return fallback ?? direct;
}

const SQUARE_GAP = 8;
const SQUARE_LEAD = 18;

function wireKey(from: string, to: string, input: number, lane: number): string {
  return `${from}\0${to}\0${input}\0${lane}`;
}

function leadOf(p: Point, dir: Point): Point {
  return { x: p.x + dir.x * SQUARE_LEAD, y: p.y + dir.y * SQUARE_LEAD };
}

/** The long run of a square wire: one straight segment, not a jog in the middle. */
function trunkOf(a: Point, da: Point, b: Point, db: Point): { horizontal: boolean; pos: number; lo: number; hi: number } {
  const s = leadOf(a, da);
  const e = leadOf(b, db);
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { horizontal: true, pos: s.y, lo: Math.min(s.x, e.x), hi: Math.max(s.x, e.x) };
  return { horizontal: false, pos: s.x, lo: Math.min(s.y, e.y), hi: Math.max(s.y, e.y) };
}

/** Smallest lane whose span is free. Lane 0 keeps the natural line; later lanes step off it. */
function pickLane(used: { lane: number; lo: number; hi: number; pos: number }[], it: { lo: number; hi: number; pos: number }): number {
  for (let n = 0; n < 32; n++) {
    const lane = n === 0 ? 0 : n % 2 === 1 ? (n + 1) / 2 : -n / 2;
    const hit = used.some((u) => u.lane === lane && it.lo < u.hi - 0.5 && it.hi > u.lo + 0.5 && Math.abs(it.pos - u.pos) < SQUARE_GAP * 1.5);
    if (!hit) return lane;
  }
  return 0;
}

function squareLanes(doc: Doc): Map<string, number> {
  const rows: { key: string; pos: number; lo: number; hi: number }[] = [];
  const cols: { key: string; pos: number; lo: number; hi: number }[] = [];
  for (const w of doc.wires.values()) {
    const src = doc.components.get(w.from);
    const dst = doc.components.get(w.to);
    if (!src || !dst || w.cable) continue;
    const lane = w.lane ?? 0;
    const input = w.input;
    const a = attachPos(src, wireEndPin(src, -1 - lane, !!w.cable));
    const b = attachPos(dst, wireEndPin(dst, input, !!w.cable));
    if (!a || !b) continue;
    const end = wireEndPin(dst, input, !!w.cable);
    const trunk = trunkOf(a, pinDir(src, -1), b, pinDir(dst, end));
    const item = { key: wireKey(w.from, w.to, input, lane), pos: trunk.pos, lo: trunk.lo, hi: trunk.hi };
    (trunk.horizontal ? rows : cols).push(item);
  }
  const out = new Map<string, number>();
  for (const group of [rows, cols]) {
    const used: { lane: number; lo: number; hi: number; pos: number }[] = [];
    const order = [...group].sort((p, q) => p.lo - q.lo || p.pos - q.pos);
    for (const it of order) {
      const lane = pickLane(used, it);
      out.set(it.key, lane);
      used.push({ lane, lo: it.lo, hi: it.hi, pos: it.pos });
    }
  }
  return out;
}

function simplifyOrtho(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev.x - p.x) < 0.5 && Math.abs(prev.y - p.y) < 0.5) continue;
    const a = out[out.length - 2];
    if (a && prev) {
      const sameX = Math.abs(a.x - prev.x) < 0.5 && Math.abs(prev.x - p.x) < 0.5;
      const sameY = Math.abs(a.y - prev.y) < 0.5 && Math.abs(prev.y - p.y) < 0.5;
      if (sameX || sameY) {
        out[out.length - 1] = p;
        continue;
      }
    }
    out.push(p);
  }
  return out;
}

function straightCurve(pts: Point[]): WireCurve {
  const segs: WireCurve[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    segs.push({
      a: p,
      c1: { x: (2 * p.x + q.x) / 3, y: (2 * p.y + q.y) / 3 },
      c2: { x: (p.x + 2 * q.x) / 3, y: (p.y + 2 * q.y) / 3 },
      b: q,
    });
  }
  const first = segs[0];
  return {
    a: first.a,
    c1: first.c1,
    c2: first.c2,
    b: first.b,
    tail: segs.length > 1 ? segs.slice(1).map((s) => ({ c1: s.c1, c2: s.c2, b: s.b })) : undefined,
  };
}

/**
 * Orthogonal wire with a single elbow, so the longer axis stays one straight run.
 * `lane` shifts that run only when another wire already occupies it.
 */
export function squareWire(a: Point, da: Point, b: Point, db: Point, lane = 0): WireCurve {
  const s = leadOf(a, da);
  const e = leadOf(b, db);
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const off = lane * SQUARE_GAP;
  const pts: Point[] = [a, s];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const y = s.y + off;
    if (off !== 0) pts.push({ x: s.x, y });
    if (Math.abs(e.x - s.x) > 0.5 || off !== 0) pts.push({ x: e.x, y });
    if (off !== 0) pts.push({ x: e.x, y: e.y });
  } else {
    const x = s.x + off;
    if (off !== 0) pts.push({ x, y: s.y });
    if (Math.abs(e.y - s.y) > 0.5 || off !== 0) pts.push({ x, y: e.y });
    if (off !== 0) pts.push({ x: e.x, y: e.y });
  }
  pts.push(e, b);
  return straightCurve(simplifyOrtho(pts));
}

/** Wire or cable curve in the chosen style. Cached until the layout changes. */
export function routedWire(map: AvoidMap, src: Component, dst: Component, input: number, lane: number, pad: number, style: WireStyle = 'avoid', cable = false): WireCurve | null {
  if (cable && style === 'square') style = 'avoid';
  const a = attachPos(src, wireEndPin(src, cable ? -1 : -1 - lane, cable));
  const b = attachPos(dst, wireEndPin(dst, input, cable));
  if (!a || !b) return null;
  const key = `${wireKey(src.id, dst.id, input, lane)}\0${pad}\0${style}`;
  const cached = map.curves.get(key);
  if (cached) return cached;
  const da = pinDir(src, -1);
  const db = pinDir(dst, wireEndPin(dst, input, cable));
  const direct = wireCurve(a, b, da, db);
  let curve = direct;
  if (style === 'square') curve = squareWire(a, da, b, db, map.squareLanes.get(wireKey(src.id, dst.id, input, lane)) ?? 0);
  else if (style === 'avoid') {
    const rects = blockRects(map, src.id, dst.id, a, da, b, db, pad, curveBounds(direct));
    if (rects.length) curve = bendAround(a, da, b, db, rects, routeSeed(src.id, dst.id, input, lane));
  }
  map.curves.set(key, curve);
  return curve;
}
