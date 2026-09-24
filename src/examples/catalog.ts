import type { Doc } from '../model/types';
import { Builder, sop, type Src } from './builder';

// ---------------------------------------------------------------- modules

interface Adder {
  s: string;
  c: string;
  ids: string[];
}

/** Full adder at (x, y), about 320 x 140. Missing inputs count as 0. */
function fullAdder(b: Builder, x: number, y: number, a: Src, bb: Src, cin: Src): Adder {
  const x1 = b.gate('xor', x, y, [a, bb]);
  const a1 = b.gate('and', x, y + 100, [a, bb]);
  const x2 = b.gate('xor', x + 130, y + 10, [x1, cin]);
  const a2 = b.gate('and', x + 130, y + 80, [x1, cin]);
  const o1 = b.gate('or', x + 240, y + 90, [a2, a1]);
  return { s: x2, c: o1, ids: [x1, a1, x2, a2, o1] };
}

function halfAdder(b: Builder, x: number, y: number, a: Src, bb: Src): Adder {
  const s = b.gate('xor', x, y, [a, bb]);
  const c = b.gate('and', x, y + 80, [a, bb]);
  return { s, c, ids: [s, c] };
}

interface Latch {
  q: string;
  qb: string;
  ids: string[];
  /** The gate inputs fed by D, for wiring D after the latch is built. */
  dPins: [string, number][];
}

/** Gated D latch: while `en` is 1, Q follows D. About 300 x 140. */
function dLatch(b: Builder, x: number, y: number, d: Src, en: Src): Latch {
  const nd = b.gate('buffer', x, y + 100, [d], true);
  const s = b.gate('and', x + 100, y, [d, en]);
  const r = b.gate('and', x + 100, y + 90, [en, nd]);
  const qb = b.add('or', x + 230, y, { not: true });
  const q = b.add('or', x + 230, y + 90, { not: true });
  b.wire(s, qb, 0);
  b.wire(q, qb, 1);
  b.wire(qb, q, 0);
  b.wire(r, q, 1);
  return { q, qb, ids: [nd, s, r, qb, q], dPins: [[nd, 0], [s, 0]] };
}

/** Rising-edge D flip-flop made of two latches. */
function dFlipFlop(b: Builder, x: number, y: number, d: Src, clk: Src, name: string): Latch & { box: string } {
  const nclk = b.gate('buffer', x, y + 160, [clk], true);
  const master = dLatch(b, x + 90, y, d, nclk);
  const slave = dLatch(b, x + 460, y, master.q, clk);
  const mBox = b.box('Master', master.ids, 20);
  const sBox = b.box('Slave', slave.ids, 20);
  const box = b.box(name, [nclk, mBox, sBox]);
  return { q: slave.q, qb: slave.qb, ids: [box], box, dPins: master.dPins };
}

/** Double-dabble cell: adds 3 when the 4-bit input is 5 or more. Inputs/outputs are LSB first. */
function add3(b: Builder, x: number, y: number, ins: Src[], name: string): { outs: Src[]; box: string } {
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
  return { outs: res.outs, box: b.box(name, res.ids, 20) };
}

const SEGMENTS = 'abcdefg';
/** Segments lit for each hex digit 0-F. */
const HEX_SEGMENTS = [
  'abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc',
  'abcdefg', 'abcdfg', 'abcefg', 'cdefg', 'adef', 'bcdeg', 'adefg', 'aefg',
];

/** Hex to 7-segment decoder. Inputs are LSB first; returns sources for segments a-g. */
function segDecoder(b: Builder, x: number, y: number, ins: Src[], name: string): { outs: Src[]; box: string } {
  const outputs = [...SEGMENTS].map((s) => ({ on: HEX_SEGMENTS.flatMap((segs, v) => (segs.includes(s) ? [v] : [])) }));
  const res = sop(b, x, y, ins, outputs);
  return { outs: res.outs, box: b.box(name, res.ids, 20) };
}

/** Seven bar-shaped bulbs. `segs` are the sources for a-g. About 140 x 220 times `scale`. */
function display(b: Builder, x: number, y: number, segs: Src[], name: string, scale = 1): string {
  const bar = (sx: number, sy: number, vertical: boolean) =>
    b.bulb(x + sx * scale, y + sy * scale, '', vertical ? { w: 20 * scale, h: 60 * scale } : { w: 60 * scale, h: 20 * scale });
  const ids = [
    bar(30, 0, false), // a
    bar(90, 20, true), // b
    bar(90, 100, true), // c
    bar(30, 160, false), // d
    bar(10, 100, true), // e
    bar(10, 20, true), // f
    bar(30, 80, false), // g
  ];
  ids.forEach((id, i) => b.wire(segs[i], id, 0));
  return b.box(name, ids, 20 * scale);
}

// ---------------------------------------------------------------- circuits

function gatesTour(): Doc {
  const b = new Builder('Logic gates');
  const A = b.sw(0, 200, 'A');
  const B = b.sw(0, 320, 'B');
  const gates: [string, 'and' | 'or' | 'xor', boolean][] = [
    ['AND', 'and', false],
    ['OR', 'or', false],
    ['XOR', 'xor', false],
    ['NAND', 'and', true],
    ['NOR', 'or', true],
    ['XNOR', 'xor', true],
  ];
  gates.forEach(([name, kind, not], i) => {
    const g = b.gate(kind, 200, i * 80, [A, B], not);
    const l = b.bulb(380, i * 80, name);
    b.wire(g, l);
  });
  const n = b.gate('buffer', 200, 500, [A], true);
  b.wire(n, b.bulb(380, 490, 'NOT A'));
  return b.finish();
}

function halfAdderDoc(): Doc {
  const b = new Builder('Half adder');
  const A = b.sw(0, 0, 'A');
  const B = b.sw(0, 100, 'B');
  const ha = halfAdder(b, 140, 0, A, B);
  b.box('Half adder', ha.ids);
  b.wire(ha.s, b.bulb(340, 0, 'Sum'));
  b.wire(ha.c, b.bulb(340, 80, 'Carry'));
  return b.finish();
}

function fullAdderDoc(): Doc {
  const b = new Builder('Full adder');
  const A = b.sw(0, 0, 'A');
  const B = b.sw(0, 100, 'B');
  const C = b.sw(0, 260, 'Cin');
  const h1 = halfAdder(b, 160, 0, A, B);
  const h2 = halfAdder(b, 360, 110, h1.s, C);
  const or = b.gate('or', 560, 200, [h2.c, h1.c]);
  b.signal(h1.s, 'S1');
  b.signal(h1.c, 'C1');
  b.signal(h2.c, 'C2');
  const hb1 = b.box('Half adder 1', h1.ids, 20);
  const hb2 = b.box('Half adder 2', h2.ids, 20);
  b.box('Full adder', [hb1, hb2, or]);
  b.wire(h2.s, b.bulb(740, 110, 'Sum'));
  b.wire(or, b.bulb(740, 200, 'Cout'));
  return b.finish();
}

/** 8-bit ripple-carry adder, or a subtractor when `subtract` (A + not B + 1). */
function rippleDoc(subtract: boolean): Doc {
  const b = new Builder(subtract ? '8-bit subtractor' : '8-bit adder');
  const rowH = 240;
  const sub = subtract ? b.sw(-420, -140, 'SUB', true) : null;
  let carry: Src = sub;
  const boxes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const y = i * rowH;
    const A = b.sw(-420, y, `A${i}`);
    const B = b.sw(-420, y + 80, `B${i}`);
    let bIn: Src = B;
    if (sub) {
      bIn = b.gate('xor', -260, y + 80, [B, sub]);
      b.signal(bIn, `~B${i}`);
    }
    const fa = fullAdder(b, 0, y, A, bIn, carry);
    b.signal(fa.c, `C${i + 1}`);
    boxes.push(b.box(`Bit ${i}`, fa.ids, 20));
    b.wire(fa.s, b.bulb(520, y + 10, subtract ? `D${i}` : `S${i}`));
    carry = fa.c;
  }
  b.box(subtract ? '8-bit subtractor' : '8-bit adder', boxes);
  b.wire(carry, b.bulb(520, 8 * rowH - 60, subtract ? 'A≥B' : 'Cout'));
  return b.finish();
}

function multiplierDoc(): Doc {
  const b = new Builder('4-bit multiplier');
  const A = [0, 1, 2, 3].map((j) => b.sw(-300, j * 200, `A${j}`));
  const B = [0, 1, 2, 3].map((j) => b.sw(-300, 820 + j * 80, `B${j}`));
  const rowBoxes: string[] = [];
  const pp0 = A.map((a, j) => b.gate('and', -100, j * 200 + 40, [a, B[0]]));
  b.wire(pp0[0], b.bulb(2100, 0, 'P0'));
  let acc: Src[] = [pp0[1], pp0[2], pp0[3], null];
  rowBoxes.push(b.box('Row 0', pp0, 20));
  for (let r = 1; r < 4; r++) {
    const x = r * 620 - 500;
    const ids: string[] = [];
    let carry: Src = null;
    const sums: Src[] = [];
    for (let j = 0; j < 4; j++) {
      const y = j * 200;
      const pp = b.gate('and', x, y + 40, [A[j], B[r]]);
      const fa = fullAdder(b, x + 130, y, pp, acc[j], carry);
      ids.push(pp, b.box(`FA ${r}.${j}`, fa.ids, 15));
      sums.push(fa.s);
      carry = fa.c;
    }
    rowBoxes.push(b.box(`Row ${r}`, ids, 20));
    b.wire(sums[0], b.bulb(2100, r * 80, `P${r}`));
    acc = [sums[1], sums[2], sums[3], carry];
  }
  acc.forEach((s, k) => b.wire(s, b.bulb(2100, (4 + k) * 80, `P${4 + k}`)));
  b.box('4-bit multiplier', rowBoxes);
  return b.finish();
}

/** Restoring division of 4-bit A by 4-bit B. */
function dividerDoc(showQ: boolean, showR: boolean, name: string): Doc {
  const b = new Builder(name);
  const A = [0, 1, 2, 3].map((j) => b.sw(-420, j * 90, `A${j}`));
  const B = [0, 1, 2, 3].map((j) => b.sw(-420, 420 + j * 90, `B${j}`));
  const nb = B.map((s, j) => {
    const g = b.gate('buffer', -260, 420 + j * 90, [s], true);
    b.signal(g, `~B${j}`);
    return g;
  });
  const invBox = b.box('Invert B', nb, 20);
  let R: Src[] = [null, null, null, null];
  const q: Src[] = [];
  const steps: string[] = [invBox];
  for (let k = 0; k < 4; k++) {
    const i = 3 - k;
    const x = k * 820;
    const ids: string[] = [];
    const s: Src[] = [A[i], R[0], R[1], R[2], R[3]];
    const t: Src[] = [];
    // Trial subtraction s - B, as s + ~B + 1.
    const t0 = b.gate('xor', x, 0, [s[0], nb[0]], true);
    const c1 = b.gate('or', x, 70, [s[0], nb[0]]);
    ids.push(t0, c1);
    t.push(t0);
    let c: Src = c1;
    for (let j = 1; j < 4; j++) {
      const fa = fullAdder(b, x, j * 170, s[j], nb[j], c);
      ids.push(...fa.ids);
      t.push(fa.s);
      c = fa.c;
    }
    const qk = b.gate('or', x + 250, 4 * 170 + 20, [s[4], c]);
    b.signal(qk, `Q${i}`);
    ids.push(qk);
    const sub = b.box('Subtract', ids, 20);
    // Keep the difference if it didn't go negative, otherwise the shifted remainder.
    const nq = b.gate('buffer', x + 420, 4 * 170 + 20, [qk], true);
    const mux: string[] = [nq];
    const next: Src[] = [];
    for (let j = 0; j < 4; j++) {
      const y = j * 170;
      const keep = b.gate('and', x + 420, y, [qk, t[j]]);
      const back = b.gate('and', x + 420, y + 60, [nq, s[j]]);
      const r = b.gate('or', x + 540, y + 30, [keep, back]);
      b.signal(r, `R${j}`);
      mux.push(keep, back, r);
      next.push(r);
    }
    const pick = b.box('Pick', mux, 20);
    steps.push(b.box(`Step ${k + 1}: bit ${i}`, [sub, pick]));
    q[i] = qk;
    R = next;
  }
  const x = 4 * 820;
  if (showQ) q.forEach((s, j) => b.wire(s, b.bulb(x, j * 80, `Q${j}`)));
  if (showR) R.forEach((s, j) => b.wire(s, b.bulb(x, (showQ ? 400 : 0) + j * 80, `R${j}`)));
  b.box(name, steps);
  return b.finish();
}

function comparatorDoc(): Doc {
  const b = new Builder('4-bit comparator');
  const A = [0, 1, 2, 3].map((j) => b.sw(0, j * 160, `A${j}`));
  const B = [0, 1, 2, 3].map((j) => b.sw(0, j * 160 + 70, `B${j}`));
  const ids: string[] = [];
  const eq = A.map((a, j) => b.gate('xor', 180, j * 160, [a, B[j]], true));
  const na = A.map((a, j) => b.gate('buffer', 180, j * 160 + 60, [a], true));
  const nb = B.map((s, j) => b.gate('buffer', 180, j * 160 + 110, [s], true));
  eq.forEach((g, j) => b.signal(g, `A${j}=B${j}`));
  ids.push(...eq, ...na, ...nb);
  const gt: string[] = [];
  const lt: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const same = eq.slice(i + 1).reverse();
    gt.push(b.gate('and', 380, (3 - i) * 130, [...same, A[i], nb[i]]));
    lt.push(b.gate('and', 380, 560 + (3 - i) * 130, [...same, na[i], B[i]]));
  }
  const all = b.gate('and', 380, 1100, [...eq].reverse());
  const G = b.gate('or', 540, 120, gt);
  const L = b.gate('or', 540, 680, lt);
  ids.push(...gt, ...lt, all, G, L);
  b.box('Compare', ids);
  b.wire(G, b.bulb(760, 130, 'A>B'));
  b.wire(all, b.bulb(760, 1100, 'A=B'));
  b.wire(L, b.bulb(760, 690, 'A<B'));
  return b.finish();
}

function srLatchDoc(): Doc {
  const b = new Builder('SR latch');
  const S = b.btn(0, 0, 'Set');
  const R = b.btn(0, 120, 'Reset');
  const qb = b.add('or', 180, 0, { not: true });
  const q = b.add('or', 180, 110, { not: true });
  b.wire(S, qb, 0);
  b.wire(q, qb, 1);
  b.wire(qb, q, 0);
  b.wire(R, q, 1);
  b.box('SR latch', [qb, q]);
  b.wire(q, b.bulb(380, 110, 'Q'));
  b.wire(qb, b.bulb(380, 0, "Q'"));
  return b.finish();
}

function memoryCellDoc(): Doc {
  const b = new Builder('Memory cell');
  const D = b.sw(0, 0, 'D');
  const W = b.btn(0, 110, 'Write');
  const l = dLatch(b, 160, 0, D, W);
  b.box('Memory cell (D latch)', l.ids);
  b.wire(l.q, b.bulb(560, 90, 'Q'));
  return b.finish();
}

function flipFlopDoc(): Doc {
  const b = new Builder('D flip-flop');
  const D = b.sw(0, 0, 'D');
  const C = b.btn(0, 150, 'Clock');
  const ff = dFlipFlop(b, 160, 0, D, C, 'D flip-flop');
  b.wire(ff.q, b.bulb(980, 90, 'Q'));
  return b.finish();
}

function registerDoc(): Doc {
  const b = new Builder('8-bit register');
  const W = b.btn(-300, -140, 'Write');
  const cells: string[] = [];
  for (let i = 0; i < 8; i++) {
    const y = i * 210;
    const D = b.sw(-300, y, `D${i}`);
    const l = dLatch(b, 0, y, D, W);
    cells.push(b.box(`Bit ${i}`, l.ids, 20));
    b.wire(l.q, b.bulb(460, y + 90, `Q${i}`));
  }
  b.box('8-bit register', cells);
  return b.finish();
}

function counterDoc(): Doc {
  const b = new Builder('4-bit counter');
  let clk: Src = b.btn(0, 150, 'Count');
  const stages: string[] = [];
  for (let i = 0; i < 4; i++) {
    const y = i * 320;
    const ff = dFlipFlop(b, 160, y, null, clk, `Bit ${i}`);
    for (const [id, pin] of ff.dPins) b.wire(ff.qb, id, pin);
    b.wire(ff.q, b.bulb(1080, y + 90, `Q${i}`));
    b.signal(ff.qb, `Q${i}'`);
    stages.push(ff.box);
    clk = ff.qb;
  }
  b.box('4-bit counter', stages);
  return b.finish();
}

function sevenSegDoc(): Doc {
  const b = new Builder('7-segment decoder');
  const X = [0, 1, 2, 3].map((j) => b.sw(-260, j * 90, `X${j}`));
  const dec = segDecoder(b, 0, 0, X, 'Hex decoder');
  display(b, 620, 300, dec.outs, 'Display', 6);
  return b.finish();
}

function threeDigitDoc(): Doc {
  const b = new Builder('3-digit display');
  const B = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => b.sw(-300, (7 - j) * 90, `B${j}`));
  const col = 460;
  const c1 = add3(b, 0, 0, [B[5], B[6], B[7], null], 'Add 3 (1)');
  const c2 = add3(b, col, 0, [B[4], c1.outs[0], c1.outs[1], c1.outs[2]], 'Add 3 (2)');
  const c3 = add3(b, 2 * col, 0, [B[3], c2.outs[0], c2.outs[1], c2.outs[2]], 'Add 3 (3)');
  const c4 = add3(b, 3 * col, 0, [B[2], c3.outs[0], c3.outs[1], c3.outs[2]], 'Add 3 (4)');
  const c5 = add3(b, 4 * col, 0, [B[1], c4.outs[0], c4.outs[1], c4.outs[2]], 'Add 3 (5)');
  const c6 = add3(b, 2 * col, 560, [c3.outs[3], c2.outs[3], c1.outs[3], null], 'Add 3 (6)');
  const c7 = add3(b, 4 * col, 560, [c4.outs[3], c6.outs[0], c6.outs[1], c6.outs[2]], 'Add 3 (7)');
  b.box('Binary to decimal', [c1.box, c2.box, c3.box, c4.box, c5.box, c6.box, c7.box]);
  const ones: Src[] = [B[0], c5.outs[0], c5.outs[1], c5.outs[2]];
  const tens: Src[] = [c5.outs[3], c7.outs[0], c7.outs[1], c7.outs[2]];
  const hundreds: Src[] = [c7.outs[3], c6.outs[3], null, null];
  ones.forEach((s, i) => b.signal(s, `1s bit ${i}`));
  tens.forEach((s, i) => b.signal(s, `10s bit ${i}`));
  hundreds.forEach((s, i) => b.signal(s, `100s bit ${i}`));
  const dx = 2800;
  const decoders = [hundreds, tens, ones].map((nib, k) => segDecoder(b, dx, k * 2000, nib, ['Hundreds', 'Tens', 'Ones'][k] + ' decoder'));
  b.box('Decoders', decoders.map((d) => d.box));
  const displays = decoders.map((d, k) => display(b, dx + 1100 + k * 1080, 2260, d.outs, ['100s', '10s', '1s'][k], 6));
  b.box('Display', displays);
  return b.finish();
}

function muxDoc(): Doc {
  const b = new Builder('4-to-1 multiplexer');
  const D = [0, 1, 2, 3].map((j) => b.sw(0, j * 90, `D${j}`));
  const S0 = b.sw(0, 420, 'S0');
  const S1 = b.sw(0, 510, 'S1');
  const n0 = b.gate('buffer', 180, 420, [S0], true);
  const n1 = b.gate('buffer', 180, 510, [S1], true);
  const sel: [Src, Src][] = [
    [n1, n0],
    [n1, S0],
    [S1, n0],
    [S1, S0],
  ];
  const ands = D.map((d, j) => b.gate('and', 340, j * 100, [d, ...sel[j]]));
  const or = b.gate('or', 500, 110, ands);
  b.box('Multiplexer', [n0, n1, ...ands, or]);
  b.wire(or, b.bulb(700, 120, 'Y'));
  return b.finish();
}

function decoderDoc(): Doc {
  const b = new Builder('2-to-4 decoder');
  const A0 = b.sw(0, 0, 'A0');
  const A1 = b.sw(0, 120, 'A1');
  const n0 = b.gate('buffer', 160, 0, [A0], true);
  const n1 = b.gate('buffer', 160, 120, [A1], true);
  const terms: [Src, Src][] = [
    [n1, n0],
    [n1, A0],
    [A1, n0],
    [A1, A0],
  ];
  const ands = terms.map((t, j) => b.gate('and', 320, j * 70, t));
  b.box('Decoder', [n0, n1, ...ands]);
  ands.forEach((g, j) => b.wire(g, b.bulb(500, j * 70, `Y${j}`)));
  return b.finish();
}

function parityDoc(): Doc {
  const b = new Builder('8-bit parity');
  const X = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => b.sw(0, j * 70, `X${j}`));
  const l1 = [0, 1, 2, 3].map((k) => b.gate('xor', 180, k * 140 + 30, [X[2 * k], X[2 * k + 1]]));
  const l2 = [0, 1].map((k) => b.gate('xor', 330, k * 280 + 100, [l1[2 * k], l1[2 * k + 1]]));
  const l3 = b.gate('xor', 480, 240, l2);
  b.box('XOR tree', [...l1, ...l2, l3]);
  b.wire(l3, b.bulb(660, 240, 'Odd'));
  return b.finish();
}

// ---------------------------------------------------------------- catalogue

export interface Example {
  id: string;
  name: string;
  build: () => Doc;
}

export interface ExampleGroup {
  name: string;
  items: Example[];
}

export const EXAMPLES: ExampleGroup[] = [
  {
    name: 'Basics',
    items: [
      { id: 'gates', name: 'Logic gates', build: gatesTour },
      { id: 'half-adder', name: 'Half adder', build: halfAdderDoc },
      { id: 'full-adder', name: 'Full adder', build: fullAdderDoc },
      { id: 'parity', name: '8-bit parity', build: parityDoc },
    ],
  },
  {
    name: 'Arithmetic',
    items: [
      { id: 'adder8', name: '8-bit adder', build: () => rippleDoc(false) },
      { id: 'sub8', name: '8-bit subtractor', build: () => rippleDoc(true) },
      { id: 'mul4', name: '4-bit multiplier', build: multiplierDoc },
      { id: 'div4', name: '4-bit divider', build: () => dividerDoc(true, true, '4-bit divider') },
      { id: 'mod4', name: '4-bit modulus', build: () => dividerDoc(false, true, '4-bit modulus') },
      { id: 'cmp4', name: '4-bit comparator', build: comparatorDoc },
    ],
  },
  {
    name: 'Memory',
    items: [
      { id: 'sr', name: 'SR latch', build: srLatchDoc },
      { id: 'cell', name: 'Memory cell', build: memoryCellDoc },
      { id: 'dff', name: 'D flip-flop', build: flipFlopDoc },
      { id: 'reg8', name: '8-bit register', build: registerDoc },
      { id: 'count4', name: '4-bit counter', build: counterDoc },
    ],
  },
  {
    name: 'Displays',
    items: [
      { id: 'seg7', name: '7-segment display', build: sevenSegDoc },
      { id: 'seg3', name: '3-digit display', build: threeDigitDoc },
    ],
  },
  {
    name: 'Routing',
    items: [
      { id: 'mux4', name: '4-to-1 multiplexer', build: muxDoc },
      { id: 'dec2', name: '2-to-4 decoder', build: decoderDoc },
    ],
  },
];
