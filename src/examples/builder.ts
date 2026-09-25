import { emptyDoc, makeComponent, netRoots } from '../model/doc';
import { componentBounds, snap } from '../model/geometry';
import { normalizePorts } from '../model/ports';
import type { Box, ComponentKind, Doc, GateKind, Rect, Rotation } from '../model/types';

/** A signal source: a component id, or null for a constant 0 (an unconnected input). */
export type Src = string | null;

/** "A0 A1 A2" becomes "A0–A2" when the names are one prefix and a run of numbers. */
function busName(names: string[]): string {
  const parts = names.map((n) => /^(\D*?)(\d+)$/.exec(n));
  if (names.length > 1 && names.every(Boolean) && parts.every((p) => p) && parts.every((p) => p![1] === parts[0]![1])) {
    const nums = parts.map((p) => Number(p![2]));
    if (nums.every((n, i) => i === 0 || n === nums[i - 1] + 1)) return `${parts[0]![1]}${nums[0]}–${nums[nums.length - 1]}`;
  }
  return names.filter(Boolean).join(' ');
}

export interface PartOptions {
  inputs?: number;
  not?: boolean;
  name?: string;
  on?: boolean;
  w?: number;
  h?: number;
  rot?: Rotation;
}

/** Small helper for building example circuits in code. */
export class Builder {
  doc: Doc;
  /** Signal names used to label the ports a signal passes through. */
  private signals = new Map<string, string>();
  private n = 0;

  constructor(name: string) {
    this.doc = emptyDoc(name);
  }

  private id(prefix: string): string {
    return `${prefix}${++this.n}`;
  }

  add(kind: ComponentKind, x: number, y: number, o: PartOptions = {}): string {
    const c = makeComponent(kind, snap(x), snap(y), this.id(kind[0]));
    if (o.inputs) c.inputs = o.inputs;
    if (o.not) c.negate = true;
    if (o.name) c.name = o.name;
    if (o.on) c.on = true;
    if (o.w) c.w = o.w;
    if (o.h) c.h = o.h;
    if (o.rot) c.rot = o.rot;
    this.doc.components.set(c.id, c);
    return c.id;
  }

  sw(x: number, y: number, name: string, on = false): string {
    return this.add('switch', x, y, { name, on, w: 120, h: 120 });
  }

  btn(x: number, y: number, name: string): string {
    return this.add('button', x, y, { name, w: 120, h: 120 });
  }

  bulb(x: number, y: number, name: string, o: PartOptions = {}): string {
    return this.add('bulb', x, y, { ...o, name });
  }

  /** A gate whose inputs are wired from `ins` in order (null entries stay unconnected). */
  gate(kind: GateKind, x: number, y: number, ins: Src[], not = false): string {
    const id = this.add(kind, x, y, { inputs: Math.max(1, ins.length), not });
    ins.forEach((s, i) => this.wire(s, id, i));
    return id;
  }

  wire(from: Src, to: string, input = 0, lane = 0): void {
    if (!from) return;
    const id = this.id('w');
    const wire = { id, from, to, input, lane: lane || undefined };
    this.doc.wires.set(id, wire);
  }

  /** Names a signal so ports it passes through get that label. */
  signal(id: Src, name: string): void {
    if (id) this.signals.set(id, name);
  }

  bounds(ids: string[]): Rect {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of ids) {
      const c = this.doc.components.get(id);
      const r = c ? componentBounds(c) : this.doc.boxes.get(id);
      if (!r) continue;
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Wraps components and boxes in a new box, with room at the top for its name. */
  box(name: string, ids: string[], pad = 30, color: string | null = null): string {
    const wall = pad + 64;
    const partMargin = wall * 0.25;
    const boxMargin = wall * 0.33;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const id of ids) {
      const comp = this.doc.components.get(id);
      const inner = this.doc.boxes.get(id);
      const r = comp ? componentBounds(comp) : inner;
      if (!r) continue;
      const m = comp ? partMargin : boxMargin;
      x0 = Math.min(x0, r.x - m);
      y0 = Math.min(y0, r.y - m);
      x1 = Math.max(x1, r.x + r.w + m);
      y1 = Math.max(y1, r.y + r.h + m);
    }
    const x = snap(x0);
    const y = snap(y0 - 40);
    const b: Box = { id: this.id('box'), name, x, y, w: snap(x1) - x, h: snap(y1) - y, color };
    this.doc.boxes.set(b.id, b);
    return b.id;
  }

  /** Adds ports wherever wires cross box walls and labels them after their signals. */
  finish(): Doc {
    normalizePorts(this.doc);
    const roots = netRoots(this.doc);
    const label = (root: string) => {
      const src = this.doc.components.get(root);
      return this.signals.get(root) ?? (src && src.kind !== 'port' && !['and', 'or', 'xor', 'buffer'].includes(src.kind) ? src.name : '');
    };
    for (const c of this.doc.components.values()) {
      if (c.kind !== 'port') continue;
      if (c.inputs > 1) {
        const names = [];
        for (let i = 0; i < c.inputs; i++) names.push(label(roots.get(i ? `${c.id}#${i}` : c.id) ?? c.id));
        c.name = busName(names);
      } else {
        const root = roots.get(c.id) ?? c.id;
        c.name = label(root);
      }
    }
    return this.doc;
  }
}

// ---------------------------------------------------------------- logic minimisation

interface Term {
  /** Which variables appear in the product. */
  mask: number;
  /** Their required values. */
  bits: number;
}

const popcount = (v: number) => {
  let n = 0;
  for (; v; v &= v - 1) n++;
  return n;
};

/** Minimal-ish sum of products (Quine-McCluskey primes, then a greedy cover). */
export function minimise(n: number, on: number[], dc: number[] = []): Term[] {
  const full = (1 << n) - 1;
  if (!on.length) return [];
  let level = new Map<string, Term>();
  for (const m of [...on, ...dc]) level.set(`${full}:${m}`, { mask: full, bits: m });
  const primes: Term[] = [];
  while (level.size) {
    const next = new Map<string, Term>();
    const used = new Set<string>();
    const terms = [...level.entries()];
    for (let i = 0; i < terms.length; i++) {
      for (let j = i + 1; j < terms.length; j++) {
        const [ka, a] = terms[i];
        const [kb, b] = terms[j];
        if (a.mask !== b.mask) continue;
        const diff = a.bits ^ b.bits;
        if (popcount(diff) !== 1) continue;
        const t = { mask: a.mask & ~diff, bits: a.bits & ~diff };
        next.set(`${t.mask}:${t.bits}`, t);
        used.add(ka);
        used.add(kb);
      }
    }
    for (const [k, t] of terms) if (!used.has(k)) primes.push(t);
    level = next;
  }
  const covers = (t: Term, m: number) => (m & t.mask) === t.bits;
  const left = new Set(on);
  const chosen: Term[] = [];
  for (const m of on) {
    const hits = primes.filter((p) => covers(p, m));
    if (hits.length === 1 && !chosen.includes(hits[0])) chosen.push(hits[0]);
  }
  for (const t of chosen) for (const m of [...left]) if (covers(t, m)) left.delete(m);
  while (left.size) {
    let best = primes[0];
    let bestScore = -Infinity;
    for (const p of primes) {
      let count = 0;
      for (const m of left) if (covers(p, m)) count++;
      const score = count * 10 - popcount(p.mask);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    chosen.push(best);
    for (const m of [...left]) if (covers(best, m)) left.delete(m);
  }
  return chosen;
}

export interface SopOutput {
  on: number[];
  dc?: number[];
}

/**
 * Lays out two-level logic (NOTs, ANDs, ORs) computing each output from `inputs` (index 0 is
 * the least significant bit). Returns the source for each output and every part it made.
 */
export function sop(b: Builder, x: number, y: number, inputs: Src[], outputs: SopOutput[]): { outs: Src[]; ids: string[] } {
  const n = inputs.length;
  const ids: string[] = [];
  const nots = new Map<number, string>();
  const literal = (i: number, value: boolean): Src => {
    if (value) return inputs[i];
    let g = nots.get(i);
    if (!g) {
      g = b.gate('buffer', x, y + i * 110, [inputs[i]], true);
      nots.set(i, g);
      ids.push(g);
    }
    return g;
  };
  const termGates = new Map<string, Src>();
  let ty = y;
  const termSource = (t: Term): Src => {
    const key = `${t.mask}:${t.bits}`;
    if (termGates.has(key)) return termGates.get(key)!;
    const lits: Src[] = [];
    for (let i = n - 1; i >= 0; i--) if (t.mask & (1 << i)) lits.push(literal(i, !!(t.bits & (1 << i))));
    let src: Src;
    if (lits.length === 1) src = lits[0];
    else {
      src = b.gate('and', x + 180, ty, lits);
      ids.push(src);
      ty += Math.max(2, lits.length) * 20 + 48;
    }
    termGates.set(key, src);
    return src;
  };
  const plans = outputs.map((o) => minimise(n, o.on, o.dc));
  const outs: Src[] = [];
  let oy = y;
  for (const terms of plans) {
    const srcs = terms.map(termSource);
    if (srcs.length === 1) {
      outs.push(srcs[0]);
      continue;
    }
    if (!srcs.length) {
      outs.push(null);
      continue;
    }
    const g = b.gate('or', x + 390, oy, srcs);
    ids.push(g);
    outs.push(g);
    oy += Math.max(2, srcs.length) * 20 + 56;
  }
  return { outs, ids };
}
