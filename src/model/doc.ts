import { bodyRect, componentBounds, geomFor, inflate, pointInRect, rectInside, rectsOverlap } from './geometry';
import type { Box, Component, ComponentKind, Doc, Rect } from './types';
import { isGate } from './types';

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
  };
}

export function componentSize(kind: ComponentKind): { w: number; h: number } {
  const g = geomFor(kind, 2, false);
  return { w: g.tip, h: g.h };
}

export const boxRect = (b: Box): Rect => ({ x: b.x, y: b.y, w: b.w, h: b.h });

/** A component belongs to a box when the centre of its body is inside the box. */
export function componentInBox(c: Component, b: Rect): boolean {
  const r = bodyRect(c);
  return pointInRect({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, b);
}

/** A box is nested in another when it lies entirely inside it. */
export function boxInBox(inner: Box, outer: Box): boolean {
  return inner !== outer && rectInside(inner, outer);
}

export interface BoxContents {
  components: Component[];
  boxes: Box[];
}

/** Everything inside a box, including the contents of nested boxes. */
export function boxContents(doc: Doc, box: Box): BoxContents {
  const components: Component[] = [];
  const boxes: Box[] = [];
  for (const c of doc.components.values()) if (componentInBox(c, box)) components.push(c);
  for (const b of doc.boxes.values()) if (boxInBox(b, box)) boxes.push(b);
  return { components, boxes };
}

/** Boxes sorted from largest (outermost) to smallest. */
export function boxesOuterFirst(doc: Doc): Box[] {
  return [...doc.boxes.values()].sort((a, b) => b.w * b.h - a.w * a.h);
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
