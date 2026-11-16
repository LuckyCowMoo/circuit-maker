import { describe, expect, it, beforeEach } from 'vitest';
import { makeComponent } from '../model/doc';
import { pinDistance, pinPos, attachPos } from '../model/geometry';
import { TABLE_OUT, TABLE_STEP_MS, TABLE_SLIDE_MS } from '../model/table';
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

let currentUrl = 'http://localhost/';
const mockWindow = {
  get location() {
    const u = new URL(currentUrl);
    return {
      get href() { return u.href; },
      get search() { return u.search; },
      get pathname() { return u.pathname; },
      get hash() { return u.hash; },
    };
  },
  history: {
    replaceState: (_data: any, _unused: string, url: string) => {
      currentUrl = new URL(url, currentUrl).href;
    },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.window = mockWindow as unknown as Window & typeof globalThis;

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

  it('clears and prevents placeRipple when waveSelection is false', () => {
    const editor = new Editor();
    expect(editor.waveSelection).toBe(false);

    editor.placeRipple = {
      x: 100,
      y: 100,
      dx: 0,
      dy: -1,
      speed: 1,
      t0: 100,
      kind: 'and',
    };
    editor.setWaveSelection(false);
    expect(editor.placeRipple).toBeNull();
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

describe('Truth table testing row highlight and slide animation', () => {
  it('highlights the current test row and smoothly slides between rows', () => {
    const editor = new Editor();
    const sw = makeComponent('switch', 0, 0, 'sw');
    const bulb = makeComponent('bulb', 200, 0, 'bulb');
    const tbl = makeComponent('table', 100, 100, 'tbl');
    tbl.table = {
      mode: 'solution',
      inputs: 1,
      outputs: 1,
      names: ['A', 'Q'],
      rows: ['0', '1'],
    };

    editor.doc.components.set(sw.id, sw);
    editor.doc.components.set(bulb.id, bulb);
    editor.doc.components.set(tbl.id, tbl);
    editor.doc.wires.set('w1', { id: 'w1', from: sw.id, to: tbl.id, input: 0 });
    editor.doc.wires.set('w2', { id: 'w2', from: bulb.id, to: tbl.id, input: TABLE_OUT });

    // Initially no test is running
    expect(editor.testRowPosition(tbl.id)).toBeNull();

    // Start table test
    (editor as any).startTableTest(tbl);
    expect(editor.testRowPosition(tbl.id)).toBe(0);

    // After TABLE_STEP_MS (1000ms), row 0 finishes and it transitions to row 1
    const run = (editor as any).tableTest;
    expect(run).not.toBeNull();
    const tNext = run.nextAt;
    (editor as any).tickTableTest(tNext);

    // Now row 1 has begun, animation is in flight
    expect(run.showing).toBe(1);
    expect(run.fromRow).toBe(0);
    expect(run.toRow).toBe(1);

    // Halfway through TABLE_SLIDE_MS
    (editor as any).visNow = run.slideT0 + TABLE_SLIDE_MS / 2;
    const midPos = editor.testRowPosition(tbl.id);
    expect(midPos).not.toBeNull();
    expect(midPos!).toBeGreaterThan(0.2);
    expect(midPos!).toBeLessThan(0.8);

    // At end of TABLE_SLIDE_MS
    (editor as any).visNow = run.slideT0 + TABLE_SLIDE_MS;
    (editor as any).tickTableTest(run.slideT0 + TABLE_SLIDE_MS);
    expect(editor.testRowPosition(tbl.id)).toBe(1);

    // When the last row finishes, test completes and highlight disappears
    (editor as any).tickTableTest(run.nextAt);
    expect(editor.testRowPosition(tbl.id)).toBeNull();
  });
});

describe('Editor gateMode (GCSE vs Full)', () => {
  beforeEach(() => {
    mockStorage.clear();
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', 'http://localhost/');
    }
  });

  it('defaults to full mode when no mode is specified in the URL', () => {
    window.history.replaceState(null, '', 'http://localhost/');
    const editor = new Editor();
    expect(editor.gateMode).toBe('full');
  });

  it('initializes to gcse mode from ?mode=gcse', () => {
    window.history.replaceState(null, '', 'http://localhost/?mode=gcse');
    const editor = new Editor();
    expect(editor.gateMode).toBe('gcse');
  });

  it('initializes to gcse mode from ?gcse or ?gcse=1', () => {
    window.history.replaceState(null, '', 'http://localhost/?gcse');
    const editor1 = new Editor();
    expect(editor1.gateMode).toBe('gcse');

    window.history.replaceState(null, '', 'http://localhost/?gcse=1');
    const editor2 = new Editor();
    expect(editor2.gateMode).toBe('gcse');
  });

  it('setGateMode toggles gateMode and updates URL', () => {
    const editor = new Editor();
    expect(editor.gateMode).toBe('full');

    editor.setGateMode('gcse');
    expect(editor.gateMode).toBe('gcse');
    expect(window.location.search).toBe('?mode=gcse');

    editor.setGateMode('full');
    expect(editor.gateMode).toBe('full');
    expect(window.location.search).toBe('');
  });

  it('menuItems returns only AND, OR, NOT gates in GCSE mode', () => {
    const editor = new Editor();
    editor.setGateMode('gcse');
    const items = editor.menuItems();
    const gateLabels = items.filter((it) => ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'Buffer'].includes(it.label)).map((it) => it.label);
    expect(gateLabels).toEqual(['AND', 'OR', 'NOT']);
  });

  it('in full mode, placing NOT bubble on empty space toasts error and does not create a buffer', () => {
    const editor = new Editor();
    editor.setGateMode('full');
    expect(editor.doc.components.size).toBe(0);

    editor.placeAt('not', { x: 100, y: 100 });
    expect(editor.doc.components.size).toBe(0);
    expect(editor.toastMessage).toBe('Drop the NOT bubble onto a gate.');
  });

  it('in GCSE mode, placing NOT on empty space creates a buffer with negate = true (a NOT gate)', () => {
    const editor = new Editor();
    editor.setGateMode('gcse');
    expect(editor.doc.components.size).toBe(0);

    editor.placeAt('not', { x: 100, y: 100 });
    expect(editor.doc.components.size).toBe(1);

    const placed = [...editor.doc.components.values()][0];
    expect(placed.kind).toBe('buffer');
    expect(placed.negate).toBe(true);
  });

  it('placing NOT on an existing gate toggles its negate property', () => {
    const editor = new Editor();
    const andGate = editor.addComponent('and', 100, 100);
    expect(andGate.negate).toBe(false);

    // Place NOT directly on the AND gate body
    editor.placeAt('not', { x: 120, y: 120 });
    expect(andGate.negate).toBe(true);

    // Place NOT again to toggle back
    editor.placeAt('not', { x: 120, y: 120 });
    expect(andGate.negate).toBe(false);
  });
});
