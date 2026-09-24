import { bodyRect, componentBounds, geomFor, inflate, IO_SIZE, pointInRect, rectInside, rectsOverlap } from './geometry';
import type { Box, Component, ComponentKind, Doc, Rect } from './types';
import { bundleDest, bundleSource, inputCount, isGate, isInput, laneCount } from './types';

export function emptyDoc(name = 'Untitled circuit'): Doc {
  return { name, components: new Map(), wires: new Map(), boxes: new Map() };
}

export function idTaken(doc: Doc, id: string): boolean {
  return doc.components.has(id) || doc.wires.has(id) || doc.boxes.has(id);
}

export function uid(doc: Doc, prefix: string): string {
  let id: string;
  do {
    id = prefix + Math.random().toString(36).slice(2, 8);
  } while (idTaken(doc, id));
  return id;
}

export function makeComponent(kind: ComponentKind, x: number, y: number, id: string): Component {
  return {
    id,
    kind,
    x,
    y,
    inputs: isGate(kind) ? 2 : 0,
    negate: false,
    stroke: null,
    fill: null,
    on: false,
    name: kind === 'marker' ? 'Marker' : '',
    color: null,
    rot: 0,
    flip: false,
    w: IO_SIZE,
    h: IO_SIZE,
    box: null,
  };
}

export function componentSize(kind: ComponentKind): { w: number; h: number } {
  const g = geomFor(kind, 2, false);
  return { w: g.tip, h: g.h };
}

export const boxRect = (b: Box): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.h });

/**
 * A component belongs to a box when the centre of its body is inside the box. A port belongs to
 * the box whose wall it sits in, and to every box around that one.
 */
export function componentInBox(doc: Doc, c: Component, b: Box): boolean {
  if (c.kind === 'port') {
    if (c.box === b.id) return true;
    const own = c.box ? doc.boxes.get(c.box) : undefined;
    return !!own && boxInBox(own, b);
  }
  const r = bodyRect(c);
  return pointInRect({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, b);
}

/** A box is nested in another when it lies entirely inside it. */
export function boxInBox(inner: Box, outer: Box): boolean {
  if (inner === outer || !rectInside(inner, outer)) return false;
  const a = inner.w * inner.h;
  const b = outer.w * outer.h;
  return a < b || (a === b && inner.id > outer.id);
}

export interface BoxContents {
  components: Component[];
  boxes: Box[];
}

/** Everything inside a box, including the contents of nested boxes. */
export function boxContents(doc: Doc, box: Box): BoxContents {
  const components: Component[] = [];
  const boxes: Box[] = [];
  for (const c of doc.components.values()) if (componentInBox(doc, c, box)) components.push(c);
  for (const b of doc.boxes.values()) if (boxInBox(b, box)) boxes.push(b);
  return { components, boxes };
}

/** Boxes sorted from largest (outermost) to smallest. */
export function boxesOuterFirst(doc: Doc): Box[] {
  return [...doc.boxes.values()].sort((a, b) => b.w * b.h - a.w * a.h || (a.id < b.id ? -1 : 1));
}

/** Expands a set of ids with the contents of any boxes in it. */
export function expandWithContents(doc: Doc, ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    out.add(id);
    const b = doc.boxes.get(id);
    if (!b) continue;
    const inside = boxContents(doc, b);
    for (const c of inside.components) out.add(c.id);
    for (const ib of inside.boxes) out.add(ib.id);
  }
  return out;
}

export function itemsBounds(doc: Doc, ids: Iterable<string>): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of ids) {
    const c = doc.components.get(id);
    const r = c ? componentBounds(c) : doc.boxes.get(id);
    if (!r) continue;
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Finds the nearest position for `rect` that doesn't overlap any obstacle and doesn't straddle
 * the edge of any container (it must be fully inside or fully outside each one). Sweeps right,
 * down, left and up past whatever is in the way and keeps the closest result.
 */
export function findFreeSpot(rect: Rect, obstacles: Rect[], margin = 20, containers: Rect[] = []): Rect {
  const hits = (r: Rect) => {
    const grown = inflate(r, margin - 0.01);
    const out = obstacles.filter((o) => rectsOverlap(grown, o));
    for (const c of containers) if (rectsOverlap(grown, c) && !rectInside(grown, c)) out.push(c);
    return out;
  };
  if (hits(rect).length === 0) return rect;
  const sweep = (dir: 0 | 1 | 2 | 3): Rect | null => {
    const r = { ...rect };
    for (let i = 0; i < 2000; i++) {
      const hit = hits(r);
      if (hit.length === 0) return r;
      if (dir === 0) r.x = Math.max(...hit.map((o) => o.x + o.w)) + margin;
      else if (dir === 1) r.y = Math.max(...hit.map((o) => o.y + o.h)) + margin;
      else if (dir === 2) r.x = Math.min(...hit.map((o) => o.x)) - margin - r.w;
      else r.y = Math.min(...hit.map((o) => o.y)) - margin - r.h;
    }
    return null;
  };
  let best: Rect | null = null;
  let bestDist = Infinity;
  for (const dir of [0, 1, 2, 3] as const) {
    const r = sweep(dir);
    if (!r) continue;
    const d = Math.hypot(r.x - rect.x, r.y - rect.y);
    if (d < bestDist) {
      best = r;
      bestDist = d;
    }
  }
  return best ?? { ...rect, x: rect.x + rect.w + margin };
}

// ---------------------------------------------------------------- labels and nets

/** 1 → A, 26 → Z, 27 → AA, 28 → AB ... */
export function letterLabel(n: number): string {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

/** The first unused default label: letters for switches and buttons, numbers for bulbs. */
export function nextLabel(doc: Doc, kind: ComponentKind, taken: Set<string> = new Set()): string {
  const used = new Set(taken);
  const inputs = isInput(kind);
  for (const c of doc.components.values()) {
    if (inputs ? isInput(c.kind) : c.kind === 'bulb') used.add(c.name.toUpperCase());
  }
  for (let n = 1; ; n++) {
    const label = inputs ? letterLabel(n) : String(n);
    if (!used.has(label)) return label;
  }
}

/** Which pins of each component are wired: character 0 is the output, then one per input. */
export function pinMasks(doc: Doc): Map<string, string> {
  const outLanes = new Map<string, Set<number>>();
  const ins = new Map<string, Set<number>>();
  for (const w of doc.wires.values()) {
    let lanes = outLanes.get(w.from);
    if (!lanes) outLanes.set(w.from, (lanes = new Set()));
    lanes.add(w.lane ?? 0);
    let s = ins.get(w.to);
    if (!s) ins.set(w.to, (s = new Set()));
    s.add(w.input);
  }
  const masks = new Map<string, string>();
  for (const c of doc.components.values()) {
    const n = inputCount(c);
    const s = ins.get(c.id);
    const lanes = laneCount(c);
    let m = '';
    for (let i = 0; i < lanes; i++) m += outLanes.get(c.id)?.has(i) ? '1' : '0';
    for (let i = 0; i < n; i++) m += s?.has(i) ? '1' : '0';
    masks.set(c.id, m);
  }
  return masks;
}

const netKey = (id: string, lane = 0) => (lane ? `${id}#${lane}` : id);

/** The component that really drives each output lane, looking back through ports and ribbons. */
export function netRoots(doc: Doc): Map<string, string> {
  const driver = new Map<string, { id: string; lane: number }>();
  for (const w of doc.wires.values()) {
    const t = doc.components.get(w.to);
    const src = doc.components.get(w.from);
    if (t && src && t.kind === 'port') {
      if (w.cable && bundleSource(src) && bundleDest(t)) {
        const n = Math.min(laneCount(src), laneCount(t));
        for (let i = 0; i < n; i++) driver.set(netKey(t.id, i), { id: w.from, lane: i });
      } else driver.set(netKey(t.id, w.input), { id: w.from, lane: w.lane ?? 0 });
    }
  }
  const follow = (id: string, lane: number): string => {
    let cur = id;
    let ln = lane;
    for (let i = 0; i < 64; i++) {
      const c = doc.components.get(cur);
      if (!c || c.kind !== 'port') return cur;
      const d = driver.get(netKey(cur, ln));
      if (!d) return cur;
      cur = d.id;
      ln = d.lane;
    }
    return cur;
  };
  const roots = new Map<string, string>();
  for (const c of doc.components.values()) {
    const lanes = laneCount(c);
    for (let i = 0; i < lanes; i++) roots.set(netKey(c.id, i), follow(c.id, i));
  }
  return roots;
}
