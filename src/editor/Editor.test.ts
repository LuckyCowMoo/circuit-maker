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
Object.defineProperty(globalThis, 'location', {
  get: () => mockWindow.location,
  configurable: true,
});
Object.defineProperty(globalThis, 'history', {
  get: () => mockWindow.history,
  configurable: true,
});

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

describe('Puzzles button component and starter circuit', () => {
  beforeEach(() => {
    mockStorage.clear();
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', 'http://localhost/');
    }
  });

  it('loads starter circuit with half adder and the resizable puzzles button', () => {
    const editor = new Editor();
    editor.loadInitial();
    expect(editor.doc.boxes.has('half_adder')).toBe(true);
    const puzzlesBtn = editor.doc.components.get('puzzles');
    expect(puzzlesBtn).toBeDefined();
    expect(puzzlesBtn?.kind).toBe('puzzles');
    expect(puzzlesBtn?.w).toBe(180);
    expect(puzzlesBtn?.h).toBe(80);
  });

  it('treats puzzles button as a resize target when selected and supports edge resizing', () => {
    const editor = new Editor();
    editor.placeAt('puzzles', { x: 200, y: 200 });
    const placed = [...editor.doc.components.values()][0];
    expect(placed.kind).toBe('puzzles');
    expect(placed.w).toBe(180);
    expect(placed.h).toBe(80);
    expect(editor.resizeTarget()?.id).toBe(placed.id);
    expect((editor as any).hitNoteEdge({ x: placed.x, y: placed.y + 40 })?.id).toBe(placed.id);
  });

  it('triggers openPuzzles when clicking the puzzles button without dragging', () => {
    const editor = new Editor();
    editor.placeAt('puzzles', { x: 200, y: 200 });
    const placed = [...editor.doc.components.values()][0];
    let opened = false;
    editor.openPuzzles = () => {
      opened = true;
    };
    const center = { x: placed.x + placed.w / 2, y: placed.y + placed.h / 2 };
    (editor as any).startMove(placed.id, center, center, false, placed);
    (editor as any).finishPointer({ pointerId: 1, clientX: center.x, clientY: center.y } as PointerEvent, false);
    expect(opened).toBe(true);
  });

  it('spawns a puzzles button in a nearby open space when a solution truth table passes', () => {
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
    // Wire switch straight to bulb so Q === A (passes both rows)
    editor.doc.wires.set('w_circuit', { id: 'w_circuit', from: sw.id, to: bulb.id, input: 0 });
    editor.doc.wires.set('w1', { id: 'w1', from: sw.id, to: tbl.id, input: 0 });
    editor.doc.wires.set('w2', { id: 'w2', from: bulb.id, to: tbl.id, input: TABLE_OUT });
    editor.sim.compile(editor.doc);

    expect([...editor.doc.components.values()].some((c) => c.kind === 'puzzles')).toBe(false);

    (editor as any).startTableTest(tbl);
    const run = (editor as any).tableTest;
    (editor as any).tickTableTest(run.nextAt);

    const spawned = [...editor.doc.components.values()].find((c) => c.kind === 'puzzles');
    expect(spawned).toBeDefined();

    // Repeated tests must NOT spawn duplicate puzzle buttons
    (editor as any).startTableTest(tbl);
    const run2 = (editor as any).tableTest;
    (editor as any).tickTableTest(run2.nextAt);
    const puzzleButtons = [...editor.doc.components.values()].filter((c) => c.kind === 'puzzles');
    expect(puzzleButtons.length).toBe(1);

    // If the button is moved far away, a new one can spawn closer
    spawned!.x = 5000;
    spawned!.y = 5000;
    (editor as any).startTableTest(tbl);
    const run3 = (editor as any).tableTest;
    (editor as any).tickTableTest(run3.nextAt);
    const puzzleButtonsAfter = [...editor.doc.components.values()].filter((c) => c.kind === 'puzzles');
    expect(puzzleButtonsAfter.length).toBe(2);
  });

  it('places a trace component that does not spawn until New Circuit is triggered', () => {
    const editor = new Editor();
    editor.placeAt('trace', { x: 300, y: 500 });

    const traceComp = [...editor.doc.components.values()].find((c) => c.kind === 'trace');
    expect(traceComp).toBeDefined();
    expect(traceComp?.trace).toBeDefined();

    // Circuit does NOT spawn immediately upon placement
    const tr = traceComp!.trace!;
    expect(tr.inputs).toBe(0);
    expect(tr.outputs).toBe(0);
    expect(tr.circuitIds).toEqual([]);

    // Circuit spawns when spawnTraceCircuit is triggered
    editor.spawnTraceCircuit(traceComp!);
    const updatedTr = traceComp!.trace!;
    expect(updatedTr.inputs).toBeGreaterThanOrEqual(1);
    expect(updatedTr.inputs).toBeLessThanOrEqual(3);
    expect(updatedTr.outputs).toBeGreaterThanOrEqual(1);
    expect(updatedTr.outputs).toBeLessThanOrEqual(2);
    expect(updatedTr.state).toBe('guess');
    expect(updatedTr.circuitIds?.length).toBeGreaterThan(0);

    // Verify generated components are locked
    for (const id of updatedTr.circuitIds!) {
      const c = editor.doc.components.get(id);
      if (c) expect(c.locked).toBe(true);
      const w = editor.doc.wires.get(id);
      if (w) expect(w.locked).toBe(true);
    }
  });

  it('tracks correct and incorrect predictions when checking guesses on trace component', () => {
    const editor = new Editor();
    editor.placeAt('trace', { x: 300, y: 500 });
    const traceComp = [...editor.doc.components.values()].find((c) => c.kind === 'trace')!;
    editor.spawnTraceCircuit(traceComp);
    const tr = traceComp.trace!;

    expect(tr.correctCount).toBe(0);
    expect(tr.incorrectCount).toBe(0);

    // Force predictions to match actual values
    tr.predicted = tr.actual.slice();
    editor.checkTraceGuess(traceComp);

    expect(tr.correctCount).toBe(1);
    expect(tr.incorrectCount).toBe(0);
    expect(tr.lastResult).toBe('correct');
    expect(tr.state).toBe('revealed');

    // Toggling a switch returns to guess mode
    editor.toggleTraceSwitch(traceComp, 0);
    expect(tr.state).toBe('guess');

    // Set prediction to intentionally opposite of actual
    tr.predicted = tr.actual.map((v) => !v);
    editor.checkTraceGuess(traceComp);

    expect(tr.correctCount).toBe(1);
    expect(tr.incorrectCount).toBe(1);
    expect(tr.lastResult).toBe('incorrect');
    expect(tr.state).toBe('revealed');
  });

  it('prevents deletion of locked trace circuit components and wires', () => {
    const editor = new Editor();
    editor.placeAt('trace', { x: 300, y: 500 });
    const traceComp = [...editor.doc.components.values()].find((c) => c.kind === 'trace')!;
    editor.spawnTraceCircuit(traceComp);
    const lockedCompId = traceComp.trace!.circuitIds!.find((id) => editor.doc.components.has(id))!;

    expect(editor.doc.components.has(lockedCompId)).toBe(true);

    // Select the locked component and attempt deletion
    editor.setSelection([lockedCompId]);
    editor.deleteSelection();

    // Locked component must NOT be deleted
    expect(editor.doc.components.has(lockedCompId)).toBe(true);
  });

  it('deletes the attached logic circuit when trace component is deleted', () => {
    const editor = new Editor();
    editor.placeAt('trace', { x: 300, y: 500 });
    const traceComp = [...editor.doc.components.values()].find((c) => c.kind === 'trace')!;
    editor.spawnTraceCircuit(traceComp);
    const circuitIds = traceComp.trace!.circuitIds!.slice();
    expect(circuitIds.length).toBeGreaterThan(0);

    // Verify circuit components and wires exist
    expect(circuitIds.some((id) => editor.doc.components.has(id))).toBe(true);
    expect(circuitIds.some((id) => editor.doc.wires.has(id))).toBe(true);

    // Select the trace component and delete it
    editor.setSelection([traceComp.id]);
    editor.deleteSelection();

    // Trace component must be deleted
    expect(editor.doc.components.has(traceComp.id)).toBe(false);

    // All attached circuit components and wires must be deleted
    for (const id of circuitIds) {
      expect(editor.doc.components.has(id)).toBe(false);
      expect(editor.doc.wires.has(id)).toBe(false);
    }
  });

  it('deletes trace component and attached circuit when box-selected together', () => {
    const editor = new Editor();
    editor.placeAt('trace', { x: 300, y: 500 });
    const traceComp = [...editor.doc.components.values()].find((c) => c.kind === 'trace')!;
    editor.spawnTraceCircuit(traceComp);
    const circuitIds = traceComp.trace!.circuitIds!.slice();

    // Select both traceComp and some locked circuit elements
    editor.setSelection([traceComp.id, circuitIds[0], circuitIds[1]]);
    editor.deleteSelection();

    // Everything in traceComp and attached circuit should be deleted
    expect(editor.doc.components.has(traceComp.id)).toBe(false);
    for (const id of circuitIds) {
      expect(editor.doc.components.has(id)).toBe(false);
      expect(editor.doc.wires.has(id)).toBe(false);
    }
  });

  it('records components when pupil converts discovery table to solution and supports hint toggling', () => {
    const editor = new Editor();
    const swA = makeComponent('switch', 0, 0, 'sw_a');
    const swB = makeComponent('switch', 0, 80, 'sw_b');
    const andGate = makeComponent('and', 100, 40, 'and_1');
    const notGate = makeComponent('buffer', 200, 40, 'not_1');
    notGate.negate = true;
    const bulb = makeComponent('bulb', 300, 40, 'bulb_1');
    const tbl = makeComponent('table', 100, 200, 'table_1');
    tbl.table = {
      mode: 'discovery',
      inputs: 2,
      outputs: 1,
      names: ['A', 'B', 'Y'],
      rows: ['1', '0', '0', '0'],
    };

    editor.doc.components.set(swA.id, swA);
    editor.doc.components.set(swB.id, swB);
    editor.doc.components.set(andGate.id, andGate);
    editor.doc.components.set(notGate.id, notGate);
    editor.doc.components.set(bulb.id, bulb);
    editor.doc.components.set(tbl.id, tbl);

    // Wire switches to AND gate
    editor.doc.wires.set('w1', { id: 'w1', from: swA.id, to: andGate.id, input: 0 });
    editor.doc.wires.set('w2', { id: 'w2', from: swB.id, to: andGate.id, input: 1 });
    // Wire AND gate to NOT gate
    editor.doc.wires.set('w3', { id: 'w3', from: andGate.id, to: notGate.id, input: 0 });
    // Wire NOT gate to bulb
    editor.doc.wires.set('w4', { id: 'w4', from: notGate.id, to: bulb.id, input: 0 });

    // Wire switches to table inputs
    editor.doc.wires.set('wt0', { id: 'wt0', from: swA.id, to: tbl.id, input: 0 });
    editor.doc.wires.set('wt1', { id: 'wt1', from: swB.id, to: tbl.id, input: 1 });
    // Wire bulb to table output
    editor.doc.wires.set('wt_out', { id: 'wt_out', from: bulb.id, to: tbl.id, input: TABLE_OUT });

    // Record components directly
    const comps = editor.recordTableComponents(editor.doc, tbl);
    expect(comps).toContain('AND');
    expect(comps).toContain('NOT');
    expect(comps.length).toBe(2);

    // Convert table to solution
    (editor as any).convertTable(tbl);
    expect(tbl.table?.mode).toBe('solution');
    expect(tbl.table?.components).toBeDefined();
    expect(tbl.table?.components).toContain('AND');
    expect(tbl.table?.components).toContain('NOT');

    // Hint toggle test
    expect(tbl.table?.showHint).toBeFalsy();
    editor.toggleTableHint(tbl);
    expect(tbl.table?.showHint).toBe(true);
    editor.toggleTableHint(tbl);
    expect(tbl.table?.showHint).toBe(false);
  });
});
