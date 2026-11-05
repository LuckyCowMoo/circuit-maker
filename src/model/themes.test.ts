import { describe, expect, it } from 'vitest';
import { accentAura, AURA_HUE, auraHueOf, auraPartner, kindAura, THEMES, waveGain } from './themes';

describe('aura colours', () => {
  it('keeps each gate in its own hue family', () => {
    expect(auraHueOf('and')).toBe(4);
    expect(auraHueOf('or')).toBe(214);
    expect(auraHueOf('xor')).toBe(278);
    expect(auraHueOf('buffer')).toBe(228);
    expect(auraHueOf('not')).toBe(332);
  });

  it('keeps the truth table wave out of the other families', () => {
    const hue = auraHueOf('table');
    expect(hue).toBe(88);
    for (const [kind, other] of Object.entries(AURA_HUE)) {
      if (kind === 'table') continue;
      const d = Math.abs(hue - other);
      expect(Math.min(d, 360 - d)).toBeGreaterThan(30);
    }
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
    expect(kindAura(solar, 'buffer')).toEqual(kindAura(solar, 'buffer'));
    const partner = auraPartner(and);
    expect(partner).not.toEqual(and);
    for (const ch of [partner.r, partner.g, partner.b]) {
      expect(ch).toBeGreaterThanOrEqual(0);
      expect(ch).toBeLessThanOrEqual(255);
    }
    expect(accentAura(solar)).not.toEqual(accentAura(midnight));
  });

  it('darkens selection waves only on the dark themes', () => {
    expect(waveGain(THEMES[0])).toBe(1);
    expect(waveGain(THEMES[1])).toBe(1);
    expect(waveGain(THEMES[2])).toBe(0.32);
    expect(waveGain(THEMES[3])).toBe(0.32);
    expect(waveGain(THEMES[2])).toBe(waveGain(THEMES[3]));
  });
});
