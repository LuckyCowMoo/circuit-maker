import { emptyDoc, makeComponent } from '../model/doc';
import { layoutTable, rowCount } from '../model/table';
import type { Doc, TableData } from '../model/types';

/** One solution-mode truth table the player has to build. */
export interface PuzzleSpec {
  id: string;
  name: string;
  /** Shown on the note above the table. */
  hint: string;
  inputs: string[];
  outputs: string[];
  /** One string per input row, one character per output. Leftmost input is the high bit. */
  rows: string[];
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
  fn: (bits: boolean[]) => boolean[],
): PuzzleSpec {
  return { id, name, hint, inputs, outputs, rows: rowsFor(inputs.length, fn) };
}

/** Easiest first. Each step adds inputs, outputs, or a less obvious gate. */
export const PUZZLES: PuzzleSpec[] = [
  puzzle('solnot', 'Not', 'Y is the opposite of A.', ['A'], ['Y'], ([a]) => [!a]),
  puzzle('soland', 'And', 'Y is 1 only when A and B are both 1.', ['A', 'B'], ['Y'], ([a, b]) => [a && b]),
  puzzle('solor', 'Or', 'Y is 1 when A or B is 1.', ['A', 'B'], ['Y'], ([a, b]) => [a || b]),
  puzzle('solxor', 'Exclusive or', 'Y is 1 when A and B differ.', ['A', 'B'], ['Y'], ([a, b]) => [a !== b]),
  puzzle('solnand', 'Nand', 'Y is 0 only when A and B are both 1.', ['A', 'B'], ['Y'], ([a, b]) => [!(a && b)]),
  puzzle('solhalf', 'Half adder', 'S is the sum bit. C is the carry.', ['A', 'B'], ['S', 'C'], ([a, b]) => [a !== b, a && b]),
  puzzle('solmaj', 'Majority', 'Y is 1 when at least two inputs are 1.', ['A', 'B', 'C'], ['Y'], ([a, b, c]) => [
    Number(a) + Number(b) + Number(c) >= 2,
  ]),
  puzzle('solfull', 'Full adder', 'Add A, B, and Ci. S is the sum, Co the carry.', ['A', 'B', 'Ci'], ['S', 'Co'], ([a, b, ci]) => {
    const n = Number(a) + Number(b) + Number(ci);
    return [n % 2 === 1, n >= 2];
  }),
];

export function puzzleTable(spec: PuzzleSpec): TableData {
  return {
    mode: 'solution',
    inputs: spec.inputs.length,
    outputs: spec.outputs.length,
    names: [...spec.inputs, ...spec.outputs],
    rows: spec.rows.slice(),
  };
}

/** The question table and a note that states the goal. The circuit is left for the player. */
export function puzzleDoc(spec: PuzzleSpec): Doc {
  const doc = emptyDoc(spec.name);
  const table = makeComponent('table', 0, 0, 'table');
  const data = puzzleTable(spec);
  table.table = data;
  const size = layoutTable(data);
  table.w = size.w;
  table.h = size.h;
  doc.components.set(table.id, table);
  const noteW = Math.max(size.w, 220);
  const note = makeComponent('note', (size.w - noteW) / 2, -108, 'hint');
  note.w = noteW;
  note.h = 76;
  note.name = spec.hint;
  doc.components.set(note.id, note);
  return doc;
}
