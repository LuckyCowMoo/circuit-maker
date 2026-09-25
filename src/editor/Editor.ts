import {
  boxContents,
  boxesOuterFirst,
  boxInBox,
  componentInBox,
  emptyDoc,
  expandWithContents,
  findFreeSpot,
  idTaken,
  itemsBounds,
  makeComponent,
  netRoots,
  nextLabel,
  pinMasks,
  uid,
} from '../model/doc';
import {
  bodyRect,
  CABLE_PITCH,
  componentBounds,
  componentCenter,
  curveBounds,
  curvePoint,
  distToSegment,
  geomOf,
  GRID,
  inflate,
  IO_MAX,
  IO_MIN,
  MAX_INPUTS,
  pinPos,
  pointInRect,
  rectInside,
  rectsOverlap,
  reorient,
  rotatedSize,
  snap,
} from '../model/geometry';
import { avoidMap, routedWire, wireStyleOf, type WireStyle } from '../model/route';
import { floatsAboveBoxes, type PartContext } from '../model/parts';
import {
  buildBoxTree,
  cableConnectedPorts,
  dissolvePort,
  normalizePorts,
  onSide,
  placePort,
  portHasSideWiring,
  portInward,
  portSide,
  setPortWidth,
  wallPoint,
  type Side,
} from '../model/ports';
import { getTheme, type Theme } from '../model/themes';
import { isModifierOnly } from '../model/keys';
import type { Box, Component, ComponentKind, Doc, Point, Rect, Rotation, Wire } from '../model/types';
import {
  bundleDest,
  bundleInput,
  bundleOutput,
  bundleSource,
  CABLE_MIN,
  canRotate,
  hasOutput,
  inputCount,
  isGate,
  isIO,
  isRibbonPort,
  laneCount,
} from '../model/types';
import { Simulator } from '../sim/simulator';
import { docToText, FILE_EXTENSION, parseCircuit, serialize, type FileView } from '../io/format';
import { buildSvg, svgToPng } from '../io/export';
import { downloadBlob, downloadText, safeFilename } from '../io/download';
import { colorsFor, renderScene, TOOLBAR_SPACE } from './renderer';
import halfAdderExample from '../../examples/half-adder.cmk.json?raw';

export type Tool = 'select' | 'pan';
/** Things the toolbar can place. `not` is the NOT bubble, dropped onto a gate. */
export type PlaceKind = ComponentKind | 'box' | 'not' | 'ribbon-port';
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
  /** For ribbon ports from the cable drop menu. */
  portMode?: 'free' | 'box';
}

export interface Arrow {
  x: number;
  y: number;
  angle: number;
  color: string;
  label: string;
  target: Point;
}

/** Which edges of a box a resize drag moves (two edges = a corner). */
export interface BoxEdges {
  box: string;
  l: boolean;
  t: boolean;
  r: boolean;
  b: boolean;
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
  | { kind: 'marquee'; start: Point; cur: Point; base: Set<string>; sx: number; sy: number; moved: boolean; click: string | null; shift: boolean }
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
  | {
      kind: 'resize';
      edges: BoxEdges;
      orig: Rect;
      start: Point;
      sx: number;
      sy: number;
      moved: boolean;
      /** Boxes that contain this one, innermost first; they grow to keep it inside. */
      outer: { id: string; orig: Rect }[];
      /** Ports on the box and its outer boxes and where they were, so they can follow the walls. */
      ports: { id: string; box: string; side: Side; at: Point; inward: boolean }[];
    }
  | { kind: 'size'; comp: string; corner: number; orig: Rect; start: Point; sx: number; sy: number; moved: boolean }
  | { kind: 'port'; comp: string; inward: boolean; sx: number; sy: number; moved: boolean }
  | { kind: 'pinch'; dist: number; world: Point; zoom: number };

export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 3;
const BOX_COLORS = ['#6e56cf', '#0f9d8a', '#e5932a', '#3b82c4', '#e5484d', '#d4a017', '#0ea5e9', '#7c3aed'];
const DRAG_PX = 4;
const UNDO_LIMIT = 80;
const AUTOSAVE_KEY = 'circuit-maker:autosave';
const TABS_KEY = 'circuit-maker:tabs';
const TAB_KEY = 'circuit-maker:tab';
const HANDOFF_KEY = 'circuit-maker:handoff:';
const KEEP_TABS = 6;
const THEME_KEY = 'circuit-maker:theme';
const BEND_KEY = 'circuit-maker:bend-wires';
const DEFAULT_BOX = { w: 240, h: 160 };
/** Space kept between a resized box and the walls of the boxes around it. */
const BOX_GAP = 20;

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
  timer: 'Timer',
  bulb: 'Light bulb',
  rgb: 'RGB bulb',
  marker: 'Marker',
  box: 'Box',
  not: 'NOT bubble',
  port: 'Wire port',
  'ribbon-port': 'Ribbon port',
};

const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      // Storage full or unavailable; autosave is best-effort.
      return false;
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
  },
};

/** An id for this browser tab that survives reloads, so each tab autosaves its own project. */
/** This tab's autosave id. Tabs opened with window.open inherit their opener's, so they ask for a `fresh` one. */
function tabId(fresh = false): string {
  try {
    let id = fresh ? null : sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return 'default';
  }
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Editor {
  doc: Doc = emptyDoc();
  cam: Camera = { x: -400, y: -300, zoom: 1 };
  theme: Theme = getTheme(storage.get(THEME_KEY));
  /** Curve, curve that dodges objects, or orthogonal runs. */
  wireStyle: WireStyle = wireStyleOf(storage.get(BEND_KEY));
  tool: Tool = 'select';
  selection = new Set<string>();
  sim = new Simulator();
  menu: PlaceMenu | null = null;
  placing: PlaceKind | null = null;
  /** World position of the placement preview. */
  ghost: Point | null = null;
  /** While placing a port, the box edge the ghost is snapped to. */
  ghostSnap: { box: string; inward: boolean } | null = null;
  /** Wire to finish after placing a ribbon port from the cable drop menu. */
  pendingConnect: PinRef | null = null;
  hoverPin: PinRef | null = null;
  /** Box edge under the pointer, which a drag would resize. */
  hoverEdge: BoxEdges | null = null;
  /** Innermost box under the pointer. It stays open however far out or near the edge it is. */
  hoverBox: string | null = null;
  toastMessage: string | null = null;
  toastAction: { label: string; run: () => void } | null = null;
  arrows: Arrow[] = [];
  /** Wiring-derived drawing data, refreshed whenever the topology changes. */
  parts: PartContext = { doc: this.doc, masks: new Map(), roots: new Map(), colors: colorsFor };
  /** Bumped when any signal changes, for UI that shows live values. */
  simVersion = 0;
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
  private simListeners = new Set<() => void>();
  private tab = tabId();
  /** Time of the last wheel event that looked like a touchpad, so the whole gesture pans. */
  private touchpadAt = 0;
  /** Buttons currently held down by a keyboard binding. */
  private keyHeldButtons = new Set<string>();
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
    window.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('dragover', this.onDragOver);
    canvas.addEventListener('drop', this.onDrop);
    document.addEventListener('keydown', this.onKeyDown, true);
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
    window.removeEventListener('contextmenu', this.onContextMenu);
    canvas.removeEventListener('dragover', this.onDragOver);
    canvas.removeEventListener('drop', this.onDrop);
    document.removeEventListener('keydown', this.onKeyDown, true);
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
      this.parts = { doc: this.doc, masks: pinMasks(this.doc), roots: netRoots(this.doc), colors: colorsFor };
      this.topologyDirty = false;
    }
    this.sim.tickTime(now);
    if (this.sim.pending) this.sim.step();
    if (this.sim.changed) {
      this.sim.changed = false;
      this.needsRender = true;
      this.simVersion++;
      for (const fn of this.simListeners) fn();
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

  subscribeSim = (fn: () => void): (() => void) => {
    this.simListeners.add(fn);
    return () => this.simListeners.delete(fn);
  };

  getSimVersion = (): number => this.simVersion;

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Call after any document mutation. Keeps box ports in step with the wiring. */
  private changed(topology: boolean): void {
    if (normalizePorts(this.doc)) {
      topology = true;
      for (const id of [...this.selection]) if (!this.itemExists(id)) this.selection.delete(id);
    }
    if (topology) this.topologyDirty = true;
    this.needsRender = true;
    this.scheduleAutosave();
    this.emit();
  }

  toast(message: string, action: { label: string; run: () => void } | null = null): void {
    this.toastMessage = message;
    this.toastAction = action;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(
      () => {
        this.toastMessage = null;
        this.toastAction = null;
        this.emit();
      },
      action ? 10000 : 4000,
    );
    this.emit();
  }

  // ---------------------------------------------------------------- persistence

  /**
   * Starts the tab: `?new` opens a blank project, `?open=<id>` a file handed over by another
   * tab; otherwise the tab's own autosave, the most recently used project, or an example.
   */
  loadInitial(): void {
    const params = new URLSearchParams(location.search);
    const handoff = params.get('open');
    const blank = params.has('new');
    if (handoff !== null || blank) {
      history.replaceState(null, '', location.pathname + location.hash);
      this.tab = tabId(true);
    }
    if (blank) {
      this.doc = emptyDoc();
      this.setView({ x: 0, y: 0, zoom: 1 });
      this.changed(true);
      return;
    }
    if (handoff !== null) {
      const text = storage.get(HANDOFF_KEY + handoff);
      storage.remove(HANDOFF_KEY + handoff);
      if (text && this.loadText(text, 'replace', false)) return;
    }
    const tabs = this.tabList();
    const candidates = [this.autosaveKey(), ...tabs.map((t) => `${AUTOSAVE_KEY}:${t}`), AUTOSAVE_KEY];
    for (const key of candidates) {
      const saved = storage.get(key);
      if (!saved) continue;
      try {
        const parsed = parseCircuit(saved);
        this.doc = parsed.doc;
        if (parsed.view) this.setView(parsed.view);
        else this.fitView(false);
        this.changed(true);
        return;
      } catch {
        // Try the next one.
      }
    }
    this.doc = parseCircuit(halfAdderExample).doc;
    this.changed(true);
    this.fitView(false);
  }

  /** Adds an example to the project beside what's there, and frames it. */
  addExample(doc: Doc): void {
    if (!this.insertDoc(doc, null)) return;
    this.fitView(true, expandWithContents(this.doc, this.selection));
  }

  private autosaveKey(): string {
    return `${AUTOSAVE_KEY}:${this.tab}`;
  }

  private tabList(): string[] {
    try {
      const list = JSON.parse(storage.get(TABS_KEY) ?? '[]');
      return Array.isArray(list) ? list.filter((t): t is string => typeof t === 'string') : [];
    } catch {
      return [];
    }
  }

  private scheduleAutosave(): void {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => {
      storage.set(this.autosaveKey(), docToText(this.doc, { view: this.getView() }));
      const tabs = [this.tab, ...this.tabList().filter((t) => t !== this.tab)];
      for (const old of tabs.slice(KEEP_TABS)) storage.remove(`${AUTOSAVE_KEY}:${old}`);
      storage.set(TABS_KEY, JSON.stringify(tabs.slice(0, KEEP_TABS)));
    }, 500);
  }

  /** Opens a project (or a blank one) in a new browser tab, leaving this one as it is. */
  openInNewTab(text: string | null): void {
    let url = location.pathname + '?new';
    if (text !== null) {
      const id = Math.random().toString(36).slice(2, 10);
      if (!storage.set(HANDOFF_KEY + id, text)) {
        this.toast('That file is too large to hand to a new tab. Use "Add to project" instead.');
        return;
      }
      url = location.pathname + '?open=' + id;
    }
    const win = window.open(url, '_blank');
    if (!win) {
      this.toast('The browser blocked the new tab.', {
        label: 'Open in new tab',
        run: () => window.open(url, '_blank'),
      });
    }
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

  setWireStyle(style: WireStyle): void {
    this.wireStyle = style;
    storage.set(BEND_KEY, style);
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
    if (isIO(kind)) c.name = nextLabel(this.doc, kind);
    this.doc.components.set(c.id, c);
    return c;
  }

  private addBox(rect: Rect, name = 'Box'): Box {
    const b: Box = { id: uid(this.doc, 'box_'), ...rect, name, color: BOX_COLORS[Math.floor(Math.random() * BOX_COLORS.length)] };
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
    this.ghostSnap = null;
    this.emit();
    if (!e) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      if (this.placing !== kind) return;
      this.updateGhost(this.toWorld(this.screenPoint(ev)));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const dragged = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6;
      if (dragged && this.placing === kind && document.elementFromPoint(ev.clientX, ev.clientY) === this.canvas) {
        this.placeAt(kind, this.toWorld(this.screenPoint(ev)));
        this.cancelPlacing();
      } else if (!dragged && kind === 'not' && this.selectedComponents().some((c) => isGate(c.kind))) {
        this.cancelPlacing();
        this.toggleNegate();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  cancelPlacing(): void {
    if (!this.placing && !this.pendingConnect) return;
    this.placing = null;
    this.ghost = null;
    this.ghostSnap = null;
    this.pendingConnect = null;
    this.needsRender = true;
    this.emit();
  }

  /** Updates the placement ghost, snapping ports to box walls when nearby. */
  private updateGhost(w: Point): void {
    if (this.placing === 'port' || this.placing === 'ribbon-port') {
      const box = this.boxNear(w);
      if (box) {
        const wp = wallPoint(box, w);
        const inward = wp.side === 0 || wp.side === 1;
        this.ghost = { x: wp.x, y: wp.y };
        this.ghostSnap = { box: box.id, inward };
        this.needsRender = true;
        return;
      }
    }
    this.ghost = w;
    this.ghostSnap = null;
    this.needsRender = true;
  }

  placeAt(kind: PlaceKind, w: Point): void {
    if (kind === 'not') {
      const gate = this.hitComponent(w);
      if (!gate || !isGate(gate.kind)) {
        this.toast('Drop the NOT bubble onto a gate.');
        return;
      }
      this.checkpoint();
      gate.negate = !gate.negate;
      this.selection = new Set([gate.id]);
      this.changed(true);
      return;
    }
    if (kind === 'port' || kind === 'ribbon-port') {
      const box = this.boxNear(w);
      if (!box) {
        if (kind === 'port') {
          this.checkpoint();
          const c = this.addComponent('buffer', 0, 0);
          const size = rotatedSize(c);
          c.x = snap(w.x - size.w / 2);
          c.y = snap(w.y - size.h / 2);
          this.selection = new Set([c.id]);
          this.finishPendingConnect(c.id);
          this.changed(true);
          return;
        }
        this.checkpoint();
        const port = this.addComponent('port', 0, 0);
        const lanes = this.pendingConnect
          ? laneCount(this.doc.components.get(this.pendingConnect.comp)!)
          : CABLE_MIN;
        port.inputs = Math.max(2, lanes);
        port.plug = this.pendingConnect && this.pendingConnect.pin >= 0 ? 'out' : 'in';
        port.inputBundle = port.plug === 'in';
        port.outputBundle = port.plug === 'out';
        port.placed = true;
        const size = rotatedSize(port);
        port.x = snap(w.x - size.w / 2);
        port.y = snap(w.y - size.h / 2);
        this.selection = new Set([port.id]);
        this.finishPendingConnect(port.id);
        this.changed(true);
        return;
      }
      this.checkpoint();
      const port = this.addComponent('port', 0, 0);
      port.box = box.id;
      port.placed = true;
      const side = wallPoint(box, w).side;
      let inward = side === 0 || side === 1;
      if (kind === 'ribbon-port') {
        const lanes = this.pendingConnect
          ? laneCount(this.doc.components.get(this.pendingConnect.comp)!)
          : CABLE_MIN;
        port.inputs = Math.max(2, lanes);
        // Cable drop picks direction from the drag; toolbar placement uses the wall.
        if (this.pendingConnect) inward = this.pendingConnect.pin < 0;
        port.plug = inward ? 'in' : 'out';
        port.inputBundle = inward;
        port.outputBundle = !inward;
      }
      placePort(this.doc, port, box, w, inward);
      this.selection = new Set([port.id]);
      this.finishPendingConnect(port.id);
      this.changed(true);
      return;
    }
    this.checkpoint();
    if (kind === 'box') {
      const b = this.addBox({
        x: snap(w.x - DEFAULT_BOX.w / 2),
        y: snap(w.y - DEFAULT_BOX.h / 2),
        ...DEFAULT_BOX,
      });
      this.selection = new Set([b.id]);
    } else {
      const c = this.addComponent(kind, 0, 0);
      const size = rotatedSize(c);
      c.x = snap(w.x - size.w / 2);
      c.y = snap(w.y - size.h / 2);
      this.selection = new Set([c.id]);
    }
    this.changed(true);
  }

  /** Completes a cable drop that asked for a new ribbon port. */
  private finishPendingConnect(compId: string): void {
    const from = this.pendingConnect;
    this.pendingConnect = null;
    if (!from) return;
    const c = this.doc.components.get(compId);
    if (!c) return;
    if (from.pin < 0) this.connect(from, { comp: compId, pin: 0 });
    else this.connect({ comp: compId, pin: -1 }, from);
  }

  /** Innermost box whose edge is near `w`, or that contains `w`. */
  private boxNear(w: Point): Box | null {
    const tol = 24;
    let best: Box | null = null;
    let bestD = tol;
    for (const b of boxesOuterFirst(this.doc).reverse()) {
      if (pointInRect(w, b)) {
        const d = Math.min(w.x - b.x, b.x + b.w - w.x, w.y - b.y, b.y + b.h - w.y);
        if (d <= tol) return b;
        if (!best) best = b;
      }
      const on =
        (w.x >= b.x - tol && w.x <= b.x + b.w + tol && (Math.abs(w.y - b.y) <= tol || Math.abs(w.y - (b.y + b.h)) <= tol)) ||
        (w.y >= b.y - tol && w.y <= b.y + b.h + tol && (Math.abs(w.x - b.x) <= tol || Math.abs(w.x - (b.x + b.w)) <= tol));
      if (!on) continue;
      const d = Math.min(
        Math.abs(w.x - b.x),
        Math.abs(w.x - (b.x + b.w)),
        Math.abs(w.y - b.y),
        Math.abs(w.y - (b.y + b.h)),
      );
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
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

    // Ribbon cable: source plug → destination plug. Empty dest ports resize to match.
    if (bundleSource(src) && bundleDest(dst) && out.pin === -1 && inp.pin === 0) {
      if (src.inputs !== dst.inputs) {
        if (dst.kind === 'rgb') {
          this.toast('An RGB bulb needs a 3-lane ribbon cable.');
          return false;
        }
        const peers = cableConnectedPorts(this.doc, dst);
        if (peers.some((p) => portHasSideWiring(this.doc, p))) {
          this.toast('That ribbon port already has wires; change its width first.');
          return false;
        }
        for (const p of peers) setPortWidth(this.doc, p, src.inputs);
      }
      for (const w of [...this.doc.wires.values()]) {
        if (w.cable && w.to === dst.id) this.doc.wires.delete(w.id);
        else if (!w.cable && w.to === dst.id && w.input === 0) this.doc.wires.delete(w.id);
      }
      const cable: Wire = { id: uid(this.doc, 'w_'), from: src.id, to: dst.id, input: 0, cable: true };
      this.doc.wires.set(cable.id, cable);
      return true;
    }

    for (const w of this.doc.wires.values()) {
      if (w.to === dst.id && w.input === inp.pin) this.doc.wires.delete(w.id);
    }
    const lane = -out.pin - 1;
    const w: Wire = { id: uid(this.doc, 'w_'), from: src.id, to: dst.id, input: inp.pin, separatePort: true };
    if (lane > 0) w.lane = lane;
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
    const wireOnly = [...this.selection].every((id) => this.doc.wires.has(id));
    if (wireOnly) {
      for (const id of this.selection) this.doc.wires.delete(id);
      this.selection = new Set();
      this.changed(true);
      return;
    }
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
    for (const b of boxes) {
      for (const c of [...this.doc.components.values()]) if (c.kind === 'port' && c.box === b.id) dissolvePort(this.doc, c);
      this.doc.boxes.delete(b.id);
    }
    this.selection = new Set();
    this.changed(true);
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
    const selected = this.selectedComponents();
    const gates = selected.filter((c) => isGate(c.kind));
    const ports = selected.filter((c) => c.kind === 'port');
    if (!gates.length && !ports.length) return;
    const peers = new Set<string>();
    for (const p of ports) for (const c of cableConnectedPorts(this.doc, p)) peers.add(c.id);
    this.checkpoint('inputs');
    for (const g of gates) g.inputs = count;
    for (const id of peers) {
      const c = this.doc.components.get(id);
      if (c?.kind === 'port') setPortWidth(this.doc, c, count);
    }
    for (const p of ports) if (!peers.has(p.id)) setPortWidth(this.doc, p, count);
    this.pruneWires();
    this.changed(true);
  }

  changeInputs(delta: number): void {
    const parts = this.selectedComponents().filter((c) => isGate(c.kind) || c.kind === 'port');
    if (!parts.length) return;
    const port = parts.find((c) => c.kind === 'port');
    if (port) {
      this.setInputs(clamp(port.inputs + delta, 1, MAX_INPUTS));
      return;
    }
    this.editSelection(
      'inputs',
      (it) => {
        if (!('kind' in it)) return;
        if (isGate(it.kind)) it.inputs = clamp(it.inputs + delta, 1, MAX_INPUTS);
      },
      true,
    );
  }

  /** Changes one ribbon-port face between one cable socket and individual lane pins. */
  setPortFace(face: 'input' | 'output', cable: boolean): void {
    const ports = this.selectedComponents().filter(isRibbonPort);
    if (!ports.length) return;
    const changing = ports.filter((p) => (face === 'input' ? bundleInput(p) : bundleOutput(p)) !== cable);
    if (!changing.length) return;
    const occupied = changing.some((p) =>
      [...this.doc.wires.values()].some((w) => (face === 'input' ? w.to === p.id : w.from === p.id)),
    );
    if (occupied) {
      this.toast(`Disconnect the ${face} side before changing it.`);
      return;
    }
    this.checkpoint('port-face');
    for (const p of changing) {
      if (face === 'input') p.inputBundle = cable;
      else p.outputBundle = cable;
    }
    this.changed(true);
  }

  /** Changes selected RGB bulbs between three wire pins and one three-lane cable socket. */
  setRgbInput(cable: boolean): void {
    const bulbs = this.selectedComponents().filter((c) => c.kind === 'rgb');
    const changing = bulbs.filter((c) => bundleInput(c) !== cable);
    if (!changing.length) return;
    if (changing.some((c) => [...this.doc.wires.values()].some((w) => w.to === c.id))) {
      this.toast('Disconnect the RGB input before changing it.');
      return;
    }
    this.checkpoint('rgb-input');
    for (const c of changing) c.inputBundle = cable;
    this.changed(true);
  }

  setTimerTiming(period: number, pulse: number): void {
    const timers = this.selectedComponents().filter((c) => c.kind === 'timer');
    if (!timers.length) return;
    this.checkpoint('timer-timing');
    for (const timer of timers) {
      timer.period = clamp(period, 0.01, 3600);
      timer.pulse = clamp(pulse, 0.001, timer.period);
    }
    this.changed(true);
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
      if (!('kind' in it) || !isGate(it.kind)) it.name = name;
    });
  }

  /** Renames one component (used by the inputs and outputs lists). */
  renameComponent(id: string, name: string): void {
    const c = this.doc.components.get(id);
    if (!c || c.name === name) return;
    this.checkpoint('name:' + id);
    c.name = name;
    this.changed(false);
  }

  /** Rotates the selected gates, switches, buttons and bulbs a quarter turn about their centres. */
  rotateSelection(dir: 1 | -1 = 1): void {
    this.editSelection('rotate', (it) => {
      if ('kind' in it && canRotate(it.kind)) reorient(it, (((it.rot + dir) % 4) + 4) % 4 as Rotation, it.flip);
    });
  }

  /** Mirrors the selected parts so they face the other way. */
  flipSelection(): void {
    this.editSelection('flip', (it) => {
      if ('kind' in it && canRotate(it.kind)) reorient(it, it.rot, !it.flip);
    });
  }

  /** The single selected switch, button or bulb, which shows resize handles. */
  resizeTarget(): Component | null {
    if (this.selection.size !== 1) return null;
    const c = this.doc.components.get([...this.selection][0]);
    return c && isIO(c.kind) ? c : null;
  }

  toggleSwitch(id: string): void {
    const c = this.doc.components.get(id);
    if (!c || c.kind !== 'switch') return;
    c.on = !c.on;
    this.sim.setSwitch(id, c.on);
    this.needsRender = true;
    this.scheduleAutosave();
    this.emit();
  }

  /** Sets or clears the keyboard binding on selected switches and buttons. */
  setKeyBind(code: string | null): void {
    const inputs = this.selectedComponents().filter((c) => c.kind === 'switch' || c.kind === 'button');
    if (!inputs.length) return;
    this.checkpoint('key-bind');
    for (const c of inputs) c.key = code;
    this.changed(false);
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
      const b = src.boxes.get(id);
      if (!b) continue;
      const copy: Box = { ...b, id: newId(b.id, 'box_'), x: b.x + dx, y: b.y + dy };
      this.doc.boxes.set(copy.id, copy);
      map.set(id, copy.id);
    }
    for (const id of ids) {
      const c = src.components.get(id);
      if (!c) continue;
      let box: string | null = null;
      if (c.kind === 'port') {
        if (c.box) {
          box = map.get(c.box) ?? null;
          if (!box) continue;
        } else if (!c.placed) continue;
      }
      const copy: Component = { ...c, id: newId(c.id, `${c.kind}_`), x: c.x + dx, y: c.y + dy, box };
      this.doc.components.set(copy.id, copy);
      map.set(id, copy.id);
    }
    for (const w of src.wires.values()) {
      const from = map.get(w.from);
      const to = map.get(w.to);
      if (from && to) {
        const copy: Wire = { id: uid(this.doc, 'w_'), from, to, input: w.input };
        if (w.lane) copy.lane = w.lane;
        if (w.cable) copy.cable = true;
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
    const boxes = [...src.boxes.values()];
    const top = [...ids].filter((id) => {
      const c = src.components.get(id);
      if (c) return c.kind !== 'port' && !boxes.some((b) => componentInBox(src, c, b));
      const b = src.boxes.get(id)!;
      return !boxes.some((o) => boxInBox(b, o));
    });
    this.selection = new Set(top.map((id) => map.get(id)).filter((id): id is string => !!id));
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
  loadText(text: string, mode: 'replace' | 'merge', undoable = true): boolean {
    let parsed;
    try {
      parsed = parseCircuit(text);
    } catch (e) {
      this.toast((e as Error).message);
      return false;
    }
    if (mode === 'replace') {
      if (undoable) this.checkpoint();
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
    const { svg, width, height } = buildSvg(this.doc, this.theme, this.sim, ids, this.wireStyle);
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
        { label: 'Timer', kind: 'timer' },
        { label: 'Light bulb', kind: 'bulb' },
        { label: 'RGB bulb', kind: 'rgb' },
        { label: 'Marker', kind: 'marker' },
        { label: 'Box', kind: 'box' },
      ];
    }
    const src = this.doc.components.get(from.comp);
    if (src && this.isCablePlug(from, src)) {
      return [
        { label: 'Ribbon port (free)', kind: 'ribbon-port', portMode: 'free' },
        { label: 'Ribbon port (on box)', kind: 'ribbon-port', portMode: 'box' },
      ];
    }
    if (from.pin < 0) return [...GATE_MENU, { label: 'Light bulb', kind: 'bulb' }, { label: 'RGB bulb', kind: 'rgb' }];
    return [...GATE_MENU, { label: 'Switch', kind: 'switch' }, { label: 'Button', kind: 'button' }, { label: 'Timer', kind: 'timer' }];
  }

  /** True when `from` is the ribbon plug of a multi-lane port (cable drag). */
  private isCablePlug(from: PinRef, c: Component): boolean {
    if (c.kind === 'rgb') return bundleInput(c) && from.pin === 0;
    if (!isRibbonPort(c)) return false;
    return (bundleOutput(c) && from.pin === -1) || (bundleInput(c) && from.pin === 0);
  }

  menuTitle(): string {
    const from = this.menu?.from;
    if (!from) return 'Add a part';
    const src = this.doc.components.get(from.comp);
    if (src && this.isCablePlug(from, src)) return 'Extend ribbon cable';
    return 'Connect a new part';
  }

  placeFromMenu(item: MenuItem): void {
    const m = this.menu;
    if (!m) return;
    this.menu = null;
    if (item.kind === 'ribbon-port' && item.portMode) {
      this.placeRibbonFromCableMenu(item.portMode, m);
      return;
    }
    if (item.kind === 'box' || item.kind === 'not' || item.kind === 'port' || item.kind === 'ribbon-port') {
      this.placeAt(item.kind, m.world);
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

  /** Places a ribbon port after dropping a cable in empty space. */
  private placeRibbonFromCableMenu(mode: 'free' | 'box', m: PlaceMenu): void {
    const from = m.from;
    if (!from) return;
    const source = this.doc.components.get(from.comp);
    if (!source) return;
    this.checkpoint();
    let box: Box | null = null;
    let at = m.world;
    if (mode === 'box') {
      box = this.addBox({
        x: snap(m.world.x - DEFAULT_BOX.w / 2),
        y: snap(m.world.y - DEFAULT_BOX.h / 2),
        ...DEFAULT_BOX,
      });
      at = {
        x: componentCenter(source).x <= m.world.x ? box.x : box.x + box.w,
        y: m.world.y,
      };
    }
    const port = this.addComponent('port', 0, 0);
    port.inputs = Math.max(2, laneCount(source));
    port.placed = true;
    // Forward cable drag enters the new port; a backward drag leaves it.
    port.inputBundle = from.pin < 0;
    port.outputBundle = from.pin >= 0;
    port.plug = from.pin < 0 ? 'in' : 'out';
    if (box) {
      port.box = box.id;
      placePort(this.doc, port, box, at, from.pin < 0);
    } else {
      const size = rotatedSize(port);
      port.x = snap(at.x - size.w / 2);
      port.y = snap(at.y - size.h / 2);
    }
    this.pendingConnect = from;
    this.finishPendingConnect(port.id);
    this.selection = new Set([port.id]);
    this.changed(true);
  }

  // ---------------------------------------------------------------- hit testing

  private closedBoxes(): Box[] {
    const out: Box[] = [];
    for (const b of this.doc.boxes.values()) if ((this.boxT.get(b.id) ?? 1) < 0.5) out.push(b);
    return out;
  }

  /**
   * Whether a component is hidden under a closed box. Switches, buttons and bulbs stay on top
   * of closed boxes; ports are hidden only when a box around their own box is closed.
   */
  private hiddenIn(c: Component, closed: Box[]): boolean {
    if (c.kind === 'port') {
      const own = c.box ? this.doc.boxes.get(c.box) : undefined;
      return !!own && closed.some((b) => boxInBox(own, b));
    }
    if (floatsAboveBoxes(c)) return false;
    for (const b of closed) if (componentInBox(this.doc, c, b)) return true;
    return false;
  }

  /** A box is hidden when any box around it is closed. */
  private boxHidden(b: Box, closed: Box[]): boolean {
    return closed.some((o) => boxInBox(b, o));
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
      const pins: number[] = [];
      if (want !== 'in') {
        const outs = g.outputs ?? (g.output ? [g.output] : []);
        for (let i = 0; i < outs.length; i++) pins.push(-1 - i);
      }
      if (want !== 'out') for (let i = 0; i < g.inputs.length; i++) pins.push(i);
      for (const pin of pins) {
        const p = pinPos(c, pin)!;
        const d = Math.hypot(w.x - p.x, w.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = { comp: c.id, pin };
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
      if (!pointInRect(w, bodyRect(c), pad) || (closed.length && this.hiddenIn(c, closed))) continue;
      // Parts drawn on top win over parts under them.
      if (!hit || floatsAboveBoxes(c) || !floatsAboveBoxes(hit)) hit = c;
    }
    return hit;
  }

  private hitClosedBox(w: Point): Box | null {
    for (const b of boxesOuterFirst(this.doc)) {
      if ((this.boxT.get(b.id) ?? 1) < 0.5 && pointInRect(w, b)) return b;
    }
    return null;
  }

  /** The edge or corner of a visible box under the pointer; inner boxes win. */
  private hitBoxEdge(w: Point): BoxEdges | null {
    const tol = 6 / this.cam.zoom;
    const closed = this.closedBoxes();
    const boxes = boxesOuterFirst(this.doc);
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (!pointInRect(w, b, tol) || this.boxHidden(b, closed)) continue;
      const e: BoxEdges = {
        box: b.id,
        l: Math.abs(w.x - b.x) < tol,
        r: Math.abs(w.x - b.x - b.w) < tol,
        t: Math.abs(w.y - b.y) < tol,
        b: Math.abs(w.y - b.y - b.h) < tol,
      };
      if (e.l && e.r) e.r = false;
      if (e.t && e.b) e.b = false;
      if (e.l || e.r || e.t || e.b) return e;
    }
    return null;
  }

  /** The innermost box under the pointer, open or closed. */
  private boxUnder(w: Point): string | null {
    const boxes = boxesOuterFirst(this.doc);
    for (let i = boxes.length - 1; i >= 0; i--) if (pointInRect(w, boxes[i])) return boxes[i].id;
    return null;
  }

  /** The innermost open box whose background is under the pointer. */
  private hitBoxBackground(w: Point): Box | null {
    const closed = this.closedBoxes();
    const boxes = boxesOuterFirst(this.doc);
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (pointInRect(w, b) && !this.boxHidden(b, closed)) return b;
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

  private hitBoxLabel(w: Point): Box | null {
    const closed = this.closedBoxes();
    const boxes = boxesOuterFirst(this.doc);
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (b.name && !this.boxHidden(b, closed) && pointInRect(w, this.boxLabel(b).rect)) return b;
    }
    return null;
  }

  private hitWire(w: Point): Wire | null {
    const baseTol = Math.max(4, 6 / this.cam.zoom);
    let hit: Wire | null = null;
    let best = Infinity;
    const avoid = avoidMap(this.doc);
    for (const wire of this.doc.wires.values()) {
      const a = this.doc.components.get(wire.from);
      const b = this.doc.components.get(wire.to);
      if (!a || !b) continue;
      const pad = wire.cable ? Math.max(laneCount(a), laneCount(b)) * CABLE_PITCH * 0.5 + 8 : 10;
      const curve = routedWire(avoid, a, b, wire.cable ? 0 : wire.input, wire.cable ? 0 : (wire.lane ?? 0), pad, this.wireStyle, !!wire.cable);
      if (!curve) continue;
      const width = wire.cable ? Math.max(laneCount(a), laneCount(b)) * CABLE_PITCH : 0;
      const tol = Math.max(baseTol, width / 2 + 2);
      if (!pointInRect(w, inflate(curveBounds(curve), tol + width / 2))) continue;
      let prev = curve.a;
      for (let i = 1; i <= 24; i++) {
        const p = curvePoint(curve, i / 24);
        const d = distToSegment(w, prev, p);
        if (d < tol && d < best) {
          best = d;
          hit = wire;
        }
        prev = p;
      }
    }
    return hit;
  }

  /** A resize handle of the selected switch, button or bulb: 0-3 = corners clockwise from top-left. */
  private hitSizeHandle(s: Point): number | null {
    const c = this.resizeTarget();
    if (!c) return null;
    const r = bodyRect(c);
    const p0 = this.toScreen(r);
    const p1 = this.toScreen({ x: r.x + r.w, y: r.y + r.h });
    const corners = [
      { x: p0.x, y: p0.y },
      { x: p1.x, y: p0.y },
      { x: p1.x, y: p1.y },
      { x: p0.x, y: p1.y },
    ];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(s.x - corners[i].x) <= 7 && Math.abs(s.y - corners[i].y) <= 7) return i;
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
      const p = pinPos(c, i)!;
      const score = Math.hypot(p.x - w.x, p.y - w.y) + (this.wireInto(c.id, i) ? 1000 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { comp: c.id, pin: i };
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- pointer input

  /**
   * The canvas has its own right-click menu, which opens on pointer-up; by the time the
   * browser's contextmenu event fires the pointer may be over that menu, so block it everywhere
   * except in text fields.
   */
  private onContextMenu = (e: Event) => {
    if (!isTyping(e.target)) e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent): void => {
    const s = this.screenPoint(e);
    this.mouse = s;
    this.pointers.set(e.pointerId, s);
    try {
      this.canvas?.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone (e.g. a very short touch).
    }
    // Explicitly leave toolbar/list text fields so Delete/Backspace applies to the new canvas
    // selection immediately rather than editing a previously focused label.
    if (document.activeElement !== this.canvas) (document.activeElement as HTMLElement | null)?.blur?.();
    this.canvas?.focus({ preventScroll: true });
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
    const corner = this.hitSizeHandle(s);
    const sized = this.resizeTarget();
    if (corner !== null && sized) {
      this.drag = { kind: 'size', comp: sized.id, corner, orig: bodyRect(sized), start: w, sx: s.x, sy: s.y, moved: false };
      return;
    }
    const pin = this.hitPin(w, null);
    if (pin) {
      this.drag = { kind: 'wire', from: pin, cur: w, target: null, sx: s.x, sy: s.y, moved: false, picked: null };
      return;
    }
    const comp = this.hitComponent(w);
    if (comp) return this.startMove(comp.id, w, s, e.shiftKey, comp);
    const edges = this.hitBoxEdge(w);
    if (edges) return this.startResize(edges, w, s);
    const closed = this.hitClosedBox(w);
    if (closed) return this.startMove(closed.id, w, s, e.shiftKey, null);
    const label = this.hitBoxLabel(w);
    if (label) return this.startMove(label.id, w, s, e.shiftKey, null);
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
    const bg = this.hitBoxBackground(w);
    if (bg && this.selection.has(bg.id)) return this.startMove(bg.id, w, s, e.shiftKey, null);
    if (!e.shiftKey && this.selection.size) this.setSelection([]);
    this.drag = {
      kind: 'marquee',
      start: w,
      cur: w,
      base: new Set(this.selection),
      sx: s.x,
      sy: s.y,
      moved: false,
      click: bg?.id ?? null,
      shift: e.shiftKey,
    };
  };

  private startResize(edges: BoxEdges, w: Point, s: Point): void {
    const b = this.doc.boxes.get(edges.box)!;
    const tree = buildBoxTree(this.doc);
    const outer: { id: string; orig: Rect }[] = [];
    for (let p = tree.parent.get(b.id) ?? null; p !== null && outer.length < 1000; p = tree.parent.get(p) ?? null) {
      const o = this.doc.boxes.get(p)!;
      outer.push({ id: p, orig: { x: o.x, y: o.y, w: o.w, h: o.h } });
    }
    const moving = new Set([b.id, ...outer.map((o) => o.id)]);
    const ports: { id: string; box: string; side: Side; at: Point; inward: boolean }[] = [];
    for (const c of this.doc.components.values()) {
      if (c.kind !== 'port' || !c.box || !moving.has(c.box)) continue;
      const pb = this.doc.boxes.get(c.box)!;
      ports.push({ id: c.id, box: c.box, side: portSide(c, pb), at: componentCenter(c), inward: portInward(c, pb) });
    }
    const orig = { x: b.x, y: b.y, w: b.w, h: b.h };
    this.drag = { kind: 'resize', edges, orig, start: w, sx: s.x, sy: s.y, moved: false, outer, ports };
  }

  private startMove(id: string, w: Point, s: Point, shift: boolean, comp: Component | null): void {
    const wasSelected = this.selection.has(id);
    if (!wasSelected) {
      if (shift) this.selection.add(id);
      else this.selection = new Set([id]);
      this.emit();
    }
    if (comp?.kind === 'port' && comp.box) {
      const box = this.doc.boxes.get(comp.box);
      if (box) {
        this.drag = { kind: 'port', comp: comp.id, inward: portInward(comp, box), sx: s.x, sy: s.y, moved: false };
        this.needsRender = true;
        return;
      }
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
      this.updateGhost(w);
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
        if (!d.moved && !far(d.sx, d.sy)) return;
        d.moved = true;
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
        const b = this.doc.boxes.get(d.edges.box);
        if (!b) return;
        const o = d.orig;
        const e = d.edges;
        const dx = w.x - d.start.x;
        const dy = w.y - d.start.y;
        let x0 = o.x;
        let y0 = o.y;
        let x1 = o.x + o.w;
        let y1 = o.y + o.h;
        if (e.l) x0 = Math.min(snap(o.x + dx), x1 - 60);
        if (e.r) x1 = Math.max(snap(x1 + dx), x0 + 60);
        if (e.t) y0 = Math.min(snap(o.y + dy), y1 - 40);
        if (e.b) y1 = Math.max(snap(y1 + dy), y0 + 40);
        b.x = x0;
        b.y = y0;
        b.w = x1 - x0;
        b.h = y1 - y0;
        let inner: Rect = b;
        for (const o of d.outer) {
          const ob = this.doc.boxes.get(o.id);
          if (!ob) break;
          const r = o.orig;
          ob.x = Math.min(r.x, inner.x - BOX_GAP);
          ob.y = Math.min(r.y, inner.y - BOX_GAP);
          ob.w = Math.max(r.x + r.w, inner.x + inner.w + BOX_GAP) - ob.x;
          ob.h = Math.max(r.y + r.h, inner.y + inner.h + BOX_GAP) - ob.y;
          inner = ob;
        }
        for (const p of d.ports) {
          const port = this.doc.components.get(p.id);
          const pb = this.doc.boxes.get(p.box);
          if (port && pb) placePort(this.doc, port, pb, onSide(pb, p.side, p.at), p.inward);
        }
        this.needsRender = true;
        break;
      }
      case 'size': {
        if (!d.moved) {
          if (!far(d.sx, d.sy)) return;
          d.moved = true;
          this.pushUndo(this.snapshot());
        }
        const c = this.doc.components.get(d.comp);
        if (!c) return;
        const o = d.orig;
        const left = d.corner === 0 || d.corner === 3;
        const top = d.corner === 0 || d.corner === 1;
        const lim = (v: number) => clamp(v, IO_MIN, IO_MAX);
        const ww = lim(snap(o.w + (left ? -1 : 1) * (w.x - d.start.x)));
        const hh = lim(snap(o.h + (top ? -1 : 1) * (w.y - d.start.y)));
        c.x = left ? o.x + o.w - ww : o.x;
        c.y = top ? o.y + o.h - hh : o.y;
        if (c.rot % 2) {
          c.w = hh;
          c.h = ww;
        } else {
          c.w = ww;
          c.h = hh;
        }
        this.needsRender = true;
        break;
      }
      case 'port': {
        if (!d.moved) {
          if (!far(d.sx, d.sy)) return;
          d.moved = true;
          this.pushUndo(this.snapshot());
        }
        const port = this.doc.components.get(d.comp);
        const box = port?.box ? this.doc.boxes.get(port.box) : undefined;
        if (!port || !box) return;
        placePort(this.doc, port, box, w, d.inward);
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
        if (!d.moved && d.click && !cancelled) {
          const next = new Set(d.base);
          if (d.shift && next.has(d.click)) next.delete(d.click);
          else next.add(d.click);
          this.selection = next;
        }
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
      case 'size':
      case 'port':
        if (d.moved) this.changed(false);
        else this.emit();
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
    let edge: BoxEdges | null = null;
    const corner = this.hitSizeHandle(s);
    const selecting = this.tool === 'select' && !this.spaceHeld;
    if (this.placing) cursor = 'copy';
    else if (this.hitArrow(s)) cursor = 'pointer';
    else if (corner !== null) cursor = corner === 0 || corner === 2 ? 'nwse-resize' : 'nesw-resize';
    else if (pin) cursor = 'crosshair';
    else if (selecting) {
      const c = this.hitComponent(w);
      if (c) cursor = c.kind === 'switch' || c.kind === 'button' ? 'pointer' : 'move';
      else if ((edge = this.hitBoxEdge(w))) {
        const e = edge;
        cursor = (e.l || e.r) && (e.t || e.b) ? ((e.l && e.t) || (e.r && e.b) ? 'nwse-resize' : 'nesw-resize') : e.l || e.r ? 'ew-resize' : 'ns-resize';
      } else if (this.hitClosedBox(w) || this.hitBoxLabel(w)) cursor = 'move';
    }
    const under = this.boxUnder(w);
    if (under !== this.hoverBox) {
      this.hoverBox = under;
      this.needsRender = true;
    }
    const prevEdge = this.hoverEdge;
    if (edge?.box !== prevEdge?.box || edge?.l !== prevEdge?.l || edge?.t !== prevEdge?.t || edge?.r !== prevEdge?.r || edge?.b !== prevEdge?.b) {
      this.hoverEdge = edge;
      this.needsRender = true;
    }
    if (this.canvas) this.canvas.style.cursor = cursor;
  }

  private updateCursor(): void {
    if (!this.canvas) return;
    if (this.drag?.kind === 'pan') this.canvas.style.cursor = 'grabbing';
    else this.updateHover(this.toWorld(this.mouse), this.mouse);
  }

  /**
   * Touchpads: pinch zooms (browsers report it as a ctrl+wheel) and two-finger scrolling pans.
   * Mouse wheels zoom. A mouse wheel sends line/page units or whole-number vertical steps, while
   * touchpads send fine pixel deltas; once a gesture looks like a touchpad it keeps panning.
   */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    const s = this.screenPoint(e);
    if (e.ctrlKey) {
      this.zoomAt(s, Math.exp(-dy * 0.01));
      return;
    }
    const now = performance.now();
    const wheelLike = e.deltaMode !== 0 || (dx === 0 && Number.isInteger(dy) && Math.abs(dy) >= 50);
    if (wheelLike && now - this.touchpadAt > 300) {
      this.zoomAt(s, Math.exp(-dy * 0.0015));
      return;
    }
    this.touchpadAt = now;
    const z = this.cam.zoom;
    this.cam = { x: this.cam.x + dx / z, y: this.cam.y + dy / z, zoom: z };
    this.camAnim = null;
    this.needsRender = true;
    this.scheduleAutosave();
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
    if (!mod && !e.altKey && this.handleBoundKey(e, true)) {
      e.preventDefault();
      return;
    }
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
        if (key === 'r') this.rotateSelection(e.shiftKey ? -1 : 1);
        else if (key === 'm') this.flipSelection();
        else if (key === 'n') this.toggleNegate();
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
    if (!isTyping(e.target)) this.handleBoundKey(e, false);
  };

  /** Applies keyboard bindings for switches (toggle) and buttons (hold). */
  private handleBoundKey(e: KeyboardEvent, down: boolean): boolean {
    if (isModifierOnly(e)) return false;
    let hit = false;
    for (const c of this.doc.components.values()) {
      if (!c.key || c.key !== e.code) continue;
      hit = true;
      if (c.kind === 'switch') {
        if (down && !e.repeat) this.toggleSwitch(c.id);
      } else if (c.kind === 'button') {
        if (down) {
          if (this.keyHeldButtons.has(c.id)) continue;
          this.keyHeldButtons.add(c.id);
          this.sim.setPressed(c.id, true);
          this.needsRender = true;
        } else if (this.keyHeldButtons.delete(c.id)) {
          this.sim.setPressed(c.id, false);
          this.needsRender = true;
        }
      }
    }
    return hit;
  }

  private releaseKeyHeldButtons(): void {
    if (!this.keyHeldButtons.size) return;
    for (const id of this.keyHeldButtons) this.sim.setPressed(id, false);
    this.keyHeldButtons.clear();
    this.needsRender = true;
  }

  private onBlur = (): void => {
    this.spaceHeld = false;
    this.releaseKeyHeldButtons();
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
    if (c.kind === 'timer' || c.kind === 'bulb' || c.kind === 'port') return this.sim.value(c.id);
    if (c.kind === 'rgb') return this.sim.value(c.id) || this.sim.value(c.id, 1) || this.sim.value(c.id, 2);
    return false;
  }

  /** Presses or releases a button from outside the canvas (the inputs list). */
  setPressed(id: string, pressed: boolean): void {
    this.sim.setPressed(id, pressed);
    this.needsRender = true;
  }

  /** Inputs and output indicators, sorted by label, for the side lists. */
  ioList(which: 'inputs' | 'outputs'): Component[] {
    const out: Component[] = [];
    for (const c of this.doc.components.values()) {
      if (
        which === 'inputs'
          ? c.kind === 'switch' || c.kind === 'button' || c.kind === 'timer'
          : c.kind === 'bulb' || c.kind === 'rgb'
      ) out.push(c);
    }
    const key = (c: Component) => (which === 'inputs' ? c.name.length : 0);
    return out.sort(
      (a, b) => key(a) - key(b) || a.name.localeCompare(b.name, undefined, { numeric: true }) || (a.id < b.id ? -1 : 1),
    );
  }

  /** Centres the view on a component and selects it. */
  locate(id: string): void {
    const c = this.doc.components.get(id);
    if (!c) return;
    this.setSelection([id]);
    this.animateTo(componentCenter(c), Math.max(this.cam.zoom, 0.8));
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
