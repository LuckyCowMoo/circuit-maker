import { boxesOuterFirst, componentInBox, componentSize } from '../model/doc';
import {
  bodyRect,
  componentBounds,
  curveBounds,
  inflate,
  inputPos,
  outputPos,
  pointInRect,
  rectsOverlap,
  snap,
  STROKE_W,
  wireCurve,
  type WireCurve,
} from '../model/geometry';
import { componentOps, type DrawOp } from '../model/shapes';
import { contrastText, wireColors, type Theme, type WireColors } from '../model/themes';
import type { Box, Component, Point, Rect } from '../model/types';
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
function colorsFor(net: string, theme: Theme): WireColors {
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
  const centre = 1 - smoothstep(0.3, 0.6, dist);
  const zoomed = smoothstep(0.18, 0.28, z);
  return smoothstep(0.3, 0.7, size * centre * zoomed);
}

function drawOps(ctx: CanvasRenderingContext2D, ops: DrawOp[], x: number, y: number, px: number): void {
  ctx.translate(x, y);
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
    } else {
      ctx.fillStyle = op.fill;
      ctx.font = `${op.bold ? 700 : 400} ${op.size}px ${FONT_STACK}`;
      ctx.textAlign = op.anchor === 'middle' ? 'center' : op.anchor === 'end' ? 'right' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(op.text, op.x, op.y);
    }
  }
  ctx.translate(-x, -y);
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
  private texts: { op: Extract<DrawOp, { t: 'text' }>; x: number; y: number }[] = [];

  add(ops: DrawOp[], x: number, y: number): void {
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.t === 'text') {
        this.texts.push({ op, x, y });
        continue;
      }
      const layer = (this.layers[i] ??= new Map());
      const key = `${op.fill}|${op.stroke}|${op.width}|${op.alpha}`;
      let b = layer.get(key);
      if (!b) {
        b = { path: new Path2D(), fill: op.fill, stroke: op.stroke, width: op.width, alpha: op.alpha };
        layer.set(key, b);
      }
      b.path.addPath(path2d(op.d), { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
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
    for (const t of this.texts) drawOps(ctx, [t.op], t.x, t.y, px);
  }
}

interface SpriteCell {
  sx: number;
  sy: number;
  w: number;
  h: number;
  /** Device-pixel position of the component origin inside the cell. */
  ox: number;
  oy: number;
}

const ATLAS_SIZE = 2048;
const SPRITE_MARGIN = 12;
const MAX_SPRITE = 256;

/**
 * Pre-rendered component images at the current scale. Filling thousands of vector shapes
 * is expensive on the GPU, while stamping images from one atlas is batched cheaply, so
 * zoomed far out components are drawn from here. While the zoom is changing the atlas is
 * rendered at quarter-octave steps and drawn slightly downscaled; once it settles it is
 * rebuilt at the exact scale so sprites are crisp.
 */
class SpriteAtlas {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cells = new Map<string, SpriteCell>();
  private scale = 0;
  private lastScale = 0;
  private ratio = 1;
  private theme: Theme | null = null;
  private x = 0;
  private y = 0;
  private rowH = 0;

  /** Returns true if another frame is needed to sharpen the sprites. */
  begin(theme: Theme, scale: number): boolean {
    const moving = scale !== this.lastScale;
    this.lastScale = scale;
    let target = this.scale;
    if (theme !== this.theme) target = 0;
    if (!moving) target = scale;
    else if (!(target >= scale && target < scale * 1.19)) target = 2 ** (Math.ceil(Math.log2(scale) * 4) / 4);
    if (target !== this.scale || theme !== this.theme) {
      this.theme = theme;
      this.scale = target;
      this.reset();
    }
    this.ratio = scale / this.scale;
    return this.ratio !== 1;
  }

  private reset(): void {
    this.cells.clear();
    this.x = this.y = this.rowH = 0;
    this.ctx?.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  }

  get(c: Component, bounds: Rect, theme: Theme, active: boolean): SpriteCell | null {
    const key = `${c.kind}|${c.inputs}|${c.negate ? 1 : 0}|${c.stroke}|${c.fill}|${c.color}|${c.on ? 1 : 0}|${active ? 1 : 0}`;
    const hit = this.cells.get(key);
    if (hit) return hit;
    const s = this.scale;
    const rx = bounds.x - c.x - SPRITE_MARGIN;
    const ry = bounds.y - c.y - SPRITE_MARGIN;
    const w = Math.ceil((bounds.w + 2 * SPRITE_MARGIN) * s) + 2;
    const h = Math.ceil((bounds.h + 2 * SPRITE_MARGIN) * s) + 2;
    if (w > MAX_SPRITE || h > MAX_SPRITE) return null;
    if (!this.ctx) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = ATLAS_SIZE;
      this.ctx = this.canvas.getContext('2d');
      if (!this.ctx) return null;
    }
    if (this.x + w > ATLAS_SIZE) {
      this.x = 0;
      this.y += this.rowH;
      this.rowH = 0;
    }
    if (this.y + h > ATLAS_SIZE) {
      this.reset();
    }
    const cell: SpriteCell = { sx: this.x, sy: this.y, w, h, ox: 1 - rx * s, oy: 1 - ry * s };
    const ctx = this.ctx;
    ctx.setTransform(s, 0, 0, s, cell.sx + cell.ox, cell.sy + cell.oy);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawOps(ctx, componentOps(c, theme, active), 0, 0, 1 / s);
    this.x += w;
    this.rowH = Math.max(this.rowH, h);
    this.cells.set(key, cell);
    return cell;
  }

  /** Draws a cell with the component origin at device position (x, y). */
  draw(ctx: CanvasRenderingContext2D, cell: SpriteCell, x: number, y: number): void {
    if (!this.canvas) return;
    const r = this.ratio;
    if (r === 1) {
      ctx.drawImage(this.canvas, cell.sx, cell.sy, cell.w, cell.h, Math.round(x - cell.ox), Math.round(y - cell.oy), cell.w, cell.h);
    } else {
      ctx.drawImage(this.canvas, cell.sx, cell.sy, cell.w, cell.h, x - cell.ox * r, y - cell.oy * r, cell.w * r, cell.h * r);
    }
  }
}

const sprites = new SpriteAtlas();

function addCurve(p: Path2D, c: WireCurve): void {
  p.moveTo(c.a.x, c.a.y);
  p.bezierCurveTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.b.x, c.b.y);
}

function strokeCurve(ctx: CanvasRenderingContext2D, c: WireCurve): void {
  ctx.beginPath();
  ctx.moveTo(c.a.x, c.a.y);
  ctx.bezierCurveTo(c.c1.x, c.c1.y, c.c2.x, c.c2.y, c.b.x, c.b.y);
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

function drawBoxOverlay(ctx: CanvasRenderingContext2D, ed: Editor, b: Box, px: number): void {
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
    const size = Math.max(8 * px, Math.min(b.h * 0.3, (b.w * 0.85) / (Math.max(1, b.name.length) * 0.6)));
    ctx.globalAlpha = cover;
    ctx.fillStyle = contrastText(col);
    ctx.font = `700 ${size}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.name, b.x + b.w / 2, b.y + b.h / 2, b.w * 0.92);
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

export function renderScene(ed: Editor): void {
  const ctx = ed.ctx;
  if (!ctx) return;
  const { width: W, height: H, dpr, cam, theme, doc, sim } = ed;
  const z = cam.zoom;
  const px = 1 / z;
  // Strokes of at most one device pixel take the canvas's hairline fast path, which is
  // roughly 10x cheaper than wider strokes; zoomed far out, wires use it and skip the glow.
  const dp = 1 / (z * dpr);
  const far = z < FAR_ZOOM;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);
  drawGrid(ctx, cam, W, H, theme);

  ctx.setTransform(dpr * z, 0, 0, dpr * z, -cam.x * z * dpr, -cam.y * z * dpr);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const view = ed.viewRect;

  // Box backgrounds, outermost first.
  const boxes = boxesOuterFirst(doc);
  ed.boxT.clear();
  const visible: Box[] = [];
  for (const b of boxes) {
    ed.boxT.set(b.id, boxOpenness(b, cam, W, H));
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

  // Wires, batched by colour: unpowered first, then glowing powered wires on top.
  const offPaths = new Map<string, Path2D>();
  const onPaths = new Map<string, { cols: WireColors; path: Path2D }>();
  const selectedCurves: WireCurve[] = [];
  for (const w of doc.wires.values()) {
    const a = doc.components.get(w.from);
    const b = doc.components.get(w.to);
    if (!a || !b) continue;
    const pa = outputPos(a);
    const pb = inputPos(b, w.input);
    if (!pa || !pb) continue;
    const curve = wireCurve(pa, pb);
    if (!rectsOverlap(inflate(curveBounds(curve), 8), view)) continue;
    if (covered.length && covered.some((bx) => pointInRect(pa, bx) && pointInRect(pb, bx))) continue;
    const cols = colorsFor(w.from, theme);
    if (ed.selection.has(w.id)) selectedCurves.push(curve);
    if (sim.value(w.from)) {
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

  // Components. Zoomed far out, most are stamped from a sprite atlas.
  const batch = new OpBatcher();
  const scale = z * dpr;
  if (far) {
    if (sprites.begin(theme, scale)) ed.requestRender();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  for (const c of doc.components.values()) {
    const bounds = componentBounds(c);
    if (!rectsOverlap(bounds, view)) continue;
    if (covered.length && componentCoveredBy(c, covered)) continue;
    const active = ed.isActive(c);
    const cell = far && c.kind !== 'marker' ? sprites.get(c, bounds, theme, active) : null;
    if (cell) sprites.draw(ctx, cell, (c.x - cam.x) * scale, (c.y - cam.y) * scale);
    else batch.add(componentOps(c, theme, active), c.x, c.y);
  }
  if (far) ctx.setTransform(scale, 0, 0, scale, -cam.x * scale, -cam.y * scale);
  batch.flush(ctx, dp);

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

  // Box overlays, innermost first so outer boxes cover inner ones.
  for (let i = visible.length - 1; i >= 0; i--) drawBoxOverlay(ctx, ed, visible[i], px);

  // Selected boxes and their resize handles.
  for (const b of ed.selectedBoxes()) {
    ctx.strokeStyle = theme.selection;
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([6 * px, 4 * px]);
    roundRectPath(ctx, inflate(b, 3 * px), 9);
    ctx.stroke();
    ctx.setLineDash([]);
    const hs = 8 * px;
    for (const p of [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
      { x: b.x, y: b.y + b.h },
    ]) {
      ctx.fillStyle = theme.bg;
      ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
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
    const from = ed.pinPosition(drag.from);
    if (from) {
      const to = (drag.target && ed.pinPosition(drag.target)) || drag.cur;
      const curve = drag.from.pin < 0 ? wireCurve(from, to) : wireCurve(to, from);
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
    } else {
      const size = componentSize(ed.placing);
      const ghost: Component = {
        id: 'ghost',
        kind: ed.placing,
        x: snap(ed.ghost.x - size.w / 2),
        y: snap(ed.ghost.y - size.h / 2),
        inputs: 2,
        negate: false,
        stroke: null,
        fill: null,
        on: false,
        name: ed.placing === 'marker' ? 'Marker' : '',
        color: null,
      };
      drawOps(ctx, componentOps(ghost, theme, false), ghost.x, ghost.y, px);
    }
    ctx.globalAlpha = 1;
  }

  // Screen-space navigation arrows.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ed.arrows = computeArrows(ed, view);
  drawArrows(ctx, ed.arrows, theme);
}

function componentCoveredBy(c: Component, covered: Box[]): boolean {
  for (const b of covered) if (componentInBox(c, b)) return true;
  return false;
}
