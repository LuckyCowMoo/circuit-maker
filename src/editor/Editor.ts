import {
  boxContents,
  boxesOuterFirst,
  componentInBox,
  componentSize,
  emptyDoc,
  expandWithContents,
  findFreeSpot,
  idTaken,
  itemsBounds,
  makeComponent,
  uid,
} from '../model/doc';
import {
  bodyRect,
  componentBounds,
  componentCenter,
  curveBounds,
  curvePoint,
  distToSegment,
  geomOf,
  GRID,
  inflate,
  inputPos,
  MAX_INPUTS,
  outputPos,
  pinPos,
  pointInRect,
  rectInside,
  rectsOverlap,
  snap,
  wireCurve,
} from '../model/geometry';
import { getTheme, type Theme } from '../model/themes';
import type { Box, Component, ComponentKind, Doc, Point, Rect, Wire } from '../model/types';
import { hasOutput, inputCount, isGate } from '../model/types';
import { Simulator } from '../sim/simulator';
import { docToText, FILE_EXTENSION, parseCircuit, serialize, type FileView } from '../io/format';
import { buildSvg, svgToPng } from '../io/export';
import { downloadBlob, downloadText, safeFilename } from '../io/download';
import { renderScene, TOOLBAR_SPACE } from './renderer';
import halfAdderExample from '../../examples/half-adder.cmk.json?raw';

export type Tool = 'select' | 'pan';
export type PlaceKind = ComponentKind | 'box';
export type ExportFormat = 'project' | 'svg' | 'png';
export type ExportScope = 'all' | 'selection';

export interface Camera {
  /** World coordinate at the top-left of the screen. */
  x: number;
  y: number;
  zoom: number;
}

/** A pin on a component; pin -1 is the output, 0..n-1 are inputs. */
export interface PinRef {
  comp: string;
  pin: number;
}

export interface PlaceMenu {
  sx: number;
  sy: number;
  world: Point;
  from: PinRef | null;
}

export interface MenuItem {
  label: string;
  kind: PlaceKind;
  negate?: boolean;
}

export interface Arrow {
  x: number;
  y: number;
  angle: number;
  color: string;
  label: string;
  target: Point;
}

export type Drag =
  | { kind: 'pan'; sx: number; sy: number; camX: number; camY: number; moved: boolean; button: number }
  | {
      kind: 'move';
      start: Point;
      sx: number;
      sy: number;
      target: string;
      wasSelected: boolean;
      shift: boolean;
      moved: boolean;
      origin: Map<string, Point> | null;
      press: string | null;
      toggle: string | null;
    }
  | { kind: 'marquee'; start: Point; cur: Point; base: Set<string> }
  | {
      kind: 'wire';
      from: PinRef;
      cur: Point;
      target: PinRef | null;
      sx: number;
      sy: number;
      moved: boolean;
      picked: string | null;
    }
  | { kind: 'resize'; box: string; handle: number; orig: Rect; start: Point; sx: number; sy: number; moved: boolean }
  | { kind: 'pinch'; dist: number; world: Point; zoom: number };

export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 3;
const DRAG_PX = 4;
const UNDO_LIMIT = 80;
const AUTOSAVE_KEY = 'circuit-maker:autosave';
const THEME_KEY = 'circuit-maker:theme';
const DEFAULT_BOX = { w: 240, h: 160 };

const GATE_MENU: MenuItem[] = [
  { label: 'AND', kind: 'and' },
  { label: 'NAND', kind: 'and', negate: true },
  { label: 'OR', kind: 'or' },
  { label: 'NOR', kind: 'or', negate: true },
  { label: 'XOR', kind: 'xor' },
  { label: 'XNOR', kind: 'xor', negate: true },
  { label: 'Buffer', kind: 'buffer' },
  { label: 'NOT', kind: 'buffer', negate: true },
];

export const KIND_LABEL: Record<PlaceKind, string> = {
  and: 'AND gate',
  or: 'OR gate',
  xor: 'XOR gate',
  buffer: 'Buffer',
  switch: 'Switch',
  button: 'Button',
  bulb: 'Light bulb',
  marker: 'Marker',
  box: 'Box',
};

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage full or unavailable; autosave is best-effort.
    }
  },
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Editor {
  doc: Doc = emptyDoc();
  cam: Camera = { x: -400, y: -300, zoom: 1 };
  theme: Theme = getTheme(storage.get(THEME_KEY));
  tool: Tool = 'select';
  selection = new Set<string>();
  sim = new Simulator();
  menu: PlaceMenu | null = null;
  placing: PlaceKind | null = null;
  /** World position of the placement preview. */
  ghost: Point | null = null;
  hoverPin: PinRef | null = null;
  toastMessage: string | null = null;
  arrows: Arrow[] = [];
  /** Box openness from the last frame: 1 = contents visible, 0 = covered. */
  boxT = new Map<string, number>();
  drag: Drag | null = null;

  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  width = 0;
  height = 0;
  dpr = 1;
  version = 0;

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastCheckpoint = { tag: '', time: 0 };
  private listeners = new Set<() => void>();
  private needsRender = true;
  private topologyDirty = true;
  private raf = 0;
  private pointers = new Map<number, Point>();
  private mouse: Point = { x: 0, y: 0 };
  private spaceHeld = false;
  private camAnim: { from: FileView; to: FileView; start: number; dur: number } | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private resizeObserver: ResizeObserver | null = null;
  private rect: DOMRect | null = null;
  /** View to apply once the canvas has a size. */
  private pendingView: FileView | 'fit' | null = null;

  // ---------------------------------------------------------------- lifecycle

  attach(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas) return;
    this.detach();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.preventDefault);
    canvas.addEventListener('dragover', this.onDragOver);
    canvas.addEventListener('drop', this.onDrop);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('copy', this.onCopy);
    window.addEventListener('cut', this.onCut);
    window.addEventListener('paste', this.onPaste);
    window.addEventListener('blur', this.onBlur);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  detach(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('wheel', this.onWheel);
    canvas.removeEventListener('contextmenu', this.preventDefault);
    canvas.removeEventListener('dragover', this.onDragOver);
    canvas.removeEventListener('drop', this.onDrop);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('copy', this.onCopy);
    window.removeEventListener('cut', this.onCut);
    window.removeEventListener('paste', this.onPaste);
    window.removeEventListener('blur', this.onBlur);
    this.resizeObserver?.disconnect();
    cancelAnimationFrame(this.raf);
    this.canvas = null;
    this.ctx = null;
  }

  private resize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.rect = canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = this.rect.width;
    this.height = this.rect.height;
    canvas.width = Math.round(this.width * this.dpr);
    canvas.height = Math.round(this.height * this.dpr);
    this.needsRender = true;
    const pending = this.pendingView;
    if (pending && this.width) {
      this.pendingView = null;
      if (pending === 'fit') this.fitView(false);
      else this.setView(pending);
    }
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    if (this.camAnim) this.tickCamAnim(now);
    if (this.topologyDirty) {
      this.sim.compile(this.doc);
      this.topologyDirty = false;
    }
    if (this.sim.pending) this.sim.step();
    if (this.sim.changed) {
      this.sim.changed = false;
      this.needsRender = true;
    }
    if (this.needsRender) {
      this.needsRender = false;
      renderScene(this);
    }
  };

  requestRender(): void {
    this.needsRender = true;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Call after any document mutation. */
  private changed(topology: boolean): void {
    if (topology) this.topologyDirty = true;
    this.needsRender = true;
    this.scheduleAutosave();
    this.emit();
  }

  toast(message: string): void {
    this.toastMessage = message;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMessage = null;
      this.emit();
    }, 4000);
    this.emit();
  }

  // ---------------------------------------------------------------- persistence

  loadInitial(): void {
    const saved = storage.get(AUTOSAVE_KEY);
    if (saved) {
      try {
        const parsed = parseCircuit(saved);
        this.doc = parsed.doc;
        if (parsed.view) this.setView(parsed.view);
        else this.fitView(false);
        this.changed(true);
        return;
      } catch {
        // Fall through to the example.
      }
    }
    this.loadExample(halfAdderExample, false);
  }

  loadExample(text: string, undoable = true): void {
    const parsed = parseCircuit(text);
    if (undoable) this.checkpoint();
    this.doc = parsed.doc;
    this.selection.clear();
    this.changed(true);
    this.fitView(false);
  }

  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      storage.set(AUTOSAVE_KEY, docToText(this.doc, { view: this.getView() }));
    }, 500);
  }

  // ---------------------------------------------------------------- undo

  private snapshot(): string {
    return JSON.stringify(serialize(this.doc));
  }

  private pushUndo(snapshot: string): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.lastCheckpoint = { tag: '', time: 0 };
  }

  /** Records an undo step. Repeated calls with the same tag in quick succession are merged. */
  checkpoint(tag = ''): void {
    const now = performance.now();
    if (tag && tag === this.lastCheckpoint.tag && now - this.lastCheckpoint.time < 1500) {
      this.lastCheckpoint.time = now;
      return;
    }
    this.pushUndo(this.snapshot());
    this.lastCheckpoint = { tag, time: now };
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.snapshot());
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  private restore(text: string): void {
    const name = this.doc.name;
    this.doc = parseCircuit(text).doc;
    this.doc.name = name;
    for (const id of [...this.selection]) if (!this.itemExists(id)) this.selection.delete(id);
    this.lastCheckpoint = { tag: '', time: 0 };
    this.changed(true);
  }

  private itemExists(id: string): boolean {
    return idTaken(this.doc, id);
  }

  // ---------------------------------------------------------------- camera

  screenPoint(e: { clientX: number; clientY: number }): Point {
    const r = this.rect ?? { left: 0, top: 0 };
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  toWorld(s: Point): Point {
    return { x: s.x / this.cam.zoom + this.cam.x, y: s.y / this.cam.zoom + this.cam.y };
  }

  toScreen(w: Point): Point {
    return { x: (w.x - this.cam.x) * this.cam.zoom, y: (w.y - this.cam.y) * this.cam.zoom };
  }

  get viewRect(): Rect {
    const z = this.cam.zoom;
    return { x: this.cam.x, y: this.cam.y, w: this.width / z, h: this.height / z };
  }

  getView(): FileView {
    const z = this.cam.zoom;
    return { x: this.cam.x + this.width / 2 / z, y: this.cam.y + this.height / 2 / z, zoom: z };
  }

  setView(v: FileView): void {
    if (!this.width) {
      this.pendingView = v;
      return;
    }
    const z = clamp(v.zoom, MIN_ZOOM, MAX_ZOOM);
    this.cam = { x: v.x - this.width / 2 / z, y: v.y - this.height / 2 / z, zoom: z };
    this.needsRender = true;
  }

  zoomAt(s: Point, factor: number): void {
    const before = this.toWorld(s);
    const z = clamp(this.cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.cam = { x: before.x - s.x / z, y: before.y - s.y / z, zoom: z };
    this.camAnim = null;
    this.needsRender = true;
    this.scheduleAutosave();
  }

  zoomBy(factor: number): void {
    this.zoomAt({ x: this.width / 2, y: this.height / 2 }, factor);
  }

  animateTo(center: Point, zoom = this.cam.zoom): void {
    this.camAnim = {
      from: this.getView(),
      to: { x: center.x, y: center.y, zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM) },
      start: performance.now(),
      dur: 380,
    };
    this.needsRender = true;
  }

  private tickCamAnim(now: number): void {
    const a = this.camAnim!;
    const t = clamp((now - a.start) / a.dur, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);
    const zoom = Math.exp(Math.log(a.from.zoom) + (Math.log(a.to.zoom) - Math.log(a.from.zoom)) * e);
    this.setView({ x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e, zoom });
    if (t >= 1) {
      this.camAnim = null;
      this.scheduleAutosave();
    }
  }

  /** Frames the given items (or everything). */
  fitView(animate = true, ids?: Iterable<string>): void {
    if (!this.width) {
      this.pendingView = 'fit';
      return;
    }
    const all = ids ? [...ids] : [...this.doc.components.keys(), ...this.doc.boxes.keys()];
    const b = itemsBounds(this.doc, all);
    if (!b) {
      this.setView({ x: 0, y: 0, zoom: 1 });
      return;
    }
    const pad = 80;
    const availH = Math.max(100, this.height - TOOLBAR_SPACE);
    const zoom = clamp(Math.min(this.width / (b.w + pad * 2), availH / (b.h + pad * 2)), MIN_ZOOM, 1.5);
    const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 + TOOLBAR_SPACE / 2 / zoom };
    if (animate) this.animateTo(center, zoom);
    else this.setView({ ...center, zoom });
  }

  // ---------------------------------------------------------------- settings

  setTool(tool: Tool): void {
    this.tool = tool;
    this.updateCursor();
    this.emit();
  }

  setTheme(id: string): void {
    this.theme = getTheme(id);
    storage.set(THEME_KEY, this.theme.id);
    this.needsRender = true;
    this.emit();
  }

  setDocName(name: string): void {
    this.doc.name = name;
    this.scheduleAutosave();
    this.emit();
  }

  // ---------------------------------------------------------------- selection

  setSelection(ids: Iterable<string>): void {
    this.selection = new Set(ids);
    this.needsRender = true;
    this.emit();
  }

  selectAll(): void {
    this.setSelection([...this.doc.components.keys(), ...this.doc.boxes.keys()]);
  }

  selectedComponents(): Component[] {
    const out: Component[] = [];
    for (const id of this.selection) {
      const c = this.doc.components.get(id);
      if (c) out.push(c);
    }
    return out;
  }

  selectedBoxes(): Box[] {
    const out: Box[] = [];
    for (const id of this.selection) {
      const b = this.doc.boxes.get(id);
      if (b) out.push(b);
    }
    return out;
  }

  selectedWires(): Wire[] {
    const out: Wire[] = [];
    for (const id of this.selection) {
      const w = this.doc.wires.get(id);
      if (w) out.push(w);
    }
    return out;
  }

  // ---------------------------------------------------------------- editing

  private addComponent(kind: ComponentKind, x: number, y: number): Component {
    const c = makeComponent(kind, x, y, uid(this.doc, `${kind}_`));
    this.doc.components.set(c.id, c);
    return c;
  }

  private addBox(rect: Rect, name = 'Box'): Box {
    const b: Box = { id: uid(this.doc, 'box_'), ...rect, name, color: null };
    this.doc.boxes.set(b.id, b);
    return b;
  }

  /** Arms placement mode. If `e` is given (a toolbar pointerdown), dragging onto the canvas places on release. */
  beginPlace(kind: PlaceKind, e?: PointerEvent): void {
    this.closeMenu();
    if (kind === 'box' && (this.selectedComponents().length || this.selectedBoxes().length)) {
      this.wrapSelectionInBox();
      return;
    }
    this.placing = kind;
    this.ghost = null;
    this.emit();
    if (!e) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      if (this.placing !== kind) return;
      this.ghost = this.toWorld(this.screenPoint(ev));
      this.needsRender = true;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const dragged = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6;
      if (dragged && this.placing === kind && document.elementFromPoint(ev.clientX, ev.clientY) === this.canvas) {
        this.placeAt(kind, this.toWorld(this.screenPoint(ev)));
        this.cancelPlacing();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  cancelPlacing(): void {
    if (!this.placing) return;
    this.placing = null;
    this.ghost = null;
    this.needsRender = true;
    this.emit();
  }

  placeAt(kind: PlaceKind, w: Point): void {
    this.checkpoint();
    if (kind === 'box') {
      const b = this.addBox({
        x: snap(w.x - DEFAULT_BOX.w / 2),
        y: snap(w.y - DEFAULT_BOX.h / 2),
        ...DEFAULT_BOX,
      });
      this.selection = new Set([b.id]);
    } else {
      const size = componentSize(kind);
      const c = this.addComponent(kind, snap(w.x - size.w / 2), snap(w.y - size.h / 2));
      this.selection = new Set([c.id]);
    }
    this.changed(true);
  }

  wrapSelectionInBox(): void {
    const ids = expandWithContents(this.doc, this.selection);
    const b = itemsBounds(this.doc, ids);
    if (!b) return;
    this.checkpoint();
    const x = snap(b.x - 30);
    const y = snap(b.y - 50);
    const box = this.addBox({ x, y, w: snap(b.x + b.w + 30) - x, h: snap(b.y + b.h + 30) - y });
    this.selection = new Set([box.id]);
    this.changed(true);
    this.toast('Box created around the selection. Name it in the toolbar.');
  }

  /** Connects an output pin to an input pin (in either order). Replaces any wire already on that input. */
  private connect(a: PinRef, b: PinRef): boolean {
    const out = a.pin < 0 ? a : b.pin < 0 ? b : null;
    const inp = out === a ? b : a;
    if (!out || inp.pin < 0) return false;
    const src = this.doc.components.get(out.comp);
    const dst = this.doc.components.get(inp.comp);
    if (!src || !dst || !hasOutput(src.kind) || inp.pin >= inputCount(dst)) return false;
    for (const w of this.doc.wires.values()) {
      if (w.to === dst.id && w.input === inp.pin) this.doc.wires.delete(w.id);
    }
    const w: Wire = { id: uid(this.doc, 'w_'), from: src.id, to: dst.id, input: inp.pin };
    this.doc.wires.set(w.id, w);
    return true;
  }

  private wireInto(comp: string, input: number): Wire | null {
    for (const w of this.doc.wires.values()) if (w.to === comp && w.input === input) return w;
    return null;
  }

  deleteSelection(): void {
    if (!this.selection.size) return;
    this.checkpoint();
    const ids = expandWithContents(this.doc, this.selection);
    for (const id of ids) {
      this.doc.components.delete(id);
      this.doc.boxes.delete(id);
      this.doc.wires.delete(id);
    }
    this.pruneWires();
    this.selection = new Set();
    this.changed(true);
  }

  /** Removes the selected boxes but keeps what's inside them. */
  unboxSelection(): void {
    const boxes = this.selectedBoxes();
    if (!boxes.length) return;
    this.checkpoint();
    for (const b of boxes) this.doc.boxes.delete(b.id);
    this.selection = new Set();
    this.changed(false);
  }

  private pruneWires(): void {
    for (const w of this.doc.wires.values()) {
      const dst = this.doc.components.get(w.to);
      if (!this.doc.components.has(w.from) || !dst || w.input >= inputCount(dst)) this.doc.wires.delete(w.id);
    }
  }

  /** Applies a change to every selected component and box. */
  editSelection(tag: string, fn: (item: Component | Box) => void, topology = false): void {
    const items = [...this.selectedComponents(), ...this.selectedBoxes()];
    if (!items.length) return;
    this.checkpoint(tag);
    for (const it of items) fn(it);
    if (topology) this.pruneWires();
    this.changed(topology);
  }

  setInputs(n: number): void {
    const count = clamp(Math.round(n), 1, MAX_INPUTS);
    this.editSelection(
      'inputs',
      (it) => {
        if ('kind' in it && isGate(it.kind)) it.inputs = count;
      },
      true,
    );
  }

  changeInputs(delta: number): void {
    const gates = this.selectedComponents().filter((c) => isGate(c.kind));
    if (!gates.length) return;
    this.editSelection(
      'inputs',
      (it) => {
        if ('kind' in it && isGate(it.kind)) it.inputs = clamp(it.inputs + delta, 1, MAX_INPUTS);
      },
      true,
    );
  }

  setNegate(v: boolean): void {
    this.editSelection(
      'negate',
      (it) => {
        if ('kind' in it && isGate(it.kind)) it.negate = v;
      },
      true,
    );
  }

  toggleNegate(): void {
    const gates = this.selectedComponents().filter((c) => isGate(c.kind));
    if (gates.length) this.setNegate(!gates.every((g) => g.negate));
  }

  setStroke(color: string | null): void {
    this.editSelection('stroke', (it) => {
      if ('kind' in it && it.kind !== 'marker') it.stroke = color;
    });
  }

  setFill(color: string | null): void {
    this.editSelection('fill', (it) => {
      if ('kind' in it && it.kind !== 'marker') it.fill = color;
    });
  }

  setColor(color: string | null): void {
    this.editSelection('color', (it) => {
      if (!('kind' in it) || it.kind === 'marker' || it.kind === 'bulb') it.color = color;
    });
  }

  setName(name: string): void {
    this.editSelection('name', (it) => {
      if (!('kind' in it) || it.kind === 'marker') it.name = name;
    });
  }

  toggleSwitch(id: string): void {
    const c = this.doc.components.get(id);
    if (!c || c.kind !== 'switch') return;
    c.on = !c.on;
    this.sim.setSwitch(id, c.on);
    this.needsRender = true;
    this.scheduleAutosave();
  }

  nudge(dx: number, dy: number): void {
    const ids = expandWithContents(this.doc, this.selection);
    if (![...ids].some((id) => this.doc.components.has(id) || this.doc.boxes.has(id))) return;
    this.checkpoint('nudge');
    for (const id of ids) {
      const it = this.doc.components.get(id) ?? this.doc.boxes.get(id);
      if (it) {
        it.x += dx;
        it.y += dy;
      }
    }
    this.changed(false);
  }

  /** Clones the given items (plus box contents and internal wires) by an offset. Returns old id -> new id. */
  private cloneItems(src: Doc, ids: Set<string>, dx: number, dy: number, keepIds = false): Map<string, string> {
    const map = new Map<string, string>();
    const newId = (id: string, prefix: string) => (keepIds && !idTaken(this.doc, id) ? id : uid(this.doc, prefix));
    for (const id of ids) {
      const c = src.components.get(id);
      if (c) {
        const copy: Component = { ...c, id: newId(c.id, `${c.kind}_`), x: c.x + dx, y: c.y + dy };
        this.doc.components.set(copy.id, copy);
        map.set(id, copy.id);
        continue;
      }
      const b = src.boxes.get(id);
      if (b) {
        const copy: Box = { ...b, id: newId(b.id, 'box_'), x: b.x + dx, y: b.y + dy };
        this.doc.boxes.set(copy.id, copy);
        map.set(id, copy.id);
      }
    }
    for (const w of src.wires.values()) {
      const from = map.get(w.from);
      const to = map.get(w.to);
      if (from && to) {
        const copy: Wire = { id: uid(this.doc, 'w_'), from, to, input: w.input };
        this.doc.wires.set(copy.id, copy);
      }
    }
    return map;
  }

  /** Nearest spot for `rect` that avoids every component and doesn't straddle any box edge. */
  private freeSpot(rect: Rect, exclude: Set<string>, extra: Rect[] = []): Rect {
    const obstacles: Rect[] = [...extra];
    for (const c of this.doc.components.values()) if (!exclude.has(c.id)) obstacles.push(componentBounds(c));
    const containers: Rect[] = [];
    for (const b of this.doc.boxes.values()) if (!exclude.has(b.id)) containers.push(b);
    return findFreeSpot(rect, obstacles, 30, containers);
  }

  /** Duplicates the selection (boxes with everything inside) into the nearest free space. */
  duplicateSelection(): void {
    const ids = expandWithContents(this.doc, this.selection);
    for (const id of ids) if (this.doc.wires.has(id)) ids.delete(id);
    const bounds = itemsBounds(this.doc, ids);
    if (!bounds) return;
    const spot = this.freeSpot(bounds, ids, [bounds]);
    this.checkpoint();
    const map = this.cloneItems(this.doc, ids, snap(spot.x - bounds.x), snap(spot.y - bounds.y));
    this.selection = new Set([...this.selection].map((id) => map.get(id)).filter((id): id is string => !!id));
    this.changed(true);
  }

  /** Inserts another document's contents near `at` (or the view centre) without overlapping anything. */
  insertDoc(src: Doc, at: Point | null): number {
    const ids = new Set<string>([...src.components.keys(), ...src.boxes.keys()]);
    const bounds = itemsBounds(src, ids);
    if (!bounds) return 0;
    const center = at ?? this.getView();
    const rect = { x: snap(center.x - bounds.w / 2), y: snap(center.y - bounds.h / 2), w: bounds.w, h: bounds.h };
    const spot = this.freeSpot(rect, new Set());
    this.checkpoint();
    const map = this.cloneItems(src, ids, snap(spot.x - bounds.x), snap(spot.y - bounds.y), true);
    const top = [...ids].filter((id) => {
      const c = src.components.get(id);
      const boxes = [...src.boxes.values()];
      if (c) return !boxes.some((b) => componentInBox(c, b));
      const b = src.boxes.get(id)!;
      return !boxes.some((o) => o !== b && rectInside(b, o));
    });
    this.selection = new Set(top.map((id) => map.get(id)!));
    this.changed(true);
    if (!rectsOverlap(spot, this.viewRect)) this.animateTo({ x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 });
    return map.size;
  }

  newDocument(): void {
    this.checkpoint();
    this.doc = emptyDoc();
    this.selection = new Set();
    this.setView({ x: 0, y: 0, zoom: 1 });
    this.changed(true);
  }

  /** Opens a project file, replacing the current document or merging into it. */
  loadText(text: string, mode: 'replace' | 'merge'): boolean {
    let parsed;
    try {
      parsed = parseCircuit(text);
    } catch (e) {
      this.toast((e as Error).message);
      return false;
    }
    if (mode === 'replace') {
      this.checkpoint();
      this.doc = parsed.doc;
      this.selection = new Set();
      this.changed(true);
      if (parsed.view) this.setView(parsed.view);
      else this.fitView(false);
    } else {
      const n = this.insertDoc(parsed.doc, null);
      if (!n) {
        this.toast('That file is empty.');
        return false;
      }
    }
    if (parsed.warnings.length) {
      console.warn('Circuit Maker import warnings:\n' + parsed.warnings.join('\n'));
      this.toast(
        `Loaded with ${parsed.warnings.length} warning${parsed.warnings.length > 1 ? 's' : ''}: ${parsed.warnings[0]}`,
      );
    }
    return true;
  }

  async exportAs(format: ExportFormat, scope: ExportScope): Promise<void> {
    let ids: Set<string> | undefined;
    if (scope === 'selection') {
      ids = expandWithContents(this.doc, this.selection);
      for (const w of this.selectedWires()) {
        ids.add(w.from);
        ids.add(w.to);
      }
      if (!ids.size) {
        this.toast('Nothing is selected.');
        return;
      }
    }
    const base = safeFilename(this.doc.name) + (scope === 'selection' ? '-selection' : '');
    if (format === 'project') {
      const text = docToText(this.doc, { ids, view: scope === 'all' ? this.getView() : undefined });
      downloadText(text, base + FILE_EXTENSION, 'application/json');
      return;
    }
    const { svg, width, height } = buildSvg(this.doc, this.theme, this.sim, ids);
    if (format === 'svg') {
      downloadText(svg, base + '.svg', 'image/svg+xml');
      return;
    }
    try {
      downloadBlob(await svgToPng(svg, width, height), base + '.png');
    } catch (e) {
      this.toast(`PNG export failed: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- place menu

  openMenu(s: Point, from: PinRef | null): void {
    this.menu = { sx: s.x, sy: s.y, world: this.toWorld(s), from };
    this.emit();
  }

  closeMenu(): void {
    if (!this.menu) return;
    this.menu = null;
    this.needsRender = true;
    this.emit();
  }

  menuItems(): MenuItem[] {
    const from = this.menu?.from ?? null;
    if (!from) {
      return [
        ...GATE_MENU,
        { label: 'Switch', kind: 'switch' },
        { label: 'Button', kind: 'button' },
        { label: 'Light bulb', kind: 'bulb' },
        { label: 'Marker', kind: 'marker' },
        { label: 'Box', kind: 'box' },
      ];
    }
    if (from.pin < 0) return [...GATE_MENU, { label: 'Light bulb', kind: 'bulb' }];
    return [...GATE_MENU, { label: 'Switch', kind: 'switch' }, { label: 'Button', kind: 'button' }];
  }

  placeFromMenu(item: MenuItem): void {
    const m = this.menu;
    if (!m) return;
    this.menu = null;
    if (item.kind === 'box') {
      this.placeAt('box', m.world);
      return;
    }
    this.checkpoint();
    const c = this.addComponent(item.kind, 0, 0);
    c.negate = !!item.negate;
    const g = geomOf(c);
    const px = snap(m.world.x);
    const py = snap(m.world.y);
    const anchor = m.from ? (m.from.pin < 0 ? g.inputs[0] : g.output) : null;
    if (anchor) {
      c.x = px - anchor.x;
      c.y = py - anchor.y;
      if (m.from!.pin < 0) this.connect(m.from!, { comp: c.id, pin: 0 });
      else this.connect({ comp: c.id, pin: -1 }, m.from!);
    } else {
      c.x = snap(m.world.x - g.tip / 2);
      c.y = snap(m.world.y - g.h / 2);
    }
    this.selection = new Set([c.id]);
    this.changed(true);
  }

  // ---------------------------------------------------------------- hit testing

  private closedBoxes(): Box[] {
    const out: Box[] = [];
    for (const b of this.doc.boxes.values()) if ((this.boxT.get(b.id) ?? 1) < 0.5) out.push(b);
    return out;
  }

  private hiddenIn(c: Component, closed: Box[]): boolean {
    for (const b of closed) if (componentInBox(c, b)) return true;
    return false;
  }

  hitPin(w: Point, want: 'in' | 'out' | null, radius?: number): PinRef | null {
    const z = this.cam.zoom;
    const r = radius ?? clamp(9 / z, 7, 24);
    const closed = this.closedBoxes();
    let best: PinRef | null = null;
    let bestD = r;
    for (const c of this.doc.components.values()) {
      if (c.kind === 'marker') continue;
      if (!pointInRect(w, componentBounds(c), r)) continue;
      if (closed.length && this.hiddenIn(c, closed)) continue;
      const g = geomOf(c);
      if (want !== 'in' && g.output) {
        const d = Math.hypot(w.x - c.x - g.output.x, w.y - c.y - g.output.y);
        if (d < bestD) {
          bestD = d;
          best = { comp: c.id, pin: -1 };
        }
      }
      if (want !== 'out') {
        for (let i = 0; i < g.inputs.length; i++) {
          const p = g.inputs[i];
          const d = Math.hypot(w.x - c.x - p.x, w.y - c.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = { comp: c.id, pin: i };
          }
        }
      }
    }
    return best;
  }

  hitComponent(w: Point): Component | null {
    const pad = 3 / this.cam.zoom;
    const closed = this.closedBoxes();
    let hit: Component | null = null;
    for (const c of this.doc.components.values()) {
      if (pointInRect(w, bodyRect(c), pad) && !(closed.length && this.hiddenIn(c, closed))) hit = c;
    }
    return hit;
  }

  private hitClosedBox(w: Point): Box | null {
    for (const b of boxesOuterFirst(this.doc)) {
      if ((this.boxT.get(b.id) ?? 1) < 0.5 && pointInRect(w, b)) return b;
    }
    return null;
  }

  /** Layout of the small top-right name label shown on open boxes (world units). */
  boxLabel(b: Box): { x: number; y: number; size: number; rect: Rect } {
    const z = this.cam.zoom;
    const size = Math.min(13 / z, b.h * 0.25);
    const textW = b.name.length * size * 0.62;
    const x = b.x + b.w - 8 / z;
    const y = b.y + 6 / z + size / 2;
    return { x, y, size, rect: { x: x - textW - 4 / z, y: b.y + 2 / z, w: textW + 8 / z, h: size + 8 / z } };
  }

  private hitBoxFrame(w: Point): Box | null {
    const tol = 6 / this.cam.zoom;
    const boxes = boxesOuterFirst(this.doc);
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (!pointInRect(w, b, tol)) continue;
      const nearEdge =
        Math.abs(w.x - b.x) < tol ||
        Math.abs(w.x - b.x - b.w) < tol ||
        Math.abs(w.y - b.y) < tol ||
        Math.abs(w.y - b.y - b.h) < tol;
      if (nearEdge || (b.name && pointInRect(w, this.boxLabel(b).rect))) return b;
    }
    return null;
  }

  private hitWire(w: Point): Wire | null {
    const tol = Math.max(4, 6 / this.cam.zoom);
    let hit: Wire | null = null;
    for (const wire of this.doc.wires.values()) {
      const a = this.doc.components.get(wire.from);
      const b = this.doc.components.get(wire.to);
      if (!a || !b) continue;
      const pa = outputPos(a);
      const pb = inputPos(b, wire.input);
      if (!pa || !pb) continue;
      const curve = wireCurve(pa, pb);
      if (!pointInRect(w, curveBounds(curve), tol)) continue;
      let prev = pa;
      for (let i = 1; i <= 24; i++) {
        const p = curvePoint(curve, i / 24);
        if (distToSegment(w, prev, p) < tol) {
          hit = wire;
          break;
        }
        prev = p;
      }
    }
    return hit;
  }

  private hitHandle(s: Point): { box: string; handle: number } | null {
    for (const b of this.selectedBoxes()) {
      const p0 = this.toScreen(b);
      const p1 = this.toScreen({ x: b.x + b.w, y: b.y + b.h });
      const corners = [
        { x: p0.x, y: p0.y },
        { x: p1.x, y: p0.y },
        { x: p1.x, y: p1.y },
        { x: p0.x, y: p1.y },
      ];
      for (let i = 0; i < 4; i++) {
        if (Math.abs(s.x - corners[i].x) <= 8 && Math.abs(s.y - corners[i].y) <= 8) return { box: b.id, handle: i };
      }
    }
    return null;
  }

  private hitArrow(s: Point): Arrow | null {
    return this.arrows.find((a) => Math.hypot(s.x - a.x, s.y - a.y) < 20) ?? null;
  }

  /** Best pin to connect to while dragging a wire from `from`. */
  private wireTarget(from: PinRef, w: Point): PinRef | null {
    const want = from.pin < 0 ? 'in' : 'out';
    const pin = this.hitPin(w, want, clamp(14 / this.cam.zoom, 10, 30));
    if (pin) return pin;
    const c = this.hitComponent(w);
    if (!c || c.kind === 'marker') return null;
    const g = geomOf(c);
    if (want === 'out') return g.output ? { comp: c.id, pin: -1 } : null;
    let best: PinRef | null = null;
    let bestScore = Infinity;
    for (let i = 0; i < g.inputs.length; i++) {
      const dy = Math.abs(c.y + g.inputs[i].y - w.y);
      const score = dy + (this.wireInto(c.id, i) ? 1000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { comp: c.id, pin: i };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- pointer input

  private preventDefault = (e: Event) => e.preventDefault();

  private onPointerDown = (e: PointerEvent): void => {
    const s = this.screenPoint(e);
    this.mouse = s;
    this.pointers.set(e.pointerId, s);
    try {
      this.canvas?.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone (e.g. a very short touch).
    }
    this.canvas?.focus();
    this.closeMenu();
    if (this.pointers.size === 2) {
      this.startPinch();
      return;
    }
    if (this.pointers.size > 2) return;
    const w = this.toWorld(s);
    if (e.button === 2 && this.placing) {
      this.cancelPlacing();
      return;
    }
    const pan = e.button === 1 || e.button === 2 || (e.button === 0 && (this.tool === 'pan' || this.spaceHeld));
    if (pan) {
      this.camAnim = null;
      this.drag = { kind: 'pan', sx: s.x, sy: s.y, camX: this.cam.x, camY: this.cam.y, moved: false, button: e.button };
      this.updateCursor();
      return;
    }
    if (e.button !== 0) return;
    if (this.placing) {
      const kind = this.placing;
      this.placeAt(kind, w);
      if (!e.shiftKey) this.cancelPlacing();
      return;
    }
    const arrow = this.hitArrow(s);
    if (arrow) {
      this.animateTo(arrow.target, Math.max(this.cam.zoom, 0.6));
      return;
    }
    const handle = this.hitHandle(s);
    if (handle) {
      const b = this.doc.boxes.get(handle.box)!;
      this.drag = {
        kind: 'resize',
        box: b.id,
        handle: handle.handle,
        orig: { x: b.x, y: b.y, w: b.w, h: b.h },
        start: w,
        sx: s.x,
        sy: s.y,
        moved: false,
      };
      return;
    }
    const closed = this.hitClosedBox(w);
    if (closed) return this.startMove(closed.id, w, s, e.shiftKey, null);
    const pin = this.hitPin(w, null);
    if (pin) {
      this.drag = { kind: 'wire', from: pin, cur: w, target: null, sx: s.x, sy: s.y, moved: false, picked: null };
      return;
    }
    const comp = this.hitComponent(w);
    if (comp) return this.startMove(comp.id, w, s, e.shiftKey, comp);
    const frame = this.hitBoxFrame(w);
    if (frame) return this.startMove(frame.id, w, s, e.shiftKey, null);
    const wire = this.hitWire(w);
    if (wire) {
      if (e.shiftKey) {
        const next = new Set(this.selection);
        if (next.has(wire.id)) next.delete(wire.id);
        else next.add(wire.id);
        this.setSelection(next);
      } else this.setSelection([wire.id]);
      return;
    }
    if (!e.shiftKey && this.selection.size) this.setSelection([]);
    this.drag = { kind: 'marquee', start: w, cur: w, base: new Set(this.selection) };
  };

  private startMove(id: string, w: Point, s: Point, shift: boolean, comp: Component | null): void {
    const wasSelected = this.selection.has(id);
    if (!wasSelected) {
      if (shift) this.selection.add(id);
      else this.selection = new Set([id]);
      this.emit();
    }
    let press: string | null = null;
    if (comp?.kind === 'button') {
      press = comp.id;
      this.sim.setPressed(comp.id, true);
    }
    this.drag = {
      kind: 'move',
      start: w,
      sx: s.x,
      sy: s.y,
      target: id,
      wasSelected,
      shift,
      moved: false,
      origin: null,
      press,
      toggle: comp?.kind === 'switch' ? comp.id : null,
    };
    this.needsRender = true;
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (this.drag?.kind === 'move' && this.drag.press) this.sim.setPressed(this.drag.press, false);
    this.drag = { kind: 'pinch', dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), world: this.toWorld(mid), zoom: this.cam.zoom };
  }

  private onPointerMove = (e: PointerEvent): void => {
    const s = this.screenPoint(e);
    this.mouse = s;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, s);
    const w = this.toWorld(s);
    if (this.placing) {
      this.ghost = w;
      this.needsRender = true;
    }
    const d = this.drag;
    if (!d) {
      this.updateHover(w, s);
      return;
    }
    const far = (sx: number, sy: number) => Math.hypot(s.x - sx, s.y - sy) >= DRAG_PX;
    switch (d.kind) {
      case 'pinch': {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const z = clamp((d.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / d.dist, MIN_ZOOM, MAX_ZOOM);
        this.cam = { x: d.world.x - mid.x / z, y: d.world.y - mid.y / z, zoom: z };
        this.needsRender = true;
        break;
      }
      case 'pan': {
        if (!d.moved && !far(d.sx, d.sy)) return;
        d.moved = true;
        const z = this.cam.zoom;
        this.cam = { x: d.camX - (s.x - d.sx) / z, y: d.camY - (s.y - d.sy) / z, zoom: z };
        this.needsRender = true;
        break;
      }
      case 'move': {
        if (!d.moved) {
          if (!far(d.sx, d.sy)) return;
          d.moved = true;
          if (d.press) {
            this.sim.setPressed(d.press, false);
            d.press = null;
          }
          d.toggle = null;
          this.pushUndo(this.snapshot());
          d.origin = new Map();
          for (const id of expandWithContents(this.doc, this.selection)) {
            const it = this.doc.components.get(id) ?? this.doc.boxes.get(id);
            if (it) d.origin.set(id, { x: it.x, y: it.y });
          }
        }
        const dx = snap(w.x - d.start.x);
        const dy = snap(w.y - d.start.y);
        for (const [id, p] of d.origin!) {
          const it = this.doc.components.get(id) ?? this.doc.boxes.get(id);
          if (it) {
            it.x = p.x + dx;
            it.y = p.y + dy;
          }
        }
        this.needsRender = true;
        break;
      }
      case 'marquee': {
        d.cur = w;
        const r = {
          x: Math.min(d.start.x, w.x),
          y: Math.min(d.start.y, w.y),
          w: Math.abs(w.x - d.start.x),
          h: Math.abs(w.y - d.start.y),
        };
        const next = new Set(d.base);
        for (const c of this.doc.components.values()) if (rectsOverlap(bodyRect(c), r)) next.add(c.id);
        for (const b of this.doc.boxes.values()) if (rectInside(b, r)) next.add(b.id);
        this.selection = next;
        this.needsRender = true;
        this.emit();
        break;
      }
      case 'wire': {
        if (!d.moved) {
          if (!far(d.sx, d.sy)) return;
          d.moved = true;
          const existing = d.from.pin >= 0 ? this.wireInto(d.from.comp, d.from.pin) : null;
          if (existing) {
            // Dragging from a connected input picks the wire up so it can be moved or removed.
            d.picked = this.snapshot();
            this.doc.wires.delete(existing.id);
            d.from = { comp: existing.from, pin: -1 };
            this.topologyDirty = true;
          }
        }
        d.cur = w;
        d.target = this.wireTarget(d.from, w);
        this.needsRender = true;
        break;
      }
      case 'resize': {
        if (!d.moved) {
          if (!far(d.sx, d.sy)) return;
          d.moved = true;
          this.pushUndo(this.snapshot());
        }
        const b = this.doc.boxes.get(d.box);
        if (!b) return;
        const o = d.orig;
        const dx = w.x - d.start.x;
        const dy = w.y - d.start.y;
        const left = d.handle === 0 || d.handle === 3;
        const top = d.handle === 0 || d.handle === 1;
        let x0 = o.x;
        let y0 = o.y;
        let x1 = o.x + o.w;
        let y1 = o.y + o.h;
        if (left) x0 = Math.min(snap(o.x + dx), x1 - 60);
        else x1 = Math.max(snap(x1 + dx), x0 + 60);
        if (top) y0 = Math.min(snap(o.y + dy), y1 - 40);
        else y1 = Math.max(snap(y1 + dy), y0 + 40);
        b.x = x0;
        b.y = y0;
        b.w = x1 - x0;
        b.h = y1 - y0;
        this.needsRender = true;
        break;
      }
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.finishPointer(e, false);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.finishPointer(e, true);
  };

  private finishPointer(e: PointerEvent, cancelled: boolean): void {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (d?.kind === 'pinch') {
      if (this.pointers.size < 2) this.drag = null;
      return;
    }
    this.drag = null;
    if (!d) return;
    this.needsRender = true;
    const s = this.screenPoint(e);
    switch (d.kind) {
      case 'pan':
        if (!d.moved && d.button === 2 && !cancelled) this.openMenu(s, null);
        this.scheduleAutosave();
        break;
      case 'move':
        if (d.press) this.sim.setPressed(d.press, false);
        if (d.moved) this.changed(false);
        else if (!cancelled) {
          if (d.toggle) this.toggleSwitch(d.toggle);
          if (d.wasSelected) {
            if (d.shift) this.selection.delete(d.target);
            else if (this.selection.size > 1) this.selection = new Set([d.target]);
          }
          this.emit();
        }
        break;
      case 'marquee':
        this.emit();
        break;
      case 'wire': {
        if (!d.moved) break;
        const target = cancelled ? null : d.target;
        if (d.picked) this.pushUndo(d.picked);
        if (target) {
          if (!d.picked) this.checkpoint();
          this.connect(d.from, target);
          this.changed(true);
        } else if (d.picked) {
          this.changed(true);
        } else if (!cancelled) {
          this.openMenu(s, d.from);
        }
        break;
      }
      case 'resize':
        if (d.moved) this.changed(false);
        break;
    }
    this.needsRender = true;
    this.updateCursor();
  }

  private updateHover(w: Point, s: Point): void {
    const pin = this.hitPin(w, null);
    const prev = this.hoverPin;
    if (pin?.comp !== prev?.comp || pin?.pin !== prev?.pin) {
      this.hoverPin = pin;
      this.needsRender = true;
    }
    let cursor = this.tool === 'pan' || this.spaceHeld ? 'grab' : 'default';
    if (this.placing) cursor = 'copy';
    else if (this.hitArrow(s)) cursor = 'pointer';
    else if (this.hitHandle(s)) {
      const h = this.hitHandle(s)!.handle;
      cursor = h === 0 || h === 2 ? 'nwse-resize' : 'nesw-resize';
    } else if (pin) cursor = 'crosshair';
    else if (this.tool === 'select' && !this.spaceHeld) {
      const c = this.hitClosedBox(w) ? null : this.hitComponent(w);
      if (c) cursor = c.kind === 'switch' || c.kind === 'button' ? 'pointer' : 'move';
      else if (this.hitClosedBox(w) || this.hitBoxFrame(w)) cursor = 'move';
    }
    if (this.canvas) this.canvas.style.cursor = cursor;
  }

  private updateCursor(): void {
    if (!this.canvas) return;
    if (this.drag?.kind === 'pan') this.canvas.style.cursor = 'grabbing';
    else this.updateHover(this.toWorld(this.mouse), this.mouse);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dy = e.deltaY * unit;
    this.zoomAt(this.screenPoint(e), Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)));
  };

  private onDragOver = (e: DragEvent): void => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  };

  private onDrop = async (e: DragEvent): Promise<void> => {
    const file = e.dataTransfer?.files[0];
    if (!file) return;
    e.preventDefault();
    const text = await file.text();
    const at = this.toWorld(this.screenPoint(e));
    try {
      const parsed = parseCircuit(text);
      this.insertDoc(parsed.doc, at);
    } catch (err) {
      this.toast((err as Error).message);
    }
  };

  // ---------------------------------------------------------------- keyboard & clipboard

  private onKeyDown = (e: KeyboardEvent): void => {
    if (isTyping(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === ' ') {
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.updateCursor();
      }
      e.preventDefault();
      return;
    }
    if (mod && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (mod && key === 'a') {
      e.preventDefault();
      this.selectAll();
      return;
    }
    if (mod && key === 'd') {
      e.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (mod && key === 's') {
      e.preventDefault();
      void this.exportAs('project', 'all');
      return;
    }
    if (mod) return;
    switch (e.key) {
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        this.deleteSelection();
        break;
      case 'Escape':
        if (this.menu) this.closeMenu();
        else if (this.placing) this.cancelPlacing();
        else this.setSelection([]);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!this.selection.size) return;
        e.preventDefault();
        const step = GRID * (e.shiftKey ? 5 : 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this.nudge(dx, dy);
        break;
      }
      case '+':
      case '=':
        this.changeInputs(1);
        break;
      case '-':
      case '_':
        this.changeInputs(-1);
        break;
      default:
        if (key === 'n') this.toggleNegate();
        else if (key === 'f') this.fitView(true, this.selection.size ? expandWithContents(this.doc, this.selection) : undefined);
        else if (key === 'v') this.setTool('select');
        else if (key === 'h') this.setTool('pan');
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      this.spaceHeld = false;
      this.updateCursor();
    }
  };

  private onBlur = (): void => {
    this.spaceHeld = false;
    if (this.drag?.kind === 'move' && this.drag.press) this.sim.setPressed(this.drag.press, false);
  };

  /** The selection as project-file text (used for the clipboard). */
  selectionText(): string | null {
    const ids = expandWithContents(this.doc, this.selection);
    if (![...ids].some((id) => this.doc.components.has(id) || this.doc.boxes.has(id))) return null;
    return docToText(this.doc, { ids, name: `${this.doc.name} (copy)` });
  }

  private onCopy = (e: ClipboardEvent): void => {
    if (isTyping(e.target) || !e.clipboardData) return;
    const text = this.selectionText();
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  };

  private onCut = (e: ClipboardEvent): void => {
    if (isTyping(e.target) || !e.clipboardData) return;
    const text = this.selectionText();
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
    this.deleteSelection();
  };

  private onPaste = (e: ClipboardEvent): void => {
    if (isTyping(e.target)) return;
    const text = e.clipboardData?.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    try {
      const parsed = parseCircuit(text);
      const inView = pointInRect(this.mouse, { x: 0, y: 0, w: this.width, h: this.height });
      this.insertDoc(parsed.doc, inView ? this.toWorld(this.mouse) : null);
      if (parsed.warnings.length) this.toast(`Pasted with warnings: ${parsed.warnings[0]}`);
    } catch {
      this.toast("The clipboard doesn't contain a Circuit Maker circuit.");
    }
  };

  // ---------------------------------------------------------------- misc queries

  /** Signal state used to draw a component: switch on, button pressed or bulb lit. */
  isActive(c: Component): boolean {
    if (c.kind === 'switch') return c.on;
    if (c.kind === 'button') return this.sim.isPressed(c.id);
    if (c.kind === 'bulb') return this.sim.value(c.id);
    return false;
  }

  pinPosition(ref: PinRef): Point | null {
    const c = this.doc.components.get(ref.comp);
    return c ? pinPos(c, ref.pin) : null;
  }

  /** Centre points of everything that the "nearest" arrow may point at. */
  navigationTargets(): { point: Point; rect: Rect; marker: Component | null }[] {
    const out: { point: Point; rect: Rect; marker: Component | null }[] = [];
    for (const c of this.doc.components.values()) {
      out.push({ point: componentCenter(c), rect: componentBounds(c), marker: c.kind === 'marker' ? c : null });
    }
    for (const b of this.doc.boxes.values()) {
      out.push({ point: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, rect: b, marker: null });
    }
    return out;
  }

  boxContentsOf(b: Box) {
    return boxContents(this.doc, b);
  }

  viewInflated(px: number): Rect {
    return inflate(this.viewRect, px / this.cam.zoom);
  }
}
