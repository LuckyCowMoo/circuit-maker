import { Builder, sop, type Src } from './builder';
import type { Doc } from '../model/types';

const COL = {
  half: '#0f9d8a',
  full: '#6e56cf',
  outer: '#5b4b8a',
  inA: '#0f766e',
  inB: '#b45309',
  out: '#1d4ed8',
  carry: '#9f1239',
  latch: '#0f766e',
  add3: '#e5932a',
  display: '#4c1d95',
  mux: '#0ea5e9',
};

function bus(b: Builder, x: number, y: number, prefix: string, name: string, color: string): string[] {
  const ids = Array.from({ length: 8 }, (_, i) => b.sw(x, y + i * 180, `${prefix}${i}`));
  b.box(name, ids, 36, color);
  return ids;
}

function boxByName(b: Builder, name: string) {
  return [...b.doc.boxes.values()].find((box) => box.name === name)!;
}

function below(b: Builder, id: string, gap = 160): number {
  const r = b.bounds([id]);
  return r.y + r.h + gap;
}

function rightOf(b: Builder, ids: string[], gap = 160): number {
  return b.bounds(ids).x + b.bounds(ids).w + gap;
}

function bulbs(b: Builder, x: number, y: number, srcs: Src[], prefix: string, name: string, pitch = 80): void {
  const ids = srcs.map((s, i) => {
    b.signal(s, `${prefix}${i}`);
    const id = b.bulb(x, y + i * pitch, `${prefix}${i}`);
    b.wire(s, id);
    return id;
  });
  b.box(name, ids, 30, COL.out);
}

function zero(b: Builder, x: number, y: number): string {
  return b.gate('buffer', x, y, [null]);
}

function one(b: Builder, x: number, y: number): string {
  return b.gate('buffer', x, y, [null], true);
}

function pad8(b: Builder, srcs: Src[], x: number, y: number): Src[] {
  const out = srcs.slice(0, 8);
  let n = out.length;
  while (out.length < 8) out.push(zero(b, x, y + n++ * 70));
  return out;
}

function fullAdder(b: Builder, x: number, y: number, a: Src, bb: Src, cin: Src) {
  const ain = b.gate('buffer', x, y, [a]);
  const bin = b.gate('buffer', x, y + 200, [bb]);
  const x1 = b.gate('xor', x + 195, y, [ain, bin]);
  const a1 = b.gate('and', x + 195, y + 200, [ain, bin]);
  const x1b = b.gate('buffer', x + 465, y, [x1]);
  const cinb = b.gate('buffer', x + 465, y + 200, [cin]);
  const x2 = b.gate('xor', x + 660, y, [x1b, cinb]);
  const a2 = b.gate('and', x + 660, y + 200, [x1b, cinb]);
  const carry = b.gate('or', x + 915, y + 80, [a1, a2]);
  const ha1 = b.box('Half adder', [ain, bin, x1, a1], 24, COL.half);
  const ha2 = b.box('Half adder', [x1b, cinb, x2, a2], 24, COL.half);
  return { s: x2 as Src, c: carry as Src, box: b.box('Full adder', [ha1, ha2, carry], 28, COL.full) };
}

function ripple(b: Builder, x: number, y: number, a: Src[], bb: Src[], cin: Src) {
  const sums: Src[] = [];
  const boxes: string[] = [];
  let c = cin;
  let yy = y;
  for (let i = 0; i < Math.max(a.length, bb.length); i++) {
    const fa = fullAdder(b, x, yy, a[i] ?? null, bb[i] ?? null, c);
    sums.push(fa.s);
    c = fa.c;
    boxes.push(fa.box);
    yy = below(b, fa.box, 160);
  }
  return { sums, cout: c, boxes };
}

export function halfAdderDoc(): Doc {
  const b = new Builder('Half adder');
  const a = b.sw(0, 0, 'A');
  const bb = b.sw(0, 200, 'B');
  const inputs = b.box('Inputs', [a, bb], 36, COL.inA);
  const x = rightOf(b, [inputs]);
  const s = b.gate('xor', x, 40, [a, bb]);
  const c = b.gate('and', x, 180, [a, bb]);
  const logic = b.box('Half adder', [s, c], 28, COL.half);
  const ox = rightOf(b, [logic]);
  const sum = b.bulb(ox, 40, 'Sum');
  const carry = b.bulb(ox, 180, 'Carry');
  b.wire(s, sum);
  b.wire(c, carry);
  b.box('Outputs', [sum, carry], 30, COL.out);
  return b.finish();
}

export function fullAdderDoc(): Doc {
  const b = new Builder('Full adder');
  const a = b.sw(0, 0, 'A');
  const bb = b.sw(0, 200, 'B');
  const cin = b.sw(0, 400, 'Cin');
  const inputs = b.box('Inputs', [a, bb, cin], 36, COL.inA);
  const fa = fullAdder(b, rightOf(b, [inputs]), 40, a, bb, cin);
  const ox = rightOf(b, [fa.box]);
  const sum = b.bulb(ox, 40, 'Sum');
  const cout = b.bulb(ox + 315, 40, 'Cout');
  b.wire(fa.s, sum);
  b.wire(fa.c, cout);
  b.box('Sum', [sum], 30, COL.out);
  b.box('Carry', [cout], 30, COL.carry);
  return b.finish();
}

export function adder8Doc(): Doc {
  const b = new Builder('8-bit adder');
  const a = bus(b, 0, 0, 'A', 'A', COL.inA);
  const bb = bus(b, 0, below(b, boxByName(b, 'A').id, 120), 'B', 'B', COL.inB);
  const added = ripple(b, rightOf(b, [boxByName(b, 'A').id, boxByName(b, 'B').id]), boxByName(b, 'A').y, a, bb, null);
  const block = b.box('8-bit adder', added.boxes, 36, COL.outer);
  const edge = b.bounds([block]);
  bulbs(b, edge.x + edge.w + 50, edge.y, added.sums, 'S', 'Sum');
  const cout = b.bulb(edge.x + edge.w + 315, edge.y, 'Cout');
  b.wire(added.cout, cout);
  b.signal(added.cout, 'Cout');
  b.box('Carry', [cout], 30, COL.carry);
  return b.finish();
}

export function sub8Doc(): Doc {
  const b = new Builder('8-bit subtractor');
  const a = bus(b, 0, 0, 'A', 'A', COL.inA);
  const bb = bus(b, 0, below(b, boxByName(b, 'A').id, 120), 'B', 'B', COL.inB);
  const x = rightOf(b, [boxByName(b, 'A').id, boxByName(b, 'B').id]);
  const y = boxByName(b, 'A').y;
  const cin = one(b, x, y);
  const inv = bb.map((id, i) => b.gate('buffer', x, y + 120 + i * 110, [id], true));
  const added = ripple(b, x + 270, y, a, inv, cin);
  const block = b.box('8-bit subtractor', [cin, ...inv, ...added.boxes], 36, COL.outer);
  const edge = b.bounds([block]);
  bulbs(b, edge.x + edge.w + 50, edge.y, added.sums, 'D', 'Difference');
  const borrow = b.gate('buffer', edge.x + edge.w + 50, edge.y + 900, [added.cout], true);
  const bulb = b.bulb(edge.x + edge.w + 270, edge.y + 900, 'Borrow');
  b.wire(borrow, bulb);
  b.box('Borrow', [borrow, bulb], 30, COL.carry);
  return b.finish();
}

export function mul4Doc(): Doc {
  const b = new Builder('4-bit multiplier');
  const a = bus(b, 0, 0, 'A', 'A', COL.inA);
  const bb = bus(b, 0, below(b, boxByName(b, 'A').id, 120), 'B', 'B', COL.inB);
  const x0 = rightOf(b, [boxByName(b, 'A').id, boxByName(b, 'B').id]);
  const y0 = boxByName(b, 'A').y;
  const hi = [0, 1, 2, 3].flatMap((i) => [zero(b, x0, y0 + i * 70), zero(b, x0, y0 + 400 + i * 70)]);
  const rows: string[] = [];
  const pp0 = [0, 1, 2, 3].map((j) => b.gate('and', x0 + 240, y0 + j * 280, [a[j], bb[0]]));
  let acc: Src[] = [pp0[1], pp0[2], pp0[3], null];
  const p: Src[] = [pp0[0]];
  rows.push(b.box('Row 0', pp0, 24, COL.full));
  let x = rightOf(b, [rows[0]], 160);
  for (let r = 1; r < 4; r++) {
    const ids: string[] = [];
    let carry: Src = null;
    const sums: Src[] = [];
    let y = y0;
    for (let j = 0; j < 4; j++) {
      const pp = b.gate('and', x, y + 80, [a[j], bb[r]]);
      const fa = fullAdder(b, x + 210, y, pp, acc[j], carry);
      ids.push(pp, fa.box);
      sums.push(fa.s);
      carry = fa.c;
      y = below(b, fa.box, 160);
    }
    rows.push(b.box(`Row ${r}`, ids, 24, COL.full));
    p.push(sums[0]);
    acc = [sums[1], sums[2], sums[3], carry];
    x = rightOf(b, [rows[rows.length - 1]], 160);
  }
  p.push(...acc);
  const wide = pad8(b, p, x0, below(b, rows[rows.length - 1], 120));
  const block = b.box('4-bit multiplier', [...hi, ...rows, ...wide.filter((s) => !p.includes(s)) as string[]], 36, COL.outer);
  const edge = b.bounds([block]);
  bulbs(b, edge.x + edge.w + 50, edge.y, wide, 'P', 'Product');
  return b.finish();
}

/** Restoring division. Quotient when `showQ`, otherwise the remainder. */
function divide(showQ: boolean): Doc {
  const b = new Builder(showQ ? '4-bit divider' : '4-bit modulus');
  const a = bus(b, 0, 0, 'A', 'A', COL.inA);
  const bb = bus(b, 0, below(b, boxByName(b, 'A').id, 120), 'B', 'B', COL.inB);
  const x0 = rightOf(b, [boxByName(b, 'A').id, boxByName(b, 'B').id]);
  const y0 = boxByName(b, 'A').y;
  const nb = bb.slice(0, 4).map((s, j) => b.gate('buffer', x0, y0 + j * 120, [s], true));
  const hi = [4, 5, 6, 7].flatMap((j) => [zero(b, x0, y0 + 560 + j * 100), zero(b, x0 + 180, y0 + 560 + j * 100)]);
  const inv = b.box('Invert B', nb, 24, COL.inB);
  let rem: Src[] = [null, null, null, null];
  const q: Src[] = [];
  const steps = [inv];
  let x = rightOf(b, [inv], 185);
  for (let k = 0; k < 4; k++) {
    const bit = 3 - k;
    const s: Src[] = [a[bit], rem[0], rem[1], rem[2], rem[3]];
    const t0 = b.gate('xor', x, y0, [s[0], nb[0]], true);
    const c1 = b.gate('or', x, y0 + 140, [s[0], nb[0]]);
    const ids = [t0, c1];
    const diff: Src[] = [t0];
    let c: Src = c1;
    let y = y0 + 320;
    for (let j = 1; j < 4; j++) {
      const fa = fullAdder(b, x, y, s[j], nb[j], c);
      ids.push(fa.box);
      diff.push(fa.s);
      c = fa.c;
      y = below(b, fa.box, 160);
    }
    const qk = b.gate('or', x + 80, y, [s[4], c]);
    ids.push(qk);
    const sub = b.box('Subtract', ids, 24, COL.full);
    const nq = b.gate('buffer', rightOf(b, [sub], 120), y0, [qk], true);
    const mux: string[] = [nq];
    const next: Src[] = [];
    for (let j = 0; j < 4; j++) {
      const yy = y0 + j * 220;
      const keep = b.gate('and', rightOf(b, [sub], 120), yy + 100, [qk, diff[j]]);
      const back = b.gate('and', rightOf(b, [sub], 270), yy + 100, [nq, s[j]]);
      const r = b.gate('or', rightOf(b, [sub], 420), yy + 100, [keep, back]);
      mux.push(keep, back, r);
      next.push(r);
    }
    const stage = b.box(showQ ? 'Divide stage' : 'Modulus stage', [sub, ...mux], 24, COL.full);
    steps.push(stage);
    q[bit] = qk;
    rem = next;
    x = rightOf(b, [stage], 185);
  }
  const shown = showQ ? q : rem;
  const wide = pad8(b, shown, x0, below(b, steps[steps.length - 1], 120));
  const block = b.box(showQ ? '4-bit divider' : '4-bit modulus', [...hi, ...steps, ...wide.filter((s) => !shown.includes(s)) as string[]], 36, COL.outer);
  const edge = b.bounds([block]);
  bulbs(b, edge.x + edge.w + 50, edge.y, wide, showQ ? 'Q' : 'R', showQ ? 'Quotient' : 'Remainder');
  return b.finish();
}

export const div4Doc = (): Doc => divide(true);
export const mod4Doc = (): Doc => divide(false);

export function cmp4Doc(): Doc {
  const b = new Builder('4-bit comparator');
  const a = bus(b, 0, 0, 'A', 'A', COL.inA);
  const bb = bus(b, 0, below(b, boxByName(b, 'A').id, 120), 'B', 'B', COL.inB);
  const x = rightOf(b, [boxByName(b, 'A').id, boxByName(b, 'B').id]);
  const y = boxByName(b, 'A').y;
  const hi = [4, 5, 6, 7].flatMap((i) => [zero(b, x, y + i * 70), zero(b, x + 80, y + i * 70)]);
  const eq = [0, 1, 2, 3].map((j) => b.gate('xor', x + 210, y + j * 260, [a[j], bb[j]], true));
  const na = [0, 1, 2, 3].map((j) => b.gate('buffer', x + 210, y + j * 260 + 90, [a[j]], true));
  const nb = [0, 1, 2, 3].map((j) => b.gate('buffer', x + 210, y + j * 260 + 180, [bb[j]], true));
  const gt: string[] = [];
  const lt: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const same = eq.slice(i + 1);
    gt.push(b.gate('and', x + 420, y + (3 - i) * 220, [...same, a[i], nb[i]]));
    lt.push(b.gate('and', x + 420, y + 960 + (3 - i) * 220, [...same, na[i], bb[i]]));
  }
  const all = b.gate('and', x + 420, y + 1900, [...eq]);
  const g = b.gate('or', x + 675, y + 120, gt);
  const l = b.gate('or', x + 675, y + 1080, lt);
  const block = b.box('4-bit comparator', [...hi, ...eq, ...na, ...nb, ...gt, ...lt, all, g, l], 36, COL.outer);
  const ox = rightOf(b, [block]);
  const gb = b.bulb(ox, y, 'A>B');
  const eb = b.bulb(ox, y + 120, 'A=B');
  const lb = b.bulb(ox, y + 240, 'A<B');
  b.wire(g, gb);
  b.wire(all, eb);
  b.wire(l, lb);
  b.box('Result', [gb, eb, lb], 30, COL.out);
  return b.finish();
}

function mux2(b: Builder, x: number, y: number, s: Src, d0: Src, d1: Src) {
  const ns = b.gate('buffer', x, y, [s], true);
  const a = b.gate('and', x + 180, y, [ns, d0]);
  const c = b.gate('and', x + 180, y + 150, [s, d1]);
  const o = b.gate('or', x + 375, y + 50, [a, c]);
  return { o: o as Src, box: b.box('Mux', [ns, a, c, o], 20, COL.mux) };
}

export function mux4Doc(): Doc {
  const b = new Builder('4-to-1 multiplexer');
  const ids = [0, 1, 2, 3].map((i) => b.sw(0, i * 200, `D${i}`));
  ids.push(b.sw(0, 800, 'S0'), b.sw(0, 1000, 'S1'));
  const inputs = b.box('Inputs', ids, 36, COL.inA);
  const x = rightOf(b, [inputs]);
  const [d0, d1, d2, d3, s0, s1] = ids;
  const lo = mux2(b, x, 0, s0, d0, d1);
  const hi = mux2(b, x, below(b, lo.box, 130), s0, d2, d3);
  const top = mux2(b, rightOf(b, [lo.box, hi.box]), 80, s1, lo.o, hi.o);
  const block = b.box('4-to-1 multiplexer', [lo.box, hi.box, top.box], 30, COL.outer);
  const out = b.bulb(rightOf(b, [block]), 80, 'Y');
  b.wire(top.o, out);
  b.box('Output', [out], 30, COL.out);
  return b.finish();
}

export function dec2Doc(): Doc {
  const b = new Builder('2-to-4 decoder');
  const s0 = b.sw(0, 0, 'S0');
  const s1 = b.sw(0, 200, 'S1');
  const inputs = b.box('Inputs', [s0, s1], 36, COL.inA);
  const x = rightOf(b, [inputs]);
  const n0 = b.gate('buffer', x, 0, [s0], true);
  const n1 = b.gate('buffer', x, 140, [s1], true);
  const outs = [0, 1, 2, 3].map((v) => b.gate('and', x + 210, v * 160, [v & 1 ? s0 : n0, v & 2 ? s1 : n1]));
  const block = b.box('2-to-4 decoder', [n0, n1, ...outs], 30, COL.outer);
  const ox = rightOf(b, [block]);
  const bulbs = outs.map((g, i) => {
    const id = b.bulb(ox, i * 100, `Y${i}`);
    b.wire(g, id);
    return id;
  });
  b.box('Outputs', bulbs, 30, COL.out);
  return b.finish();
}

function dLatch(b: Builder, x: number, y: number, d: Src, en: Src) {
  const nd = b.gate('buffer', x, y + 180, [d], true);
  const s = b.gate('and', x + 195, y, [d, en]);
  const r = b.gate('and', x + 195, y + 180, [en, nd]);
  const qb = b.add('or', x + 420, y, { not: true, inputs: 2 });
  const q = b.add('or', x + 420, y + 180, { not: true, inputs: 2 });
  b.wire(s, qb, 0);
  b.wire(q, qb, 1);
  b.wire(qb, q, 0);
  b.wire(r, q, 1);
  return { q: q as Src, qb: qb as Src, ids: [nd, s, r, qb, q], dPins: [[nd, 0], [s, 0]] as [string, number][] };
}

export function srDoc(): Doc {
  const b = new Builder('SR latch');
  const s = b.btn(0, 0, 'S');
  const r = b.btn(0, 200, 'R');
  const inputs = b.box('Inputs', [s, r], 36, COL.inA);
  const x = rightOf(b, [inputs]);
  const qb = b.add('or', x, 0, { not: true, inputs: 2 });
  const q = b.add('or', x, 220, { not: true, inputs: 2 });
  b.wire(s, qb, 0);
  b.wire(q, qb, 1);
  b.wire(qb, q, 0);
  b.wire(r, q, 1);
  const box = b.box('SR latch', [qb, q], 30, COL.latch);
  const ox = rightOf(b, [box]);
  const qBulb = b.bulb(ox, 140, 'Q');
  const qbBulb = b.bulb(ox, 0, 'Qn');
  b.wire(q, qBulb);
  b.wire(qb, qbBulb);
  b.box('Outputs', [qBulb, qbBulb], 30, COL.out);
  return b.finish();
}

export function memDoc(): Doc {
  const b = new Builder('Memory cell');
  const d = b.sw(0, 0, 'D');
  const en = b.btn(0, 200, 'Write');
  const inputs = b.box('Inputs', [d, en], 36, COL.inA);
  const cell = dLatch(b, rightOf(b, [inputs]), 0, d, en);
  const box = b.box('Memory cell', cell.ids, 30, COL.latch);
  const q = b.bulb(rightOf(b, [box]), 80, 'Q');
  b.wire(cell.q, q);
  b.box('Output', [q], 30, COL.out);
  return b.finish();
}

function dff(b: Builder, x: number, y: number, d: Src, clk: Src) {
  const nclk = b.gate('buffer', x, y + 240, [clk], true);
  const master = dLatch(b, x + 165, y, d, nclk);
  const mBox = b.box('Latch', master.ids, 20, COL.latch);
  const slave = dLatch(b, rightOf(b, [mBox], 80), y, master.q, clk);
  const sBox = b.box('Latch', slave.ids, 20, COL.latch);
  return { q: slave.q, qb: slave.qb, box: b.box('D flip-flop', [nclk, mBox, sBox], 24, COL.full), dPins: master.dPins };
}

export function dffDoc(): Doc {
  const b = new Builder('D flip-flop');
  const d = b.sw(0, 0, 'D');
  const clk = b.btn(0, 200, 'Clock');
  const inputs = b.box('Inputs', [d, clk], 36, COL.inA);
  const ff = dff(b, rightOf(b, [inputs]), 0, d, clk);
  const q = b.bulb(rightOf(b, [ff.box]), 80, 'Q');
  b.wire(ff.q, q);
  b.box('Output', [q], 30, COL.out);
  return b.finish();
}

export function reg8Doc(): Doc {
  const b = new Builder('8-bit register');
  const data = bus(b, 0, 0, 'D', 'D', COL.inA);
  const load = b.btn(0, below(b, boxByName(b, 'D').id, 120), 'Load');
  b.box('Load', [load], 36, COL.inB);
  const x = rightOf(b, [boxByName(b, 'D').id, boxByName(b, 'Load').id]);
  const y = boxByName(b, 'D').y;
  const en = b.gate('buffer', x, y, [load]);
  const cells: string[] = [];
  const qs: Src[] = [];
  let yy = y;
  for (let i = 0; i < 8; i++) {
    const cell = dLatch(b, x + 240, yy, data[i], en);
    cells.push(b.box('Memory cell', cell.ids, 20, COL.latch));
    qs.push(cell.q);
    yy = below(b, cells[i], 160);
  }
  const block = b.box('8-bit register', [en, ...cells], 30, COL.outer);
  bulbs(b, rightOf(b, [block]), y, qs, 'Q', 'Q');
  return b.finish();
}

export function count4Doc(): Doc {
  const b = new Builder('4-bit counter');
  const clk = b.btn(0, 0, 'Clock');
  const inputs = b.box('Inputs', [clk], 36, COL.inA);
  const x = rightOf(b, [inputs]);
  const clock = b.gate('buffer', x, 0, [clk]);
  const stages: string[] = [];
  const qs: Src[] = [];
  let y = 0;
  for (let i = 0; i < 4; i++) {
    const ff = dff(b, x + 360, y, null, clock);
    const lower = qs.slice();
    const toggle: Src = i === 0 ? null : lower.length === 1 ? lower[0] : b.gate('and', x, y + 120, lower);
    const d = i === 0 ? ff.qb : b.gate('xor', x, y + 280, [ff.q, toggle]);
    for (const [id, pin] of ff.dPins) b.wire(d, id, pin);
    const extra = [ff.box];
    if (i > 0 && lower.length > 1) extra.push(toggle as string);
    if (i > 0) extra.push(d as string);
    stages.push(b.box('T flip-flop', extra, 20, COL.full));
    qs.push(ff.q);
    y = below(b, stages[i], 280);
  }
  const hi = [0, 1, 2, 3].map((i) => zero(b, x, y + i * 70));
  const block = b.box('4-bit counter', [clock, ...stages, ...hi], 30, COL.outer);
  bulbs(b, rightOf(b, [block]), 0, [...qs, ...hi], 'Q', 'Count');
  return b.finish();
}

const SEGMENTS = 'abcdefg';
const HEX = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg', 'abcefg', 'cdefg', 'adef', 'bcdeg', 'adefg', 'aefg'];

function segDecoder(b: Builder, x: number, y: number, ins: Src[]) {
  const outputs = [...SEGMENTS].map((s) => ({ on: HEX.flatMap((segs, v) => (segs.includes(s) ? [v] : [])) }));
  const res = sop(b, x, y, ins, outputs);
  return { outs: res.outs, box: b.box('7-segment decoder', res.ids, 24, COL.outer) };
}

function digit(b: Builder, x: number, y: number, segs: Src[], name: string): string {
  const t = 60;
  const L = 180;
  const bar = (sx: number, sy: number, vertical: boolean) =>
    b.bulb(x + sx, y + sy, '', vertical ? { w: t, h: L } : { w: L, h: t });
  const ids = [
    bar(t, 0, false),
    bar(t + L, t, true),
    bar(t + L, t + L + t, true),
    bar(t, t + L + t + L, false),
    bar(0, t + L + t, true),
    bar(0, t, true),
    bar(t, t + L, false),
  ];
  ids.forEach((id, i) => {
    b.wire(segs[i], id);
    const c = b.doc.components.get(id)!;
    c.name = `${name} ${SEGMENTS[i]}`;
  });
  return b.box(name, ids, 24, COL.display);
}

export function seg7Doc(): Doc {
  const b = new Builder('7-segment display');
  const value = bus(b, 0, 0, 'B', 'Value', COL.inA);
  const x = rightOf(b, [boxByName(b, 'Value').id]);
  const y = boxByName(b, 'Value').y;
  const hi = [4, 5, 6, 7].map((i) => zero(b, x, y + i * 70));
  const dec = segDecoder(b, x + 210, y, value.slice(0, 4));
  const block = b.box('Decoder', [dec.box, ...hi], 30, COL.outer);
  digit(b, rightOf(b, [block]), y + 200, dec.outs, 'Display');
  return b.finish();
}

function add3(b: Builder, x: number, y: number, ins: Src[]) {
  const on: number[][] = [[], [], [], []];
  const dc: number[] = [];
  for (let v = 0; v < 16; v++) {
    if (v > 9) {
      dc.push(v);
      continue;
    }
    const r = v >= 5 ? v + 3 : v;
    for (let bit = 0; bit < 4; bit++) if (r & (1 << bit)) on[bit].push(v);
  }
  const res = sop(b, x, y, ins, on.map((m) => ({ on: m, dc })));
  return { outs: res.outs, box: b.box('Add 3', res.ids, 20, COL.add3) };
}

export function seg3Doc(): Doc {
  const b = new Builder('3-digit display');
  const value = bus(b, 0, 0, 'B', 'Value', COL.inA);
  const x = rightOf(b, [boxByName(b, 'Value').id], 140);
  const y = boxByName(b, 'Value').y;
  const c1 = add3(b, x, y, [value[5], value[6], value[7], null]);
  const c2 = add3(b, rightOf(b, [c1.box], 40), y, [value[4], c1.outs[0], c1.outs[1], c1.outs[2]]);
  const c3 = add3(b, rightOf(b, [c2.box], 40), y, [value[3], c2.outs[0], c2.outs[1], c2.outs[2]]);
  const c4 = add3(b, rightOf(b, [c3.box], 40), y, [value[2], c3.outs[0], c3.outs[1], c3.outs[2]]);
  const c5 = add3(b, rightOf(b, [c4.box], 40), y, [value[1], c4.outs[0], c4.outs[1], c4.outs[2]]);
  const topBox = b.bounds([c1.box]);
  const bottom = topBox.y + topBox.h + 70;
  const c6 = add3(b, b.bounds([c3.box]).x, bottom, [c3.outs[3], c2.outs[3], c1.outs[3], null]);
  const c7 = add3(b, b.bounds([c5.box]).x, bottom, [c4.outs[3], c6.outs[0], c6.outs[1], c6.outs[2]]);
  const ones = [value[0], c5.outs[0], c5.outs[1], c5.outs[2]];
  const tens = [c5.outs[3], c7.outs[0], c7.outs[1], c7.outs[2]];
  const hundreds = [c7.outs[3], c6.outs[3], null, null];
  const adds = b.box('Binary to decimal', [c1.box, c2.box, c3.box, c4.box, c5.box, c6.box, c7.box], 30, COL.outer);
  const dx = rightOf(b, [adds], 140);
  const h = segDecoder(b, dx, y, hundreds);
  const t = segDecoder(b, rightOf(b, [h.box], 40), y, tens);
  const o = segDecoder(b, rightOf(b, [t.box], 40), y, ones);
  const decs = b.box('Decoders', [h.box, t.box, o.box], 30, COL.full);
  const dispX = rightOf(b, [decs], 140);
  digit(b, dispX, y, h.outs, '100s');
  digit(b, dispX, y + 700, t.outs, '10s');
  digit(b, dispX, y + 1400, o.outs, '1s');
  return b.finish();
}
