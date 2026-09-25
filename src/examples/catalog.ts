import type { Doc } from '../model/types';
import {
  adder4Doc,
  adder8Doc,
  cmp4Doc,
  count4Doc,
  dec2Doc,
  dffDoc,
  div4Doc,
  fullAdderDoc,
  halfAdderDoc,
  memDoc,
  mod4Doc,
  mul4Doc,
  mux4Doc,
  reg8Doc,
  seg3Doc,
  seg7Doc,
  srDoc,
  sub8Doc,
} from './circuits';
import { snakeDoc } from './snake';
import { emptyDoc, makeComponent } from '../model/doc';

export interface Example {
  id: string;
  name: string;
  build: () => Doc;
}

export interface ExampleGroup {
  name: string;
  items: Example[];
}

/** Dense grid of gates with long crossing wires, for routing and render performance. */
function stressDoc(): Doc {
  const cols = 28;
  const rows = 18;
  const dx = 170;
  const dy = 90;
  const doc = emptyDoc('Stress test');
  doc.boxes.set('block_a', { id: 'block_a', name: 'Block A', x: 500, y: 60, w: 900, h: 620, color: '#5b4b8a' });
  doc.boxes.set('block_b', { id: 'block_b', name: 'Block B', x: 1800, y: 200, w: 780, h: 780, color: '#0f766e' });
  doc.boxes.set('block_c', { id: 'block_c', name: 'Block C', x: 3000, y: 40, w: 640, h: 480, color: '#b45309' });
  const id = (c: number, r: number) => `g${c}_${r}`;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const gate = makeComponent('and', c * dx, r * dy, id(c, r));
      gate.inputs = 2;
      doc.components.set(gate.id, gate);
    }
  }
  const clk = makeComponent('timer', -200, 700, 'clk');
  clk.name = 'Clock';
  clk.period = 0.4;
  clk.pulse = 0.2;
  doc.components.set(clk.id, clk);
  const sw = makeComponent('switch', -200, 820, 'sw');
  sw.name = 'Force';
  sw.on = true;
  doc.components.set(sw.id, sw);
  const out = makeComponent('bulb', cols * dx + 40, 700, 'out');
  out.name = 'Out';
  doc.components.set(out.id, out);
  let wi = 0;
  const wire = (from: string, to: string, input: number) => {
    const w = { id: `w${wi++}`, from, to, input };
    doc.wires.set(w.id, w);
  };
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (c + 1 < cols) wire(id(c, r), id(c + 1, r), 0);
      const c2 = c + 6;
      if (c2 < cols) wire(id(c, r), id(c2, (r + 4) % rows), 1);
    }
  }
  wire('clk', 'g0_8', 1);
  wire('sw', 'g0_9', 1);
  wire(id(cols - 1, 8), 'out', 0);
  return doc;
}

export const EXAMPLES: ExampleGroup[] = [
  {
    name: 'Arithmetic',
    items: [
      { id: 'half', name: 'Half adder', build: halfAdderDoc },
      { id: 'full', name: 'Full adder', build: fullAdderDoc },
      { id: 'adder4', name: '4-bit adder', build: adder4Doc },
      { id: 'adder8', name: '8-bit adder', build: adder8Doc },
      { id: 'sub8', name: '8-bit subtractor', build: sub8Doc },
      { id: 'mul4', name: '4-bit multiplier', build: mul4Doc },
      { id: 'div4', name: '4-bit divider', build: div4Doc },
      { id: 'mod4', name: '4-bit modulus', build: mod4Doc },
      { id: 'cmp4', name: '4-bit comparator', build: cmp4Doc },
    ],
  },
  {
    name: 'Memory',
    items: [
      { id: 'sr', name: 'SR latch', build: srDoc },
      { id: 'mem', name: 'Memory cell', build: memDoc },
      { id: 'dff', name: 'D flip-flop', build: dffDoc },
      { id: 'reg8', name: '8-bit register', build: reg8Doc },
      { id: 'count4', name: '4-bit counter', build: count4Doc },
    ],
  },
  {
    name: 'Displays',
    items: [
      { id: 'seg7', name: '7-segment display', build: seg7Doc },
      { id: 'seg3', name: '3-digit display', build: seg3Doc },
    ],
  },
  {
    name: 'Routing',
    items: [
      { id: 'mux4', name: '4-to-1 multiplexer', build: mux4Doc },
      { id: 'dec2', name: '2-to-4 decoder', build: dec2Doc },
    ],
  },
  {
    name: 'Games',
    items: [{ id: 'snake', name: 'Snake', build: snakeDoc }],
  },
  {
    name: 'Tests',
    items: [{ id: 'stress', name: 'Stress test', build: stressDoc }],
  },
];
