import { Builder, sop, type Src } from './builder';
import type { Doc } from '../model/types';

/** Scripted fruit columns. Length 20, so it drifts against the row list. */
export const FRUIT_X = [13, 2, 14, 0, 11, 5, 15, 8, 3, 12, 7, 1, 10, 4, 6, 9, 15, 2, 8, 11];
/** Scripted fruit rows. Length 15, coprime with 20, so pairs repeat only every 60 eats. */
export const FRUIT_Y = [8, 2, 14, 0, 11, 5, 15, 7, 3, 12, 1, 10, 4, 13, 6];
/** Red, blue, cyan, magenta, white. Green is the body and yellow is the head. */
export const PALETTE: [number, number, number][] = [
  [1, 0, 0],
  [0, 0, 1],
  [0, 1, 1],
  [1, 0, 1],
  [1, 1, 1],
];

const SLOTS = 99;
const SEGMENTS = 'abcdefg';
const HEX = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg', 'abcefg', 'cdefg', 'adef', 'bcdeg', 'adefg', 'aefg'];

/** True when body slot `i` is on the snake. Mirrors the gate network. */
export function segmentLive(i: number, tail: number, len: number): boolean {
  const sum = tail + len;
  if (sum >= SLOTS) return i >= tail || i < sum - SLOTS;
  return i >= tail && i < sum;
}

interface FF {
  q: string;
  dNot: string;
  dAnd: string;
}

/** Gate placer plus the Boolean helpers the snake is built from. */
class Logic {
  ids: string[] = [];
  zero: Src;
  one: Src;
  private nots = new Map<string, string>();
  private x: number;
  private y: number;
  private y0: number;
  private colH: number;
  private colW = 160;

  constructor(
    private b: Builder,
    x: number,
    y: number,
    colH = 6800,
  ) {
    this.x = x;
    this.y = y;
    this.y0 = y;
    this.colH = colH;
    this.zero = null;
    this.one = null;
    this.zero = this.gate('buffer', [null]);
    this.one = this.gate('buffer', [null], true);
  }

  relocate(x: number, y: number, colH: number): void {
    this.x = x;
    this.y = y;
    this.y0 = y;
    this.colH = colH;
  }

  private slot(h: number): { x: number; y: number } {
    if (this.y + h > this.y0 + this.colH) {
      this.y = this.y0;
      this.x += this.colW;
    }
    const p = { x: this.x, y: this.y };
    this.y += h + 40;
    return p;
  }

  gate(kind: 'and' | 'or' | 'xor' | 'buffer', ins: Src[], not = false): string {
    const h = Math.max(2, ins.length) * 20;
    const p = this.slot(h);
    return this.at(kind, p.x, p.y, ins, not);
  }

  at(kind: 'and' | 'or' | 'xor' | 'buffer', x: number, y: number, ins: Src[], not = false, bag = this.ids): string {
    const id = this.b.gate(kind, x, y, ins, not);
    bag.push(id);
    return id;
  }

  not(s: Src): Src {
    if (!s) return this.one;
    if (s === this.one) return this.zero;
    if (s === this.zero) return this.one;
    let g = this.nots.get(s);
    if (!g) {
      g = this.gate('buffer', [s], true);
      this.nots.set(s, g);
    }
    return g;
  }

  and(a: Src, b: Src): Src {
    if (!a || !b) return null;
    if (a === this.one) return b;
    if (b === this.one) return a;
    return this.gate('and', [a, b]);
  }

  or(a: Src, b: Src): Src {
    if (!a) return b;
    if (!b) return a;
    if (a === this.one || b === this.one) return this.one;
    return this.gate('or', [a, b]);
  }

  xor(a: Src, b: Src): Src {
    if (!a) return b;
    if (!b) return a;
    if (a === this.one) return this.not(b);
    if (b === this.one) return this.not(a);
    return this.gate('xor', [a, b]);
  }

  andN(xs: Src[]): Src {
    const ys = xs.filter((s): s is string => !!s);
    if (ys.length !== xs.length) return null;
    if (!ys.length) return this.one;
    if (ys.length === 1) return ys[0];
    if (ys.length <= 8) return this.gate('and', ys);
    const parts: Src[] = [];
    for (let i = 0; i < ys.length; i += 8) parts.push(this.andN(ys.slice(i, i + 8)));
    return this.andN(parts);
  }

  orN(xs: Src[]): Src {
    const ys = xs.filter((s): s is string => !!s);
    if (!ys.length) return null;
    if (ys.length === 1) return ys[0];
    if (ys.length <= 8) return this.gate('or', ys);
    const parts: Src[] = [];
    for (let i = 0; i < ys.length; i += 8) parts.push(this.orN(ys.slice(i, i + 8)));
    return this.orN(parts);
  }

  mux(sel: Src, a: Src, b: Src): Src {
    if (!sel) return b;
    if (sel === this.one) return a;
    return this.or(this.and(sel, a), this.and(this.not(sel), b));
  }

  muxBus(sel: Src, a: Src[], b: Src[]): Src[] {
    const n = Math.max(a.length, b.length);
    const out: Src[] = [];
    for (let i = 0; i < n; i++) out.push(this.mux(sel, a[i] ?? null, b[i] ?? null));
    return out;
  }

  eqConst(bits: Src[], n: number, width: number): Src {
    const lits: Src[] = [];
    for (let i = 0; i < width; i++) {
      const bit = bits[i] ?? null;
      if ((n >> i) & 1) {
        if (!bit) return null;
        lits.push(bit);
      } else lits.push(this.not(bit));
    }
    return this.andN(lits);
  }

  cmpConst(bits: Src[], n: number, width: number): { gt: Src; eq: Src } {
    let gt: Src = null;
    let eq: Src = this.one;
    for (let i = width - 1; i >= 0; i--) {
      const bit = bits[i] ?? null;
      if ((n >> i) & 1) eq = this.and(eq, bit);
      else {
        gt = this.or(gt, this.and(eq, bit));
        eq = this.and(eq, this.not(bit));
      }
    }
    return { gt, eq };
  }

  geConst(bits: Src[], n: number, width: number): Src {
    const c = this.cmpConst(bits, n, width);
    return this.or(c.gt, c.eq);
  }

  addBus(a: Src[], b: Src[]): Src[] {
    let c: Src = null;
    const n = Math.max(a.length, b.length);
    const out: Src[] = [];
    for (let i = 0; i < n; i++) {
      const ai = a[i] ?? null;
      const bi = b[i] ?? null;
      const axb = this.xor(ai, bi);
      out.push(this.xor(axb, c));
      c = this.or(this.and(ai, bi), this.and(axb, c));
    }
    out.push(c);
    return out;
  }

  add1(bits: Src[]): Src[] {
    let c: Src = this.one;
    return bits.map((bit) => {
      const s = this.xor(bit, c);
      c = this.and(bit, c);
      return s;
    });
  }

  sub1(bits: Src[]): Src[] {
    let br: Src = this.one;
    return bits.map((bit) => {
      const d = this.xor(bit, br);
      br = this.and(this.not(bit), br);
      return d;
    });
  }

  subConst(bits: Src[], n: number, width: number): Src[] {
    let br: Src = null;
    const out: Src[] = [];
    for (let i = 0; i < width; i++) {
      const a = bits[i] ?? null;
      const nb: Src = (n >> i) & 1 ? this.one : null;
      const axn = this.xor(a, nb);
      out.push(this.xor(axn, br));
      const na = this.not(a);
      br = this.orN([this.and(na, nb), this.and(na, br), this.and(nb, br)]);
    }
    return out;
  }

  /** Increment, wrapping to 0 when the value equals `mod - 1`. */
  incMod(bits: Src[], mod: number): Src[] {
    const at = this.eqConst(bits, mod - 1, bits.length);
    return this.muxBus(at, bits.map(() => null), this.add1(bits));
  }

  modSub(bits: Src[], subs: number[]): Src[] {
    let cur = bits;
    for (const d of subs) {
      const ge = this.geConst(cur, d, cur.length);
      cur = this.muxBus(ge, this.subConst(cur, d, cur.length), cur);
    }
    return cur;
  }

  /**
   * Master-slave D flip-flop. The inverted slave output is created first so power-up
   * presettle holds every Q at 0 until the first rising edge.
   */
  dff(x: number, y: number, clk: Src, nclk: Src): FF {
    const master = this.latch(x, y, nclk);
    const slave = this.latch(x, y + 120, clk);
    this.b.wire(master.q, slave.dNot, 0);
    this.b.wire(master.q, slave.dAnd, 0);
    return { q: slave.q, dNot: master.dNot, dAnd: master.dAnd };
  }

  private latch(x: number, y: number, en: Src): FF {
    const dNot = this.at('buffer', x, y + 60, [null], true);
    const dAnd = this.at('and', x + 80, y, [null, en]);
    const r = this.at('and', x + 80, y + 60, [null, en]);
    this.b.wire(dNot, r, 0);
    const qb = this.b.add('or', x + 160, y, { not: true, inputs: 2 });
    const q = this.b.add('or', x + 160, y + 60, { not: true, inputs: 2 });
    this.ids.push(qb, q);
    this.b.wire(dAnd, qb, 0);
    this.b.wire(q, qb, 1);
    this.b.wire(qb, q, 0);
    this.b.wire(r, q, 1);
    return { q, dNot, dAnd };
  }

  /** D = loadInit ? init : run ? next : Q. */
  drive(ff: FF, init: boolean, next: Src, run: Src, loadInit: Src): void {
    const held = this.or(this.and(run, next), this.and(this.not(run), ff.q));
    const d = init ? this.or(loadInit, this.and(this.not(loadInit), held)) : this.and(this.not(loadInit), held);
    if (!d) return;
    this.b.wire(d, ff.dNot, 0);
    this.b.wire(d, ff.dAnd, 0);
  }

  driveBus(ffs: FF[], init: number, next: Src[], run: Src, loadInit: Src): void {
    ffs.forEach((ff, i) => this.drive(ff, !!((init >> i) & 1), next[i] ?? null, run, loadInit));
  }
}

function ramGrid(x0: number, y0: number, cols: number, pitchX: number, pitchY: number) {
  let i = 0;
  return () => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    i++;
    return { x: x0 + c * pitchX, y: y0 + r * pitchY };
  };
}

function digit(b: Builder, x: number, y: number, segs: Src[], name: string, bag: string[]): void {
  const t = 60;
  const L = 180;
  const bar = (sx: number, sy: number, vertical: boolean) => {
    const id = b.add('bulb', x + sx, y + sy, { name: '', w: vertical ? t : L, h: vertical ? L : t });
    bag.push(id);
    return id;
  };
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
    b.doc.components.get(id)!.name = `${name} ${SEGMENTS[i]}`;
  });
}

function segDecode(b: Builder, x: number, y: number, ins: Src[]): { outs: Src[]; ids: string[] } {
  const outputs = [...SEGMENTS].map((s) => ({
    on: HEX.flatMap((segs, v) => (segs.includes(s) ? [v] : [])),
    dc: [10, 11, 12, 13, 14, 15],
  }));
  const res = sop(b, x, y, ins, outputs);
  return { outs: res.outs, ids: res.ids };
}

/** Two BCD digits from a 0–99 value. Bit 0 is the least significant. */
export function bcdDigits(b: Builder, x: number, y: number, bits: Src[]): { ones: Src[]; tens: Src[]; ids: string[] } {
  const onesOn: number[][] = [[], [], [], []];
  const tensOn: number[][] = [[], [], [], []];
  const dc: number[] = [];
  for (let v = 0; v < 128; v++) {
    if (v > 99) {
      dc.push(v);
      continue;
    }
    const o = v % 10;
    const t = Math.floor(v / 10);
    for (let bit = 0; bit < 4; bit++) {
      if (o & (1 << bit)) onesOn[bit].push(v);
      if (t & (1 << bit)) tensOn[bit].push(v);
    }
  }
  const res = sop(b, x, y, bits.slice(0, 7), [...onesOn, ...tensOn].map((on) => ({ on, dc })));
  return { ones: res.outs.slice(0, 4), tens: res.outs.slice(4, 8), ids: res.ids };
}

/** Standalone score decoder, so the BCD table can be checked without the whole game. */
export function bcdDoc(): Doc {
  const b = new Builder('Score digits');
  const bits = Array.from({ length: 8 }, (_, i) => b.sw(0, i * 180, `S${i}`));
  b.box('Value', bits, 36, '#0f766e');
  const dec = bcdDigits(b, 1600, 0, bits);
  const ones = segDecode(b, 5200, 0, dec.ones);
  const tens = segDecode(b, 5200, 2200, dec.tens);
  const bag = [...dec.ids, ...ones.ids, ...tens.ids];
  digit(b, 9000, 0, ones.outs, '1s', bag);
  digit(b, 9000, 800, tens.outs, '10s', bag);
  b.box('Score', bag, 36, '#4c1d95');
  return b.finish();
}

function paint(b: Builder, x: number, y: number, name: string, key: string, bag: string[]): string {
  const id = b.add(name === 'Clock' ? 'timer' : 'button', x, y, {
    name,
    w: name === 'Clock' ? 400 : 120,
    h: name === 'Clock' ? 400 : 120,
  });
  const c = b.doc.components.get(id)!;
  if (name === 'Clock') {
    c.period = 0.5;
    c.pulse = 0.25;
  } else c.key = key;
  b.signal(id, key);
  bag.push(id);
  return id;
}

/** Orange navigation pin so players can jump between the huge layout regions. */
function mark(b: Builder, x: number, y: number, name: string, bag: string[]): void {
  const id = b.add('marker', x, y, { name });
  b.doc.components.get(id)!.color = '#e5932a';
  bag.push(id);
}

export function snakeDoc(): Doc {
  const b = new Builder('Snake');
  const inputIds: string[] = [];
  const screenX = 2000;
  const screenY = 52000;
  const cellSize = 120;
  const cellPitch = 210;
  const ix = screenX;
  const iy = screenY + 15 * cellPitch + cellSize + 600;
  mark(b, ix, iy - 200, 'Controls', inputIds);
  const right = paint(b, ix, iy, 'Right', 'K0', inputIds);
  b.doc.components.get(right)!.key = 'ArrowRight';
  const left = paint(b, ix, iy + 200, 'Left', 'K1', inputIds);
  b.doc.components.get(left)!.key = 'ArrowLeft';
  const down = paint(b, ix, iy + 400, 'Down', 'K2', inputIds);
  b.doc.components.get(down)!.key = 'ArrowDown';
  const up = paint(b, ix, iy + 600, 'Up', 'K3', inputIds);
  b.doc.components.get(up)!.key = 'ArrowUp';
  const reset = paint(b, ix, iy + 800, 'Reset', 'K4', inputIds);
  b.doc.components.get(reset)!.key = 'KeyR';
  const clock = paint(b, ix, iy + 1100, 'Clock', 'K5', inputIds);
  const L = new Logic(b, 0, 0);
  const k6 = L.gate('buffer', [null]);
  const k7 = L.gate('buffer', [null]);
  // Keep the input cable 8 lanes wide. These two zeros live with the controls.
  const z6 = b.add('buffer', ix, iy + 1600, { name: 'K6' });
  const z7 = b.add('buffer', ix, iy + 1700, { name: 'K7' });
  b.signal(z6, 'K6');
  b.signal(z7, 'K7');
  inputIds.push(z6, z7);
  b.wire(z6, k6, 0);
  b.wire(z7, k7, 0);

  const recv = (src: string) => L.gate('buffer', [src]);
  const btnR = recv(right);
  const btnL = recv(left);
  const btnD = recv(down);
  const btnU = recv(up);
  const btnReset = recv(reset);
  const clk = recv(clock);
  const nclk = L.not(clk);

  mark(b, 0, -200, 'Game logic', L.ids);
  mark(b, 0, 7800, 'Game state', L.ids);
  const cell = ramGrid(0, 8000, 8, 280, 280);
  const alloc = () => {
    const p = cell();
    return L.dff(p.x, p.y, clk, nclk);
  };
  const allocBus = (n: number) => Array.from({ length: n }, alloc);

  const dir = allocBus(2);
  const hx = allocBus(4);
  const hy = allocBus(4);
  const tail = allocBus(7);
  const len = allocBus(7);
  const step = allocBus(6);
  const fx = allocBus(4);
  const fy = allocBus(4);
  const colorIdx = allocBus(3);
  const score = allocBus(7);
  const dead = alloc();
  const booted = alloc();
  const fruitVis = alloc();
  const seek = alloc();
  const scanning = alloc();
  const tries = allocBus(6);
  const scan = allocBus(8);
  const body = Array.from({ length: SLOTS }, () => allocBus(8));

  const q = (ffs: FF[]) => ffs.map((f) => f.q as Src);
  const dirQ = q(dir);
  const hxQ = q(hx);
  const hyQ = q(hy);
  const tailQ = q(tail);
  const lenQ = q(len);
  const stepQ = q(step);
  const fxQ = q(fx);
  const fyQ = q(fy);
  const idxQ = q(colorIdx);
  const scoreQ = q(score);
  const triesQ = q(tries);
  const scanQ = q(scan);
  const bodyQ = body.map(q);

  const loadInit = L.or(L.not(booted.q), btnReset);

  const only = (a: Src, rest: Src[]) => L.andN([a, ...rest.map((s) => L.not(s))]);
  const onlyR = only(btnR, [btnL, btnU, btnD]);
  const onlyL = only(btnL, [btnR, btnU, btnD]);
  const onlyD = only(btnD, [btnR, btnL, btnU]);
  const onlyU = only(btnU, [btnR, btnL, btnD]);
  const take = L.orN([onlyR, onlyL, onlyD, onlyU]);
  // Right 00, left 01, down 10, up 11. Opposite flips the low bit.
  const want0 = L.or(onlyL, onlyU);
  const want1 = L.or(onlyD, onlyU);
  const isOpp = L.and(L.not(L.xor(want1, dirQ[1])), L.xor(want0, dirQ[0]));
  const accept = L.and(take, L.not(isOpp));
  const dirNext = [L.mux(accept, want0, dirQ[0]), L.mux(accept, want1, dirQ[1])];

  const rightOn = L.and(L.not(dirQ[1]), L.not(dirQ[0]));
  const leftOn = L.and(L.not(dirQ[1]), dirQ[0]);
  const downOn = L.and(dirQ[1], L.not(dirQ[0]));
  const upOn = L.and(dirQ[1], dirQ[0]);
  const xp = L.add1(hxQ);
  const xm = L.sub1(hxQ);
  const yp = L.add1(hyQ);
  const ym = L.sub1(hyQ);
  let nx = hxQ;
  nx = L.muxBus(leftOn, xm, nx);
  nx = L.muxBus(rightOn, xp, nx);
  let ny = hyQ;
  ny = L.muxBus(upOn, ym, ny);
  ny = L.muxBus(downOn, yp, ny);
  const wall = L.orN([
    L.and(rightOn, L.eqConst(hxQ, 15, 4)),
    L.and(leftOn, L.eqConst(hxQ, 0, 4)),
    L.and(downOn, L.eqConst(hyQ, 15, 4)),
    L.and(upOn, L.eqConst(hyQ, 0, 4)),
  ]);

  const sum = L.addBus(tailQ, lenQ);
  const wrapped = L.geConst(sum, SLOTS, 8);
  const end = L.muxBus(wrapped, L.subConst(sum, SLOTS, 8).slice(0, 7), sum.slice(0, 7));
  const sel = Array.from({ length: SLOTS }, (_, i) => L.eqConst(tailQ, i, 7));
  const tailXY: Src[] = [];
  for (let bit = 0; bit < 8; bit++) tailXY.push(L.orN(sel.map((s, i) => L.and(s, bodyQ[i][bit]))));
  const tx = tailXY.slice(0, 4);
  const ty = tailXY.slice(4, 8);

  const liveNotTail: Src[] = [];
  for (let i = 0; i < SLOTS; i++) {
    const geTail = L.not(L.cmpConst(tailQ, i, 7).gt);
    const ltLin = L.cmpConst(sum.slice(0, 7), i, 7).gt;
    const ltWrap = L.cmpConst(end, i, 7).gt;
    const live = L.mux(wrapped, L.or(geTail, ltWrap), L.and(geTail, ltLin));
    liveNotTail.push(L.and(live, L.not(sel[i])));
  }

  const eqWord = (word: Src[], x: Src[], y: Src[]) => L.andN(word.map((bit, i) => L.not(L.xor(bit, i < 4 ? x[i] : y[i - 4]))));
  const occExceptTail = (x: Src[], y: Src[]) => L.orN(liveNotTail.map((live, i) => L.and(live, eqWord(bodyQ[i], x, y))));
  const bodyHit = occExceptTail(nx, ny);

  const clear = L.andN([L.not(loadInit), L.not(dead.q), L.not(seek.q), L.not(scanning.q)]);
  const dieNow = L.and(clear, L.or(wall, bodyHit));
  const move = L.andN([clear, L.not(wall), L.not(bodyHit)]);
  const atFruit = L.andN([fruitVis.q, L.andN(nx.map((bit, i) => L.not(L.xor(bit, fxQ[i])))), L.andN(ny.map((bit, i) => L.not(L.xor(bit, fyQ[i]))))]);
  const eat = L.and(move, atFruit);
  const len99 = L.eqConst(lenQ, SLOTS, 7);
  const score99 = L.eqConst(scoreQ, SLOTS, 7);
  const grow = L.and(eat, L.not(len99));

  const ge60 = L.geConst(triesQ, 60, 6);
  const doScan = L.or(scanning.q, L.and(seek.q, ge60));
  const doScript = L.and(L.not(doScan), L.or(eat, seek.q));

  const romX = (idx: Src[]) => {
    const m = L.modSub(idx, [40, 20]);
    return [0, 1, 2, 3].map((bit) => L.orN(FRUIT_X.map((v, i) => ((v >> bit) & 1 ? L.eqConst(m, i, 6) : null))));
  };
  const romY = (idx: Src[]) => {
    const m = L.modSub(idx, [45, 30, 15]);
    return [0, 1, 2, 3].map((bit) => L.orN(FRUIT_Y.map((v, i) => ((v >> bit) & 1 ? L.eqConst(m, i, 6) : null))));
  };

  const base = L.muxBus(seek.q, stepQ, L.incMod(stepQ, 60));
  const idxs = [base];
  for (let k = 0; k < 4; k++) idxs.push(L.incMod(idxs[k], 60));
  const scriptPos = idxs.slice(0, 4).map((idx) => ({ x: romX(idx), y: romY(idx) }));
  const scanPos = [0, 1, 2, 3].map((k) => {
    let v = scanQ;
    for (let n = 0; n < k; n++) v = L.add1(v);
    return { x: v.slice(0, 4), y: v.slice(4, 8) };
  });
  const cands = scriptPos.map((p, i) => ({
    x: L.muxBus(doScan, scanPos[i].x, p.x),
    y: L.muxBus(doScan, scanPos[i].y, p.y),
    idx: idxs[i],
  }));

  const free = cands.map((c) => {
    const onTail = L.andN([0, 1, 2, 3].map((i) => L.not(L.xor(c.x[i], tx[i]))).concat([0, 1, 2, 3].map((i) => L.not(L.xor(c.y[i], ty[i])))));
    const vacate = L.andN([move, L.not(grow), onTail]);
    const isNew = L.and(move, L.andN(c.x.map((bit, i) => L.not(L.xor(bit, nx[i]))).concat(c.y.map((bit, i) => L.not(L.xor(bit, ny[i]))))));
    const blocked = L.orN([occExceptTail(c.x, c.y), L.and(onTail, L.not(vacate)), isNew]);
    return L.not(blocked);
  });
  const found = L.orN(free);
  let chosen = idxs[4];
  let chX = cands[3].x;
  let chY = cands[3].y;
  for (let i = 3; i >= 0; i--) {
    chosen = L.muxBus(free[i], cands[i].idx, chosen);
    chX = L.muxBus(free[i], cands[i].x, chX);
    chY = L.muxBus(free[i], cands[i].y, chY);
  }
  const place = L.and(found, L.or(doScript, doScan));

  const nextIdx = L.incMod(idxQ, 5);
  const showIdx = L.muxBus(eat, nextIdx, idxQ);
  const colSel = [0, 1, 2, 3, 4].map((i) => L.eqConst(showIdx, i, 3));
  const showR = L.orN([colSel[0], colSel[3], colSel[4]]);
  const showG = L.orN([colSel[2], colSel[4]]);
  const showB = L.orN([colSel[1], colSel[2], colSel[3], colSel[4]]);

  const playing = L.andN([L.not(loadInit), L.not(dead.q), L.not(dieNow), L.not(seek.q), L.not(scanning.q)]);
  L.driveBus(dir, 0, dirNext, playing, loadInit);
  L.driveBus(hx, 9, nx, move, loadInit);
  L.driveBus(hy, 8, ny, move, loadInit);
  const tailRun = L.and(move, L.not(grow));
  L.driveBus(tail, 0, L.muxBus(L.eqConst(tailQ, 98, 7), tailQ.map(() => null), L.add1(tailQ)), tailRun, loadInit);
  L.driveBus(len, 4, L.add1(lenQ), grow, loadInit);
  L.driveBus(score, 0, L.add1(scoreQ), L.and(eat, L.not(score99)), loadInit);
  L.drive(dead, false, L.or(dead.q, dieNow), L.one, loadInit);
  L.drive(booted, true, L.one, L.one, loadInit);
  L.drive(fruitVis, true, L.mux(place, L.one, L.mux(eat, null, fruitVis.q)), L.or(place, eat), loadInit);
  const nextSeek = L.andN([doScript, L.not(found), L.not(ge60)]);
  L.drive(seek, false, nextSeek, L.one, loadInit);
  const nextScanMode = L.mux(found, null, doScan);
  L.drive(scanning, false, nextScanMode, L.or(found, doScan), loadInit);
  const triesBump = L.addBus(triesQ, [null, null, L.one]).slice(0, 6);
  const four: Src[] = [null, null, L.one];
  const failedSeek = L.andN([seek.q, L.not(found), L.not(doScan)]);
  const failedEat = L.andN([doScript, L.not(seek.q), L.not(found)]);
  let triesNext = triesQ.map(() => null as Src);
  triesNext = L.muxBus(failedSeek, triesBump, triesNext);
  triesNext = L.muxBus(failedEat, four, triesNext);
  L.driveBus(tries, 0, triesNext, L.or(doScript, found), loadInit);
  let scanPlus = scanQ;
  for (let n = 0; n < 4; n++) scanPlus = L.add1(scanPlus);
  L.driveBus(scan, 0, scanPlus, L.and(doScan, L.not(found)), loadInit);
  L.driveBus(step, 0, chosen, doScript, loadInit);
  L.driveBus(fx, FRUIT_X[0], chX, place, loadInit);
  L.driveBus(fy, FRUIT_Y[0], chY, place, loadInit);
  L.driveBus(colorIdx, 0, nextIdx, eat, loadInit);

  const wsel = Array.from({ length: SLOTS }, (_, i) => L.eqConst(end, i, 7));
  const newXY = [...nx, ...ny];
  for (let i = 0; i < SLOTS; i++) {
    const init = i < 4 ? [6, 7, 8, 9][i] | (8 << 4) : 0;
    const hit = L.and(move, wsel[i]);
    const next = bodyQ[i].map((bit, b) => L.mux(hit, newXY[b], bit));
    L.driveBus(body[i], init, next, move, loadInit);
  }

  mark(b, 0, 39800, 'Pixel memory', L.ids);
  const pixAt = ramGrid(0, 40000, 48, 280, 280);
  const pix: FF[][][] = [];
  for (let y = 0; y < 16; y++) {
    pix.push([]);
    for (let x = 0; x < 16; x++) {
      pix[y].push([0, 1, 2].map(() => {
        const p = pixAt();
        return L.dff(p.x, p.y, clk, nclk);
      }));
    }
  }

  L.relocate(15000, 40000, 12000);
  const dec = (bits: Src[]) => Array.from({ length: 16 }, (_, i) => L.eqConst(bits, i, 4));
  const dxH = dec(hxQ);
  const dyH = dec(hyQ);
  const dxN = dec(nx);
  const dyN = dec(ny);
  const dxT = dec(tx);
  const dyT = dec(ty);
  const dxF = dec(chX);
  const dyF = dec(chY);
  const initPix = (x: number, y: number): [number, number, number] => {
    if (x === 9 && y === 8) return [1, 1, 0];
    if (y === 8 && x >= 6 && x <= 8) return [0, 1, 0];
    if (x === FRUIT_X[0] && y === FRUIT_Y[0]) return [1, 0, 0];
    return [0, 0, 0];
  };
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const wH = L.and(move, L.and(dxN[x], dyN[y]));
      const wO = L.and(move, L.and(dxH[x], dyH[y]));
      const wT = L.andN([move, L.not(grow), L.and(dxT[x], dyT[y])]);
      const wF = L.and(place, L.and(dxF[x], dyF[y]));
      const write = L.orN([wH, wO, wT, wF]);
      const cr = L.or(wH, L.and(wF, showR));
      const cg = L.orN([wH, wO, L.and(wF, showG)]);
      const cb = L.and(L.not(wH), L.and(wF, showB));
      const qs = pix[y][x].map((f) => f.q as Src);
      const colors = [cr, cg, cb];
      const init = initPix(x, y);
      pix[y][x].forEach((ff, bit) => {
        const next = L.mux(write, colors[bit], qs[bit]);
        L.drive(ff, !!init[bit], next, L.one, loadInit);
      });
    }
  }

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const id = b.add('rgb', screenX + x * cellPitch, screenY + y * cellPitch, {
        name: `c${x}_${y}`,
        w: cellSize,
        h: cellSize,
      });
      L.ids.push(id);
      const qs = pix[y][x];
      b.wire(qs[0].q, id, 0);
      b.wire(qs[1].q, id, 1);
      b.wire(qs[2].q, id, 2);
    }
  }
  mark(b, screenX, screenY - 200, 'Screen', L.ids);

  score.forEach((ff, i) => b.signal(ff.q, `S${i}`));
  const s7 = L.gate('buffer', [null]);
  b.signal(s7, 'S7');
  // Digits sit right of the RGB grid; BCD/segment decode continues further right.
  const scoreIds: string[] = [];
  const digX = screenX + 16 * cellPitch + 400;
  const sy = screenY;
  const digitW = 60 + 180 + 60;
  const sx = digX + digitW + 400;
  mark(b, digX, sy - 200, 'Score', scoreIds);
  const recvS = score.map((ff, i) => {
    const id = b.add('buffer', sx, sy + i * 80, {});
    scoreIds.push(id);
    b.wire(ff.q, id, 0);
    return id;
  });
  const s7b = b.add('buffer', sx, sy + 7 * 80, {});
  scoreIds.push(s7b);
  b.wire(s7, s7b, 0);
  const digits = bcdDigits(b, sx + 400, sy, [...recvS, s7b]);
  const decX = b.bounds(digits.ids).x + b.bounds(digits.ids).w + 400;
  const ones = segDecode(b, decX, sy, digits.ones);
  const tens = segDecode(b, decX, sy + 2400, digits.tens);
  scoreIds.push(...digits.ids, ...ones.ids, ...tens.ids);
  digit(b, digX, sy, ones.outs, '1s', scoreIds);
  digit(b, digX, sy + 800, tens.outs, '10s', scoreIds);

  b.box('Inputs', inputIds, 36, '#0f766e');
  b.box('Snake', L.ids, 36, '#5b4b8a');
  b.box('Score', scoreIds, 36, '#4c1d95');
  return b.finish();
}

