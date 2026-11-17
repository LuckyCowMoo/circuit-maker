import { describe, expect, it } from 'vitest';
import { makeComponent } from './doc';
import { applyXf, xformOf } from './geometry';
import { componentOps, pointOnKnob, type TextOp } from './shapes';
import { THEMES } from './themes';

const theme = THEMES[0];

function legend(kind: 'button' | 'switch' | 'timer', key: string | null, w = 120, h = 120, fill: string | null = null) {
  const c = makeComponent(kind, 0, 0, 'part');
  c.w = w;
  c.h = h;
  c.key = key;
  c.fill = fill;
  const texts = componentOps(c, theme, {}).filter((op): op is TextOp => op.t === 'text');
  return { c, texts, label: texts.map((op) => op.text).join(' ') };
}

describe('key on the part', () => {
  it('prints the bound key on a button', () => {
    const bound = legend('button', 'NumpadEnter');
    expect(bound.label).toBe('Num Enter');
    expect(bound.texts.length).toBeGreaterThan(0);
    for (const op of bound.texts) {
      expect(op.anchor).toBe('middle');
      expect(op.x).toBe(60);
      expect(op.size).toBeGreaterThan(8);
    }
    expect(legend('button', null).texts).toHaveLength(0);
  });

  it('prints the bound key inside the switch pip, and the pip carries it when flipped', () => {
    const off = legend('switch', 'KeyA', 40, 40);
    expect(off.label).toBe('A');
    expect(off.texts).toHaveLength(1);
    expect(off.texts[0].y).toBe(20);
    const on = makeComponent('switch', 0, 0, 'part');
    on.w = 40;
    on.h = 40;
    on.key = 'KeyA';
    on.on = true;
    const flipped = componentOps(on, theme, { active: true }).filter((op): op is TextOp => op.t === 'text');
    expect(flipped).toHaveLength(1);
    expect(flipped[0].y).toBe(20);
    expect(flipped[0].x).toBeGreaterThan(off.texts[0].x);
    expect(legend('switch', null, 40, 40).texts).toHaveLength(0);
  });

  it('picks ink that reads on the part colour', () => {
    expect(legend('button', 'KeyA', 120, 120, '#ffffff').texts[0].fill).toBe('#111111');
    expect(legend('button', 'KeyA', 120, 120, '#111111').texts[0].fill).toBe('#ffffff');
    const pressed = makeComponent('button', 0, 0, 'part');
    pressed.w = 120;
    pressed.h = 120;
    pressed.key = 'NumpadEnter';
    const on = componentOps(pressed, theme, { active: true, netOn: 'hsl(285, 100%, 50%)' }).filter(
      (op): op is TextOp => op.t === 'text',
    );
    expect(on[0].fill).toBe('#ffffff');
  });

  it('leaves timers unlabeled', () => {
    expect(legend('timer', 'KeyA').texts).toHaveLength(0);
  });
});

describe('switch and button knobs', () => {
  const at = (c: ReturnType<typeof makeComponent>, local: { x: number; y: number }, t?: number, pressed?: boolean) =>
    pointOnKnob(c, applyXf(xformOf(c), local), t, pressed);

  it('hits the switch pip and misses the housing', () => {
    const sw = makeComponent('switch', 80, 40, 's');
    expect(at(sw, { x: 14, y: 20 }, 0)).toBe(true);
    expect(at(sw, { x: 32, y: 20 }, 0)).toBe(false);
    expect(at(sw, { x: 2, y: 2 }, 0)).toBe(false);
    expect(at(sw, { x: 26, y: 20 }, 1)).toBe(true);
    expect(at(sw, { x: 8, y: 20 }, 1)).toBe(false);
    sw.rot = 1;
    expect(at(sw, { x: 14, y: 20 }, 0)).toBe(true);
    expect(at(sw, { x: 2, y: 2 }, 0)).toBe(false);
  });

  it('hits the button face and misses the housing', () => {
    const btn = makeComponent('button', 0, 0, 'b');
    expect(at(btn, { x: 20, y: 20 })).toBe(true);
    expect(at(btn, { x: 3, y: 3 })).toBe(false);
    expect(at(btn, { x: 8, y: 20 })).toBe(false);
    expect(at(btn, { x: 8, y: 20 }, undefined, true)).toBe(false);
    expect(at(btn, { x: 20, y: 20 }, undefined, true)).toBe(true);
  });

  it('draws the puzzles button as a single green button shape with no outer base', () => {
    const puz = makeComponent('puzzles', 0, 0, 'p');
    expect(puz.w).toBe(180);
    expect(puz.h).toBe(80);
    const ops = componentOps(puz, theme, { active: false });
    const paths = ops.filter((op) => op.t === 'path');
    expect(paths).toHaveLength(1);
    if (paths[0].t === 'path') {
      expect(paths[0].fill).toBe(theme.on);
    }
    const texts = ops.filter((op): op is TextOp => op.t === 'text');
    expect(texts.map((t) => t.text).join(' ')).toBe('Puzzles');
  });
});

describe('truth table test row highlight', () => {
  it('draws a row highlight rectangle when tableTestRow is provided', () => {
    const table = makeComponent('table', 0, 0, 'tbl');
    table.table = {
      mode: 'solution',
      inputs: 2,
      outputs: 1,
      names: ['A', 'B', 'Q'],
      rows: ['0', '0', '0', '1'],
    };

    // No highlight when tableTestRow is undefined
    const opsNoTest = componentOps(table, theme, { active: false });
    const highlightsNoTest = opsNoTest.filter(
      (op) => op.t === 'path' && op.fill === theme.selection && op.alpha === 0.18,
    );
    expect(highlightsNoTest).toHaveLength(0);

    // Row 0 highlighted
    const opsRow0 = componentOps(table, theme, { active: false, tableTestRow: 0 });
    const highlightsRow0 = opsRow0.filter(
      (op) => op.t === 'path' && op.fill === theme.selection && op.alpha === 0.18,
    );
    expect(highlightsRow0).toHaveLength(1);

    // Row 1 highlighted
    const opsRow1 = componentOps(table, theme, { active: false, tableTestRow: 1 });
    const highlightsRow1 = opsRow1.filter(
      (op) => op.t === 'path' && op.fill === theme.selection && op.alpha === 0.18,
    );
    expect(highlightsRow1).toHaveLength(1);

    // Row 1 highlight Y coordinate is 22px (TABLE_ROW_H) below row 0
    // d is roundRectD: M(x+r) (y) H(x+w-r) ...
    // Let's verify row 1 is shifted down relative to row 0
    expect(highlightsRow1[0]).not.toEqual(highlightsRow0[0]);
    if (highlightsRow0[0].t === 'path' && highlightsRow1[0].t === 'path') {
      const matchY0 = highlightsRow0[0].d.match(/M[\d.]+\s+([\d.]+)/);
      const matchY1 = highlightsRow1[0].d.match(/M[\d.]+\s+([\d.]+)/);
      expect(matchY0).not.toBeNull();
      expect(matchY1).not.toBeNull();
      const y0 = parseFloat(matchY0![1]);
      const y1 = parseFloat(matchY1![1]);
      expect(y1 - y0).toBeCloseTo(22, 1);
    }
  });

  it('slides smoothly down when tableTestRow is fractional', () => {
    const table = makeComponent('table', 0, 0, 'tbl');
    table.table = {
      mode: 'solution',
      inputs: 2,
      outputs: 1,
      names: ['A', 'B', 'Q'],
      rows: ['0', '0', '0', '1'],
    };

    const opsRow0 = componentOps(table, theme, { active: false, tableTestRow: 0 });
    const opsRowHalf = componentOps(table, theme, { active: false, tableTestRow: 0.5 });
    const h0 = opsRow0.find((op) => op.t === 'path' && op.fill === theme.selection);
    const hHalf = opsRowHalf.find((op) => op.t === 'path' && op.fill === theme.selection);
    expect(h0 && h0.t === 'path').toBe(true);
    expect(hHalf && hHalf.t === 'path').toBe(true);
    if (h0?.t === 'path' && hHalf?.t === 'path') {
      const y0 = parseFloat(h0.d.match(/M[\d.]+\s+([\d.]+)/)![1]);
      const yHalf = parseFloat(hHalf.d.match(/M[\d.]+\s+([\d.]+)/)![1]);
      expect(yHalf - y0).toBeCloseTo(11, 1);
    }
  });
});
