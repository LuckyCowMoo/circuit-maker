import { boxesOuterFirst, boxInBox, componentInBox, makeComponent, signalKeys } from '../model/doc';
import {
  attachPos,
  bodyRect,
  componentBounds,
  cableStripe,
  CABLE_PITCH,
  curveBounds,
  inflate,
  pinDir,
  pointInRect,
  rectInside,
  rectsOverlap,
  rotatedSize,
  snap,
  STROKE_W,
  wireCurve,
  xformOf,
  type WireCurve,
  type Xf,
} from '../model/geometry';
import { floatsAboveBoxes, partInfo, partLabel } from '../model/parts';
import { avoidMap, bendAround, blockRects, routeSeed, routedWire, squareWire } from '../model/route';
import { placePort } from '../model/ports';
import { componentOps, textRect, type DrawOp, type TextOp } from '../model/shapes';
import { contrastText, wireColors, type Theme, type WireColors } from '../model/themes';
import type { Box, Component, Point, Rect } from '../model/types';
import { bundleSource, laneCount } from '../model/types';
import { FONT_STACK } from '../io/export';
import type { Arrow, Camera, Editor } from './Editor';

/** Screen space kept clear at the bottom for the floating toolbar. */
export const TOOLBAR_SPACE = 110;
const FAR_ZOOM = 0.3;

const pathCache = new Map<string, Path2D>();
function path2d(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

let colorTheme: Theme | null = null;
const colorCache = new Map<string, WireColors>();
export function colorsFor(net: string, theme: Theme): WireColors {
  if (colorTheme !== theme) {
    colorCache.clear();
    colorTheme = theme;
  }
  let c = colorCache.get(net);
  if (!c) {
    c = wireColors(net, theme);
    colorCache.set(net, c);
  }
  return c;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * How "open" a box is: 1 shows its contents with the colour as a background wash,
 * 0 covers them with solid colour and a large centred name. Boxes open when zoomed in
 * and near the centre of the screen, and close when zoomed out or near the edges.
 */
export function boxOpenness(b: Box, cam: Camera, vw: number, vh: number): number {
  const z = cam.zoom;
  const sx = (b.x - cam.x) * z;
  const sy = (b.y - cam.y) * z;
  const sw = b.w * z;
  const sh = b.h * z;
  const size = smoothstep(100, 140, Math.min(sw, sh));
  const cx = vw / 2;
  const cy = vh / 2;
  const dx = Math.max(sx - cx, 0, cx - (sx + sw));
  const dy = Math.max(sy - cy, 0, cy - (sy + sh));
  const dist = Math.hypot(dx, dy) / (Math.min(vw, vh) / 2);
  const centre = 1 - smoothstep(0.82, 1.02, dist);
  const zoomed = smoothstep(0.18, 0.28, z);
  return smoothstep(0.3, 0.7, size * centre * zoomed);
}

function drawText(ctx: CanvasRenderingContext2D, op: TextOp): void {
  ctx.fillStyle = op.fill;
  ctx.font = `${op.bold ? 700 : 400} ${op.size}px ${FONT_STACK}`;
  ctx.textAlign = op.anchor === 'middle' ? 'center' : op.anchor === 'end' ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(op.text, op.x, op.y);
}

function drawOps(ctx: CanvasRenderingContext2D, ops: DrawOp[], m: Xf, px: number): void {
  ctx.save();
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  for (const op of ops) {
    if (op.t === 'path') {
      const p = path2d(op.d);
      if (op.alpha !== undefined) ctx.globalAlpha *= op.alpha;
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fill(p);
      }
      if (op.stroke) {
        ctx.strokeStyle = op.stroke;
        ctx.lineWidth = Math.max(op.width ?? STROKE_W, px);
        ctx.stroke(p);
      }
      if (op.alpha !== undefined) ctx.globalAlpha /= op.alpha;
    } else drawText(ctx, op);
  }
  ctx.restore();
}

interface Batch {
  path: Path2D;
  fill?: string;
  stroke?: string;
  width?: number;
  alpha?: number;
}

/**
 * Draws many components with few canvas calls: op i of every component goes into layer i,
 * and ops with identical styling within a layer share one Path2D.
 */
class OpBatcher {
  private layers: Map<string, Batch>[] = [];
  private texts: { op: TextOp; m: Xf }[] = [];

  add(ops: DrawOp[], m: Xf): void {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.t === 'text') {
        this.texts.push({ op, m });
        continue;
      }
      const layer = (this.layers[i] ??= new Map());
      const key = `${op.fill}|${op.stroke}|${op.width}|${op.alpha}`;
      let b = layer.get(key);
      if (!b) {
        b = { path: new Path2D(), fill: op.fill, stroke: op.stroke, width: op.width, alpha: op.alpha };
        layer.set(key, b);
      }
      b.path.addPath(path2d(op.d), m);
    }
  }

  flush(ctx: CanvasRenderingContext2D, px: number): void {
    for (const layer of this.layers) {
      if (!layer) continue;
      for (const b of layer.values()) {
        ctx.globalAlpha = b.alpha ?? 1;
        if (b.fill) {
          ctx.fillStyle = b.fill;
          ctx.fill(b.path);
        }
        if (b.stroke) {
          ctx.strokeStyle = b.stroke;
          ctx.lineWidth = Math.max(b.width ?? STROKE_W, px);
          ctx.stroke(b.path);
        }
      }
    }
    ctx.globalAlpha = 1;
    for (const t of this.texts) drawOps(ctx, [t.op], t.m, px);
    this.layers = [];
    this.texts = [];
  }
}


function addCurve(p: { moveTo(x: number, y: number): void; bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void }, c: WireCurve): void {
  p.moveTo(c.a.x, c.a.y);
  p.bezierCurveTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.b.x, c.b.y);
  for (const s of c.tail ?? []) p.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.b.x, s.b.y);
}

function strokeCurve(ctx: CanvasRenderingContext2D, c: WireCurve): void {
  ctx.beginPath();
  addCurve(ctx, c);
  ctx.stroke();
}

function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, w: number, h: number, theme: Theme): void {
  const z = cam.zoom;
  let step = 20;
  while (step * z < 16) step *= 5;
  const x0 = Math.floor(cam.x / step);
  const y0 = Math.floor(cam.y / step);
  const x1 = Math.ceil((cam.x + w / z) / step);
  const y1 = Math.ceil((cam.y + h / z) / step);
  const minor = new Path2D();
  const major = new Path2D();
  for (let i = x0; i <= x1; i++) {
    const sx = Math.round((i * step - cam.x) * z) + 0.5;
    const p = i % 5 === 0 ? major : minor;
    p.moveTo(sx, 0);
    p.lineTo(sx, h);
  }
  for (let j = y0; j <= y1; j++) {
    const sy = Math.round((j * step - cam.y) * z) + 0.5;
    const p = j % 5 === 0 ? major : minor;
    p.moveTo(0, sy);
    p.lineTo(w, sy);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = theme.grid;
  ctx.globalAlpha = 0.45;
  ctx.stroke(minor);
  ctx.globalAlpha = 1;
  ctx.stroke(major);
}

function roundRectPath(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.min(radius, r.w / 2, r.h / 2));
}

/**
 * Where to put a closed box's big name so it doesn't cover the switches, lights and ports
 * that stay visible on top: the centre if that's clear, otherwise the clear spot nearest the
 * centre, shrinking the text if nothing fits.
 */
function coverLabelLayout(
  ctx: CanvasRenderingContext2D,
  b: Box,
  obstacles: Rect[],
  px: number,
): { x: number; y: number; size: number } {
  const len = Math.max(1, b.name.length);
  const size0 = Math.max(8 * px, Math.min(b.h * 0.3, (b.w * 0.85) / (len * 0.6)));
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (!obstacles.length) return { x: cx, y: cy, size: size0 };
  const inner = inflate(b, -4 * px);
  for (let size = size0; size >= 8 * px; size *= 0.75) {
    ctx.font = `700 ${size}px ${FONT_STACK}`;
    const tw = Math.min(ctx.measureText(b.name).width, b.w * 0.92);
    const pad = size * 0.15;
    const rw = tw + 2 * pad;
    const rh = size + 2 * pad;
    const cands: Point[] = [{ x: cx, y: cy }];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        cands.push({
          x: inner.x + rw / 2 + ((inner.w - rw) * i) / n,
          y: inner.y + rh / 2 + ((inner.h - rh) * j) / n,
        });
      }
    }
    cands.sort((p, q) => Math.hypot(p.x - cx, p.y - cy) - Math.hypot(q.x - cx, q.y - cy));
    for (const p of cands) {
      const r = { x: p.x - rw / 2, y: p.y - rh / 2, w: rw, h: rh };
      if (!rectInside(r, inner)) continue;
      if (obstacles.some((o) => rectsOverlap(o, r))) continue;
      return { x: p.x, y: p.y, size };
    }
  }
  return { x: cx, y: cy, size: size0 };
}

function drawBoxOverlay(ctx: CanvasRenderingContext2D, ed: Editor, b: Box, px: number, obstacles: Rect[]): void {
  const t = ed.boxT.get(b.id) ?? 1;
  const col = b.color ?? ed.theme.box;
  const cover = 1 - t;
  if (cover > 0.01) {
    ctx.globalAlpha = cover;
    ctx.fillStyle = col;
    roundRectPath(ctx, b, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (!b.name) return;
  if (t > 0.01) {
    const l = ed.boxLabel(b);
    ctx.globalAlpha = t;
    ctx.fillStyle = col;
    ctx.font = `700 ${l.size}px ${FONT_STACK}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.name, l.x, l.y);
    ctx.globalAlpha = 1;
  }
  if (cover > 0.01) {
    const mine = obstacles.filter((o) => rectsOverlap(o, b));
    const l = coverLabelLayout(ctx, b, mine, px);
    ctx.globalAlpha = cover;
    ctx.fillStyle = contrastText(col);
    ctx.font = `700 ${l.size}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.name, l.x, l.y, b.w * 0.92);
    ctx.globalAlpha = 1;
  }
}

function edgePoint(target: Point, cx: number, cy: number, inner: { x0: number; y0: number; x1: number; y1: number }) {
  const dx = target.x - cx;
  const dy = target.y - cy;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (inner.x1 - cx) / dx);
  if (dx < 0) t = Math.min(t, (inner.x0 - cx) / dx);
  if (dy > 0) t = Math.min(t, (inner.y1 - cy) / dy);
  if (dy < 0) t = Math.min(t, (inner.y0 - cy) / dy);
  if (!Number.isFinite(t)) t = 0;
  return { x: cx + dx * t, y: cy + dy * t, angle: Math.atan2(dy, dx) };
}

/** Arrows at the screen edge pointing to off-screen markers, plus one to the nearest item if nothing is visible. */
function computeArrows(ed: Editor, view: Rect): Arrow[] {
  const margin = 30;
  const inner = { x0: margin, y0: margin, x1: ed.width - margin, y1: Math.max(margin + 10, ed.height - TOOLBAR_SPACE) };
  const cx = (inner.x0 + inner.x1) / 2;
  const cy = (inner.y0 + inner.y1) / 2;
  const arrows: Arrow[] = [];
  let anyVisible = false;
  const targets = ed.navigationTargets();
  for (const t of targets) {
    const visible = rectsOverlap(t.rect, view);
    if (visible) anyVisible = true;
    else if (t.marker) {
      const p = edgePoint(ed.toScreen(t.point), cx, cy, inner);
      arrows.push({ ...p, color: t.marker.color ?? ed.theme.marker, label: t.marker.name, target: t.point });
    }
  }
  if (!anyVisible && targets.length) {
    const centre = ed.getView();
    const candidates = targets.some((t) => !t.marker) ? targets.filter((t) => !t.marker) : targets;
    let best = candidates[0];
    let bestD = Infinity;
    for (const t of candidates) {
      const d = Math.hypot(t.point.x - centre.x, t.point.y - centre.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    const p = edgePoint(ed.toScreen(best.point), cx, cy, inner);
    arrows.push({ ...p, color: ed.theme.text, label: 'Nearest', target: best.point });
  }
  return arrows;
}

function drawArrows(ctx: CanvasRenderingContext2D, arrows: Arrow[], theme: Theme): void {
  for (const a of arrows) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle);
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, -12);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fillStyle = a.color;
    ctx.strokeStyle = theme.bg;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    if (!a.label) continue;
    ctx.font = `700 12px ${FONT_STACK}`;
    const tw = ctx.measureText(a.label).width;
    const pw = tw + 14;
    const cos = Math.cos(a.angle);
    const sin = Math.sin(a.angle);
    const dist = 22 + Math.abs(cos) * (pw / 2) + Math.abs(sin) * 10;
    const lx = a.x - cos * dist;
    const ly = a.y - sin * dist;
    const bx = Math.max(4, Math.min(lx - pw / 2, ctx.canvas.clientWidth - pw - 4));
    ctx.fillStyle = theme.ui.bg;
    ctx.beginPath();
    ctx.roundRect(bx, ly - 10, pw, 20, 10);
    ctx.fill();
    ctx.fillStyle = a.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.label, bx + 7, ly + 0.5);
  }
}

function drawHandles(ctx: CanvasRenderingContext2D, r: Rect, theme: Theme, px: number): void {
  const hs = 8 * px;
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1.5 * px;
  for (const p of [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ]) {
    ctx.fillStyle = theme.bg;
    ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
    ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
  }
}

export function renderScene(ed: Editor): void {
  const ctx = ed.ctx;
  if (!ctx) return;
  const { width: W, height: H, dpr, cam, theme, doc, sim } = ed;
  const pc = ed.parts;
  const z = cam.zoom;
  const px = 1 / z;
  // Strokes of at most one device pixel take the canvas's hairline fast path, which is
  // roughly 10x cheaper than wider strokes; zoomed far out, wires use it and skip the glow.
  const dp = 1 / (z * dpr);
  const far = z < FAR_ZOOM;
  const worldTransform = () => ctx.setTransform(dpr * z, 0, 0, dpr * z, -cam.x * z * dpr, -cam.y * z * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  drawGrid(ctx, cam, W, H, theme);

  worldTransform();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const view = ed.viewRect;

  // Box backgrounds, outermost first.
  const boxes = boxesOuterFirst(doc);
  ed.boxT.clear();
  const visible: Box[] = [];
  const hovered = ed.hoverBox ? doc.boxes.get(ed.hoverBox) : undefined;
  for (const b of boxes) {
    const open = hovered && (b.id === hovered.id || boxInBox(hovered, b));
    ed.boxT.set(b.id, open ? 1 : boxOpenness(b, cam, W, H));
    if (rectsOverlap(b, view)) visible.push(b);
  }
  for (const b of visible) {
    const col = b.color ?? theme.box;
    roundRectPath(ctx, b, 8);
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2, 1.5 * px);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  const covered = visible.filter((b) => (ed.boxT.get(b.id) ?? 1) < 0.02);
  const avoid = avoidMap(doc);

  // Wires, batched by colour: unpowered first, then glowing powered wires on top. A wire takes
  // the colour of the part that really drives it, so it keeps its hue through box ports.
  const offPaths = new Map<string, Path2D>();
  const onPaths = new Map<string, { cols: WireColors; path: Path2D }>();
  const signals = signalKeys(doc);
  const laneKey = (id: string, lane = 0) => (lane ? `${id}#${lane}` : id);
  const picked = new Set<string>();
  for (const id of ed.selection) {
    const w = doc.wires.get(id);
    const src = w && doc.components.get(w.from);
    if (!w || !src) continue;
    const n = w.cable ? laneCount(src) : 1;
    for (let i = 0; i < n; i++) {
      const lane = w.cable ? i : (w.lane ?? 0);
      picked.add(signals.get(laneKey(w.from, lane)) ?? laneKey(w.from, lane));
    }
  }
  const onNet = (from: string, lane: number) => picked.has(signals.get(laneKey(from, lane)) ?? laneKey(from, lane));
  const selectedCurves: WireCurve[] = [];
  for (const w of doc.wires.values()) {
    if (w.cable) continue;
    const a = doc.components.get(w.from);
    const b = doc.components.get(w.to);
    if (!a || !b) continue;
    const curve = routedWire(avoid, a, b, w.input, w.lane ?? 0, 10, ed.wireStyle);
    if (!curve) continue;
    if (!rectsOverlap(inflate(curveBounds(curve), 8), view)) continue;
    if (covered.length && covered.some((bx) => pointInRect(curve.a, bx) && pointInRect(curve.b, bx))) continue;
    const srcKey = w.lane ? `${w.from}#${w.lane}` : w.from;
    const cols = colorsFor(pc.roots.get(srcKey) ?? w.from, theme);
    if (onNet(w.from, w.lane ?? 0)) selectedCurves.push(curve);
    if (sim.value(w.from, w.lane ?? 0)) {
      let entry = onPaths.get(cols.on);
      if (!entry) onPaths.set(cols.on, (entry = { cols, path: new Path2D() }));
      addCurve(entry.path, curve);
    } else {
      let p = offPaths.get(cols.off);
      if (!p) offPaths.set(cols.off, (p = new Path2D()));
      addCurve(p, curve);
    }
  }
  ctx.lineWidth = Math.max(STROKE_W, dp);
  for (const [color, p] of offPaths) {
    ctx.strokeStyle = color;
    ctx.stroke(p);
  }
  if (selectedCurves.length) {
    ctx.strokeStyle = theme.selection;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(8, 6 * px);
    for (const c of selectedCurves) strokeCurve(ctx, c);
    ctx.globalAlpha = 1;
  }
  if (!far) {
    ctx.lineWidth = Math.max(9, 5 * px);
    for (const { cols, path } of onPaths.values()) {
      ctx.strokeStyle = cols.glow;
      ctx.stroke(path);
    }
  }
  ctx.lineWidth = far ? dp : Math.max(3, 1.5 * px);
  for (const { cols, path } of onPaths.values()) {
    ctx.strokeStyle = cols.on;
    ctx.stroke(path);
  }

  // Ribbon cables: one stripe per lane, packed with no gap, no glow. Stripe 0 matches lane 0.
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 2;
  ctx.lineWidth = CABLE_PITCH + 0.8;
  for (const w of doc.wires.values()) {
    if (!w.cable) continue;
    const a = doc.components.get(w.from);
    const b = doc.components.get(w.to);
    if (!a || !b) continue;
    const lanes = Math.min(laneCount(a), laneCount(b));
    const curve = routedWire(avoid, a, b, 0, 0, lanes * CABLE_PITCH * 0.5 + 8, ed.wireStyle, true);
    if (!curve) continue;
    const n = lanes;
    if (!rectsOverlap(inflate(curveBounds(curve), n * CABLE_PITCH), view)) continue;
    const da = pinDir(a, -1);
    const db = pinDir(b, 0);
    for (let i = 0; i < n; i++) {
      const key = i ? `${w.from}#${i}` : w.from;
      const cols = colorsFor(pc.roots.get(key) ?? w.from, theme);
      const stripe = cableStripe(curve, i, n, da, db);
      ctx.beginPath();
      ctx.moveTo(stripe[0].x, stripe[0].y);
      for (let k = 1; k < stripe.length; k++) ctx.lineTo(stripe[k].x, stripe[k].y);
      ctx.strokeStyle = sim.value(w.from, i) ? cols.on : cols.off;
      ctx.stroke();
    }
    let cableHit = false;
    for (let i = 0; i < n; i++) if (onNet(w.from, i)) cableHit = true;
    if (cableHit) {
      ctx.strokeStyle = theme.selection;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = n * CABLE_PITCH + 4;
      strokeCurve(ctx, curve);
      ctx.globalAlpha = 1;
      ctx.lineWidth = CABLE_PITCH + 0.8;
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Components, batched into a few canvas calls. Switches, buttons, bulbs and ports are
  // drawn later, above the box covers, so they stay visible.
  const batch = new OpBatcher();
  const drawParts = (list: Iterable<Component>) => {
    for (const c of list) {
      const info = partInfo(pc, c, theme, ed.isActive(c));
      if (c.kind === 'switch') info.switchT = ed.switchBlend(c.id);
      if (c.kind === 'bulb' || c.kind === 'rgb') {
        const look = ed.bulbLook(c.id);
        if (look) {
          info.bulbPower = look.power;
          info.bulbColor = look.color;
        }
      }
      info.lanes?.forEach((lane, i) => {
        lane.on = ed.sim.value(c.id, i);
      });
      batch.add(componentOps(c, theme, info), xformOf(c));
    }
    batch.flush(ctx, dp);
  };
  const lower: Component[] = [];
  const floating: Component[] = [];
  for (const c of doc.components.values()) {
    if (!rectsOverlap(componentBounds(c), view)) continue;
    if (floatsAboveBoxes(c)) {
      if (!(c.kind === 'port' && covered.length && portHidden(doc, c, covered))) floating.push(c);
    } else if (!(covered.length && componentCoveredBy(ed, c, covered))) lower.push(c);
  }
  drawParts(lower);

  // Box overlays, innermost first so outer boxes cover inner ones.
  const labels: TextOp[] = [];
  const obstacles: Rect[] = [];
  for (const c of floating) {
    obstacles.push(inflate(bodyRect(c), 3));
    const l = partLabel(doc, c, theme);
    if (l && !(c.kind === 'port' && labels.some((o) => o.text === l.text && rectsOverlap(textRect(o), textRect(l))))) {
      labels.push(l);
      obstacles.push(textRect(l));
    }
  }
  for (let i = visible.length - 1; i >= 0; i--) drawBoxOverlay(ctx, ed, visible[i], px, obstacles);

  drawParts(floating);
  for (const l of labels) if (l.size * z >= 5) drawText(ctx, l);

  // Selection outlines for components.
  ctx.strokeStyle = theme.selection;
  ctx.lineWidth = 1.5 * px;
  for (const id of ed.selection) {
    const c = doc.components.get(id);
    if (!c) continue;
    const r = inflate(bodyRect(c), 5);
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 4);
    ctx.stroke();
  }
  const sized = ed.resizeTarget();
  if (sized) drawHandles(ctx, bodyRect(sized), theme, px);

  // Selected boxes and their resize handles.
  for (const b of ed.selectedBoxes()) {
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([6 * px, 4 * px]);
    roundRectPath(ctx, inflate(b, 3 * px), 9);
    ctx.stroke();
    ctx.setLineDash([]);
    drawHandles(ctx, b, theme, px);
  }

  // Box edge under the pointer, which can be dragged to resize.
  const edge = ed.drag?.kind === 'resize' ? null : ed.hoverEdge;
  if (edge) {
    const b = doc.boxes.get(edge.box);
    if (b) {
      ctx.strokeStyle = theme.selection;
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      if (edge.l) (ctx.moveTo(b.x, b.y), ctx.lineTo(b.x, b.y + b.h));
      if (edge.r) (ctx.moveTo(b.x + b.w, b.y), ctx.lineTo(b.x + b.w, b.y + b.h));
      if (edge.t) (ctx.moveTo(b.x, b.y), ctx.lineTo(b.x + b.w, b.y));
      if (edge.b) (ctx.moveTo(b.x, b.y + b.h), ctx.lineTo(b.x + b.w, b.y + b.h));
      ctx.stroke();
    }
  }

  // Hovered / targeted pin.
  const drag = ed.drag;
  const pinHighlight = drag?.kind === 'wire' ? drag.target : drag ? null : ed.hoverPin;
  if (pinHighlight) {
    const p = ed.pinPosition(pinHighlight);
    if (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(6, 6 * px), 0, Math.PI * 2);
      ctx.strokeStyle = theme.selection;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
    }
  }

  // Wire being dragged.
  if (drag?.kind === 'wire' && drag.moved) {
    const src = doc.components.get(drag.from.comp);
    const from = src && attachPos(src, drag.from.pin);
    if (src && from) {
      const tc = drag.target && doc.components.get(drag.target.comp);
      const to = (tc && attachPos(tc, drag.target!.pin)) || drag.cur;
      const dFrom = pinDir(src, drag.from.pin);
      const dTo = tc ? pinDir(tc, drag.target!.pin) : { x: -dFrom.x, y: -dFrom.y };
      const outward = drag.from.pin < 0;
      const start = outward ? from : to;
      const end = outward ? to : from;
      const da = outward ? dFrom : dTo;
      const db = outward ? dTo : dFrom;
      const span = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        w: Math.abs(end.x - start.x),
        h: Math.abs(end.y - start.y),
      };
      const cable = bundleSource(src) && drag.from.pin === -1;
      let curve;
      if (ed.wireStyle === 'avoid' || (cable && ed.wireStyle === 'square')) {
        const srcId = outward ? src.id : (tc?.id ?? '');
        const dstId = outward ? (tc?.id ?? '') : src.id;
        const input = outward ? (drag.target?.pin ?? 0) : drag.from.pin;
        const lane = Math.max(0, -(outward ? drag.from.pin : (drag.target?.pin ?? -1)) - 1);
        const blocks = blockRects(avoid, srcId, dstId, start, da, end, db, 10, span);
        curve = bendAround(start, da, end, db, blocks, routeSeed(srcId, dstId, input, lane));
      } else if (ed.wireStyle === 'square' && !cable) {
        curve = squareWire(start, da, end, db, 0);
      } else {
        curve = wireCurve(start, end, da, db);
      }
      ctx.strokeStyle = theme.selection;
      ctx.lineWidth = Math.max(STROKE_W, 1.5 * px);
      ctx.setLineDash([8 * px, 6 * px]);
      strokeCurve(ctx, curve);
      ctx.setLineDash([]);
    }
  }

  // Marquee.
  if (drag?.kind === 'marquee') {
    const r = {
      x: Math.min(drag.start.x, drag.cur.x),
      y: Math.min(drag.start.y, drag.cur.y),
      w: Math.abs(drag.cur.x - drag.start.x),
      h: Math.abs(drag.cur.y - drag.start.y),
    };
    ctx.fillStyle = theme.selection;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = px;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }

  // Placement preview.
  if (ed.placing && ed.ghost) {
    ctx.globalAlpha = 0.5;
    if (ed.placing === 'box') {
      const r = { x: snap(ed.ghost.x - 120), y: snap(ed.ghost.y - 80), w: 240, h: 160 };
      ctx.fillStyle = theme.box;
      ctx.globalAlpha = 0.15;
      roundRectPath(ctx, r, 8);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = theme.box;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (ed.placing === 'not') {
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(ed.ghost.x, ed.ghost.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = theme.fill;
      ctx.fill();
      ctx.strokeStyle = theme.selection;
      ctx.lineWidth = STROKE_W;
      ctx.stroke();
    } else {
      const kind = ed.placing === 'ribbon-port' ? 'port' : ed.placing;
      const ghost = makeComponent(kind, 0, 0, 'ghost');
      if (ed.placing === 'ribbon-port') {
        ghost.inputs = 4;
        ghost.plug = ed.ghostSnap?.inward === false ? 'out' : 'in';
        ghost.inputBundle = ghost.plug === 'in';
        ghost.outputBundle = ghost.plug === 'out';
      }
      if ((ed.placing === 'port' || ed.placing === 'ribbon-port') && ed.ghostSnap) {
        const box = doc.boxes.get(ed.ghostSnap.box);
        if (box) {
          placePort(doc, ghost, box, ed.ghost, ed.ghostSnap.inward);
        } else {
          const size = rotatedSize(ghost);
          ghost.x = snap(ed.ghost.x - size.w / 2);
          ghost.y = snap(ed.ghost.y - size.h / 2);
        }
      } else {
        const size = rotatedSize(ghost);
        ghost.x = snap(ed.ghost.x - size.w / 2);
        ghost.y = snap(ed.ghost.y - size.h / 2);
      }
      drawOps(ctx, componentOps(ghost, theme, { active: false }), xformOf(ghost), px);
    }
    ctx.globalAlpha = 1;
  }

  // Screen-space navigation arrows.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ed.arrows = computeArrows(ed, view);
  drawArrows(ctx, ed.arrows, theme);
}

function componentCoveredBy(ed: Editor, c: Component, covered: Box[]): boolean {
  for (const b of covered) if (componentInBox(ed.doc, c, b)) return true;
  return false;
}

/** A port is hidden when a box around its own box is closed. */
function portHidden(doc: Editor['doc'], port: Component, covered: Box[]): boolean {
  const own = port.box ? doc.boxes.get(port.box) : undefined;
  if (!own) return false;
  for (const b of covered) if (b !== own && boxInBox(own, b)) return true;
  return false;
}
