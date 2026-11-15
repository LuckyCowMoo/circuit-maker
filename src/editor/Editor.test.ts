import { describe, expect, it, beforeEach } from 'vitest';
import { makeComponent } from '../model/doc';
import { pinDistance, pinPos, attachPos } from '../model/geometry';
import { Editor } from './Editor';
import { drawPinGrabArea } from './renderer';

const store = new Map<string, string>();
const mockStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.localStorage = mockStorage as unknown as Storage;

describe('Editor selection style', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('defaults waveSelection to false (blue box selection outline on by default)', () => {
    const editor = new Editor();
    expect(editor.waveSelection).toBe(false);
  });

  it('allows toggling waveSelection and persists the preference', () => {
    const editor = new Editor();
    expect(editor.waveSelection).toBe(false);

    editor.setWaveSelection(true);
    expect(editor.waveSelection).toBe(true);
    expect(mockStorage.getItem('circuit-maker:wave-selection')).toBe('1');

    // A new editor instance should pick up the saved '1'
    const restoredEditor = new Editor();
    expect(restoredEditor.waveSelection).toBe(true);

    editor.setWaveSelection(false);
    expect(editor.waveSelection).toBe(false);
    expect(mockStorage.getItem('circuit-maker:wave-selection')).toBe('0');

    const restoredEditor2 = new Editor();
    expect(restoredEditor2.waveSelection).toBe(false);
  });
});

describe('Pin grab area shape and hit testing', () => {
  it('measures distance along the full pin stub and around the rounded tip', () => {
    // Switch at (0, 0), size 40x40.
    // Output pin is pin -1.
    // Base is at (40, 20), tip is at (60, 20).
    const sw = makeComponent('switch', 0, 0, 'sw');
    expect(attachPos(sw, -1)).toEqual({ x: 40, y: 20 });
    expect(pinPos(sw, -1)).toEqual({ x: 60, y: 20 });

    // Exactly at the base (where pin leaves switch body)
    expect(pinDistance(sw, -1, { x: 40, y: 20 })).toBe(0);

    // Halfway along the pin stub
    expect(pinDistance(sw, -1, { x: 50, y: 20 })).toBe(0);

    // 4 units above the pin stub
    expect(pinDistance(sw, -1, { x: 50, y: 24 })).toBe(4);

    // At the pin tip
    expect(pinDistance(sw, -1, { x: 60, y: 20 })).toBe(0);

    // In the rounded cap 5 units past the pin tip
    expect(pinDistance(sw, -1, { x: 65, y: 20 })).toBe(5);

    // Inside the switch body (more than 2 units in)
    expect(pinDistance(sw, -1, { x: 30, y: 20 })).toBe(Infinity);
  });

  it('allows grabbing the pin from anywhere along the stub out to the tip', () => {
    const editor = new Editor();
    const sw = makeComponent('switch', 0, 0, 'sw');
    editor.doc.components.set(sw.id, sw);

    // Clicking halfway along the stub (x=50, y=20) hits the pin
    const hitMid = editor.hitPin({ x: 50, y: 20 }, null);
    expect(hitMid).toEqual({ comp: 'sw', pin: -1 });

    // Clicking at the pin base near the body (x=41, y=20) hits the pin
    const hitBase = editor.hitPin({ x: 41, y: 20 }, null);
    expect(hitBase).toEqual({ comp: 'sw', pin: -1 });

    // Clicking at the tip (x=60, y=20) hits the pin
    const hitTip = editor.hitPin({ x: 60, y: 20 }, null);
    expect(hitTip).toEqual({ comp: 'sw', pin: -1 });

    // Clicking inside the switch body does not hit the pin
    const hitInside = editor.hitPin({ x: 20, y: 20 }, null);
    expect(hitInside).toBeNull();
  });

  it('draws the capsule grab area contour onto canvas without error', () => {
    const sw = makeComponent('switch', 0, 0, 'sw');
    const ops: string[] = [];
    const mockCtx = {
      beginPath: () => ops.push('beginPath'),
      arc: (...args: number[]) => ops.push(`arc(${args.map(Math.round).join(',')})`),
      lineTo: (x: number, y: number) => ops.push(`lineTo(${Math.round(x)},${Math.round(y)})`),
      closePath: () => ops.push('closePath'),
      stroke: () => ops.push('stroke'),
      strokeStyle: '',
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D;

    drawPinGrabArea(mockCtx, sw, -1, '#2f7cf6', 1);
    expect(ops).toContain('beginPath');
    expect(ops).toContain('closePath');
    expect(ops).toContain('stroke');
    expect(ops.some((op) => op.startsWith('arc'))).toBe(true);
    expect(ops.some((op) => op.startsWith('lineTo'))).toBe(true);
  });
});
