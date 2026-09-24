import { boxInBox, componentInBox, makeComponent, uid } from './doc';
import { componentCenter, GRID, pinDir, pinPos, PORT_SIZE, rotatedSize } from './geometry';
import {
  bundleDest,
  bundleInput,
  bundleOutput,
  bundleSource,
  CABLE_MIN,
  isInput,
  type Box,
  type Component,
  type Doc,
  type Point,
  type Rotation,
  type Wire,
} from './types';

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
export function placePort(doc: Doc, port: Component, box: Box, target: Point, inward: boolean, slide = true): void {
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
  port.flip = false;
  port.rot = rotFor(inward ? { x: -n.x, y: -n.y } : n);
  if (port.inputs > 1 && port.inputBundle === undefined && port.outputBundle === undefined) {
    port.plug = inward ? 'in' : 'out';
    port.inputBundle = inward;
    port.outputBundle = !inward;
  }
  const span = vertical ? rotatedSize(port).h : rotatedSize(port).w;
  const gap = Math.max(PORT_SIZE, span);
  const free = (v: number) => others.every((o) => Math.abs(o - v) >= gap);
  if (slide && !free(base)) {
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
  if (!slide) {
    // Keep x,y from the file / caller; only lock rotation to the nearest matching wall.
    let best = Infinity;
    let rot = port.rot;
    for (let side = 0; side < 4; side++) {
      port.rot = rotFor(inward ? { x: -NORMALS[side].x, y: -NORMALS[side].y } : NORMALS[side]);
      const c = componentCenter(port);
      const wall = side === 0 ? box.x : side === 2 ? box.x + box.w : side === 1 ? box.y : box.y + box.h;
      const d = side === 0 || side === 2 ? Math.abs(c.x - wall) : Math.abs(c.y - wall);
      if (d < best) {
        best = d;
        rot = port.rot;
      }
    }
    port.rot = rot;
    return;
  }
  const cx = vertical ? wp.x : pos;
  const cy = vertical ? pos : wp.y;
  const size = rotatedSize(port);
  port.x = cx - size.w / 2;
  port.y = cy - size.h / 2;
}

/** True when a ribbon port has any non-cable wire on a lane pin. */
export function portHasSideWiring(doc: Doc, port: Component): boolean {
  for (const w of doc.wires.values()) {
    if (w.cable) continue;
    if (bundleInput(port)) {
      if (w.from === port.id) return true;
    } else if (bundleOutput(port)) {
      if (w.to === port.id) return true;
    } else if (w.to === port.id || w.from === port.id) {
      return true;
    }
  }
  return false;
}

/** Every ribbon port reachable from `start` through ribbon cables, including `start`. */
export function cableConnectedPorts(doc: Doc, start: Component): Component[] {
  if (start.kind !== 'port' || start.inputs <= 1) return [start];
  const out: Component[] = [];
  const seen = new Set<string>();
  const queue = [start.id];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const c = doc.components.get(id);
    if (!c || c.kind !== 'port' || c.inputs <= 1) continue;
    out.push(c);
    for (const w of doc.wires.values()) {
      if (!w.cable) continue;
      if (w.from === id) queue.push(w.to);
      else if (w.to === id) queue.push(w.from);
    }
  }
  return out;
}

/** Sets lane count on a ribbon port and re-seats it on its wall when it has one. */
export function setPortWidth(doc: Doc, port: Component, n: number): void {
  const count = Math.max(1, n);
  const box = port.box ? doc.boxes.get(port.box) : undefined;
  const at = componentCenter(port);
  const inward = box ? (port.plug ? port.plug === 'in' : portInward(port, box)) : true;
  port.inputs = count;
  if (count <= 1) {
    delete port.plug;
    delete port.inputBundle;
    delete port.outputBundle;
  } else if (port.inputBundle === undefined && port.outputBundle === undefined) {
    port.plug = inward ? 'in' : 'out';
    port.inputBundle = inward;
    port.outputBundle = !inward;
  }
  if (box) placePort(doc, port, box, at, inward, true);
}

function addWire(doc: Doc, from: string, to: string, input: number): Wire {
  for (const [id, w] of doc.wires) if (w.to === to && w.input === input) doc.wires.delete(id);
  const id = uid(doc, 'w');
  const wire: Wire = { id, from, to, input };
  doc.wires.set(id, wire);
  return wire;
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
      if (c.placed) continue;
      dissolvePort(doc, c);
      changed = true;
      continue;
    }
    if (c.inputs > 1 && c.inputBundle === undefined && c.outputBundle === undefined) {
      c.inputBundle = c.plug === 'in';
      c.outputBundle = c.plug === 'out';
      changed = true;
    }
    // Width changes re-seat via setPortWidth; avoid moving ports during ordinary normalize.
  }
  if (!hasBoxWork(doc)) return changed;

  for (let pass = 0; pass < 12; pass++) {
    const tree = buildBoxTree(doc);
    const info = portInfo(doc, tree);
    const inScope = (c: Component) => {
      const pi = c.kind === 'port' ? info.get(c.id) : undefined;
      return pi ? pi.inScope : tree.scope(c);
    };
    const outScope = (c: Component) => {
      const pi = c.kind === 'port' ? info.get(c.id) : undefined;
      return pi ? pi.outScope : tree.scope(c);
    };
    let dirty = false;
    for (const w of [...doc.wires.values()]) {
      if (!doc.wires.has(w.id)) continue;
      const s = doc.components.get(w.from);
      const t = doc.components.get(w.to);
      if (!s || !t) continue;
      const S = outScope(s);
      const T = inScope(t);
      if (S === T) continue;
      if (bundleSource(s) && bundleDest(t)) continue;
      dirty = true;
      if (t.kind === 'port') {
        const pi = info.get(t.id);
        if (pi) {
          const fromInside = tree.within(S, pi.box);
          if (pi.inward === fromInside) {
            dissolveInto(doc, w, t);
            continue;
          }
        }
      }
      if (s.kind === 'port') {
        const pi = info.get(s.id);
        if (pi) {
          const toInside = tree.within(T, pi.box);
          const driver = pi.driver;
          if (pi.inward !== toInside && driver) {
            doc.wires.delete(w.id);
            addWire(doc, driver, w.to, w.input);
            continue;
          }
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
        // Ribbon ports and toolbar-placed ports stay put when empty.
        if (c.inputs >= 2 || c.placed) continue;
        doc.components.delete(c.id);
        dirty = true;
      }
    }
    if (!dirty) break;
    changed = true;
  }
  if (bundlePorts(doc)) changed = true;
  if (spliceRibbons(doc)) changed = true;
  return changed;
}

/**
 * Replaces a complete set of lane wires between two ribbon ports with one ribbon cable.
 * The cable is a wire: lane i of the source plug drives lane i of the destination plug.
 */
function spliceRibbons(doc: Doc): boolean {
  const groups = new Map<string, Wire[]>();
  for (const w of doc.wires.values()) {
    if (w.cable) continue;
    const s = doc.components.get(w.from);
    const t = doc.components.get(w.to);
    if (!s || !t || !bundleSource(s) || !bundleDest(t)) continue;
    const key = `${s.id}>${t.id}`;
    const list = groups.get(key);
    if (list) list.push(w);
    else groups.set(key, [w]);
  }
  let changed = false;
  for (const list of groups.values()) {
    const s = doc.components.get(list[0].from)!;
    const t = doc.components.get(list[0].to)!;
    if (list.length < CABLE_MIN || list.length !== s.inputs || list.length !== t.inputs) continue;
    const lanes = new Set(list.map((w) => w.lane ?? 0));
    const inputs = new Set(list.map((w) => w.input));
    if (lanes.size !== list.length || inputs.size !== list.length) continue;
    const laneOf = new Map(list.map((w) => [w.input, w.lane ?? 0]));
    const moved: { w: Wire; lane: number }[] = [];
    for (const w of doc.wires.values()) {
      if (w.from !== t.id || w.cable || !laneOf.has(w.lane ?? 0)) continue;
      moved.push({ w, lane: laneOf.get(w.lane ?? 0)! });
    }
    for (const m of moved) {
      if (m.lane) m.w.lane = m.lane;
      else delete m.w.lane;
    }
    for (const w of list) doc.wires.delete(w.id);
    const wire = addWire(doc, s.id, t.id, 0);
    wire.cable = true;
    changed = true;
  }
  return changed;
}

/** Gathers one-signal ports that share a wall and all lead to the same neighbouring box. */
function bundlePorts(doc: Doc): boolean {
  const tree = buildBoxTree(doc);
  const peerOf = (port: Component): string => {
    const outward = !portInward(port, doc.boxes.get(port.box!)!);
    for (const w of doc.wires.values()) {
      if (outward ? w.from !== port.id : w.to !== port.id) continue;
      const other = doc.components.get(outward ? w.to : w.from);
      if (!other) continue;
      if (other.kind === 'port' && other.box) return other.box;
      return tree.scope(other) ?? '';
    }
    return '';
  };
  const groups = new Map<string, Component[]>();
  for (const c of doc.components.values()) {
    if (c.kind !== 'port' || !c.box || c.inputs > 1) continue;
    const box = doc.boxes.get(c.box);
    if (!box) continue;
    const key = `${c.box}|${portSide(c, box)}|${portInward(c, box) ? 1 : 0}|${peerOf(c)}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  let changed = false;
  for (const list of groups.values()) {
    if (list.length < 2 || list.length < CABLE_MIN) continue;
    const box = doc.boxes.get(list[0].box!)!;
    const side = portSide(list[0], box);
    const vertical = side === 0 || side === 2;
    list.sort((a, b) => {
      const ca = componentCenter(a);
      const cb = componentCenter(b);
      return vertical ? ca.y - cb.y : ca.x - cb.x;
    });
    const inward = portInward(list[0], box);
    const port = makeComponent('port', 0, 0, uid(doc, 'p'));
    port.inputs = list.length;
    port.box = box.id;
    port.name = list.map((p) => p.name).filter(Boolean).join(' ');
    doc.components.set(port.id, port);
    port.plug = inward ? 'in' : 'out';
    port.inputBundle = inward;
    port.outputBundle = !inward;
    placePort(doc, port, box, componentCenter(list[Math.floor(list.length / 2)]), inward);
    list.forEach((old, i) => {
      for (const w of doc.wires.values()) {
        if (w.to === old.id) {
          w.to = port.id;
          w.input = i;
        } else if (w.from === old.id) {
          w.from = port.id;
          w.lane = i;
        }
      }
      doc.components.delete(old.id);
    });
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
    if (!w.separatePort) {
      for (const [pid, pi] of info) {
        if (pi.box === boxId && pi.inward === inward && pi.driver === cur && doc.components.has(pid)) return pid;
      }
    }
    // Explicit editor branches get their own wall port, even when their driver is shared.
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
