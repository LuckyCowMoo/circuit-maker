import { describe, expect, it } from 'vitest';
import { accentAura, auraHueOf, auraJitter, kindAura, THEMES } from './themes';

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe('aura colours', () => {
  it('keeps each gate in its own hue family', () => {
    expect(auraHueOf('and')).toBe(4);
    expect(auraHueOf('or')).toBe(214);
    expect(auraHueOf('xor')).toBe(278);
    expect(auraHueOf('buffer')).toBe(22);
    expect(auraHueOf('not')).toBe(332);
  });

  it('jitters a placed part a little and keeps that shift', () => {
    expect(auraJitter('')).toBe(0);
    const ids = ['and_a', 'and_b', 'or_c', 'xor_d', 'gate_e', 'gate_f', 'gate_g', 'gate_h'];
    const shifts = ids.map((id) => auraJitter(id));
    for (const shift of shifts) {
      expect(Math.abs(shift)).toBeLessThanOrEqual(24);
      expect(auraJitter(ids[shifts.indexOf(shift)])).toBe(shift);
    }
    expect(new Set(shifts.map((n) => n.toFixed(4))).size).toBeGreaterThan(1);
    for (const id of ids) expect(hueDistance(auraHueOf('and', id), 4)).toBeLessThanOrEqual(24);
  });

  it('paints kinds in the expected families and retunes them per theme', () => {
    const solar = THEMES[0];
    const midnight = THEMES[2];
    const and = kindAura(solar, 'and');
    const or = kindAura(solar, 'or');
    const xor = kindAura(solar, 'xor');
    expect(and.r).toBeGreaterThan(and.g);
    expect(and.r).toBeGreaterThan(and.b);
    expect(or.b).toBeGreaterThan(or.r);
    expect(or.b).toBeGreaterThan(or.g);
    expect(xor.b).toBeGreaterThan(xor.g);
    expect(xor.r).toBeGreaterThan(xor.g);
    expect(kindAura(solar, 'and')).not.toEqual(kindAura(midnight, 'and'));
    expect(kindAura(solar, 'and', 'and_a')).toEqual(kindAura(solar, 'and', 'and_a'));
    expect(accentAura(solar)).not.toEqual(accentAura(midnight));
  });
});
