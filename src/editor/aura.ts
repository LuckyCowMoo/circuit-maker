import type { Editor, PlaceKind } from './Editor';
import { boxInBox, componentInBox, signalKeys } from '../model/doc';
import {
  componentBounds,
  CABLE_PITCH,
  curveBounds,
  geomFor,
  inflate,
  pointInRect,
  rectsOverlap,
  localSize,
  xformOf,
  type WireCurve,
  type Xf,
} from '../model/geometry';
import { floatsAboveBoxes } from '../model/parts';
import { avoidMap, routedWire } from '../model/route';
import { componentOutline, roundRectD } from '../model/shapes';
import { auraPartner, idleWire, kindAura, parseRgb, vividAura, wireColors, type Rgb } from '../model/themes';
import { AuraPass, cameraPlace, type AuraDraw } from './auraPass';
import type { Box, Component, Rect } from '../model/types';
import { isInput, laneCount } from '../model/types';

/** Toolbar goo lifetime. The draw stops once the volume has sunk back into the bar. */
const RIPPLE_MS = 3200;

/**
 * A canvas can be transferred to a worker only once. React Strict Mode disposes the overlay
 * and builds it again on the same canvas, so the worker is kept until the unmount sticks.
 */
const heldAura = new WeakMap<HTMLCanvasElement, { worker: Worker; release: number }>();

/**
 * How far a part's wave can reach past its outline, as a fraction of its smaller side.
 * The visible edge sits inside this. 0.13 puts that edge about a tenth of the body out,
 * matching the switch reference.
 */
const WAVE_REACH = 0.13;

/** Twice a 2-input AND's current wave, so smaller parts don't shrink below that. */
const AND2 = geomFor('and', 2, false);
const MIN_WAVE_REACH = WAVE_REACH * Math.min(AND2.tip, AND2.h) * 2;

/** Wire sleeve, past the drawn stroke, in multiples of a single wire's width. Cables use this same sleeve. */
const WIRE_SLEEVE = 2.4;

/** Past this short side, extra size stretches the wave with a square root instead of linearly. */
const REACH_KNEE = 120;

function partReach(w: number, h: number): number {
  const side = Math.min(w, h);
  const linear = WAVE_REACH * side;
  const grown = side <= REACH_KNEE ? linear : WAVE_REACH * REACH_KNEE * Math.sqrt(side / REACH_KNEE);
  return Math.max(MIN_WAVE_REACH, grown);
}

export interface PlaceRipple {
  /** Viewport point on the top edge of the toolbar where the part left. */
  x: number;
  y: number;
  /** Unit direction the pointer was moving as it crossed out, CSS y-down. */
  dx: number;
  dy: number;
  /** Exit speed in CSS pixels per millisecond. A fast leave grows the first bulge. */
  speed: number;
  t0: number;
  kind: PlaceKind;
}



interface View {
  wx: number;
  wy: number;
  tx: number;
  ty: number;
  s: number;
  zoom: number;
}

interface RippleDraw {
  x: number;
  y: number;
  age: number;
  color: Rgb;
  mate: Rgb;
  dirx: number;
  diry: number;
  speed: number;
  radius: number;
  bar: DOMRect;
}

const outlineCache = new Map<string, Path2D>();
function cachedPath(d: string): Path2D {
  let p = outlineCache.get(d);
  if (!p) outlineCache.set(d, (p = new Path2D(d)));
  return p;
}

function curvePath(curve: WireCurve): Path2D {
  const p = new Path2D();
  p.moveTo(curve.a.x, curve.a.y);
  p.bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.b.x, curve.b.y);
  for (const s of curve.tail ?? []) p.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.b.x, s.b.y);
  return p;
}

/** 2 = a part's two layers, 1 = a wire's single layer, 0 = anything else. */
function waveLayer(r: number, b: number, a: number): number {
  if (b < 8 || a < 16) return 0;
  if (Math.abs(r * 2 - b) < 40) return 2;
  if (Math.abs(r * 4 - b) < 40) return 1;
  return 0;
}

function componentAura(ed: Editor, c: Component): Rgb {
  if (isInput(c.kind)) {
    const root = ed.parts.roots.get(c.id) ?? c.id;
    return parseRgb(wireColors(root, ed.theme).on) ?? kindAura(ed.theme, c.kind, c.id);
  }
  if (c.kind === 'marker') return vividAura(ed.theme, c.color ?? ed.theme.marker, c.id);
  const kind = c.kind === 'port' && c.inputs > 1 ? 'ribbon-port' : c.kind;
  return kindAura(ed.theme, kind, c.id);
}

/** Drawn width of a selected signal wire, in world units. Matches the scene stroke. */
function wireCore(zoom: number, dpr: number): number {
  if (zoom < 0.3) return 1 / (zoom * Math.max(dpr, 1));
  return Math.max(3, 1.5 / zoom);
}

function toolbarEl(): Element | null {
  return document.querySelector('.tb-row .toolbar:not(.tb-measure)');
}


function partHidden(ed: Editor, c: Component, covered: Box[]): boolean {
  if (!covered.length) return false;
  if (c.kind === 'port') {
    const own = c.box ? ed.doc.boxes.get(c.box) : undefined;
    if (!own) return false;
    return covered.some((b) => b !== own && boxInBox(own, b));
  }
  if (floatsAboveBoxes(c)) return false;
  return covered.some((b) => componentInBox(ed.doc, c, b));
}


const GL_ATTRS = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
} as const;

/**
 * Firefox often refuses a WebGL context once the canvas has moved to a worker.
 * The overlay then never starts, and selection stays on the blue box. Drawing
 * on the page thread still shows the wave, in the same frame as the parts.
 */
function workerAuraSupported(): boolean {
  return typeof navigator === 'undefined' || !/firefox\//i.test(navigator.userAgent);
}

/**
 * Screen-space selection aura. The stamp is built here; a worker owns the WebGL canvas and
 * keeps the waves moving while the page is busy loading.
 */
export class AuraOverlay {
  ok = false;
  private pass: AuraPass | null = null;
  private worker: Worker | null = null;
  private stampGen = 0;
  private bufW = 0;
  private bufH = 0;
  private failed = false;
  private onStatus?: (ok: boolean) => void;
  private colorCanvas = document.createElement('canvas');
  private flowCanvas = document.createElement('canvas');
  private colorCtx: CanvasRenderingContext2D | null = null;
  private flowCtx: CanvasRenderingContext2D | null = null;
  /** One gate's distance field, merged into the stamp so a neighbour cannot overwrite it. */
  private gateColor = document.createElement('canvas');
  private gateFlow = document.createElement('canvas');
  private gateColorCtx: CanvasRenderingContext2D | null = null;
  private gateFlowCtx: CanvasRenderingContext2D | null = null;
  private view: View = { wx: 1, wy: 1, tx: 0, ty: 0, s: 1, zoom: 1 };
  private stampW = 1;
  private stampH = 1;
  private hasStamp = false;
  /** Camera baked into the stamp currently being drawn. */
  private stampCam: { x: number; y: number; zoom: number } | null = null;
  /** Camera the stamp is built in. Scrolling places this picture; it is not rebuilt every frame. */
  private basis: { x: number; y: number; zoom: number } | null = null;
  /** Camera of the picture currently drawn on the lock canvas. */
  private bitmap: ImageBitmap | null = null;
  private bitmapBasis: { x: number; y: number; zoom: number } | null = null;
  private picSeq = 0;
  /** Pictures that arrive after the wave was cleared are dropped. */
  private acceptPictures = false;
  private lockCanvas: HTMLCanvasElement | null = null;
  private lockCtx: CanvasRenderingContext2D | null = null;
  /** Camera last placed. A still view while a build blocks the page keeps the worker canvas on screen. */
  private lastPresented: { x: number; y: number; zoom: number } | null = null;
  /** Camera of the stamp the worker has actually received. The fallback pass slides that one. */
  private postedCam: { x: number; y: number; zoom: number } | null = null;
  private shown = false;
  private sizeDirty = true;
  /** Camera, selection, and powered inputs. The animated waves live in the shader, so a scene redraw does not restamp. */
  private fieldSig = '';
  private activeSig = '';
  private activeVer = -1;
  private activeSel = '';
  private heldCanvas: HTMLCanvasElement | null = null;

  constructor(canvas: HTMLCanvasElement, onStatus?: (ok: boolean) => void) {
    this.onStatus = onStatus;
    this.colorCtx = this.colorCanvas.getContext('2d', { willReadFrequently: true });
    this.flowCtx = this.flowCanvas.getContext('2d', { willReadFrequently: true });
    this.gateColorCtx = this.gateColor.getContext('2d', { willReadFrequently: true });
    this.gateFlowCtx = this.gateFlow.getContext('2d', { willReadFrequently: true });
    if (!this.colorCtx || !this.flowCtx || !this.gateColorCtx || !this.gateFlowCtx) return;
    if (this.startWorker(canvas)) return;
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', GL_ATTRS) as WebGL2RenderingContext | null;
    } catch {
      return;
    }
    if (!gl) return;
    this.pass = new AuraPass(gl);
    this.ok = this.pass.ok;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    if (!this.ok) return;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.bufW === w && this.bufH === h) return;
    this.bufW = w;
    this.bufH = h;
    this.sizeDirty = true;
    if (this.lockCanvas) {
      this.lockCanvas.width = w;
      this.lockCanvas.height = h;
    }
    if (this.worker) this.worker.postMessage({ type: 'resize', width: w, height: h, cssW, cssH });
    else this.pass?.resize(w, h);
  }

  /** Push uniforms before a long load so the worker can keep drawing through it. */
  nudge(ed: Editor, now: number): void {
    if (!this.ok || !this.worker) return;
    const building = !!ed.toastMessage?.startsWith('Building ');
    this.postState(ed, building, this.hasStamp, this.rippleOf(ed, now));
    if (building) this.present(ed, true);
  }

  frame(ed: Editor, now: number, _sceneDrawn: boolean): void {
    if (!this.ok || !this.colorCtx) return;
    const ripple = this.rippleOf(ed, now);
    const building = !!ed.toastMessage?.startsWith('Building ');
    const rebase = !building && this.wantsRebase(ed);
    if (rebase) this.basis = { x: ed.cam.x, y: ed.cam.y, zoom: ed.cam.zoom || 1 };
    const fields = this.fieldKey(ed);
    const rebuild = this.sizeDirty || rebase || fields !== this.fieldSig;
    if (rebuild) {
      this.fieldSig = fields;
      this.sizeDirty = false;
      this.rebuild(ed);
    }
    const show = this.hasStamp;
    if (rebuild && !show) this.dropField();
    if (!show && !ripple && !building) {
      if (this.shown) this.clearGl();
      this.shown = false;
      this.bitmap?.close();
      this.bitmap = null;
      this.bitmapBasis = null;
      this.acceptPictures = false;
      this.postState(ed, false, false, null);
      this.present(ed, false);
      return;
    }
    this.acceptPictures = true;
    if (rebuild && show) this.upload(ed);
    this.publish(ed, now, ripple, building, show);
    this.present(ed, building);
    this.shown = true;
  }

  dispose(): void {
    this.ok = false;
    this.stampGen++;
    this.bitmap?.close();
    this.bitmap = null;
    this.bitmapBasis = null;
    this.lockCanvas?.remove();
    this.lockCanvas = null;
    this.lockCtx = null;
    if (this.heldCanvas) {
      this.heldCanvas.style.visibility = '';
      this.heldCanvas.style.transform = '';
    }
    const canvas = this.heldCanvas;
    const held = canvas ? heldAura.get(canvas) : undefined;
    this.worker = null;
    this.heldCanvas = null;
    if (held && canvas) {
      window.clearTimeout(held.release);
      held.release = window.setTimeout(() => {
        if (heldAura.get(canvas) !== held) return;
        held.worker.postMessage({ type: 'stop' });
        held.worker.terminate();
        heldAura.delete(canvas);
      }, 0);
    }
    this.pass?.dispose();
    this.pass = null;
  }

  private startWorker(canvas: HTMLCanvasElement): boolean {
    if (!workerAuraSupported()) return false;
    if (typeof Worker === 'undefined' || !('transferControlToOffscreen' in canvas)) return false;
    const existing = heldAura.get(canvas);
    if (existing) {
      window.clearTimeout(existing.release);
      existing.release = 0;
      this.attachWorker(canvas, existing.worker);
      return true;
    }
    let transferred = false;
    try {
      const off = canvas.transferControlToOffscreen();
      transferred = true;
      const worker = new Worker(new URL('./auraWorker.ts', import.meta.url), { type: 'module' });
      heldAura.set(canvas, { worker, release: 0 });
      this.attachWorker(canvas, worker);
      worker.postMessage({ type: 'init', canvas: off }, [off]);
      return true;
    } catch (err) {
      console.warn(err);
      if (transferred) this.fail();
      return transferred;
    }
  }

  private attachWorker(canvas: HTMLCanvasElement, worker: Worker): void {
    this.heldCanvas = canvas;
    this.worker = worker;
    this.ok = true;
    this.ensureLock(canvas);
    worker.onmessage = (ev: MessageEvent<{ type?: string; bitmap?: ImageBitmap; basis?: { x: number; y: number; zoom: number }; seq?: number }>) => {
      const data = ev.data;
      if (data?.type === 'fail') this.fail();
      if (data?.type === 'picture' && data.bitmap && data.basis) {
        const seq = data.seq ?? 0;
        if (!this.acceptPictures || seq < this.picSeq) {
          data.bitmap.close();
          return;
        }
        this.picSeq = seq;
        this.bitmap?.close();
        this.bitmap = data.bitmap;
        this.bitmapBasis = { x: data.basis.x, y: data.basis.y, zoom: data.basis.zoom };
      }
    };
    worker.onerror = () => this.fail();
  }

  /** The page canvas stays on the worker. This one is drawn in the same frame as the parts. */
  private ensureLock(source: HTMLCanvasElement): void {
    if (this.lockCanvas) return;
    const lock = document.createElement('canvas');
    lock.className = 'aura';
    lock.setAttribute('aria-hidden', 'true');
    source.after(lock);
    this.lockCanvas = lock;
    this.lockCtx = lock.getContext('2d', { alpha: true });
    source.style.visibility = 'hidden';
  }

  private fail(): void {
    if (this.failed) return;
    this.failed = true;
    const canvas = this.heldCanvas;
    const worker = this.worker ?? (canvas ? heldAura.get(canvas)?.worker : undefined);
    this.ok = false;
    this.worker = null;
    this.heldCanvas = null;
    this.bitmap?.close();
    this.bitmap = null;
    this.lockCanvas?.remove();
    this.lockCanvas = null;
    this.lockCtx = null;
    if (canvas) {
      canvas.style.visibility = '';
      canvas.style.transform = '';
      heldAura.delete(canvas);
    }
    worker?.terminate();
    this.onStatus?.(false);
  }

  private rippleOf(ed: Editor, now: number): RippleDraw | null {
    const rip = ed.placeRipple;
    if (!rip) return null;
    const age = (now - rip.t0) / RIPPLE_MS;
    if (age >= 1) {
      ed.placeRipple = null;
      return null;
    }
    const el = toolbarEl();
    const bar = el?.getBoundingClientRect();
    if (!bar || bar.width < 2 || bar.height < 2) return null;
    const raw = el ? parseFloat(getComputedStyle(el).borderTopLeftRadius) : 16;
    const radius = Math.min(Number.isFinite(raw) ? raw : 16, bar.width * 0.5, bar.height * 0.5);
    const color = kindAura(ed.theme, rip.kind);
    return {
      x: rip.x,
      y: rip.y,
      age,
      color,
      mate: auraPartner(color),
      dirx: rip.dx,
      diry: rip.dy,
      speed: rip.speed,
      bar,
      radius,
    };
  }

  private ensureStamp(cssW: number, cssH: number, dpr: number): boolean {
    const dw = Math.max(1, Math.round(cssW * dpr));
    const dh = Math.max(1, Math.round(cssH * dpr));
    let sw = Math.max(1, Math.round(dw / 2));
    let sh = Math.max(1, Math.round(dh / 2));
    const cap = 1400;
    const m = Math.max(sw, sh);
    if (m > cap) {
      sw = Math.max(1, Math.round((sw * cap) / m));
      sh = Math.max(1, Math.round((sh * cap) / m));
    }
    if (this.colorCanvas.width !== sw || this.colorCanvas.height !== sh) {
      this.colorCanvas.width = sw;
      this.colorCanvas.height = sh;
      this.flowCanvas.width = sw;
      this.flowCanvas.height = sh;
    }
    this.stampW = sw;
    this.stampH = sh;
    return true;
  }

  /**
   * Everything the distance stamp depends on. Signal colours and the moving noise
   * are not in here: those stay in the shader, so a live circuit does not rebuild the field.
   */
  private fieldKey(ed: Editor): string {
    const ids = [...ed.selection].sort();
    const sel = ids.join(',');
    if (ed.getSimVersion() !== this.activeVer || sel !== this.activeSel) {
      this.activeVer = ed.getSimVersion();
      this.activeSel = sel;
      const on: string[] = [];
      for (const c of ed.doc.components.values()) {
        if (!isInput(c.kind) || ed.selection.has(c.id) || !ed.isActive(c)) continue;
        on.push(c.id);
      }
      this.activeSig = on.join(',');
    }
    const bits = [
      ed.dpr,
      ed.width,
      ed.height,
      ed.theme.id,
      ed.wireStyle,
      ed.waveSelection ? 1 : 0,
      ed.getVersion(),
      sel,
      this.activeSig,
    ];
    for (const id of ids) {
      const c = ed.doc.components.get(id);
      if (c) {
        bits.push(c.x.toFixed(1), c.y.toFixed(1), c.w, c.h, c.rot);
        continue;
      }
      const b = ed.doc.boxes.get(id);
      if (b) bits.push(b.x.toFixed(1), b.y.toFixed(1), b.w, b.h, (ed.boxT.get(id) ?? 1).toFixed(3));
    }
    const closed: string[] = [];
    for (const [id, t] of ed.boxT) if (t < 0.02) closed.push(id);
    if (closed.length) bits.push(closed.sort().join(','));
    return bits.join('|');
  }

  private rebuild(ed: Editor): void {
    this.hasStamp = false;
    const cssW = ed.width;
    const cssH = ed.height;
    if (cssW < 2 || cssH < 2 || !this.colorCtx || !this.flowCtx) return;
    this.ensureStamp(cssW, cssH, ed.dpr);
    const s = this.stampW / cssW;
    const cam = this.basis ?? ed.cam;
    const zoom = cam.zoom || 1;
    this.view = {
      wx: zoom * s,
      wy: zoom * s,
      tx: -cam.x * zoom * s,
      ty: -cam.y * zoom * s,
      s,
      zoom,
    };
    this.stampCam = { x: cam.x, y: cam.y, zoom };
    this.clearStamp();
    const view = inflate({ x: cam.x, y: cam.y, w: cssW / zoom, h: cssH / zoom }, 40 / zoom);
    const covered: Box[] = [];
    for (const b of ed.doc.boxes.values()) if ((ed.boxT.get(b.id) ?? 1) < 0.02) covered.push(b);

    for (const c of ed.doc.components.values()) {
      const selected = ed.selection.has(c.id);
      if (c.kind === 'note' || c.kind === 'marker') continue;
      if (selected && !ed.waveSelection) continue;
      const powered = !selected && isInput(c.kind) && ed.isActive(c);
      if (!selected && !powered) continue;
      if (!rectsOverlap(componentBounds(c), view)) continue;
      if (partHidden(ed, c, covered)) continue;
      const local = localSize(c);
      const reach = partReach(local.w, local.h);
      this.paintLocalField(
        xformOf(c),
        cachedPath(componentOutline(c)),
        componentAura(ed, c),
        reach,
        selected ? 1 : 0.5,
        local.w,
        local.h,
      );
    }

    if (ed.waveSelection) {
      for (const b of ed.doc.boxes.values()) {
        if (!ed.selection.has(b.id)) continue;
        const open = 1 - (ed.boxT.get(b.id) ?? 1);
        if (open < 0.02) continue;
        if (!rectsOverlap(b, view)) continue;
        if (covered.some((o) => o !== b && boxInBox(b, o))) continue;
        const reach = partReach(b.w, b.h);
        this.paintWorldField(
          cachedPath(roundRectD(b.x, b.y, b.w, b.h, 8)),
          vividAura(ed.theme, b.color ?? ed.theme.box, b.id),
          reach,
          0,
          open,
          'two',
          b,
          true,
        );
      }
    }

    this.paintWires(ed, covered, view);
  }

  private paintWires(ed: Editor, covered: Box[], view: Rect): void {
    if (!ed.waveSelection) return;
    let picked = false;
    for (const id of ed.selection) {
      if (ed.doc.wires.has(id)) {
        picked = true;
        break;
      }
    }
    if (!picked) return;
    const doc = ed.doc;
    const signals = signalKeys(doc);
    const laneKey = (id: string, lane = 0) => (lane ? `${id}#${lane}` : id);
    const nets = new Set<string>();
    for (const id of ed.selection) {
      const w = doc.wires.get(id);
      const src = w && doc.components.get(w.from);
      if (!w || !src) continue;
      const n = w.cable ? laneCount(src) : 1;
      for (let i = 0; i < n; i++) {
        const lane = w.cable ? i : (w.lane ?? 0);
        nets.add(signals.get(laneKey(w.from, lane)) ?? laneKey(w.from, lane));
      }
    }
    const onNet = (from: string, lane: number) => nets.has(signals.get(laneKey(from, lane)) ?? laneKey(from, lane));
    const map = ed.routeMap ?? avoidMap(doc);
    const zoom = this.view.zoom;
    const core = wireCore(zoom, ed.dpr);
    const idle = parseRgb(idleWire(ed.theme));
    for (const w of doc.wires.values()) {
      if (w.cable) continue;
      if (!onNet(w.from, w.lane ?? 0)) continue;
      const a = doc.components.get(w.from);
      const b = doc.components.get(w.to);
      if (!a || !b) continue;
      const curve = routedWire(map, a, b, w.input, w.lane ?? 0, 10, ed.wireStyle);
      if (!curve) continue;
      if (!rectsOverlap(inflate(curveBounds(curve), 8), view)) continue;
      if (covered.length && covered.some((bx) => pointInRect(curve.a, bx) && pointInRect(curve.b, bx))) continue;
      const srcKey = w.lane ? `${w.from}#${w.lane}` : w.from;
      const rgb = ed.parts.live.has(w.id) ? parseRgb(wireColors(ed.parts.roots.get(srcKey) ?? w.from, ed.theme).on) : idle;
      if (!rgb) continue;
      this.paintWireField(curve, rgb, core);
    }
    for (const w of doc.wires.values()) {
      if (!w.cable) continue;
      const a = doc.components.get(w.from);
      const b = doc.components.get(w.to);
      if (!a || !b) continue;
      const n = Math.min(laneCount(a), laneCount(b));
      let hit = -1;
      for (let i = 0; i < n; i++) if (onNet(w.from, i)) {
        hit = i;
        break;
      }
      if (hit < 0) continue;
      const curve = routedWire(map, a, b, 0, 0, n * CABLE_PITCH * 0.5 + 8, ed.wireStyle, true);
      if (!curve) continue;
      if (!rectsOverlap(inflate(curveBounds(curve), n * CABLE_PITCH), view)) continue;
      const key = hit ? `${w.from}#${hit}` : w.from;
      const laneLive = ed.parts.live.has(hit ? `${w.id}#${hit}` : w.id);
      const rgb = laneLive ? parseRgb(wireColors(ed.parts.roots.get(key) ?? w.from, ed.theme).on) : idle;
      if (!rgb) continue;
      const sleeve = Math.max(core, 0.5) * WIRE_SLEEVE;
      this.paintWireField(curve, rgb, n * CABLE_PITCH + 0.8, sleeve);
    }
  }

  private clearStamp(): void {
    const c = this.colorCtx!;
    const f = this.flowCtx!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    f.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    f.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    f.globalAlpha = 1;
    c.clearRect(0, 0, this.stampW, this.stampH);
    f.fillStyle = '#000';
    f.fillRect(0, 0, this.stampW, this.stampH);
    for (const ctx of [c, f]) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
    }
  }

  /**
   * Distance measured in the part's own units, so zooming scales the wave with the part.
   * 0 on the outline, 1 at `reach` past it. Two layers store red at half of blue; a wire's single layer stores a quarter.
   * The interior stays filled so the cover's anti-aliased edge blends into the wave. Each field is merged by the closer outline.
   */
  private paintLocalField(
    m: Xf,
    path: Path2D,
    rgb: Rgb,
    reach: number,
    strength: number,
    bodyW: number,
    bodyH: number,
  ): void {
    const pad = reach * 1.2 + 16;
    const rect = this.gateStampRect(m, bodyW, bodyH, pad);
    if (!rect) return;
    this.prepareScratch(rect.w, rect.h);
    const { wx, wy, tx, ty } = this.view;
    const place = (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(wx * m.a, wy * m.b, wx * m.c, wy * m.d, wx * m.e + tx - rect.x, wy * m.f + ty - rect.y);
      this.readyStroke(ctx);
    };
    this.strokeField(place, path, rgb, reach, 0, strength, 'two', false);
    this.keepCloserField(rect);
    this.hasStamp = true;
  }

  private paintWorldField(
    path: Path2D,
    rgb: Rgb,
    reach: number,
    inner: number,
    strength: number,
    mode: 'one' | 'two',
    bounds: Rect,
    hollow: boolean,
  ): void {
    const pad = reach * 1.2 + inner + 4;
    const rect = this.worldStampRect(bounds, pad);
    if (!rect) return;
    this.prepareScratch(rect.w, rect.h);
    const { wx, wy, tx, ty } = this.view;
    const place = (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(wx, 0, 0, wy, tx - rect.x, ty - rect.y);
      this.readyStroke(ctx);
    };
    this.strokeField(place, path, rgb, reach, inner, strength, mode, hollow);
    this.keepCloserField(rect);
    this.hasStamp = true;
  }

  private paintWireField(curve: WireCurve, rgb: Rgb, core: number, reach = Math.max(core, 0.5) * WIRE_SLEEVE): void {
    this.paintWorldField(curvePath(curve), rgb, reach, core / 2, 0.5, 'one', curveBounds(curve), false);
  }

  /** Stamp-space bounds of a local body expanded by `pad` world units. */
  private gateStampRect(m: Xf, bodyW: number, bodyH: number, pad: number): { x: number; y: number; w: number; h: number } | null {
    const { wx, wy, tx, ty } = this.view;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const px of [-pad, bodyW + pad]) {
      for (const py of [-pad, bodyH + pad]) {
        const x = wx * (m.a * px + m.c * py + m.e) + tx;
        const y = wy * (m.b * px + m.d * py + m.f) + ty;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    const x0 = Math.max(0, Math.floor(minX) - 2);
    const y0 = Math.max(0, Math.floor(minY) - 2);
    const x1 = Math.min(this.stampW, Math.ceil(maxX) + 2);
    const y1 = Math.min(this.stampH, Math.ceil(maxY) + 2);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private prepareScratch(w: number, h: number): void {
    const gc = this.gateColorCtx!;
    const gf = this.gateFlowCtx!;
    if (this.gateColor.width !== w || this.gateColor.height !== h) {
      this.gateColor.width = w;
      this.gateColor.height = h;
      this.gateFlow.width = w;
      this.gateFlow.height = h;
    } else {
      gc.setTransform(1, 0, 0, 1, 0, 0);
      gf.setTransform(1, 0, 0, 1, 0, 0);
      gc.clearRect(0, 0, w, h);
      gf.clearRect(0, 0, w, h);
    }
  }

  private readyStroke(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  /** Stamp-space bounds of a world rectangle expanded by `pad` world units. */
  private worldStampRect(b: Rect, pad: number): { x: number; y: number; w: number; h: number } | null {
    const { wx, wy, tx, ty } = this.view;
    const minX = wx * (b.x - pad) + tx;
    const minY = wy * (b.y - pad) + ty;
    const maxX = wx * (b.x + b.w + pad) + tx;
    const maxY = wy * (b.y + b.h + pad) + ty;
    const x0 = Math.max(0, Math.floor(Math.min(minX, maxX)) - 2);
    const y0 = Math.max(0, Math.floor(Math.min(minY, maxY)) - 2);
    const x1 = Math.min(this.stampW, Math.ceil(Math.max(minX, maxX)) + 2);
    const y1 = Math.min(this.stampH, Math.ceil(Math.max(minY, maxY)) + 2);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * `reach` and `inner` are in the same units as the current transform (local units, or world units).
   * The stroke is centered, so a reach of R extends R past the path. `inner` is the wire's half-width:
   * distance 0 starts at the wire edge, then the core is punched out.
   */
  private strokeField(
    place: (ctx: CanvasRenderingContext2D) => void,
    path: Path2D,
    rgb: Rgb,
    reach: number,
    inner: number,
    strength: number,
    mode: 'one' | 'two',
    hollow: boolean,
  ): void {
    const c = this.gateColorCtx!;
    const f = this.gateFlowCtx!;
    place(c);
    place(f);
    const span = Math.max(reach, 0.5) * this.view.zoom * this.view.s;
    const steps = Math.max(8, Math.min(48, Math.round(span)));
    const blue = Math.round(Math.max(0, Math.min(1, strength)) * 255);
    const red = Math.round(blue / (mode === 'one' ? 4 : 2));
    const colour = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    c.strokeStyle = colour;
    c.fillStyle = colour;
    const shell = (inner + reach * 1.12) * 2;
    c.lineWidth = shell;
    c.stroke(path);
    f.strokeStyle = `rgb(${red},${blue},${blue})`;
    f.lineWidth = shell;
    f.stroke(path);
    for (let i = steps; i >= 1; i--) {
      const dist = i / steps;
      const lw = (inner + dist * reach) * 2;
      c.lineWidth = lw;
      c.stroke(path);
      f.strokeStyle = `rgb(${red},${Math.round(dist * blue)},${blue})`;
      f.lineWidth = lw;
      f.stroke(path);
    }
    if (!hollow && inner <= 0) {
      c.fill(path);
      f.fillStyle = `rgb(${red},0,${blue})`;
      f.fill(path);
    }
    if (hollow) {
      c.globalCompositeOperation = 'destination-out';
      f.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
      f.fillStyle = '#000';
      c.fill(path);
      f.fill(path);
    } else if (inner > 0) {
      const hole = inner * 2;
      c.globalCompositeOperation = 'destination-out';
      f.globalCompositeOperation = 'destination-out';
      c.lineWidth = hole;
      f.lineWidth = hole;
      c.stroke(path);
      f.stroke(path);
    }
    c.globalCompositeOperation = 'source-over';
    f.globalCompositeOperation = 'source-over';
  }

  /** Parts stay above wires. Same kind of field keeps whichever outline is closer. */
  private keepCloserField(rect: { x: number; y: number; w: number; h: number }): void {
    const srcC = this.gateColorCtx!.getImageData(0, 0, rect.w, rect.h);
    const srcF = this.gateFlowCtx!.getImageData(0, 0, rect.w, rect.h);
    const dstC = this.colorCtx!.getImageData(rect.x, rect.y, rect.w, rect.h);
    const dstF = this.flowCtx!.getImageData(rect.x, rect.y, rect.w, rect.h);
    const sc = srcC.data;
    const sf = srcF.data;
    const dc = dstC.data;
    const df = dstF.data;
    for (let i = 0; i < sf.length; i += 4) {
      const srcL = waveLayer(sf[i], sf[i + 2], sf[i + 3]);
      if (!srcL) continue;
      const sb = sf[i + 2];
      const db = df[i + 2];
      const dstL = waveLayer(df[i], db, df[i + 3]);
      if (dstL > srcL) continue;
      if (dstL === srcL && sf[i + 1] / sb >= df[i + 1] / db) continue;
      df[i] = sf[i];
      df[i + 1] = sf[i + 1];
      df[i + 2] = sf[i + 2];
      df[i + 3] = sf[i + 3];
      dc[i] = sc[i];
      dc[i + 1] = sc[i + 1];
      dc[i + 2] = sc[i + 2];
      dc[i + 3] = sc[i + 3];
    }
    this.flowCtx!.putImageData(dstF, rect.x, rect.y);
    this.colorCtx!.putImageData(dstC, rect.x, rect.y);
  }

  /** Slide a stamp drawn at `from` onto the camera on screen now. */
  private mapBetween(from: { x: number; y: number; zoom: number } | null, ed: Editor): [number, number, number] {
    if (!from) return [1, 0, 0];
    const zoom = ed.cam.zoom || 1;
    const cssW = ed.width || 1;
    const cssH = ed.height || 1;
    return [from.zoom / zoom, ((ed.cam.x - from.x) * from.zoom) / cssW, ((ed.cam.y - from.y) * from.zoom) / cssH];
  }

  /** Where the picture the worker is showing sits in this frame. */
  private stampMap(ed: Editor): [number, number, number] {
    return this.mapBetween(this.postedCam, ed);
  }

  private upload(ed: Editor): void {
    if (!this.worker) {
      this.postedCam = this.stampCam ? { ...this.stampCam } : null;
      this.pass?.upload(this.colorCanvas, this.flowCanvas);
      return;
    }
    const built = this.stampCam ? { ...this.stampCam } : null;
    const gen = ++this.stampGen;
    const copy = (src: HTMLCanvasElement) => {
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const ctx = c.getContext('2d');
      if (!ctx) return Promise.reject(new Error('stamp copy'));
      ctx.drawImage(src, 0, 0);
      return createImageBitmap(c);
    };
    void Promise.all([copy(this.colorCanvas), copy(this.flowCanvas)])
      .then(([colorBmp, flowBmp]) => {
        if (gen !== this.stampGen || !this.worker || !built) {
          colorBmp.close();
          flowBmp.close();
          return;
        }
        this.postedCam = built;
        this.worker.postMessage(
          { type: 'stamps', color: colorBmp, flow: flowBmp, basis: built },
          [colorBmp, flowBmp],
        );
      })
      .catch((err) => console.warn(err));
  }

  private clearGl(): void {
    this.pass?.clear();
  }

  private publish(ed: Editor, now: number, ripple: RippleDraw | null, building: boolean, show: boolean): void {
    if (this.worker) {
      this.postState(ed, building, show, ripple);
      return;
    }
    this.pass?.draw(now / 1000, this.drawOf(ed, building, ripple, show));
  }

  private postState(ed: Editor, building: boolean, show: boolean, ripple: RippleDraw | null): void {
    const rip = ed.placeRipple;
    this.worker?.postMessage({
      type: 'state',
      cssW: ed.width,
      cssH: ed.height,
      building,
      show,
      cam: { x: ed.cam.x, y: ed.cam.y, zoom: ed.cam.zoom || 1 },
      ripple:
        ripple && rip
          ? {
              x: ripple.x,
              y: ripple.y,
              dirx: ripple.dirx,
              diry: ripple.diry,
              speed: ripple.speed,
              radius: ripple.radius,
              color: [ripple.color.r / 255, ripple.color.g / 255, ripple.color.b / 255],
              mate: [ripple.mate.r / 255, ripple.mate.g / 255, ripple.mate.b / 255],
              bar: [ripple.bar.x, ripple.bar.y, ripple.bar.width, ripple.bar.height],
              startAbs: performance.timeOrigin + rip.t0,
            }
          : null,
    });
  }

  /** The GPU still holds the last selection stamp until this replaces it. */
  private dropField(): void {
    if (this.worker) this.worker.postMessage({ type: 'clearField' });
    else this.pass?.clearField();
    this.postedCam = null;
  }

  private drawOf(ed: Editor, building: boolean, ripple: RippleDraw | null, field: boolean): AuraDraw {
    return {
      cssW: ed.width,
      cssH: ed.height,
      building,
      field,
      map: this.stampMap(ed),
      place: [1, 0, 0] as [number, number, number],
      ripple: ripple
        ? {
            x: ripple.x,
            y: ripple.y,
            age: ripple.age,
            dirx: ripple.dirx,
            diry: ripple.diry,
            speed: ripple.speed,
            radius: ripple.radius,
            color: [ripple.color.r / 255, ripple.color.g / 255, ripple.color.b / 255],
            mate: [ripple.mate.r / 255, ripple.mate.g / 255, ripple.mate.b / 255],
            bar: [ripple.bar.x, ripple.bar.y, ripple.bar.width, ripple.bar.height],
          }
          : null,
    };
  }

  /** A fresh stamp once the placed picture no longer covers the view. */
  private wantsRebase(ed: Editor): boolean {
    const basis = this.basis;
    if (!basis) return true;
    const zoom = ed.cam.zoom || 1;
    const dx = (ed.cam.x - basis.x) * zoom;
    const dy = (ed.cam.y - basis.y) * zoom;
    if (Math.hypot(dx, dy) > Math.min(ed.width, ed.height) * 0.35) return true;
    const ratio = zoom / (basis.zoom || 1);
    return ratio < 0.8 || ratio > 1.25;
  }

  private stillView(ed: Editor): boolean {
    const prev = this.lastPresented;
    if (!prev) return false;
    const zoom = ed.cam.zoom || 1;
    const dx = (ed.cam.x - prev.x) * zoom;
    const dy = (ed.cam.y - prev.y) * zoom;
    if (Math.hypot(dx, dy) > 0.5) return false;
    const ratio = zoom / (prev.zoom || 1);
    return ratio > 0.999 && ratio < 1.001;
  }

  /**
   * While the page is still and a build is blocking the main thread, the worker canvas stays
   * visible so the wave can keep moving. Scrolling draws the worker's picture here instead,
   * in the same frame as the parts.
   */
  private present(ed: Editor, building: boolean): void {
    const source = this.heldCanvas;
    const lock = this.lockCanvas;
    if (!this.worker || !source || !lock) return;
    const from = this.bitmapBasis;
    const sameSpace = !!from && !!this.basis && from.x === this.basis.x && from.y === this.basis.y && from.zoom === this.basis.zoom;
    if (building && from && sameSpace && this.stillView(ed)) {
      const [s, tx, ty] = cameraPlace(from, ed.cam);
      source.style.visibility = 'visible';
      source.style.transformOrigin = '0 0';
      source.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      lock.style.visibility = 'hidden';
    } else {
      source.style.visibility = 'hidden';
      source.style.transform = 'none';
      lock.style.visibility = 'visible';
      this.blit(ed);
    }
    this.lastPresented = { x: ed.cam.x, y: ed.cam.y, zoom: ed.cam.zoom || 1 };
  }

  private blit(ed: Editor): void {
    const ctx = this.lockCtx;
    const canvas = this.lockCanvas;
    if (!ctx || !canvas) return;
    const dpr = ed.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bmp = this.bitmap;
    const from = this.bitmapBasis;
    if (!bmp || !from) return;
    const [s, tx, ty] = cameraPlace(from, ed.cam);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, tx * dpr, ty * dpr);
    ctx.drawImage(bmp, 0, 0, ed.width || 1, ed.height || 1);
  }
}
