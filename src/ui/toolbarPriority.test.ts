import { describe, expect, it } from 'vitest';
import { computeOpenSegments, SEGMENT_PRIORITY } from './Toolbar';

describe('toolbar priority segment packing', () => {
  it('defines the priority order to only prioritise gates and io', () => {
    expect(SEGMENT_PRIORITY).toEqual([
      'gates', // prio 0 - highest priority (operators)
      'io',    // prio 1 - I/O menu
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

  it('only opens gates and io in compact mode, keeping all other submenus closed even when room is large', () => {
    const open = computeOpenSegments(1100, thinWidth, iconWidth, sampleWidths);
    expect(open.size).toBe(2);
    expect(open.has('gates')).toBe(true);
    expect(open.has('io')).toBe(true);
    expect(open.has('menu')).toBe(false);
    expect(open.has('components')).toBe(false);
    expect(open.has('comments')).toBe(false);
    expect(open.has('time')).toBe(false);
    expect(open.has('navigation')).toBe(false);
  });

  it('opens both gates and io when room fits both', () => {
    // Top 2 (gates, io) need: 320 + 170 + 90 = 580px.
    const open = computeOpenSegments(600, thinWidth, iconWidth, sampleWidths);
    expect(open.has('gates')).toBe(true);
    expect(open.has('io')).toBe(true);
    expect(open.size).toBe(2);
  });

  it('keeps only gates (highest prio 0) open when room only allows prio 0', () => {
    // gates only needs: 320 + 170 = 490px.
    const open = computeOpenSegments(500, thinWidth, iconWidth, sampleWidths);
    expect(open.has('gates')).toBe(true);
    expect(open.has('io')).toBe(false);
    expect(open.size).toBe(1);
  });

  it('collapses all sections into icons on very thin screens where even gates cannot fit', () => {
    const open = computeOpenSegments(350, thinWidth, iconWidth, sampleWidths);
    expect(open.size).toBe(0);
  });

  it('allows io to open alongside gates when gates catalogue is in GCSE mode (narrower gates)', () => {
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
