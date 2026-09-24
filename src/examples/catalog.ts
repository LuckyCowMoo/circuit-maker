import type { Doc } from '../model/types';
import { Builder, sop, type Src } from './builder';

/**
 * Examples removed while ribbon cables are still being built. Remake these once the cable,
 * port and ordering rules below are settled.
 *
 * Basics: Logic gates, Half adder, Full adder, 8-bit parity.
 * Arithmetic: 8-bit subtractor, 4-bit multiplier, 4-bit divider, 4-bit modulus, 4-bit comparator.
 * Memory: SR latch, Memory cell, D flip-flop, 8-bit register, 4-bit counter.
 * Displays: 7-segment display (the 3-digit display includes the same decoder).
 * Routing: 4-to-1 multiplexer, 2-to-4 decoder.
 *
 * Rules for an example:
 * - Switches and buttons live in an input box. Nothing floats outside a box.
 * - A box that several signals cross on one wall uses a ribbon port: one pin per lane on the
 *   inside, and one plug on the outside. That plug is always a ribbon cable, not separate wires.
 * - Bit 0 is the top lane of every input and output, and lane 0 of a ribbon is bit 0.
 * - Copied blocks share a colour. Every half adder is the same colour; every full adder is
 *   the same colour. A box dropped from the toolbar picks a random colour.
 * - Parts inside a box must not overlap.
 */

const COL = {
  half: '#0f9d8a',
  bit: '#6e56cf',
  add3: '#e5932a',
  decode: '#3b82c4',
  display: '#111827',
  outer: '#5b4b8a',
  alt: '#0f766e',
};

interface Adder {
  s: string;
  c: string;
  ids: string[];
}

function fullAdder(b: Builder, x: number, y: number, a: Src, bb: Src, cin: Src): Adder {
  const x1 = b.gate('xor', x, y, [a, bb]);
  const a1 = b.gate('and', x, y + 100, [a, bb]);
  const x2 = b.gate('xor', x + 130, y + 10, [x1, cin]);
  const a2 = b.gate('and', x + 130, y + 80, [x1, cin]);
  const o1 = b.gate('or', x + 240, y + 90, [a2, a1]);
  return { s: x2, c: o1, ids: [x1, a1, x2, a2, o1] };
}

/** Double-dabble cell. Inputs and outputs are LSB first, which is the top of the ribbon. */
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
  return { outs: res.outs, box: b.box(name, res.ids, 20, COL.add3) };
}

const SEGMENTS = 'abcdefg';
const HEX_SEGMENTS = [
  'abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc',
  'abcdefg', 'abcdfg', 'abcefg', 'cdefg', 'adef', 'bcdeg', 'adefg', 'aefg',
];

function segDecoder(b: Builder, x: number, y: number, ins: Src[], name: string): { outs: Src[]; box: string } {
  const outputs = [...SEGMENTS].map((s) => ({ on: HEX_SEGMENTS.flatMap((segs, v) => (segs.includes(s) ? [v] : [])) }));
  const res = sop(b, x, y, ins, outputs);
  return { outs: res.outs, box: b.box(name, res.ids, 20, COL.decode) };
}

function display(b: Builder, x: number, y: number, segs: Src[], name: string, scale = 1): string {
  const bar = (sx: number, sy: number, vertical: boolean) =>
    b.bulb(x + sx * scale, y + sy * scale, '', vertical ? { w: 20 * scale, h: 60 * scale } : { w: 60 * scale, h: 20 * scale });
  const ids = [
    bar(30, 0, false),
    bar(90, 20, true),
    bar(90, 100, true),
    bar(30, 160, false),
    bar(10, 100, true),
    bar(10, 20, true),
    bar(30, 80, false),
  ];
  ids.forEach((id, i) => b.wire(segs[i], id, 0));
  return b.box(name, ids, 20 * scale, COL.display);
}

/** 8-bit ripple-carry adder. A and B sit side by side above the adder; Sum takes the output cable. */
function adderDoc(): Doc {
  const b = new Builder('8-bit adder');
  const rowH = 240;
  const pitch = 72;
  const aSwitches: string[] = [];
  const bSwitches: string[] = [];
  for (let i = 0; i < 8; i++) {
    aSwitches.push(b.sw(0, i * pitch, `A${i}`));
    bSwitches.push(b.sw(320, i * pitch, `B${i}`));
  }
  b.box('A', aSwitches, 24, '#0f766e');
  b.box('B', bSwitches, 24, '#b45309');
  let carry: Src = null;
  const bits: string[] = [];
  const sums: string[] = [];
  for (let i = 0; i < 8; i++) {
    const y = 900 + i * rowH;
    const fa = fullAdder(b, 80, y, aSwitches[i], bSwitches[i], carry);
    b.signal(fa.c, `C${i + 1}`);
    bits.push(b.box(`Bit ${i}`, fa.ids, 20, COL.bit));
    sums.push(b.bulb(1000, 900 + i * pitch, `S${i}`));
    b.wire(fa.s, sums[i]);
    carry = fa.c;
  }
  b.box('8-bit adder', bits, 30, COL.outer);
  const cout = b.bulb(1000, 900 + 8 * pitch, 'Cout');
  b.wire(carry, cout);
  b.box('Sum', [...sums, cout], 24, '#1d4ed8');
  return b.finish();
}

/** Binary to decimal, then three 7-segment digits. B0 is the top switch. */
function threeDigitDoc(): Doc {
  const b = new Builder('3-digit display');
  const switches = [0, 1, 2, 3, 4, 5, 6, 7].map((j) => b.sw(-300, j * 90, `B${j}`));
  b.box('Value', switches, 24, '#0f766e');
  const col = 460;
  const c1 = add3(b, 0, 0, [switches[5], switches[6], switches[7], null], 'Add 3 (1)');
  const c2 = add3(b, col, 0, [switches[4], c1.outs[0], c1.outs[1], c1.outs[2]], 'Add 3 (2)');
  const c3 = add3(b, 2 * col, 0, [switches[3], c2.outs[0], c2.outs[1], c2.outs[2]], 'Add 3 (3)');
  const c4 = add3(b, 3 * col, 0, [switches[2], c3.outs[0], c3.outs[1], c3.outs[2]], 'Add 3 (4)');
  const c5 = add3(b, 4 * col, 0, [switches[1], c4.outs[0], c4.outs[1], c4.outs[2]], 'Add 3 (5)');
  const rowBottom = Math.max(...[c1, c2, c3, c4, c5].map((c) => {
    const box = b.doc.boxes.get(c.box)!;
    return box.y + box.h;
  }));
  const c6 = add3(b, 2 * col, rowBottom + 80, [c3.outs[3], c2.outs[3], c1.outs[3], null], 'Add 3 (6)');
  const c7 = add3(b, 4 * col, rowBottom + 80, [c4.outs[3], c6.outs[0], c6.outs[1], c6.outs[2]], 'Add 3 (7)');
  const ones: Src[] = [switches[0], c5.outs[0], c5.outs[1], c5.outs[2]];
  const tens: Src[] = [c5.outs[3], c7.outs[0], c7.outs[1], c7.outs[2]];
  const hundreds: Src[] = [c7.outs[3], c6.outs[3], null, null];
  const pack = (bits: Src[], name: string, x: number, y: number) => {
    const bufs = bits.map((s, i) => {
      b.signal(s, `${name} bit ${i}`);
      return b.gate('buffer', x, y + i * 70, [s]);
    });
    return { bufs, box: b.box(name, bufs, 16, COL.decode) };
  };
  const hPack = pack(hundreds, '100s bits', 2500, 0);
  const tPack = pack(tens, '10s bits', 2500, 220);
  const oPack = pack(ones, '1s bits', 2500, 560);
  b.box('Binary to decimal', [c1.box, c2.box, c3.box, c4.box, c5.box, c6.box, c7.box, hPack.box, tPack.box, oPack.box], 30, COL.outer);
  const decoders = [
    segDecoder(b, 3100, 0, hPack.bufs, 'Hundreds decoder'),
    segDecoder(b, 3100, 220, tPack.bufs, 'Tens decoder'),
    segDecoder(b, 3100, 560, oPack.bufs, 'Ones decoder'),
  ];
  const displays = decoders.map((d, k) => display(b, 4300, k * 1100, d.outs, ['100s', '10s', '1s'][k], 4));
  b.box('Display', displays, 30, '#4c1d95');
  return b.finish();
}

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
    name: 'Arithmetic',
    items: [{ id: 'adder8', name: '8-bit adder', build: adderDoc }],
  },
  {
    name: 'Displays',
    items: [{ id: 'seg3', name: '3-digit display', build: threeDigitDoc }],
  },
];
