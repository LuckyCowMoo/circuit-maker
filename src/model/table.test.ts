import { describe, expect, it } from 'vitest';
import { makeComponent } from './doc';
import { pinPos } from './geometry';
import {
  TABLE_CONVERT_LABEL,
  TABLE_CONVERT_MS,
  addInputColumn,
  addOutputColumn,
  blankOutputColumn,
  comboIndex,
  dropOutput,
  freshTable,
  gradeRow,
  layoutTable,
  observe,
  pinIsSpare,
  pinSide,
  rowBit,
  tableComplete,
  tablePassed,
  wipeRows,
} from './table';
import type { TableData } from './types';

function seen(inputs: number, outputs: number, fill: (row: number) => string): TableData {
  const t = freshTable();
  t.inputs = inputs;
  t.outputs = outputs;
  t.names = Array.from({ length: inputs + outputs }, (_, i) => String(i));
  t.rows = Array.from({ length: 1 << inputs }, (_, row) => fill(row));
  return t;
}

describe('truth table rows', () => {
  it('names the convert button and waits three seconds', () => {
    expect(TABLE_CONVERT_LABEL).toBe('convert to question');
    expect(TABLE_CONVERT_MS).toBe(3000);
    expect(layoutTable(freshTable()).button.w).toBeGreaterThanOrEqual(130);
  });

  it('numbers combinations with the leftmost input as the high bit', () => {
    expect(comboIndex([false, false, false])).toBe(0);
    expect(comboIndex([false, false, true])).toBe(1);
    expect(comboIndex([false, true, false])).toBe(2);
    expect(comboIndex([true, false, false])).toBe(4);
    expect(rowBit(3, 1, 0)).toBe('0');
    expect(rowBit(3, 1, 2)).toBe('1');
    expect(rowBit(3, 4, 0)).toBe('1');
  });

  it('fills a blank row once and does not overwrite it', () => {
    const t = freshTable();
    addInputColumn(t, 'A');
    addInputColumn(t, 'B');
    addOutputColumn(t, '1');
    expect(t.rows).toEqual([null, null, null, null]);
    expect(observe(t, [false, true], [true])).toBe(true);
    expect(t.rows[1]).toBe('1');
    expect(observe(t, [false, true], [false])).toBe(false);
    expect(t.rows[1]).toBe('1');
    expect(tableComplete(t)).toBe(false);
  });

  it('wipes recorded rows when an input column is added', () => {
    const t = seen(1, 1, () => '1');
    expect(tableComplete(t)).toBe(true);
    addInputColumn(t, 'B');
    expect(t.inputs).toBe(2);
    expect(t.rows).toEqual([null, null, null, null]);
    expect(tableComplete(t)).toBe(false);
  });

  it('keeps old output cells when a new output is added, and fills only the blank one later', () => {
    const t = seen(1, 1, (row) => (row === 0 ? '0' : '1'));
    addOutputColumn(t, '2');
    expect(t.rows).toEqual(['0', '1']);
    expect(tableComplete(t)).toBe(false);
    expect(observe(t, [false], [true, false])).toBe(true);
    expect(t.rows[0]).toBe('00');
    expect(observe(t, [true], [false, true])).toBe(true);
    expect(t.rows[1]).toBe('11');
    expect(tableComplete(t)).toBe(true);
  });

  it('drops an output column without clearing the others', () => {
    const t = seen(1, 2, () => '01');
    dropOutput(t, 0);
    expect(t.outputs).toBe(1);
    expect(t.rows).toEqual(['1', '1']);
    expect(tableComplete(t)).toBe(true);
  });

  it('blanks one output column so it can be recorded again', () => {
    const t = seen(1, 2, () => '01');
    blankOutputColumn(t, 1);
    expect(t.rows).toEqual(['0.', '0.']);
    expect(tableComplete(t)).toBe(false);
    wipeRows(t);
    expect(t.rows.every((row) => row == null)).toBe(true);
  });

  it('grades each output on its own', () => {
    expect(gradeRow('01', [false, true])).toBe('pp');
    expect(gradeRow('01', [false, false])).toBe('pf');
    expect(gradeRow('1', [false])).toBe('f');
  });

  it('counts a solution as correct only when every output passed', () => {
    const t = seen(1, 1, () => '1');
    t.mode = 'solution';
    expect(tablePassed(t)).toBe(false);
    t.marks = ['p', null];
    expect(tablePassed(t)).toBe(false);
    t.marks = ['p', 'f'];
    expect(tablePassed(t)).toBe(false);
    t.marks = ['p', 'p'];
    expect(tablePassed(t)).toBe(true);
    t.mode = 'discovery';
    expect(tablePassed(t)).toBe(false);
  });

  it('grows a spare pin on each half until the cap, and solution tables have none', () => {
    const t = freshTable();
    const lay = layoutTable(t);
    expect(lay.pins.map((pin) => pin.pin)).toEqual([0, 8]);
    const grown = freshTable();
    grown.inputs = 2;
    grown.outputs = 1;
    const pins = layoutTable(grown).pins;
    const spareIn = pins.find((pin) => pin.side === 'in' && pin.spare)!;
    const spareOut = pins.find((pin) => pin.side === 'out' && pin.spare)!;
    const real = pins.filter((pin) => !pin.spare);
    expect(real).toHaveLength(3);
    expect(spareIn.colW).toBe(0);
    expect(spareOut.colW).toBe(0);
    expect(spareIn.x).toBeLessThan(pins.find((pin) => pin.pin === 0)!.x);
    expect(spareOut.x).toBeGreaterThan(pins.find((pin) => pin.pin === 8)!.x);
    const wide = layoutTable(grown);
    expect(wide.button.w).toBe(wide.w - 16);
    expect(wide.button.y + wide.button.h).toBeLessThan(wide.labelY);
    expect(pinIsSpare(t, 0)).toBe(true);
    expect(pinIsSpare(t, 8)).toBe(true);
    expect(pinSide(t, 1)).toBeNull();
    t.mode = 'solution';
    t.inputs = 2;
    t.outputs = 1;
    expect(pinIsSpare(t, 2)).toBe(false);
    expect(pinSide(t, 0)).toBe('in');
    expect(pinSide(t, 1)).toBe('in');
    expect(pinSide(t, 2)).toBeNull();
    expect(pinSide(t, 8)).toBe('out');
    const solved = layoutTable(t);
    expect(solved.pins.map((pin) => pin.pin)).toEqual([0, 1, 8]);
    expect(solved.pins.every((pin) => pin.colW === solved.pins[0].colW)).toBe(true);
    expect(solved.gridRight).toBe(solved.w - 8);
    const gap = solved.pins[2].colX - (solved.pins[1].colX + solved.pins[1].colW);
    expect(gap).toBeGreaterThan(16);
  });

  it('places output pins to the right of the input pins, above the body', () => {
    const c = makeComponent('table', 10, 20, 'tt');
    c.table!.inputs = 2;
    c.table!.outputs = 1;
    c.table!.mode = 'solution';
    const a = pinPos(c, 0);
    const b = pinPos(c, 1);
    const out = pinPos(c, 8);
    const missing = pinPos(c, 2);
    expect(a && b && out).toBeTruthy();
    expect(b!.x).toBeGreaterThan(a!.x);
    expect(out!.x).toBeGreaterThan(b!.x);
    expect(a!.y).toBeLessThan(c.y);
    expect(missing).toBeNull();
  });
});
