import { describe, expect, it } from 'vitest';
import { computeOpenSegments, SEGMENT_PRIORITY } from './Toolbar';

describe('toolbar priority segment packing', () => {
  it('defines the priority order exactly as requested', () => {
    expect(SEGMENT_PRIORITY).toEqual([
      'gates',       // prio 0 - highest priority
      'io',          // prio 1
      'menu',        // prio 2
      'components',  // prio 3
      'comments',    // prio 4
      'time',        // prio 5
      'navigation',  // prio 6 - lowest priority
    ]);
  });

  const thinWidth = 320; // 7 icons * 40px + 6 seps * 2px + 12px padding ~ 304-320px
  const iconWidth = 40;
  const sampleWidths: Record<string, number> = {
    gates: 210,      // delta = 170
    io: 130,         // delta = 90
    menu: 210,       // delta = 170
    components: 170, // delta = 130
    comments: 90,    // delta = 50
    time: 190,       // delta = 150
    navigation: 210, // delta = 170
  };
  // Total delta if all 7 are open = 170 + 90 + 170 + 130 + 50 + 150 + 170 = 930
  // Total width when all 7 are open = 320 + 930 = 1250px

  it('keeps all 7 segments open when available room is large enough', () => {
    const open = computeOpenSegments(1300, thinWidth, iconWidth, sampleWidths);
    expect(open.size).toBe(7);
    for (const seg of SEGMENT_PRIORITY) {
      expect(open.has(seg)).toBe(true);
    }
  });

  it('collapses navigation (lowest prio 6) first when space is slightly constrained', () => {
    // Room for 1200px (needed: 1250, deficit: 50).
    // navigation requires delta 170, which cannot fit.
    const open = computeOpenSegments(1200, thinWidth, iconWidth, sampleWidths);
    expect(open.has('gates')).toBe(true);
    expect(open.has('io')).toBe(true);
    expect(open.has('menu')).toBe(true);
    expect(open.has('components')).toBe(true);
    expect(open.has('comments')).toBe(true);
    expect(open.has('time')).toBe(true);
    expect(open.has('navigation')).toBe(false);
  });

  it('collapses time (prio 5) and navigation (prio 6) when room is further constrained', () => {
    // Top 5 (gates, io, menu, components, comments) need:
    // 320 + 170 + 90 + 170 + 130 + 50 = 930px.
    const open = computeOpenSegments(950, thinWidth, iconWidth, sampleWidths);
    expect(open.has('gates')).toBe(true);
    expect(open.has('io')).toBe(true);
    expect(open.has('menu')).toBe(true);
    expect(open.has('components')).toBe(true);
    expect(open.has('comments')).toBe(true);
    expect(open.has('time')).toBe(false);
    expect(open.has('navigation')).toBe(false);
  });

  it('collapses comments (prio 4) next when room drops below its threshold', () => {
    // Top 4 (gates, io, menu, components) need:
    // 320 + 170 + 90 + 170 + 130 = 880px.
    const open = computeOpenSegments(890, thinWidth, iconWidth, sampleWidths);
    expect(open.has('gates')).toBe(true);
    expect(open.has('io')).toBe(true);
    expect(open.has('menu')).toBe(true);
    expect(open.has('components')).toBe(true);
    expect(open.has('comments')).toBe(false);
    expect(open.has('time')).toBe(false);
    expect(open.has('navigation')).toBe(false);
  });

  it('collapses components (prio 3) next', () => {
    // Top 3 (gates, io, menu) need:
    // 320 + 170 + 90 + 170 = 750px.
    const open = computeOpenSegments(760, thinWidth, iconWidth, sampleWidths);
    expect(open.has('gates')).toBe(true);
    expect(open.has('io')).toBe(true);
    expect(open.has('menu')).toBe(true);
    expect(open.has('components')).toBe(false);
  });

  it('collapses menu (prio 2) next', () => {
    // Top 2 (gates, io) need:
    // 320 + 170 + 90 = 580px.
    const open = computeOpenSegments(600, thinWidth, iconWidth, sampleWidths);
    expect(open.has('gates')).toBe(true);
    expect(open.has('io')).toBe(true);
    expect(open.has('menu')).toBe(false);
  });

  it('keeps only gates (highest prio 0) open when room only allows prio 0', () => {
    // gates only needs:
    // 320 + 170 = 490px.
    const open = computeOpenSegments(500, thinWidth, iconWidth, sampleWidths);
    expect(open.has('gates')).toBe(true);
    expect(open.has('io')).toBe(false);
    expect(open.has('menu')).toBe(false);
  });

  it('collapses all sections into icons on very thin screens where even gates cannot fit', () => {
    const open = computeOpenSegments(350, thinWidth, iconWidth, sampleWidths);
    expect(open.size).toBe(0);
  });

  it('allows more sections to open when gates catalogue is in GCSE mode (narrower gates)', () => {
    // In GCSE mode, gates has only 3 gates (~130px, delta 90 instead of 170)
    const gcseWidths = { ...sampleWidths, gates: 130 }; // delta 90
    // With 520px available:
    // Full mode: gates (170) -> 320+170 = 490. io needs 90 -> 490+90=580 > 520, so only gates opens.
    // GCSE mode: gates (90) -> 320+90 = 410. io needs 90 -> 410+90 = 500 <= 520, so BOTH gates AND io open!
    const fullOpen = computeOpenSegments(520, thinWidth, iconWidth, sampleWidths);
    expect(fullOpen.has('gates')).toBe(true);
    expect(fullOpen.has('io')).toBe(false);

    const gcseOpen = computeOpenSegments(520, thinWidth, iconWidth, gcseWidths);
    expect(gcseOpen.has('gates')).toBe(true);
    expect(gcseOpen.has('io')).toBe(true);
  });
});
