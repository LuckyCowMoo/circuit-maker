import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../model/doc';
import { THEMES } from '../model/themes';
import { boxesPreviewSvg, exampleCardColors, exampleComplexity, expandSvgCanvas, heroAccent } from './exampleVisuals';

describe('example visuals', () => {
  it('darkens cards with bit width', () => {
    const a0 = exampleCardColors('Arithmetic', 'half').bg;
    const a2 = exampleCardColors('Arithmetic', 'adder4').bg;
    const a3 = exampleCardColors('Arithmetic', 'adder8').bg;
    expect(a0).not.toBe(a2);
    expect(a2).not.toBe(a3);
    expect(exampleComplexity('calc')).toBe(4);
    expect(exampleCardColors('Arithmetic', 'calc').bg).toBe('#0c0c0e');
    expect(exampleCardColors('Arithmetic', 'calc').label).toBe('#f4f4f5');
    expect(exampleCardColors('Arithmetic', 'half').label).toMatch(/^hsl\(168, 72%, (12|16|20)%\)$/);
    expect(exampleCardColors('Memory', 'reg8').label).toMatch(/^hsl\(278, 72%, (12|16|20)%\)$/);
  });

  it('pads a wide preview with space above and below', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100" width="300" height="100"><rect x="0" y="0" width="300" height="100" fill="#fff"/><path d="M10 50H290"/></svg>';
    const out = expandSvgCanvas(svg);
    expect(out).toContain('viewBox="0 -62.5 300 225"');
    expect(out).toContain('width="300" height="225"');
    expect(out).toContain('<rect x="0" y="-62.5" width="300" height="225"');
    expect(out).toContain('<path d="M10 50H290"/>');
  });

  it('draws large-example previews as boxes', () => {
    const doc = emptyDoc('Big');
    doc.boxes.set('outer', { id: 'outer', name: 'Outer', x: 0, y: 0, w: 400, h: 240, color: '#0f766e' });
    doc.boxes.set('inner', { id: 'inner', name: 'Inner', x: 40, y: 40, w: 80, h: 50, color: '#5b4b8a' });
    const svg = boxesPreviewSvg(doc, THEMES[0]);
    expect(svg).toContain('Outer');
    expect(svg).toContain('fill="#0f766e"');
    expect(svg).not.toContain('parts');
  });

  it('picks a hero accent per theme', () => {
    for (const t of THEMES) {
      expect(heroAccent(t)).toMatch(/^#/);
    }
  });
});
