import { describe, expect, it } from 'vitest';
import { noteLayout } from '../model/shapes';
import { tableComplete } from '../model/table';
import { exampleIconSvg } from './exampleIcons';
import { exampleCardColors, exampleComplexity } from './exampleVisuals';
import { EXAMPLES } from './catalog';
import { PUZZLES, puzzleDoc, puzzleTable, type PuzzleSpec } from './puzzles';

/** True when one AND, OR, XOR, NAND, NOR, or XNOR gate produces the only output. */
function isSingleGate(spec: PuzzleSpec): boolean {
  if (spec.outputs.length !== 1) return false;
  const n = spec.inputs.length;
  const bits = (row: number) => Array.from({ length: n }, (_, col) => ((row >> (n - 1 - col)) & 1) === 1);
  const y = spec.rows.map((row) => row === '1');
  const match = (fn: (bs: boolean[]) => boolean) => y.every((bit, row) => bit === fn(bits(row)));
  const ones = (bs: boolean[]) => bs.filter(Boolean).length;
  return (
    match((bs) => bs.every(Boolean)) ||
    match((bs) => bs.some(Boolean)) ||
    match((bs) => !bs.every(Boolean)) ||
    match((bs) => bs.every((bit) => !bit)) ||
    match((bs) => ones(bs) % 2 === 1) ||
    match((bs) => ones(bs) % 2 === 0)
  );
}

function lightness(bg: string): number {
  const m = /hsl\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%\s*\)/.exec(bg);
  return m ? Number(m[1]) : NaN;
}

describe('solution puzzles', () => {
  it('offers solution tables, easiest first, with one single gate', () => {
    expect(PUZZLES.map((p) => p.id)).toEqual([
      'soland',
      'soleither',
      'solonly',
      'solboth',
      'solsame',
      'solhigh',
      'solhalf',
      'solunless',
      'solpick',
      'solmaj',
      'solmost',
      'solfull',
    ]);
    expect(PUZZLES.filter(isSingleGate).map((p) => p.id)).toEqual(['soland']);
    expect(EXAMPLES[0].name).toBe('Puzzles');
    expect(EXAMPLES[0].items.map((item) => item.id)).toEqual(PUZZLES.map((p) => p.id));
    let prev = -1;
    for (const spec of PUZZLES) {
      const rank = exampleComplexity(spec.id);
      expect(rank).toBeGreaterThan(prev);
      prev = rank;
      const table = puzzleTable(spec);
      expect(table.mode).toBe('solution');
      expect(tableComplete(table)).toBe(true);
      expect(table.rows).toEqual(spec.rows);
      const doc = puzzleDoc(spec);
      const spawned = [...doc.components.values()].find((c) => c.kind === 'table');
      const note = [...doc.components.values()].find((c) => c.kind === 'note');
      expect(spawned?.table?.rows).toEqual(spec.rows);
      expect(note?.name).toBe(spec.hint);
      expect(noteLayout(spec.hint, note?.w ?? 0, note?.h ?? 0).size).toBeGreaterThanOrEqual(15);
      expect((note?.w ?? 0) % 10).toBe(0);
      expect((note?.h ?? 0) % 10).toBe(0);
      expect((note?.y ?? 0) + (note?.h ?? 0)).toBeLessThan(0);
    }
    const lights = PUZZLES.map((spec) => lightness(exampleCardColors('Puzzles', spec.id).bg));
    for (let i = 1; i < lights.length; i++) expect(lights[i]).toBeLessThan(lights[i - 1]);
  });

  it('draws a denser icon for each harder puzzle', () => {
    const icons = PUZZLES.map((spec) => exampleIconSvg(spec.id));
    expect(new Set(icons).size).toBe(PUZZLES.length);
    const dots = icons.map((svg) => (svg.match(/<circle\b/g) ?? []).length);
    expect(dots).toEqual(PUZZLES.map((_, step) => step + 1));
  });
});
