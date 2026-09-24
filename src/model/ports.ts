import { boxInBox, componentInBox, makeComponent, uid } from './doc';
import { componentCenter, GRID, pinDir, pinPos, PORT_SIZE } from './geometry';
import { isInput, type Box, type Component, type Doc, type Point, type Rotation, type Wire } from './types';

/** Sides of a box: left, top, right, bottom. */
export type Side = 0 | 1 | 2 | 3;
const NORMALS: Point[] = [
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
];
export const outwardNormal = (s: Side): Point => NORMALS[s];

const rotFor = (d: Point): Rotation => (d.x > 0 ? 0 : d.y > 0 ? 1 : d.x < 0 ? 2 : 3);

/** Distance kept between a port and the corners of its box. */
const CORNER = 10;

export interface BoxTree {
  parent: Map<string, string | null>;
  /** The innermost box a component is in, or null at the top level. Ports use their own box. */
  scope(c: Component): string | null;
  /** True when `scope` is `ancestor` or nested somewhere inside it (null is the whole canvas). */
  within(scope: string | null, ancestor: string | null): boolean;
}

export function buildBoxTree(doc: Doc): BoxTree {
  const boxes = [...doc.boxes.values()].sort((a, b) => a.w * a.h - b.w * b.h);
  const parent = new Map<string, string | null>();
  for (const b of boxes) {
    let p: string | null = null;
    for (const o of boxes) {
      if (boxInBox(b, o)) {
        p = o.id;
        break;
      }
    }
    parent.set(b.id, p);
  }
  const scopeCache = new Map<string, string | null>();
  return {
    parent,
    scope(c) {
      if (c.kind === 'port') return c.box && doc.boxes.has(c.box) ? c.box : null;
      let s = scopeCache.get(c.id);
      if (s !== undefined) return s;
      s = null;
      for (const b of boxes) {
        if (componentInBox(doc, c, b)) {
          s = b.id;
          break;
        }
      }
      scopeCache.set(c.id, s);
      return s;
    },
    within(scope, ancestor) {
      if (ancestor === null) return true;
      for (let s = scope, i = 0; s !== null && i < 1000; s = parent.get(s) ?? null, i++) if (s === ancestor) return true;
      return false;
    },
  };
}

/** The wall a port sits on: the side of its box nearest to its centre. */
export function portSide(port: Component, box: Box): Side {
  const c = componentCenter(port);
  const d = [c.x - box.x, c.y - box.y, box.x + box.w - c.x, box.y + box.h - c.y].map(Math.abs);
  let best: Side = 0;
  for (let i = 1; i < 4; i++) if (d[i] < d[best]) best = i as Side;
  return best;
}

/** Whether a port carries its signal into its box (rather than out of it). */
export function portInward(port: Component, box: Box): boolean {
  const n = outwardNormal(portSide(port, box));
  const d = pinDir(port, -1);
  return d.x * n.x + d.y * n.y < 0;
}

/** `p` moved onto the line of one side of a box, keeping its position along that side. */
export function onSide(box: Box, side: Side, p: Point): Point {
  if (side === 0 || side === 2) return { x: side === 0 ? box.x : box.x + box.w, y: p.y };
  return { x: p.x, y: side === 1 ? box.y : box.y + box.h };
}

/** The nearest point on a box's wall to `p`, snapped to the grid and kept away from the corners. */
export function wallPoint(box: Box, p: Point): { side: Side; x: number; y: number } {
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
  const along = (v: number, lo: number, len: number) =>
    clamp(Math.round((v - lo) / GRID) * GRID + lo, lo + CORNER, lo + len - CORNER);
  const cands: { side: Side; x: number; y: number }[] = [
    { side: 0, x: box.x, y: along(p.y, box.y, box.h) },
    { side: 1, x: along(p.x, box.x, box.w), y: box.y },
    { side: 2, x: box.x + box.w, y: along(p.y, box.y, box.h) },
    { side: 3, x: along(p.x, box.x, box.w), y: box.y + box.h },
  ];
  let best = cands[0];
  let bd = Infinity;
  for (const c of cands) {
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

/**
 * Moves a port onto the wall of its box as close to `target` as possible, sliding along the wall
 * past other ports, and points it in or out.
 */
export function placePort(doc: Doc, port: Component, box: Box, target: Point, inward: boolean): void {
  const wp = wallPoint(box, target);
  const n = outwardNormal(wp.side);
  const vertical = wp.side === 0 || wp.side === 2;
  const lo = (vertical ? box.y : box.x) + CORNER;
  const hi = (vertical ? box.y + box.h : box.x + box.w) - CORNER;
  const others: number[] = [];
  for (const c of doc.components.values()) {
    if (c.kind !== 'port' || c.box !== box.id || c.id === port.id) continue;
    const b = doc.boxes.get(box.id);
    if (!b || portSide(c, b) !== wp.side) continue;
    const cc = componentCenter(c);
    others.push(vertical ? cc.y : cc.x);
  }
  const base = vertical ? wp.y : wp.x;
  let pos = base;
  const free = (v: number) => others.every((o) => Math.abs(o - v) >= PORT_SIZE);
  if (!free(base)) {
    for (let k = 1; k < 400; k++) {
      const up = base - k * GRID;
      const down = base + k * GRID;
      if (down <= hi && free(down)) {
        pos = down;
        break;
      }
      if (up >= lo && free(up)) {
        pos = up;
        break;
      }
    }
  }
  const cx = vertical ? wp.x : pos;
  const cy = vertical ? pos : wp.y;
  port.rot = rotFor(inward ? { x: -n.x, y: -n.y } : n);
  port.flip = false;
  port.x = cx - PORT_SIZE / 2;
  port.y = cy - PORT_SIZE / 2;
}

function addWire(doc: Doc, from: string, to: string, input: number): void {
  for (const [id, w] of doc.wires) if (w.to === to && w.input === input) doc.wires.delete(id);
  const id = uid(doc, 'w');
  doc.wires.set(id, { id, from, to, input });
}

function pinPoint(doc: Doc, id: string, pin: number): Point {
  const c = doc.components.get(id)!;
  return pinPos(c, pin) ?? componentCenter(c);
}

/**
 * Makes every wire that crosses a box wall go through a port in that wall. Wires into or out of
 * boxes get ports added (or reuse one already carrying the same signal); ports whose wiring no
 * longer crosses their wall are bypassed or dissolved; ports with nothing attached are removed.
 * Returns true if anything changed.
 */
export function normalizePorts(doc: Doc): boolean {
  let changed = false;
  for (const c of [...doc.components.values()]) {
    if (c.kind !== 'port') continue;
    const box = c.box ? doc.boxes.get(c.box) : undefined;
    if (!box) {
      dissolvePort(doc, c);
      changed = true;
      continue;
    }
    const inward = portInward(c, box);
    const before = `${c.x},${c.y},${c.rot}`;
    placePort(doc, c, box, componentCenter(c), inward);
    if (`${c.x},${c.y},${c.rot}` !== before) changed = true;
  }
  if (!hasBoxWork(doc)) return changed;

  for (let pass = 0; pass < 12; pass++) {
    const tree = buildBoxTree(doc);
    const info = portInfo(doc, tree);
    const inScope = (c: Component) => (c.kind === 'port' ? info.get(c.id)!.inScope : tree.scope(c));
    const outScope = (c: Component) => (c.kind === 'port' ? info.get(c.id)!.outScope : tree.scope(c));
    let dirty = false;
    for (const w of [...doc.wires.values()]) {
      if (!doc.wires.has(w.id)) continue;
      const s = doc.components.get(w.from);
      const t = doc.components.get(w.to);
      if (!s || !t) continue;
      const S = outScope(s);
      const T = inScope(t);
      if (S === T) continue;
      dirty = true;
      if (t.kind === 'port') {
        const pi = info.get(t.id)!;
        const fromInside = tree.within(S, pi.box);
        if (pi.inward === fromInside) {
          dissolveInto(doc, w, t);
          continue;
        }
      }
      if (s.kind === 'port') {
        const pi = info.get(s.id)!;
        const toInside = tree.within(T, pi.box);
        const driver = pi.driver;
        if (pi.inward !== toInside && driver) {
          doc.wires.delete(w.id);
          addWire(doc, driver, w.to, w.input);
          continue;
        }
      }
      route(doc, tree, info, w, S, T);
    }
    for (const c of [...doc.components.values()]) {
      if (c.kind !== 'port') continue;
      let wired = false;
      for (const w of doc.wires.values()) {
        if (w.from === c.id || w.to === c.id) {
          wired = true;
          break;
        }
      }
      if (!wired) {
        doc.components.delete(c.id);
        dirty = true;
      }
    }
    if (!dirty) break;
    changed = true;
  }
  return changed;
}

function hasBoxWork(doc: Doc): boolean {
  if (doc.boxes.size) return true;
  for (const c of doc.components.values()) if (c.kind === 'port') return true;
  return false;
}

interface PortInfo {
  box: string;
  inward: boolean;
  inScope: string | null;
  outScope: string | null;
  driver: string | null;
}

function portInfo(doc: Doc, tree: BoxTree): Map<string, PortInfo> {
  const driver = new Map<string, string>();
  for (const w of doc.wires.values()) driver.set(w.to + '#' + w.input, w.from);
  const out = new Map<string, PortInfo>();
  for (const c of doc.components.values()) {
    if (c.kind !== 'port' || !c.box) continue;
    const box = doc.boxes.get(c.box);
    if (!box) continue;
    const inward = portInward(c, box);
    const parent = tree.parent.get(box.id) ?? null;
    out.set(c.id, {
      box: box.id,
      inward,
      inScope: inward ? parent : box.id,
      outScope: inward ? box.id : parent,
      driver: driver.get(c.id + '#0') ?? null,
    });
  }
  return out;
}

/** Replaces `wire` (into `port`) by wiring its source straight to the port's targets. */
function dissolveInto(doc: Doc, wire: Wire, port: Component): void {
  doc.wires.delete(wire.id);
  for (const w of [...doc.wires.values()]) if (w.from === port.id) addWire(doc, wire.from, w.to, w.input);
}

/** Removes a port, joining whatever drove it to whatever it drove. */
export function dissolvePort(doc: Doc, port: Component): void {
  let driver: string | null = null;
  const targets: Wire[] = [];
  for (const w of [...doc.wires.values()]) {
    if (w.to === port.id) {
      driver = w.from;
      doc.wires.delete(w.id);
    } else if (w.from === port.id) {
      targets.push(w);
      doc.wires.delete(w.id);
    }
  }
  doc.components.delete(port.id);
  if (driver) for (const t of targets) addWire(doc, driver, t.to, t.input);
}

/** Routes a wire from scope S to scope T through ports: up and out of boxes, then down and in. */
function route(doc: Doc, tree: BoxTree, info: Map<string, PortInfo>, w: Wire, S: string | null, T: string | null): void {
  const up: string[] = [];
  const ancestorsT = new Set<string | null>();
  for (let s = T, i = 0; i < 1000; i++) {
    ancestorsT.add(s);
    if (s === null) break;
    s = tree.parent.get(s) ?? null;
  }
  let lca: string | null = S;
  for (let i = 0; lca !== null && !ancestorsT.has(lca) && i < 1000; i++) {
    up.push(lca);
    lca = tree.parent.get(lca) ?? null;
  }
  const down: string[] = [];
  for (let s = T, i = 0; s !== lca && s !== null && i < 1000; i++) {
    down.push(s);
    s = tree.parent.get(s) ?? null;
  }
  down.reverse();

  const target = pinPoint(doc, w.to, w.input);
  let cur = w.from;
  const through = (boxId: string, inward: boolean, toward: Point) => {
    for (const [pid, pi] of info) {
      if (pi.box === boxId && pi.inward === inward && pi.driver === cur && doc.components.has(pid)) return pid;
    }
    const box = doc.boxes.get(boxId)!;
    const id = uid(doc, 'p');
    const port = makeComponent('port', 0, 0, id);
    port.box = boxId;
    const src = doc.components.get(cur);
    if (src && (src.kind === 'port' || isInput(src.kind))) port.name = src.name;
    doc.components.set(id, port);
    placePort(doc, port, box, toward, inward);
    addWire(doc, cur, id, 0);
    const parent = tree.parent.get(boxId) ?? null;
    info.set(id, {
      box: boxId,
      inward,
      inScope: inward ? parent : boxId,
      outScope: inward ? boxId : parent,
      driver: cur,
    });
    return id;
  };
  doc.wires.delete(w.id);
  for (const b of up) cur = through(b, false, target);
  for (const b of down) cur = through(b, true, pinPoint(doc, cur, -1));
  addWire(doc, cur, w.to, w.input);
}

export function portsOf(doc: Doc, boxId: string): Component[] {
  const out: Component[] = [];
  for (const c of doc.components.values()) if (c.kind === 'port' && c.box === boxId) out.push(c);
  return out;
}
