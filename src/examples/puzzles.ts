import { emptyDoc, makeComponent } from '../model/doc';
import { GRID } from '../model/geometry';
import { noteLayout } from '../model/shapes';
import { layoutTable, rowCount } from '../model/table';
import type { Component, Doc, TableData } from '../model/types';

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

/**
 * Easiest first. And is the one single-gate puzzle. Each later puzzle needs a
 * larger circuit. Full adder stays the hardest.
 */
export const PUZZLES: PuzzleSpec[] = [
  puzzle('soland', 'And', 'Y is 1 only when A and B are both 1.', ['A', 'B'], ['Y'], ([a, b]) => [a && b]),
  puzzle('soleither', 'Either and both', 'X is 1 when A or B is on. Y is 1 only when both are on.', ['A', 'B'], ['X', 'Y'], ([a, b]) => [
    a || b,
    a && b,
  ]),
  puzzle('solonly', 'Only A', 'Y is 1 only when A is on and B is off.', ['A', 'B'], ['Y'], ([a, b]) => [a && !b]),
  puzzle(
    'solboth',
    'Only or both',
    'Only is 1 only when A is on and B is off. Both is 1 only when A and B are both on.',
    ['A', 'B'],
    ['Only', 'Both'],
    ([a, b]) => [a && !b, a && b],
  ),
  puzzle('solsame', 'Same or different', 'Same is 1 when A and B match. Diff is 1 when they differ.', ['A', 'B'], ['Same', 'Diff'], ([a, b]) => [
    a === b,
    a !== b,
  ]),
  puzzle(
    'solhigh',
    'Which side',
    'High is 1 only when A is on and B is off. Low is 1 only when A is off and B is on.',
    ['A', 'B'],
    ['High', 'Low'],
    ([a, b]) => [a && !b, !a && b],
  ),
  puzzle(
    'solhalf',
    'Half adder',
    'S is the sum, 1 when A and B differ. C is the carry, 1 only when both are 1.',
    ['A', 'B'],
    ['S', 'C'],
    ([a, b]) => [a !== b, a && b],
  ),
  puzzle('solunless', 'Unless', 'Y is 1 only when A and B are on and C is off.', ['A', 'B', 'C'], ['Y'], ([a, b, c]) => [a && b && !c]),
  puzzle(
    'solpick',
    'Choose',
    'Y matches A while Pick is off, and matches B while Pick is on.',
    ['A', 'B', 'Pick'],
    ['Y'],
    ([a, b, pick]) => [pick ? b : a],
  ),
  puzzle('solmaj', 'Majority', 'Y is 1 when at least two of A, B, and C are on.', ['A', 'B', 'C'], ['Y'], ([a, b, c]) => [
    Number(a) + Number(b) + Number(c) >= 2,
  ]),
  puzzle(
    'solmost',
    'Most or all',
    'Most is 1 when at least two of A, B, and C are on. All is 1 only when every one is on.',
    ['A', 'B', 'C'],
    ['Most', 'All'],
    ([a, b, c]) => {
      const n = Number(a) + Number(b) + Number(c);
      return [n >= 2, n === 3];
    },
  ),
  puzzle(
    'solfull',
    'Full adder',
    'S is the sum, 1 when an odd number of A, B, and Ci are on. Co is the carry, 1 when at least two are on.',
    ['A', 'B', 'Ci'],
    ['S', 'Co'],
    ([a, b, ci]) => {
      const n = Number(a) + Number(b) + Number(ci);
      return [n % 2 === 1, n >= 2];
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
  };
}

/** Next multiple of the file grid, so a saved puzzle loads back at the same size. */
function onGrid(v: number): number {
  return Math.ceil(v / GRID) * GRID;
}

/** Wide enough, and tall enough, that the plain-English hint stays readable. */
function hintNote(hint: string, tableW: number): Component {
  const w = onGrid(Math.max(tableW, 260));
  let h = onGrid(100);
  while (h < 240 && noteLayout(hint, w, h).size < 15) h += GRID;
  const note = makeComponent('note', (tableW - w) / 2, -(h + 40), 'hint');
  note.w = w;
  note.h = h;
  note.name = hint;
  return note;
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
  const note = hintNote(spec.hint, size.w);
  doc.components.set(note.id, note);
  return doc;
}
