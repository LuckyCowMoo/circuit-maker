import { emptyDoc, makeComponent } from '../model/doc';
import { GRID, snap } from '../model/geometry';
import { noteLayout } from '../model/shapes';
import { layoutTable, rowCount, TABLE_OUT } from '../model/table';
import type { Component, Doc, TableData, Wire } from '../model/types';

/** One solution-mode truth table the player has to build. */
export interface PuzzleSpec {
  id: string;
  name: string;
  /** Shown on the note beneath the table. */
  hint: string;
  inputs: string[];
  outputs: string[];
  /** One string per input row, one character per output. Leftmost input is the high bit. */
  rows: string[];
  components: string[];
}

function bitsOf(inputs: number, row: number): boolean[] {
  return Array.from({ length: inputs }, (_, col) => ((row >> (inputs - 1 - col)) & 1) === 1);
}

function rowsFor(inputs: number, fn: (bits: boolean[]) => boolean[]): string[] {
  return Array.from({ length: rowCount(inputs) }, (_, row) => fn(bitsOf(inputs, row)).map((bit) => (bit ? '1' : '0')).join(''));
}

function puzzle(
  id: string,
  name: string,
  hint: string,
  inputs: string[],
  outputs: string[],
  components: string[],
  fn: (bits: boolean[]) => boolean[],
): PuzzleSpec {
  const fullHint = hint.startsWith(name) ? hint : `${name}: ${hint}`;
  return { id, name, hint: fullHint, inputs, outputs, rows: rowsFor(inputs.length, fn), components };
}

/**
 * Easiest first. And is the one single-gate puzzle. Each later puzzle needs a
 * larger circuit. 2-bit compare stays the hardest.
 */
export const PUZZLES: PuzzleSpec[] = [
  puzzle('soland', 'And', 'And: Y is 1 only when A and B are both 1.', ['A', 'B'], ['Y'], ['AND'], ([a, b]) => [a && b]),
  puzzle('soleither', 'Either and both', 'Either and both: X is 1 when A or B is on. Y is 1 only when both are on.', ['A', 'B'], ['X', 'Y'], ['AND', 'OR'], ([a, b]) => [
    a || b,
    a && b,
  ]),
  puzzle('solonly', 'Only A', 'Only A: Y is 1 only when A is on and B is off.', ['A', 'B'], ['Y'], ['AND', 'NOT'], ([a, b]) => [a && !b]),
  puzzle('solimply', 'Imply', 'Imply: Y is 1 unless A is on while B is off.', ['A', 'B'], ['Y'], ['OR', 'NOT'], ([a, b]) => [!a || b]),
  puzzle(
    'solboth',
    'Only or both',
    'Only or both: Only is 1 only when A is on and B is off. Both is 1 only when A and B are both on.',
    ['A', 'B'],
    ['Only', 'Both'],
    ['AND', 'AND', 'NOT'],
    ([a, b]) => [a && !b, a && b],
  ),
  puzzle('solbounds', 'Bounds', 'Bounds: AtLeast is 1 when A or B is on. AtMost is 1 when not both are on.', ['A', 'B'], ['AtLeast', 'AtMost'], ['AND', 'OR', 'NOT'], ([a, b]) => [
    a || b,
    !(a && b),
  ]),
  puzzle('solsame', 'Same or different', 'Same or different: Same is 1 when A and B match. Diff is 1 when they differ.', ['A', 'B'], ['Same', 'Diff'], ['NOT', 'XOR'], ([a, b]) => [
    a === b,
    a !== b,
  ]),
  puzzle(
    'solbothneither',
    'Both and neither',
    'Both and neither: Both is 1 only when A and B are both on. Neither is 1 only when neither is on.',
    ['A', 'B'],
    ['Both', 'Neither'],
    ['AND', 'OR', 'NOT'],
    ([a, b]) => [a && b, !a && !b],
  ),
  puzzle(
    'solhigh',
    'Which side',
    'Which side: High is 1 only when A is on and B is off. Low is 1 only when A is off and B is on.',
    ['A', 'B'],
    ['High', 'Low'],
    ['AND', 'AND', 'NOT', 'NOT'],
    ([a, b]) => [a && !b, !a && b],
  ),
  puzzle('soleneither', 'Enable either', 'Enable either: Y is 1 when either A or B is on, provided En is on.', ['A', 'B', 'En'], ['Y'], ['AND', 'OR'], ([a, b, en]) => [
    (a || b) && en,
  ]),
  puzzle(
    'solhalf',
    'Half adder',
    'Half adder: S is the sum, 1 when A and B differ. C is the carry, 1 only when both are 1.',
    ['A', 'B'],
    ['S', 'C'],
    ['AND', 'XOR'],
    ([a, b]) => [a !== b, a && b],
  ),
  puzzle(
    'solhalfsub',
    'Half subtractor',
    'Half subtractor: D is the difference, 1 when A and B differ. Bw is the borrow, 1 only when A is 0 and B is 1.',
    ['A', 'B'],
    ['D', 'Bw'],
    ['AND', 'NOT', 'XOR'],
    ([a, b]) => [a !== b, !a && b],
  ),
  puzzle(
    'solroute',
    'Route',
    'Route: Sends In to Y0 while Sel is off, and to Y1 while Sel is on.',
    ['In', 'Sel'],
    ['Y0', 'Y1'],
    ['AND', 'AND', 'NOT'],
    ([input, sel]) => [input && !sel, input && sel],
  ),
  puzzle('solunless', 'Unless', 'Unless: Y is 1 only when A and B are on and C is off.', ['A', 'B', 'C'], ['Y'], ['AND', 'AND', 'NOT'], ([a, b, c]) => [a && b && !c]),
  puzzle(
    'solpick',
    'Choose',
    'Choose: Y matches A while Pick is off, and matches B while Pick is on.',
    ['A', 'B', 'Pick'],
    ['Y'],
    ['AND', 'AND', 'OR', 'NOT'],
    ([a, b, pick]) => [pick ? b : a],
  ),
  puzzle(
    'solparity3',
    'Odd and even',
    'Odd and even: Odd is 1 when an odd number of A, B, and C are on. Even is 1 when an even number are on.',
    ['A', 'B', 'C'],
    ['Odd', 'Even'],
    ['NOT', 'XOR', 'XOR'],
    ([a, b, c]) => {
      const n = Number(a) + Number(b) + Number(c);
      return [n % 2 === 1, n % 2 === 0];
    },
  ),
  puzzle(
    'solallnone',
    'All or none',
    'All or none: Y is 1 when either all three inputs are on, or all three are off.',
    ['A', 'B', 'C'],
    ['Y'],
    ['OR', 'NOT', 'XOR', 'XOR'],
    ([a, b, c]) => [(a && b && c) || (!a && !b && !c)],
  ),
  puzzle('solmaj', 'Majority', 'Majority: Y is 1 when at least two of A, B, and C are on.', ['A', 'B', 'C'], ['Y'], ['AND', 'AND', 'OR', 'OR'], ([a, b, c]) => [
    Number(a) + Number(b) + Number(c) >= 2,
  ]),
  puzzle(
    'solmost',
    'Most or all',
    'Most or all: Most is 1 when at least two of A, B, and C are on. All is 1 only when every one is on.',
    ['A', 'B', 'C'],
    ['Most', 'All'],
    ['AND', 'AND', 'AND', 'OR', 'OR'],
    ([a, b, c]) => {
      const n = Number(a) + Number(b) + Number(c);
      return [n >= 2, n === 3];
    },
  ),
  puzzle(
    'solfull',
    'Full adder',
    'Full adder: S is the sum, 1 when an odd number of A, B, and Ci are on. Co is the carry, 1 when at least two are on.',
    ['A', 'B', 'Ci'],
    ['S', 'Co'],
    ['AND', 'AND', 'OR', 'XOR', 'XOR'],
    ([a, b, ci]) => {
      const n = Number(a) + Number(b) + Number(ci);
      return [n % 2 === 1, n >= 2];
    },
  ),
  puzzle(
    'solfullsub',
    'Full subtractor',
    'Full subtractor: D is the difference (A - B - Bi). Bo is the borrow, 1 whenever A minus B minus Bi is negative.',
    ['A', 'B', 'Bi'],
    ['D', 'Bo'],
    ['AND', 'AND', 'OR', 'NOT', 'NOT', 'XOR', 'XOR'],
    ([a, b, bi]) => {
      const d = Number(a) - Number(b) - Number(bi);
      return [Math.abs(d) % 2 === 1, d < 0];
    },
  ),
  puzzle(
    'soldecoder',
    'Decoder',
    'Decoder: When En is on, turns on exactly one output selected by A and B (00: Y0, 01: Y1, 10: Y2, 11: Y3).',
    ['A', 'B', 'En'],
    ['Y0', 'Y1', 'Y2', 'Y3'],
    ['AND', 'AND', 'AND', 'AND', 'NOT', 'NOT'],
    ([a, b, en]) => [en && !a && !b, en && !a && b, en && a && !b, en && a && b],
  ),
  puzzle(
    'solbcd',
    'Valid BCD',
    'Valid BCD: Valid is 1 when the 4-bit input represents a valid decimal digit 0 to 9, and 0 for 10 to 15.',
    ['B3', 'B2', 'B1', 'B0'],
    ['Valid'],
    ['AND', 'OR', 'NOT'],
    ([b3, b2, b1, b0]) => {
      const val = (Number(b3) << 3) | (Number(b2) << 2) | (Number(b1) << 1) | Number(b0);
      return [val <= 9];
    },
  ),
  puzzle(
    'solcmp2',
    '2-bit compare',
    '2-bit compare: Gt is 1 when 2-bit number A (A1 A0) is greater than B (B1 B0). Eq is 1 when they are equal.',
    ['A1', 'A0', 'B1', 'B0'],
    ['Gt', 'Eq'],
    ['AND', 'AND', 'AND', 'AND', 'OR', 'NOT', 'NOT', 'NOT', 'NOT', 'XOR', 'XOR'],
    ([a1, a0, b1, b0]) => {
      const va = (Number(a1) << 1) | Number(a0);
      const vb = (Number(b1) << 1) | Number(b0);
      return [va > vb, va === vb];
    },
  ),
];

export function puzzleTable(spec: PuzzleSpec): TableData {
  return {
    mode: 'solution',
    inputs: spec.inputs.length,
    outputs: spec.outputs.length,
    names: [...spec.inputs, ...spec.outputs],
    rows: spec.rows.slice(),
    components: spec.components.slice(),
  };
}

/** Next multiple of the file grid, so a saved puzzle loads back at the same size. */
function onGrid(v: number): number {
  return Math.ceil(v / GRID) * GRID;
}

/** Wide enough, and tall enough, that the plain-English hint stays readable. */
function hintNote(spec: PuzzleSpec, tableW: number, tableH: number): Component {
  const text = spec.hint.startsWith(spec.name) ? spec.hint : `${spec.name}: ${spec.hint}`;
  const w = onGrid(Math.max(tableW, 260));
  let h = onGrid(100);
  while (h < 240 && noteLayout(text, w, h).size < 15) h += GRID;
  const x = Math.round((tableW - w) / (2 * GRID)) * GRID;
  const y = onGrid(tableH + 40);
  const note = makeComponent('note', x, y, 'hint');
  note.w = w;
  note.h = h;
  note.name = text;
  return note;
}

/** The question table, switches, bulbs, and a note stating the goal. The circuit is left for the player. */
export function puzzleDoc(spec: PuzzleSpec): Doc {
  const doc = emptyDoc(spec.name);
  const table = makeComponent('table', 0, 0, 'table');
  const data = puzzleTable(spec);
  table.table = data;
  const size = layoutTable(data);
  table.w = size.w;
  table.h = size.h;
  doc.components.set(table.id, table);

  // Position switches above the table, out to the left
  const swX = -160;
  const nIn = spec.inputs.length;
  for (let i = 0; i < nIn; i++) {
    const swY = -60 - (nIn - 1 - i) * 80;
    const sw = makeComponent('switch', swX, swY, `sw_${i}`);
    sw.name = spec.inputs[i];
    doc.components.set(sw.id, sw);

    const wire: Wire = {
      id: `w_in_${i}`,
      from: sw.id,
      to: table.id,
      input: i,
      separatePort: true,
    };
    doc.wires.set(wire.id, wire);
  }

  // Position bulbs above the table, out to the right
  const bulbX = snap(size.w + 120);
  const nOut = spec.outputs.length;
  for (let j = 0; j < nOut; j++) {
    const bulbY = -60 - (nOut - 1 - j) * 80;
    const bulb = makeComponent('bulb', bulbX, bulbY, `bulb_${j}`);
    bulb.name = spec.outputs[j];
    doc.components.set(bulb.id, bulb);

    const wire: Wire = {
      id: `w_out_${j}`,
      from: bulb.id,
      to: table.id,
      input: TABLE_OUT + j,
      separatePort: true,
    };
    doc.wires.set(wire.id, wire);
  }

  const note = hintNote(spec, size.w, size.h);
  doc.components.set(note.id, note);
  return doc;
}
