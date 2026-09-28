import { describe, expect, it } from 'vitest';
import { makeComponent } from './doc';
import { componentOps, type TextOp } from './shapes';
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
