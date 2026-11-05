import { describe, expect, it } from 'vitest';
import { tableComplete } from '../model/table';
import { exampleIconSvg } from './exampleIcons';
import { exampleCardColors, exampleComplexity } from './exampleVisuals';
import { EXAMPLES } from './catalog';
import { PUZZLES, puzzleDoc, puzzleTable } from './puzzles';

function lightness(bg: string): number {
  const m = /hsl\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%\s*\)/.exec(bg);
  return m ? Number(m[1]) : NaN;
}

describe('solution puzzles', () => {
  it('offers eight solution tables, easiest first', () => {
    expect(PUZZLES).toHaveLength(8);
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
      expect(spawned?.table?.rows).toEqual(spec.rows);
    }
    const lights = PUZZLES.map((spec) => lightness(exampleCardColors('Puzzles', spec.id).bg));
    for (let i = 1; i < lights.length; i++) expect(lights[i]).toBeLessThan(lights[i - 1]);
  });

  it('draws a denser icon for each harder puzzle', () => {
    const icons = PUZZLES.map((spec) => exampleIconSvg(spec.id));
    expect(new Set(icons).size).toBe(PUZZLES.length);
    const dots = icons.map((svg) => (svg.match(/<circle\b/g) ?? []).length);
    expect(dots).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
