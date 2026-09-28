import { Builder, type Src } from './builder';
import { add3, dff, digit, fullAdder, ripple, segDecoder } from './circuits';
import type { Doc } from '../model/types';

const N = 16;
// The adder settles while the key is held, before the timer pulse. That pulse is only a few
// dozen waves wide, so these waits have to stay shorter than it or the clocks never fire.
const CAPTURE_DELAY = 4;
// Flags that choose the next number move after the result is stored, still inside that pulse.
const COMMIT_DELAY = 12;
// A flip-flop box rises above the point it is placed at, so this is the below() gap that leaves the boxes clear of each other.
const DFF_GAP = 220;

const COL = {
  face: '#1d4ed8',
  keys: '#0f766e',
  encoder: '#0369a1',
  press: '#c2410c',
  entry: '#1e3a8a',
  times: '#0891b2',
  acc: '#6d28d9',
  add: '#047857',
  mul: '#5b21b6',
  div: '#9a3412',
  signs: '#9f1239',
  memory: '#115e59',
  clear: '#475569',
  display: '#4c1d95',
  bcd: '#a16207',
  proc: '#5b4b8a',
  control: '#b45309',
  row: '#6e56cf',
};

const NOTE = {
  Keypad:
    'Type a number, press + − × or ÷, type the next number, then equals. Press equals again to repeat that sum with the same second number. The number pad matches these keys: Enter is equals, and the decimal key clears.',
  Encoder:
    'The ten digit keys become one 4-bit number, bit 0 first, plus a wire that says a digit was pressed. The four operators become a 2-bit code and a press wire.',
  'One press': 'A fast tick samples each key. Holding a key down only counts as one press, so a finger resting on a button does not repeat it.',
  Entry: 'This register is the number on the screen. A new digit, clear, memory recall, the sign key, or a finished sum writes the next value.',
  Control:
    'These gates choose the next number on the screen and when to store it. A digit, clear, the sign key, memory recall, or the saved operator can write that register.',
  'Times ten': 'Shift to multiply by eight, shift again to multiply by two, add those, then add the new digit. A digit that would pass ±32767 is ignored.',
  Accumulator: 'This is the number already entered, waiting on the left of + − × or ÷. Equals, or another operator, replaces it with the result.',
  'Add and subtract': 'One adder does both jobs. Add passes the second number through. Subtract flips every bit of it and adds one.',
  Multiply:
    'Both numbers are made positive first. Each row adds the first number, shifted, when that bit of the second number is on. The sign goes back on afterwards.',
  Divide:
    'Each stage shifts in one bit of the dividend and subtracts the divisor. The answer bit stays when the subtraction fits. The quotient is a whole number toward zero.',
  Signs:
    'Make both numbers positive, do the multiply or divide, then put the sign back. A result that does not fit, including negating −32768, clamps to ±32767 and lights overflow.',
  Memory: 'MS saves the number on the screen. MR brings it back. Clear does not forget it.',
  Clear: 'Clear sets the screen to zero. The saved operator and the memory stay as they were.',
  'Binary to decimal': 'These add-3 adders turn the 16-bit magnitude into five decimal digits, one shift at a time, from the highest bit down to the lowest.',
  Digits: 'Seven lamps make each digit. Leading zeros stay dark, except the ones place. The lamp on the left is the minus sign.',
  'Acc readout': 'The number stored in the accumulator register, shown in decimal like the main display.',
  'Acc to decimal': 'Same double-dabble path as the main display, driven from the accumulator register for the upper readout row.',
  'Op readout': 'One lamp for the saved operator: + − × or ÷. It stays lit after equals, and the next equals repeats that operation with the same second number.',
};

const KEYS = [
  ['C', '±', 'MS', 'MR'],
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '−'],
  ['0', '=', '', '+'],
];

/** Number-pad key for each calculator button that has one. */
const NUMPAD: Record<string, string> = {
  '0': 'Numpad0',
  '1': 'Numpad1',
  '2': 'Numpad2',
  '3': 'Numpad3',
  '4': 'Numpad4',
  '5': 'Numpad5',
  '6': 'Numpad6',
  '7': 'Numpad7',
  '8': 'Numpad8',
  '9': 'Numpad9',
  '+': 'NumpadAdd',
  '−': 'NumpadSubtract',
  '×': 'NumpadMultiply',
  '÷': 'NumpadDivide',
  '=': 'NumpadEnter',
  C: 'NumpadDecimal',
};

type FF = ReturnType<typeof dff>;
type Word = { bits: Src[]; ids: string[] };

function below(b: Builder, id: string, gap = 160): number {
  const r = b.bounds([id]);
  return r.y + r.h + gap;
}

function rightOf(b: Builder, ids: string[], gap = 160, fallback = 0): number {
  const real = ids.filter((id) => id && (b.doc.components.has(id) || b.doc.boxes.has(id)));
  if (!real.length) return fallback;
  const r = b.bounds(real);
  if (!Number.isFinite(r.x)) return fallback;
  return r.x + r.w + gap;
}

function bottomOf(b: Builder, ids: string[]): number {
  const r = b.bounds(ids.filter((id) => id && (b.doc.components.has(id) || b.doc.boxes.has(id))));
  return r.y + r.h;
}

function annotate(b: Builder, ids: string[], title: string, text: string, color: string): string {
  const r = b.bounds(ids);
  const marker = b.add('marker', r.x, r.y - 360, { name: title });
  b.doc.components.get(marker)!.color = color;
  const note = b.add('note', r.x, r.y - 280, { name: text, w: 400, h: 200 });
  return b.box(title, [...ids, marker, note], 36, color);
}

function noteOnly(b: Builder, x: number, y: number, title: string, text: string, color: string): string {
  const marker = b.add('marker', x, y, { name: title });
  b.doc.components.get(marker)!.color = color;
  const note = b.add('note', x, y + 80, { name: text, w: 400, h: 200 });
  return b.box(title, [marker, note], 28, color);
}

function taps(b: Builder, x: number, y: number, prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => b.add('buffer', x, y + i * 120, { inputs: 1, name: `${prefix}${i}` }));
}

function orGate(b: Builder, x: number, y: number, ins: Src[]): Src {
  const used = ins.filter((s): s is string => !!s);
  if (used.length === 0) return null;
  if (used.length === 1) return used[0];
  return b.gate('or', x, y, used);
}

function andGate(b: Builder, x: number, y: number, ins: Src[]): Src {
  if (ins.some((s) => !s)) return null;
  if (ins.length === 1) return ins[0];
  return b.gate('and', x, y, ins);
}

function muxWord(b: Builder, x: number, y: number, sel: Src, d0: Src[], d1: Src[]): Word {
  if (!sel) return { bits: d0.slice(), ids: [] };
  const nsel = b.gate('buffer', x, y, [sel], true);
  const ids = [nsel];
  const bits: Src[] = [];
  for (let i = 0; i < d0.length; i++) {
    const yy = y + 100 + i * 150;
    const a = b.gate('and', x + 300, yy, [nsel, d0[i] ?? null]);
    const c = b.gate('and', x + 560, yy, [sel, d1[i] ?? null]);
    const o = b.gate('or', x + 820, yy, [a, c]);
    ids.push(a, c, o);
    bits.push(o);
  }
  return { bits, ids };
}

function muxBit(b: Builder, x: number, y: number, sel: Src, d0: Src, d1: Src): { o: Src; ids: string[] } {
  if (!sel) return { o: d0, ids: [] };
  const nsel = b.gate('buffer', x, y, [sel], true);
  const a = b.gate('and', x + 240, y + 80, [nsel, d0]);
  const c = b.gate('and', x + 480, y + 80, [sel, d1]);
  const o = b.gate('or', x + 720, y + 80, [a, c]);
  return { o, ids: [nsel, a, c, o] };
}

function delaySrc(b: Builder, src: Src, n: number, x: number, y: number): { out: Src; ids: string[] } {
  const ids: string[] = [];
  let s = src;
  const rows = 16;
  const pitch = 50;
  for (let i = 0; i < n; i++) {
    if (!s) break;
    const id = b.gate('buffer', x + Math.floor(i / rows) * pitch, y + (i % rows) * pitch, [s]);
    ids.push(id);
    s = id;
  }
  return { out: ids.length ? ids[ids.length - 1] : src, ids };
}

function copyWord(b: Builder, x: number, y: number, bits: Src[]): Word {
  const ids: string[] = [];
  const out = bits.map((bit, i) => {
    const id = b.gate('buffer', x, y + i * 100, [bit]);
    ids.push(id);
    return id as Src;
  });
  return { bits: out, ids };
}

function drive(b: Builder, ffs: FF[], bits: Src[]): void {
  ffs.forEach((ff, i) => {
    for (const [id, pin] of ff.dPins) b.wire(bits[i] ?? null, id, pin);
  });
}

function register(b: Builder, x: number, y: number, clk: Src, n = N): { ffs: FF[]; q: Src[]; boxes: string[] } {
  const ffs: FF[] = [];
  let yy = y;
  for (let i = 0; i < n; i++) {
    const ff = dff(b, x, yy, null, clk);
    ffs.push(ff);
    yy = below(b, ff.box, DFF_GAP);
  }
  return { ffs, q: ffs.map((ff) => ff.q), boxes: ffs.map((ff) => ff.box) };
}

function negateWord(b: Builder, x: number, y: number, bits: Src[]): Word {
  const inv = bits.map((s, i) => b.gate('buffer', x, y + i * 90, [s], true));
  const one = b.gate('buffer', x, y + bits.length * 90 + 60, [null], true);
  const sum = ripple(b, rightOf(b, [...inv, one], 200, x + 400), y, inv, Array(bits.length).fill(null), one);
  return { bits: sum.sums, ids: [...inv, one, ...sum.boxes] };
}

function absolute(b: Builder, x: number, y: number, bits: Src[]): { mag: Src[]; neg: Src[]; ids: string[] } {
  const neg = negateWord(b, x, y, bits);
  const mux = muxWord(b, rightOf(b, neg.ids, 200, x + 1600), y, bits[N - 1] ?? null, bits, neg.bits);
  return { mag: mux.bits, neg: neg.bits, ids: [...neg.ids, ...mux.ids] };
}

function clampWord(b: Builder, x: number, y: number, bits: Src[], sign: Src, ovf: Src): Word {
  const nsign = b.gate('buffer', x, y, [sign], true);
  const one = b.gate('buffer', x, y + 140, [null], true);
  const rail: Src[] = [];
  for (let i = 0; i < N; i++) rail.push(i === N - 1 ? sign : i === 0 ? one : nsign);
  const mux = muxWord(b, x, y + 280, ovf, bits, rail);
  return { bits: mux.bits, ids: [nsign, one, ...mux.ids] };
}

function multiply(b: Builder, x: number, y: number, a: Src[], bb: Src[]): { bits: Src[]; boxes: string[] } {
  const pp0 = a.map((bit, j) => b.gate('and', x, y + j * 280, [bit, bb[0] ?? null]));
  let acc: Src[] = [...pp0.slice(1), null];
  const p: Src[] = [pp0[0]];
  const rows = [b.box('Row 0', pp0, 24, COL.row)];
  let cx = rightOf(b, [rows[0]], 160);
  for (let r = 1; r < N; r++) {
    const ids: string[] = [];
    let carry: Src = null;
    const sums: Src[] = [];
    let yy = y;
    for (let j = 0; j < N; j++) {
      const pp = b.gate('and', cx, yy + 80, [a[j] ?? null, bb[r] ?? null]);
      const fa = fullAdder(b, cx + 240, yy, pp, acc[j] ?? null, carry);
      ids.push(pp, fa.box);
      sums.push(fa.s);
      carry = fa.c;
      yy = below(b, fa.box, 160);
    }
    rows.push(b.box(`Row ${r}`, ids, 24, COL.row));
    p.push(sums[0]);
    acc = [...sums.slice(1), carry];
    cx = rightOf(b, [rows[rows.length - 1]], 160);
  }
  p.push(...acc);
  return { bits: p, boxes: rows };
}

function divide(b: Builder, x: number, y: number, a: Src[], bb: Src[]): { bits: Src[]; boxes: string[] } {
  const nb = bb.map((s, j) => b.gate('buffer', x, y + j * 100, [s], true));
  const inv = b.box('Invert divisor', nb, 24, COL.div);
  let rem: Src[] = Array(N).fill(null);
  const q: Src[] = Array(N).fill(null);
  const steps = [inv];
  let cx = rightOf(b, [inv], 200);
  for (let k = 0; k < N; k++) {
    const bit = N - 1 - k;
    const s: Src[] = [a[bit] ?? null, ...rem];
    const t0 = b.gate('xor', cx, y, [s[0], nb[0]], true);
    const c1 = b.gate('or', cx, y + 180, [s[0], nb[0]]);
    const ids = [t0, c1];
    const diff: Src[] = [t0];
    let c: Src = c1;
    let yy = y + 420;
    for (let j = 1; j < N; j++) {
      const fa = fullAdder(b, cx, yy, s[j] ?? null, nb[j], c);
      ids.push(fa.box);
      diff.push(fa.s);
      c = fa.c;
      yy = below(b, fa.box, 160);
    }
    const qk = b.gate('or', cx + 120, yy, [s[N] ?? null, c]);
    ids.push(qk);
    const sub = b.box('Subtract', ids, 24, COL.row);
    const mx = rightOf(b, [sub], 160);
    const nq = b.gate('buffer', mx, y, [qk], true);
    const mux = [nq];
    const next: Src[] = [];
    for (let j = 0; j < N; j++) {
      const row = y + j * 220;
      const keep = b.gate('and', mx, row + 100, [qk, diff[j]]);
      const back = b.gate('and', mx + 260, row + 100, [nq, s[j] ?? null]);
      const r = b.gate('or', mx + 520, row + 100, [keep, back]);
      mux.push(keep, back, r);
      next.push(r);
    }
    steps.push(b.box('Divide stage', [sub, ...mux], 24, COL.div));
    q[bit] = qk;
    rem = next;
    cx = rightOf(b, [steps[steps.length - 1]], 200);
  }
  return { bits: q, boxes: steps };
}

/** Add 3 before each shift, skipping a digit that is still zero. Bit 0 of the magnitude is the ones bit. */
function doubleDabble(b: Builder, x: number, y: number, mag: Src[]): { digits: Src[][]; ids: string[] } {
  let nibbles: Src[][] = Array.from({ length: 5 }, () => [null, null, null, null]);
  const ids: string[] = [];
  let cx = x;
  for (let bit = N - 1; bit >= 0; bit--) {
    const added: Src[][] = [];
    const col: string[] = [];
    let yy = y;
    for (let d = 0; d < 4; d++) {
      if (nibbles[d].every((s) => !s)) {
        added.push([null, null, null, null]);
        continue;
      }
      const cell = add3(b, cx, yy, nibbles[d]);
      col.push(cell.box);
      ids.push(cell.box);
      added.push(cell.outs);
      yy = below(b, cell.box, 80);
    }
    const top = nibbles[4];
    nibbles = [
      [mag[bit] ?? null, added[0][0], added[0][1], added[0][2]],
      [added[0][3], added[1][0], added[1][1], added[1][2]],
      [added[1][3], added[2][0], added[2][1], added[2][2]],
      [added[2][3], added[3][0], added[3][1], added[3][2]],
      [added[3][3], top[0], top[1], top[2]],
    ];
    if (col.length) cx = rightOf(b, col, 80, cx);
  }
  return { digits: nibbles, ids };
}

function multiplyOverflow(b: Builder, x: number, y: number, mag: Src[], sign: Src): { bits: Src[]; ovf: Src; ids: string[] } {
  const hi = orGate(b, x, y, mag.slice(N));
  const low15 = orGate(b, x, y + 420, mag.slice(0, N - 1));
  const notHi = b.gate('buffer', x + 420, y, [hi], true);
  const notLow = b.gate('buffer', x + 420, y + 420, [low15], true);
  const exactly = andGate(b, x + 720, y, [mag[N - 1], notLow, notHi]);
  // A new gate, so a short magnitude cannot pull an existing bit into this box.
  const tooBig = b.gate('or', x + 720, y + 220, [hi, mag[N - 1] ?? null]);
  const fitsNeg = andGate(b, x + 720, y + 640, [exactly, sign]);
  const notFit = b.gate('buffer', x + 1100, y + 640, [fitsNeg], true);
  const ovf = andGate(b, x + 1400, y, [tooBig, notFit]);
  const neg = negateWord(b, x, y + 900, mag.slice(0, N));
  const signed = muxWord(b, rightOf(b, neg.ids, 160, x + 1800), y + 900, sign, mag.slice(0, N), neg.bits);
  const clamped = clampWord(b, rightOf(b, signed.ids, 160, x + 3200), y + 900, signed.bits, sign, ovf);
  const ids = [notHi, notLow, notFit, ...neg.ids, ...signed.ids, ...clamped.ids];
  for (const g of [hi, low15, exactly, tooBig, fitsNeg, ovf]) if (g) ids.push(g);
  return { bits: clamped.bits, ovf, ids };
}

function shiftLeft(bits: Src[], by: number): Src[] {
  return Array.from({ length: N }, (_, i) => (i < by ? null : (bits[i - by] ?? null)));
}

function timesTen(b: Builder, x: number, y: number, entry: Src[], digit: Src[]): {
  ids: string[];
  appended: Src[];
  tooBig: Src;
  flipped: Src[];
  isMin: Src;
} {
  const neg = negateWord(b, x, y, entry);
  let cx = rightOf(b, neg.ids, 200, x + 1600);
  const mag = muxWord(b, cx, y, entry[N - 1], entry, neg.bits);
  cx = rightOf(b, mag.ids, 200, cx + 1200);
  const x2 = shiftLeft(mag.bits, 1);
  const x8 = shiftLeft(mag.bits, 3);
  const lost2 = b.gate('buffer', cx, y, [mag.bits[N - 1] ?? null]);
  const lost8 = b.gate('or', cx, y + 180, mag.bits.slice(N - 3));
  cx += 500;
  const sum = ripple(b, cx, y, x8, x2, null);
  cx = rightOf(b, sum.boxes, 200, cx + 1600);
  const dig = [...digit, ...Array(N - 4).fill(null)];
  const added = ripple(b, cx, y, sum.sums, dig, null);
  cx = rightOf(b, added.boxes, 200, cx + 1600);
  const tooBig = orGate(b, cx, y, [lost2, lost8, sum.cout, added.cout, added.sums[N - 1], mag.bits[N - 1]]);
  const reNeg = negateWord(b, cx, y + 500, added.sums);
  const appended = muxWord(b, rightOf(b, reNeg.ids, 160, cx + 1600), y + 500, entry[N - 1], added.sums, reNeg.bits);
  const low = orGate(b, x, bottomOf(b, neg.ids) + 80, entry.slice(0, N - 1));
  const nlow = b.gate('buffer', x + 400, bottomOf(b, neg.ids) + 80, [low], true);
  const isMin = andGate(b, x + 700, bottomOf(b, neg.ids) + 80, [entry[N - 1], nlow]);
  const one = b.gate('buffer', x + 700, bottomOf(b, neg.ids) + 240, [null], true);
  const pos: Src[] = Array.from({ length: N }, (_, i) => (i === N - 1 ? null : one));
  const flipped = muxWord(b, x + 1100, bottomOf(b, neg.ids) + 80, isMin, neg.bits, pos);
  const ids = [...neg.ids, ...mag.ids, ...sum.boxes, ...added.boxes, ...reNeg.ids, ...appended.ids, nlow, one, ...flipped.ids];
  ids.push(lost2, lost8);
  for (const g of [tooBig, low, isMin]) if (g) ids.push(g);
  return { ids, appended: appended.bits, tooBig, flipped: flipped.bits, isMin };
}

function addSub(b: Builder, x: number, y: number, acc: Src[], entry: Src[], op0: Src, op1: Src): {
  ids: string[];
  bits: Src[];
  ovf: Src;
} {
  const n1 = b.gate('buffer', x, y, [op1], true);
  const sub = b.gate('and', x + 240, y, [op0, n1]);
  const inv = entry.map((s, i) => b.gate('buffer', x, y + 200 + i * 90, [s], true));
  const picked = muxWord(b, x + 900, y, sub, entry, inv);
  const sum = ripple(b, x + 2300, y, acc, picked.bits, sub);
  const oy = y + 2800;
  const same = b.gate('xor', x, oy, [acc[N - 1], entry[N - 1]], true);
  const differ = b.gate('xor', x + 280, oy, [acc[N - 1], entry[N - 1]]);
  const flipped = b.gate('xor', x + 560, oy, [sum.sums[N - 1], acc[N - 1]]);
  const addOvf = b.gate('and', x, oy + 200, [same, flipped]);
  const subOvf = b.gate('and', x + 280, oy + 200, [differ, flipped]);
  const ovf = muxBit(b, x + 560, oy + 200, sub, addOvf, subOvf);
  const clamped = clampWord(b, rightOf(b, sum.boxes, 240, x + 4000), y, sum.sums, acc[N - 1], ovf.o);
  return {
    ids: [n1, sub, ...inv, ...picked.ids, ...sum.boxes, same, differ, flipped, addOvf, subOvf, ...ovf.ids, ...clamped.ids],
    bits: clamped.bits,
    ovf: ovf.o,
  };
}

interface Face {
  box: string;
  k: string[];
  v: string[];
  /** Segment drivers for the accumulator row (5×7), wired from processing. */
  accSeg: string[];
  accMinus: string;
  op0: string;
  op1: string;
  /** High while an operator is waiting, including after equals. */
  opShow: string;
}

function flattenSegs(shown: Src[][]): Src[] {
  const out: Src[] = [];
  for (const digit of shown) {
    for (const s of digit) out.push(s);
  }
  return out;
}

function signedDecimalDisplay(b: Builder, signed: Src[], cx: number, y: number, bag: string[]): { shown: Src[][]; sign: Src } {
  const mag = absolute(b, rightOf(b, signed.filter(Boolean) as string[], 240, cx + 400), y, signed);
  const dabble = doubleDabble(b, rightOf(b, mag.ids, 240, cx + 1200), y, mag.mag);
  bag.push(...mag.ids, ...dabble.ids);
  const fromHigh = [...dabble.digits].reverse();
  const decIds: string[] = [];
  const { shown } = maskedDigitRow(b, rightOf(b, dabble.ids, 240, cx + 2200), y, fromHigh, decIds);
  bag.push(...decIds);
  return { shown, sign: signed[N - 1] };
}

function maskedDigitRow(b: Builder, cx: number, y: number, fromHigh: Src[][], decIds: string[]): { shown: Src[][]; right: number } {
  const shown: Src[][] = [];
  let higher: Src = null;
  for (let i = 0; i < 5; i++) {
    const dec = segDecoder(b, cx, y, fromHigh[i]);
    decIds.push(dec.box);
    if (i === 4) {
      const bx = rightOf(b, [dec.box], 80);
      const segs = dec.outs.map((s, bit) => {
        const g = b.gate('buffer', bx + 700, y + 600 + bit * 90, [s]);
        decIds.push(g);
        return g as Src;
      });
      shown.push(segs);
      cx = rightOf(b, segs.filter((s): s is string => !!s), 200);
    } else {
      const bx = rightOf(b, [dec.box], 80);
      const nz = orGate(b, bx, y, fromHigh[i]);
      const show = orGate(b, bx, y + 240, [nz, higher]);
      higher = show;
      const ids: string[] = [];
      const segs = dec.outs.map((s, bit) => {
        if (!show) return null;
        const g = b.gate('and', bx + 420, y + bit * 90, [s, show]);
        ids.push(g);
        return g as Src;
      });
      if (nz) decIds.push(nz);
      if (show && show !== nz) decIds.push(show);
      decIds.push(...ids);
      shown.push(segs);
      cx = rightOf(b, [dec.box, ...ids], 200);
    }
  }
  return { shown, right: cx };
}

function buildFace(b: Builder): Face {
  const v = taps(b, 0, 0, 'V', N + 1);
  const signed = v.slice(0, N);
  const bcdParts = [...v];
  const places = ['10000s', '1000s', '100s', '10s', '1s'];
  const accPlaces = places.map((p) => `Acc ${p}`);
  const decY = 0;
  const cx = rightOf(b, bcdParts, 240);
  const { shown } = signedDecimalDisplay(b, signed, cx, decY, bcdParts);
  const bcd = annotate(b, bcdParts, 'Binary to decimal', NOTE['Binary to decimal'], COL.bcd);

  // The accumulator readout, with its note, sits in the gap under the converter.
  const bcdBottom = bottomOf(b, [bcd]);
  const keyY = bcdBottom + 1880;
  const clear = noteOnly(b, 0, keyY, 'Clear', NOTE.Clear, COL.clear);
  const keyX = rightOf(b, [clear], 200);
  const buttons = new Map<string, string>();
  const keyIds: string[] = [];
  KEYS.forEach((row, r) => {
    row.forEach((name, c) => {
      if (!name) return;
      const id = b.btn(keyX + c * 200, keyY + r * 200, name);
      const code = NUMPAD[name];
      if (code) b.doc.components.get(id)!.key = code;
      buttons.set(name, id);
      keyIds.push(id);
    });
  });
  const keypad = annotate(b, keyIds, 'Keypad', NOTE.Keypad, COL.keys);

  let sx = rightOf(b, [keypad], 200);
  const minus = b.bulb(sx, keyY + 220, 'Minus', { w: 80, h: 80 });
  b.wire(signed[N - 1], minus);
  sx += 220;
  const digitStartX = sx;

  const digitBoxes = places.map((name, i) => {
    const id = digit(b, sx, keyY, shown[i], name, { title: '' });
    sx = rightOf(b, [id], 80, sx + 400);
    return id;
  });
  const overflow = b.bulb(sx, keyY + 200, 'Overflow', { w: 150, h: 80 });
  b.wire(v[N], overflow);
  const digits = annotate(b, [minus, ...digitBoxes, overflow], 'Digits', NOTE.Digits, COL.display);

  const accY = bcdBottom + 760;
  const accSeg: string[] = [];
  const accGroups: Src[][] = [];
  const tapPitch = 40;
  const tapX = digitStartX - 400;
  for (let i = 0; i < 5; i++) {
    const segs: Src[] = [];
    for (let j = 0; j < 7; j++) {
      const tap = b.add('buffer', tapX + i * 50, accY + j * tapPitch, { inputs: 1, name: `AccSeg${i}${j}` });
      accSeg.push(tap);
      segs.push(tap);
    }
    accGroups.push(segs);
  }
  const accMinus = b.add('buffer', tapX + 5 * 50, accY, { inputs: 1, name: 'AccMinusIn' });
  const accMinusBulb = b.bulb(digitStartX, accY + 80, 'Acc Minus', { w: 60, h: 60 });
  b.wire(accMinus, accMinusBulb);
  let ax = digitStartX + 160;
  const accDigitBoxes = accPlaces.map((name, i) => {
    const id = digit(b, ax, accY, accGroups[i], name, { scale: 0.72, title: '' });
    ax = rightOf(b, [id], 60, ax + 280);
    return id;
  });
  const accReadout = annotate(b, [accMinus, accMinusBulb, ...accSeg, ...accDigitBoxes], 'Acc readout', NOTE['Acc readout'], COL.acc);

  const opX = Math.max(rightOf(b, [digits], 360), rightOf(b, [accReadout], 360));
  const op0In = b.add('buffer', opX, keyY, { inputs: 1, name: 'Op0In' });
  const op1In = b.add('buffer', opX, keyY + 120, { inputs: 1, name: 'Op1In' });
  const opShowIn = b.add('buffer', opX, keyY + 240, { inputs: 1, name: 'OpShowIn' });
  // Pins face the buffers on the left, so the operator names sit in the gap before the decoder.
  const lampX = opX + 460;
  const n0 = b.gate('buffer', lampX + 360, keyY, [op0In], true);
  const n1 = b.gate('buffer', lampX + 360, keyY + 280, [op1In], true);
  const plus = b.gate('and', lampX + 700, keyY, [n0, n1, opShowIn]);
  const minusOp = b.gate('and', lampX + 700, keyY + 240, [op0In, n1, opShowIn]);
  const times = b.gate('and', lampX + 700, keyY + 480, [n0, op1In, opShowIn]);
  const div = b.gate('and', lampX + 700, keyY + 720, [op0In, op1In, opShowIn]);
  const opLogic = [n0, n1, plus, minusOp, times, div];
  const opLamps = (
    [
      ['+', plus, COL.add],
      ['−', minusOp, COL.signs],
      ['×', times, COL.mul],
      ['÷', div, COL.div],
    ] as const
  ).map(([name, src, color], i) => {
    const id = b.bulb(lampX, keyY + i * 200, name, { w: 100, h: 100 });
    b.doc.components.get(id)!.color = color;
    b.wire(src, id);
    return id;
  });
  const opReadout = annotate(b, [op0In, op1In, opShowIn, ...opLogic, ...opLamps], 'Op readout', NOTE['Op readout'], COL.control);

  const ex = rightOf(b, [opReadout], 240);
  const digitKeys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => buttons.get(n)!);
  const masks = [
    [1, 3, 5, 7, 9],
    [2, 3, 6, 7],
    [4, 5, 6, 7],
    [8, 9],
  ];
  const enc: string[] = [];
  const bit = masks.map((mask, i) => {
    const g = orGate(b, ex, keyY + i * 240, mask.map((n) => digitKeys[n]))!;
    enc.push(g);
    return g;
  });
  const digLevel = orGate(b, ex + 460, keyY, digitKeys)!;
  const opLevel = orGate(b, ex + 460, keyY + 320, ['+', '−', '×', '÷'].map((n) => buttons.get(n)!))!;
  const op0 = orGate(b, ex + 460, keyY + 640, [buttons.get('−')!, buttons.get('÷')!])!;
  const op1 = orGate(b, ex + 460, keyY + 960, [buttons.get('×')!, buttons.get('÷')!])!;
  enc.push(digLevel, opLevel, op0, op1);
  const encoder = annotate(b, enc, 'Encoder', NOTE.Encoder, COL.encoder);

  const k = taps(b, rightOf(b, [encoder], 240), keyY, 'K', 13);
  const roots: Src[] = [bit[0], bit[1], bit[2], bit[3], digLevel, op0, op1, opLevel, buttons.get('C')!, buttons.get('±')!, buttons.get('MS')!, buttons.get('MR')!, buttons.get('=')!];
  roots.forEach((src, i) => {
    b.signal(src, `K${i}`);
    b.wire(src, k[i], 0);
  });

  const face = b.box('Calculator', [bcd, accReadout, opReadout, digits, clear, keypad, encoder, ...k], 48, COL.face);
  return { box: face, k, v, accSeg, accMinus, op0: op0In, op1: op1In, opShow: opShowIn };
}

interface ProcFace {
  box: string;
  v: string[];
  accSegs: Src[];
  accSign: Src;
  op0: Src;
  op1: Src;
  opShow: Src;
}

function buildProcessing(b: Builder, originX: number, faceK: string[]): ProcFace {
  const y0 = 0;
  const k = taps(b, originX, y0, 'K', 13);
  const v = taps(b, originX + 300, y0, 'V', N + 1);
  const level = k.map((id) => id as Src);

  const pressX = rightOf(b, [...k, ...v], 280);
  const timer = b.add('timer', pressX, y0, { name: 'Tick', w: 120, h: 120 });
  const tick = b.doc.components.get(timer)!;
  tick.period = 0.05;
  tick.pulse = 0.02;
  const pulseIds = [timer];
  const pulse: Src[] = [];
  let py = y0 + 320;
  for (const index of [4, 7, 8, 9, 10, 11, 12]) {
    const a = dff(b, pressX, py, level[index], timer);
    const c = dff(b, rightOf(b, [a.box], 100), py, a.q, timer);
    const px = rightOf(b, [c.box], 100);
    const nq = b.gate('buffer', px, py, [c.q], true);
    const p = b.gate('and', px, py + 180, [a.q, nq]);
    pulseIds.push(a.box, c.box, nq, p);
    pulse.push(p);
    py = below(b, a.box, DFF_GAP);
  }
  const onePress = annotate(b, pulseIds, 'One press', NOTE['One press'], COL.press);
  const [digP, opP, clrP, signP, msP, mrP, eqP] = pulse;

  // Ids first: the registers clock these. They are seated once the row above has a height.
  const clocks = ['Entry clock', 'Accumulator clock', 'Memory clock', 'Fresh clock', 'Pending clock', 'Operator clock', 'Overflow clock'].map((name) =>
    b.add('buffer', originX, y0 - 8000, { inputs: 1, name }),
  );
  const [entryClk, accClk, memClk, freshClk, pendClk, opClk, ovfClk] = clocks;

  const entryX = rightOf(b, [onePress], 320);
  const entry = register(b, entryX, y0, entryClk);
  entry.q.forEach((q, i) => {
    b.signal(q, `V${i}`);
    b.wire(q, v[i], 0);
  });
  // Each copy leaves the register toward one section, so the buses stay cables.
  let fanX = rightOf(b, entry.boxes, 200);
  const fan = (bits: Src[]) => {
    const word = copyWord(b, fanX, y0, bits);
    fanX = rightOf(b, word.ids, 160);
    return word;
  };
  const forTen = fan(entry.q);
  const forMem = fan(entry.q);
  const forCtrl = fan(entry.q);
  const entryIds = [...entry.boxes, ...forTen.ids, ...forMem.ids, ...forCtrl.ids];

  const time = timesTen(b, fanX + 200, y0, forTen.bits, level.slice(0, 4));
  const times = annotate(b, time.ids, 'Times ten', NOTE['Times ten'], COL.times);
  const acc = register(b, rightOf(b, [times], 320), y0, accClk);
  const accBox = annotate(b, acc.boxes, 'Accumulator', NOTE.Accumulator, COL.acc);
  const mem = register(b, rightOf(b, [accBox], 320), y0, memClk);
  const memBox = annotate(b, mem.boxes, 'Memory', NOTE.Memory, COL.memory);
  drive(b, mem.ffs, forMem.bits);

  const rowBottom = Math.max(bottomOf(b, [onePress]), bottomOf(b, entry.boxes), bottomOf(b, [times]), bottomOf(b, [accBox]), bottomOf(b, [memBox]));
  const ctrlX = originX;
  const ctrlY = rowBottom + 1200;
  // Spread across, above this box, so the ribbon on its top edge stays in bit order.
  const kOrder = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12];
  const kLocal = level.slice();
  kOrder.forEach((i, n) => {
    kLocal[i] = b.gate('buffer', ctrlX + n * 100, rowBottom + 280, [level[i]]);
  });
  const flagX = ctrlX;
  clocks.forEach((id, i) => {
    const c = b.doc.components.get(id)!;
    c.x = flagX;
    c.y = ctrlY + i * 200;
  });
  let fy = ctrlY + clocks.length * 200 + 160;
  const fresh = dff(b, flagX, fy, null, freshClk);
  fy = below(b, fresh.box, DFF_GAP);
  const pending = dff(b, flagX, fy, null, pendClk);
  fy = below(b, pending.box, DFF_GAP);
  const op0ff = dff(b, flagX, fy, null, opClk);
  fy = below(b, op0ff.box, DFF_GAP);
  const op1ff = dff(b, flagX, fy, null, opClk);
  fy = below(b, op1ff.box, DFF_GAP);
  const ovf = dff(b, flagX, fy, null, ovfClk);
  fy = below(b, ovf.box, DFF_GAP);
  const doneClk = b.add('buffer', flagX, fy, { inputs: 1, name: 'Done clock' });
  const done = dff(b, flagX + 420, fy, null, doneClk);
  fy = below(b, done.box, DFF_GAP);
  const repeatClk = b.add('buffer', flagX, fy, { inputs: 1, name: 'Repeat clock' });
  const repeating = dff(b, flagX + 420, fy, null, repeatClk);
  fy = below(b, repeating.box, DFF_GAP);
  const saveEntryClk = b.add('buffer', flagX, fy, { inputs: 1, name: 'Saved entry clock' });
  const savedEntry = register(b, flagX + 420, fy, saveEntryClk);
  fy = bottomOf(b, savedEntry.boxes) + DFF_GAP;
  const postEqClk = b.add('buffer', flagX, fy, { inputs: 1, name: 'Post-equals clock' });
  const postEq = dff(b, flagX + 420, fy, null, postEqClk);
  fy = below(b, postEq.box, DFF_GAP);
  const opSinceEqClk = b.add('buffer', flagX, fy, { inputs: 1, name: 'Op since equals clock' });
  const opSinceEq = dff(b, flagX + 420, fy, null, opSinceEqClk);
  fy = below(b, opSinceEq.box, DFF_GAP);
  const notOpSinceEqAlu = b.gate('buffer', flagX, fy, [opSinceEq.q], true);
  const repeatSel = andGate(b, flagX + 280, fy, [repeating.q, notOpSinceEqAlu]);
  const aluEntry = muxWord(b, flagX + 700, fy, repeatSel, entry.q, savedEntry.q);
  const copyX = rightOf(b, aluEntry.ids, 200, flagX + 2200);
  const forAdd = copyWord(b, copyX, fy, aluEntry.bits);
  const forSign = copyWord(b, rightOf(b, forAdd.ids, 160, copyX + 400), fy, aluEntry.bits);
  const aluEntryIds = [
    ...forAdd.ids,
    ...forSign.ids,
    ...aluEntry.ids,
    notOpSinceEqAlu,
    ...(repeatSel ? [repeatSel] : []),
  ];
  const flagBoxes = [
    fresh.box,
    pending.box,
    op0ff.box,
    op1ff.box,
    ovf.box,
    done.box,
    repeating.box,
    ...savedEntry.boxes,
    postEq.box,
    opSinceEq.box,
  ];
  b.signal(ovf.q, 'V16');
  b.wire(ovf.q, v[N], 0);

  // Room under this band for the control muxes before the arithmetic starts.
  const aluY = ctrlY + 27000;

  const add = addSub(b, originX, aluY, acc.q, forAdd.bits, op0ff.q, op1ff.q);
  const absA = absolute(b, rightOf(b, add.ids, 400), aluY, acc.q);
  const absB = absolute(b, rightOf(b, absA.ids, 400), aluY, forSign.bits);
  const signBit = b.gate('xor', rightOf(b, absB.ids, 240), aluY, [acc.q[N - 1], forSign.bits[N - 1]]);
  const mulY = Math.max(bottomOf(b, add.ids), bottomOf(b, absA.ids), bottomOf(b, absB.ids)) + 3500;
  const mul = multiply(b, originX, mulY, absA.mag, absB.mag);
  const mulBox = annotate(b, mul.boxes, 'Multiply', NOTE.Multiply, COL.mul);
  const div = divide(b, originX, bottomOf(b, [mulBox]) + 1000, absA.mag, absB.mag);
  const divBox = annotate(b, div.boxes, 'Divide', NOTE.Divide, COL.div);
  const accLogicBag: string[] = [];
  const accTailY = bottomOf(b, [divBox]) + 2400;
  const accDisplay = signedDecimalDisplay(b, acc.q, originX, accTailY, accLogicBag);
  const accDecodeBox = annotate(b, accLogicBag, 'Acc to decimal', NOTE['Acc to decimal'], COL.acc);
  const prod = multiplyOverflow(b, rightOf(b, [...absB.ids, signBit], 400), aluY, mul.bits, signBit);
  const quot = multiplyOverflow(b, rightOf(b, prod.ids, 400), aluY, div.bits, signBit);
  const magOr = orGate(b, b.bounds(absB.ids).x, bottomOf(b, absB.ids) + 400, absB.mag)!;
  const signBox = annotate(
    b,
    [...absA.ids, ...absB.ids, signBit, ...prod.ids, ...quot.ids, magOr],
    'Signs',
    NOTE.Signs,
    COL.signs,
  );

  const logicX = flagX + 1700;
  const muxX = logicX + 1900;
  let muxY = ctrlY;
  const mulDiv = muxWord(b, muxX, muxY, op0ff.q, prod.bits, quot.bits);
  muxY += 2700;
  const result = muxWord(b, muxX, muxY, op1ff.q, add.bits, mulDiv.bits);
  muxY += 2700;
  const mulDivOvf = muxBit(b, muxX, muxY, op0ff.q, prod.ovf, quot.ovf);
  const resultOvf = muxBit(b, muxX + 1400, muxY, op1ff.q, add.ovf, mulDivOvf.o);
  muxY += 800;

  const div0 = b.gate('buffer', logicX, ctrlY + 4600, [magOr], true);
  const ctrl = control(b, logicX, ctrlY, muxX, muxY, {
    level: kLocal,
    digP,
    opP,
    clrP,
    signP,
    mrP,
    eqP,
    fresh: fresh.q,
    pending: pending.q,
    op0: op0ff.q,
    op1: op1ff.q,
    entry: forCtrl.bits,
    mem: mem.q,
    appended: time.appended,
    flipped: time.flipped,
    tooBig: time.tooBig,
    isMin: time.isMin,
    result: result.bits,
    resultOvf: resultOvf.o,
    div0,
    done: done.q,
    repeating: repeating.q,
    postEq: postEq.q,
    opSinceEq: opSinceEq.q,
  });

  drive(b, entry.ffs, ctrl.entryD);
  drive(b, acc.ffs, ctrl.accD);
  drive(b, [fresh], [ctrl.freshD]);
  drive(b, [pending], [ctrl.pendingD]);
  drive(b, [done], [ctrl.doneD]);
  drive(b, [repeating], [ctrl.repeatD]);
  drive(b, [postEq], [ctrl.postEqD]);
  drive(b, [opSinceEq], [ctrl.opSinceEqD]);
  // The save clock rises before the entry clock, so this stores the second number rather than the result.
  drive(b, savedEntry.ffs, forCtrl.bits);
  drive(b, [op0ff], [kLocal[5]]);
  drive(b, [op1ff], [kLocal[6]]);
  drive(b, [ovf], [ctrl.ovfD]);
  const delayX = rightOf(
    b,
    [...ctrl.ids, ...mulDiv.ids, ...result.ids, ...mulDivOvf.ids, ...resultOvf.ids, div0],
    240,
  );
  let dx = delayX;
  const delayed = (src: Src, n: number) => {
    const chain = delaySrc(b, src, n, dx, ctrlY);
    dx = rightOf(b, chain.ids, 80, dx + 80);
    return chain;
  };
  const entrySlow = delayed(ctrl.aluFire, CAPTURE_DELAY);
  const accDelay = delayed(ctrl.accFire, CAPTURE_DELAY);
  const freshDelay = delayed(ctrl.freshFire, COMMIT_DELAY);
  const pendDelay = delayed(ctrl.pendFire, COMMIT_DELAY);
  const repeatDelay = delayed(ctrl.repeatFire, COMMIT_DELAY);
  const opSinceDelay = delayed(ctrl.opSinceEqFire, COMMIT_DELAY);
  const opDelay = delayed(opP, COMMIT_DELAY);
  const entryJoin = orGate(b, dx, ctrlY, [ctrl.entryFast, entrySlow.out]);
  const delays = [
    ...entrySlow.ids,
    ...accDelay.ids,
    ...freshDelay.ids,
    ...pendDelay.ids,
    ...repeatDelay.ids,
    ...opSinceDelay.ids,
    ...opDelay.ids,
  ];
  if (entryJoin) delays.push(entryJoin);
  b.wire(entryJoin, entryClk, 0);
  b.wire(accDelay.out, accClk, 0);
  b.wire(freshDelay.out, freshClk, 0);
  b.wire(pendDelay.out, pendClk, 0);
  b.wire(msP, memClk, 0);
  b.wire(opDelay.out, opClk, 0);
  b.wire(ctrl.ovfFire, ovfClk, 0);
  b.wire(ctrl.doneFire, doneClk, 0);
  b.wire(repeatDelay.out, repeatClk, 0);
  b.wire(ctrl.saveEntryFire, saveEntryClk, 0);
  b.wire(ctrl.postEqFire, postEqClk, 0);
  b.wire(opSinceDelay.out, opSinceEqClk, 0);

  const entryBox = annotate(b, entryIds, 'Entry', NOTE.Entry, COL.entry);
  const ctrlBox = annotate(
    b,
    [...clocks, ...flagBoxes, ...aluEntryIds, ...delays, ...mulDiv.ids, ...result.ids, ...mulDivOvf.ids, ...resultOvf.ids, div0, ...ctrl.ids],
    'Control',
    NOTE.Control,
    COL.control,
  );
  const addBox = annotate(b, add.ids, 'Add and subtract', NOTE['Add and subtract'], COL.add);
  const proc = b.box(
    'Processing',
    [onePress, times, accBox, accDecodeBox, memBox, addBox, signBox, mulBox, divBox, entryBox, ctrlBox, ...k, ...v],
    48,
    COL.proc,
  );
  faceK.forEach((src, i) => b.wire(src, k[i], 0));
  return {
    box: proc,
    v,
    accSegs: flattenSegs(accDisplay.shown),
    accSign: accDisplay.sign,
    op0: op0ff.q,
    op1: op1ff.q,
    opShow: pending.q,
  };
}

function control(
  b: Builder,
  x: number,
  y: number,
  muxX: number,
  muxY: number,
  s: {
    level: Src[];
    digP: Src;
    opP: Src;
    clrP: Src;
    signP: Src;
    mrP: Src;
    eqP: Src;
    fresh: Src;
    pending: Src;
    op0: Src;
    op1: Src;
    entry: Src[];
    mem: Src[];
    appended: Src[];
    flipped: Src[];
    tooBig: Src;
    isMin: Src;
    result: Src[];
    resultOvf: Src;
    div0: Src;
    done: Src;
    repeating: Src;
    postEq: Src;
    opSinceEq: Src;
  },
): {
  ids: string[];
  entryD: Src[];
  accD: Src[];
  freshD: Src;
  pendingD: Src;
  ovfD: Src;
  entryFast: Src;
  aluFire: Src;
  accFire: Src;
  freshFire: Src;
  pendFire: Src;
  ovfFire: Src;
  doneD: Src;
  doneFire: Src;
  saveEntryFire: Src;
  repeatD: Src;
  repeatFire: Src;
  postEqD: Src;
  postEqFire: Src;
  opSinceEqD: Src;
  opSinceEqFire: Src;
} {
  const ids: string[] = [];
  const keep = (g: Src) => {
    if (g) ids.push(g);
    return g;
  };
  let gy = y;
  const at = (ins: Src[], kind: 'or' | 'and' | 'buffer' = 'or', not = false) => {
    const g = kind === 'buffer' ? b.gate('buffer', x, gy, ins, not) : kind === 'and' ? andGate(b, x, gy, ins) : orGate(b, x, gy, ins);
    if (g && kind !== 'or' && kind !== 'and') ids.push(g);
    else if (g && (kind === 'and' || kind === 'or') && !ins.filter(Boolean).includes(g)) ids.push(g);
    gy += 180;
    return g;
  };
  const notFresh = at([s.fresh], 'buffer', true)!;
  const notBig = at([s.tooBig], 'buffer', true)!;
  const notDig = at([s.level[4]], 'buffer', true)!;
  const notEq = at([s.level[12]], 'buffer', true)!;
  const opCont = keep(andGate(b, x + 500, y, [s.level[7], notFresh]));
  const contOrEq = keep(orGate(b, x + 500, y + 180, [opCont, s.level[12]]));
  const useAlu = keep(andGate(b, x + 500, y + 360, [s.pending, contOrEq]));
  const opIsDiv = keep(andGate(b, x + 500, y + 540, [s.op0, s.op1]));
  const divBad = keep(andGate(b, x + 500, y + 720, [opIsDiv, s.div0]));
  const blocked = keep(andGate(b, x + 500, y + 900, [useAlu, divBad]));
  const notBlock = b.gate('buffer', x + 500, y + 1080, [blocked], true);
  ids.push(notBlock);
  const digOk = keep(orGate(b, x + 500, y + 1280, [s.fresh, notBig]));
  const digFire = keep(andGate(b, x + 500, y + 1460, [s.digP, digOk]));
  const pulseOr = keep(orGate(b, x + 900, y + 1640, [s.eqP, s.opP]));
  const compute = keep(andGate(b, x + 500, y + 1640, [pulseOr, useAlu]));
  // Divide-by-zero blocks the stored result, not the clock. Gating the clock from the
  // number it writes makes the latch ring.
  const aluFire = compute!;
  const entryFast = keep(orGate(b, x, y + 2100, [s.clrP, s.mrP, s.signP, digFire]))!;
  const eqAndPend = keep(andGate(b, x + 500, y + 2100, [s.eqP, s.pending]));
  const accPulse = keep(orGate(b, x + 800, y + 2100, [s.opP, eqAndPend]));
  const accFire = accPulse!;
  const digFresh = keep(andGate(b, x + 500, y + 2480, [s.digP, s.fresh]));
  const notOpSinceEq = b.gate('buffer', x + 1100, y + 2480, [s.opSinceEq], true);
  ids.push(notOpSinceEq);
  const startOver = keep(andGate(b, x + 1400, y + 2480, [digFresh, s.postEq, notOpSinceEq]));
  const freshFire = keep(orGate(b, x, y + 2500, [s.digP, s.clrP, s.mrP, s.eqP, s.opP]))!;
  const pendFire = keep(orGate(b, x, y + 2800, [s.opP, s.clrP, startOver]))!;
  const notClrP = b.gate('buffer', x + 800, y + 2800, [s.clrP], true);
  ids.push(notClrP);
  const pendingD = keep(andGate(b, x + 1100, y + 2800, [s.opP, notClrP]))!;
  const ovfFire = keep(orGate(b, x, y + 3100, [s.signP, s.clrP, digFresh, compute]))!;
  const signMin = keep(andGate(b, x + 500, y + 2800, [s.level[9], s.isMin]));
  const bad = keep(orGate(b, x + 800, y + 3100, [divBad, s.resultOvf]));
  const setOvf = keep(orGate(b, x + 500, y + 3000, [signMin, andGate(b, x + 1100, y + 3000, [useAlu, bad])]));
  const clrOvf = keep(orGate(b, x + 500, y + 3300, [s.level[8], andGate(b, x + 800, y + 3300, [s.level[4], s.fresh])]));
  const notClr = b.gate('buffer', x + 500, y + 3500, [clrOvf], true);
  ids.push(notClr);
  const ovfD = keep(andGate(b, x + 800, y + 3500, [setOvf, notClr]));
  const eqDone = keep(andGate(b, x + 500, y + 3600, [s.eqP, aluFire]));
  const doneReset = keep(orGate(b, x + 800, y + 3600, [s.opP, s.clrP, startOver]));
  const notDoneReset = b.gate('buffer', x + 1100, y + 3600, [doneReset], true);
  ids.push(notDoneReset);
  const doneD = keep(orGate(b, x + 1400, y + 3600, [eqDone, andGate(b, x + 1700, y + 3600, [s.done, notDoneReset])]))!;
  const doneFire = keep(orGate(b, x, y + 3780, [eqDone, doneReset]))!;
  const notRepeating = b.gate('buffer', x + 800, y + 3960, [s.repeating], true);
  ids.push(notRepeating);
  const repeatSet = keep(andGate(b, x + 1400, y + 3960, [aluFire, s.eqP, notBlock, notRepeating]))!;
  const saveEntryFire = keep(andGate(b, x + 1100, y + 3960, [eqAndPend, notRepeating]))!;
  const repeatResetLvl = keep(orGate(b, x + 800, y + 4140, [s.level[4], s.level[7], s.level[8]]));
  const notRepeatResetLvl = b.gate('buffer', x + 1200, y + 4140, [repeatResetLvl], true);
  ids.push(notRepeatResetLvl);
  const repeatArm = keep(andGate(b, x + 1600, y + 4140, [s.level[12], s.pending, notBlock]));
  const repeatHold = keep(andGate(b, x + 2100, y + 4140, [s.repeating, notRepeatResetLvl]));
  const repeatD = keep(orGate(b, x + 2600, y + 4140, [repeatArm, repeatHold]))!;
  const repeatFire = keep(orGate(b, x, y + 4320, [s.digP, s.opP, s.clrP, repeatSet]))!;
  const postEqSet = eqDone;
  const postEqClr = keep(orGate(b, x + 800, y + 4500, [s.opP, s.clrP, startOver]));
  const notPostEqClr = b.gate('buffer', x + 1100, y + 4500, [postEqClr], true);
  ids.push(notPostEqClr);
  const postEqD = keep(orGate(b, x + 1400, y + 4500, [postEqSet, andGate(b, x + 1700, y + 4500, [s.postEq, notPostEqClr])]))!;
  const postEqFire = keep(orGate(b, x, y + 4680, [postEqSet, postEqClr]))!;
  const opSinceEqSet = s.opP;
  const opSinceClrLvl = keep(orGate(b, x + 800, y + 4860, [s.level[12], s.level[8]]));
  const notOpSinceClrLvl = b.gate('buffer', x + 1200, y + 4860, [opSinceClrLvl], true);
  ids.push(notOpSinceClrLvl);
  const opSinceHold = keep(andGate(b, x + 1600, y + 4860, [s.opSinceEq, notOpSinceClrLvl]));
  const opSinceEqD = keep(orGate(b, x + 2100, y + 4860, [s.level[7], opSinceHold]))!;
  const opSinceEqClr = keep(orGate(b, x + 800, y + 5040, [eqDone, s.clrP, startOver]));
  const opSinceEqFire = keep(orGate(b, x, y + 5220, [opSinceEqSet, opSinceEqClr]))!;

  const digitWord: Src[] = [...s.level.slice(0, 4), ...Array(N - 4).fill(null)];
  const digValue = muxWord(b, muxX, muxY, s.fresh, s.appended, digitWord);
  let my = muxY + 2700;
  // While no sum is waiting, keep the number already stored. Following the adder here leaves the latch open on a moving result.
  const take = keep(andGate(b, muxX, my, [useAlu, notBlock]));
  const held = muxWord(b, muxX, my + 400, take, s.entry, s.result);
  my += 2700;
  const afterDig = muxWord(b, muxX, my, s.level[4], held.bits, digValue.bits);
  my += 2700;
  const afterSign = muxWord(b, muxX, my, s.level[9], afterDig.bits, s.flipped);
  my += 2700;
  const afterMr = muxWord(b, muxX, my, s.level[11], afterSign.bits, s.mem);
  my += 2700;
  const entryD = muxWord(b, muxX, my, s.level[8], afterMr.bits, Array(N).fill(null));
  // useAlu is true while the key is held, before the clock, so this stores the result of a pending sum.
  const accD = muxWord(b, muxX, my + 2700, take, s.entry, s.result);
  ids.push(...digValue.ids, ...held.ids, ...afterDig.ids, ...afterSign.ids, ...afterMr.ids, ...entryD.ids, ...accD.ids, notFresh, notBig, notDig, notEq);
  return {
    ids,
    entryD: entryD.bits,
    accD: accD.bits,
    freshD: notDig,
    pendingD,
    ovfD,
    entryFast,
    aluFire,
    accFire,
    freshFire,
    pendFire,
    ovfFire,
    doneD,
    doneFire,
    saveEntryFire,
    repeatD,
    repeatFire,
    postEqD,
    postEqFire,
    opSinceEqD,
    opSinceEqFire,
  };
}

export function calculatorDoc(): Doc {
  const b = new Builder('Calculator');
  const face = buildFace(b);
  const proc = buildProcessing(b, rightOf(b, [face.box], 7200), face.k);
  proc.v.forEach((src, i) => b.wire(src, face.v[i], 0));
  proc.accSegs.forEach((src, i) => b.wire(src, face.accSeg[i], 0));
  b.wire(proc.accSign, face.accMinus, 0);
  b.wire(proc.op0, face.op0, 0);
  b.wire(proc.op1, face.op1, 0);
  b.wire(proc.opShow, face.opShow, 0);
  return b.finish();
}
