import { TABLE_OUT } from './table';
import type { Component, ComponentKind, Doc, Point, Rect, Wire } from './types';
import { makeComponent, uid } from './doc';
import { snap } from './geometry';

export const TRACE_COL = 46;
export const TRACE_PAD = 8;
export const TRACE_GAP = 28;
export const TRACE_MIN_W = 240;
export const TRACE_H = 120;

export const STAGE_DX = 195;
export const SWITCH_DY = 85;
export const GATE_DY = 95;
export const BULB_DY = 95;

export interface TraceData {
  inputs: number;
  outputs: number;
  names: string[];
  predicted: boolean[];
  actual: boolean[];
  inputStates: boolean[];
  correctCount: number;
  incorrectCount: number;
  state: 'guess' | 'revealed';
  lastResult?: 'correct' | 'incorrect';
  circuitIds?: string[];
}

export interface TracePin {
  pin: number;
  x: number;
  side: 'in' | 'out';
  index: number;
  colX: number;
  colW: number;
}

export interface TraceLayout {
  w: number;
  h: number;
  pins: TracePin[];
  btnSpawn: Rect;
  scoreBox: Rect;
  btnGuess: Rect;
  gridLeft: number;
  gridRight: number;
  gapX: number;
  gap: number;
  labelY: number;
  valueY: number;
  switchBoxes: Rect[];
}

export function freshTrace(): TraceData {
  return {
    inputs: 0,
    outputs: 0,
    names: [],
    predicted: [],
    actual: [],
    inputStates: [],
    correctCount: 0,
    incorrectCount: 0,
    state: 'guess',
    circuitIds: [],
  };
}

export function cloneTrace(t: TraceData): TraceData {
  return {
    inputs: t.inputs,
    outputs: t.outputs,
    names: t.names.slice(),
    predicted: t.predicted.slice(),
    actual: t.actual.slice(),
    inputStates: t.inputStates.slice(),
    correctCount: t.correctCount,
    incorrectCount: t.incorrectCount,
    state: t.state,
    lastResult: t.lastResult,
    circuitIds: t.circuitIds ? t.circuitIds.slice() : [],
  };
}

export function layoutTrace(t: TraceData): TraceLayout {
  const left = TRACE_PAD;
  const right = TRACE_PAD;
  const inW = Math.max(1, t.inputs) * TRACE_COL;
  const outW = Math.max(1, t.outputs) * TRACE_COL;
  let gap = TRACE_GAP;
  let w = left + inW + gap + outW + right;
  if (w < TRACE_MIN_W) {
    gap += TRACE_MIN_W - w;
    w = TRACE_MIN_W;
  }

  const pins: TracePin[] = [];
  let x = left;
  for (let i = 0; i < t.inputs; i++) {
    pins.push({ pin: i, x: x + TRACE_COL / 2, side: 'in', index: i, colX: x, colW: TRACE_COL });
    x += TRACE_COL;
  }
  const gapX = x;
  x += gap;
  const switchBoxes: Rect[] = [];
  const valueY = 96;

  for (let j = 0; j < t.outputs; j++) {
    const colX = x;
    const cx = colX + TRACE_COL / 2;
    pins.push({ pin: TABLE_OUT + j, x: cx, side: 'out', index: j, colX, colW: TRACE_COL });
    switchBoxes.push({
      x: cx - 17,
      y: valueY - 11,
      w: 34,
      h: 22,
    });
    x += TRACE_COL;
  }
  const gridRight = x;

  return {
    w,
    h: TRACE_H,
    pins,
    btnSpawn: {
      x: TRACE_PAD,
      y: 6,
      w: 96,
      h: 22,
    },
    scoreBox: {
      x: w - TRACE_PAD - 110,
      y: 6,
      w: 110,
      h: 22,
    },
    btnGuess: {
      x: TRACE_PAD,
      y: 32,
      w: w - TRACE_PAD * 2,
      h: 24,
    },
    gridLeft: left,
    gridRight,
    gapX,
    gap,
    labelY: 66,
    valueY,
    switchBoxes,
  };
}

export function tracePinLocal(t: TraceData, pin: number, pinLen: number): Point | null {
  const found = layoutTrace(t).pins.find((p) => p.pin === pin);
  return found ? { x: found.x, y: -pinLen } : null;
}

export function normalizeTrace(raw: unknown): TraceData {
  const t = freshTrace();
  if (!raw || typeof raw !== 'object') return t;
  const o = raw as Record<string, unknown>;
  t.inputs = typeof o.inputs === 'number' ? Math.max(0, Math.min(8, o.inputs)) : 0;
  t.outputs = typeof o.outputs === 'number' ? Math.max(0, Math.min(8, o.outputs)) : 0;
  t.names = Array.isArray(o.names) ? o.names.map(String) : [];
  t.predicted = Array.isArray(o.predicted) ? o.predicted.map(Boolean) : [];
  t.actual = Array.isArray(o.actual) ? o.actual.map(Boolean) : [];
  t.inputStates = Array.isArray(o.inputStates) ? o.inputStates.map(Boolean) : [];
  t.correctCount = typeof o.correctCount === 'number' ? o.correctCount : 0;
  t.incorrectCount = typeof o.incorrectCount === 'number' ? o.incorrectCount : 0;
  t.state = o.state === 'revealed' ? 'revealed' : 'guess';
  if (o.lastResult === 'correct' || o.lastResult === 'incorrect') t.lastResult = o.lastResult;
  t.circuitIds = Array.isArray(o.circuitIds) ? o.circuitIds.map(String) : [];
  return t;
}

/** Gate evaluation helper matching logic simulator behavior (only AND, OR, NOT). */
export function evalGate(kind: ComponentKind, negate: boolean, in0: boolean, in1: boolean): boolean {
  let v = false;
  if (kind === 'and') v = in0 && in1;
  else if (kind === 'or') v = in0 || in1;
  else if (kind === 'buffer') v = in0;
  return negate ? !v : v;
}

/** Randomly chooses input count (1 to 3), with higher numbers being rarer. */
export function pickInputCount(): number {
  const r = Math.random();
  if (r < 0.35) return 1;       // 35% for 1 input
  if (r < 0.75) return 2;       // 40% for 2 inputs
  return 3;                     // 25% for 3 inputs
}

/** Randomly chooses output count (1 or 2). */
export function pickOutputCount(inputs: number): number {
  if (inputs === 1) return 1;
  return Math.random() < 0.6 ? 1 : 2;
}

/**
 * Valid layer configurations where:
 * - Total operators <= 5
 * - Final layer has length numOutputs (1 or 2)
 * - Every operator output is guaranteed to connect to a downstream operator or bulb
 */
export function pickLayerPattern(numInputs: number, numOutputs: number): number[] {
  if (numOutputs === 1) {
    if (numInputs === 1) {
      const options = [[1], [1, 1], [1, 1, 1]];
      return options[Math.floor(Math.random() * options.length)];
    }
    if (numInputs === 2) {
      const options = [
        [1],
        [1, 1],
        [2, 1],
        [1, 1, 1],
        [2, 1, 1],
        [1, 2, 1],
        [2, 2, 1],
      ];
      return options[Math.floor(Math.random() * options.length)];
    }
    // numInputs === 3: Layer 0 must have at least 2 gates so 3 inputs can connect
    const options = [
      [2, 1],
      [2, 1, 1],
      [2, 2, 1],
    ];
    return options[Math.floor(Math.random() * options.length)];
  } else {
    // numOutputs === 2
    if (numInputs === 2) {
      const options = [
        [2],
        [1, 2],
        [2, 2],
        [1, 1, 2],
        [1, 2, 2],
        [2, 1, 2],
      ];
      return options[Math.floor(Math.random() * options.length)];
    }
    // numInputs === 3: Layer 0 must have at least 2 gates
    const options = [
      [2],
      [2, 2],
      [2, 1, 2],
    ];
    return options[Math.floor(Math.random() * options.length)];
  }
}

export function pickLayerCount(): number {
  return 1 + Math.floor(Math.random() * 3);
}

/**
 * Deletes the procedural logic circuit attached to a trace component,
 * including all switches, gates, bulbs, and connecting wires.
 */
export function deleteTraceCircuit(doc: Doc, traceComp: Component): void {
  const t = traceComp.trace;
  if (t?.circuitIds && t.circuitIds.length > 0) {
    for (const cid of t.circuitIds) {
      doc.components.delete(cid);
      doc.wires.delete(cid);
    }
  }

  // Safety fallback: traverse and delete any locked components connected to traceComp
  const attachedLockedComps = new Set<string>();
  for (const w of doc.wires.values()) {
    if (w.to === traceComp.id || w.from === traceComp.id) {
      const otherId = w.to === traceComp.id ? w.from : w.to;
      const other = doc.components.get(otherId);
      if (other?.locked) attachedLockedComps.add(other.id);
    }
  }
  if (attachedLockedComps.size > 0) {
    const queue = [...attachedLockedComps];
    while (queue.length > 0) {
      const curId = queue.pop()!;
      for (const w of doc.wires.values()) {
        if (w.to === curId || w.from === curId) {
          const neighborId = w.to === curId ? w.from : w.to;
          const neighbor = doc.components.get(neighborId);
          if (neighbor?.locked && !attachedLockedComps.has(neighborId)) {
            attachedLockedComps.add(neighborId);
            queue.push(neighborId);
          }
        }
      }
    }
    for (const cid of attachedLockedComps) {
      doc.components.delete(cid);
    }
  }

  // Remove any wires connected to traceComp
  for (const [wId, w] of [...doc.wires.entries()]) {
    if (w.to === traceComp.id || w.from === traceComp.id) {
      doc.wires.delete(wId);
    }
  }
}

/**
 * Procedurally generates a logic circuit:
 * - 1 to 3 inputs (switches in random starting states)
 * - 1 to 2 outputs (bulbs)
 * - Maximum 5 operators total across all layers
 * - Uses ONLY AND, OR, and NOT gates
 * - Guaranteed connectivity: No operator spawns if it has nowhere for its output to go
 * - Spacing between components is 3x the standard size
 * - Centered horizontally above the trace component
 * - Wires from bulbs to trace component connect on the left side of the bulbs
 */
export function generateTraceCircuit(doc: Doc, traceComp: Component): void {
  // 1. Clean up old circuit components and wires
  deleteTraceCircuit(doc, traceComp);
  const prevTrace = traceComp.trace ?? freshTrace();

  // 2. Determine configuration
  const numInputs = pickInputCount(); // 1 to 3
  const numOutputs = pickOutputCount(numInputs); // 1 or 2
  const pattern = pickLayerPattern(numInputs, numOutputs);
  const numLayers = pattern.length;

  const createdIds: string[] = [];

  // Helper to add locked wire
  const addWire = (fromId: string, toId: string, inputPin: number, separatePort = false): Wire => {
    const wId = uid(doc, 'w_');
    const w: Wire = {
      id: wId,
      from: fromId,
      to: toId,
      input: inputPin,
      separatePort,
      locked: true,
    };
    doc.wires.set(wId, w);
    createdIds.push(wId);
    return w;
  };

  // 3. Layout and Centering calculations
  const tempTrace: TraceData = {
    ...prevTrace,
    inputs: numInputs,
    outputs: numOutputs,
  };
  const lay = layoutTrace(tempTrace);
  traceComp.w = lay.w;
  traceComp.h = lay.h;

  // Total horizontal circuit width: switches (col 0) to bulbs (col numLayers + 1)
  const totalStages = numLayers + 2; // switches + layers + bulbs
  const circuitW = (totalStages - 1) * STAGE_DX + 40;

  // Center horizontally over the trace component
  const traceCenterX = traceComp.x + traceComp.w / 2;
  const sx = snap(traceCenterX - circuitW / 2);

  // Vertical centering
  const maxItems = Math.max(numInputs, numOutputs, ...pattern);
  const maxStageH = (maxItems - 1) * GATE_DY;
  const gapAboveTrace = 90;
  const stageCenterY = snap(traceComp.y - gapAboveTrace - maxStageH / 2);

  // 4. Create input switches (Column 0)
  const switchNames = ['A', 'B', 'C'].slice(0, numInputs);
  const switches: Component[] = [];
  const switchVals: boolean[] = [];

  const switchH = (numInputs - 1) * SWITCH_DY;
  const sy0 = stageCenterY - switchH / 2;

  for (let i = 0; i < numInputs; i++) {
    const sw = makeComponent('switch', sx, sy0 + i * SWITCH_DY, uid(doc, 'tsw_'));
    sw.name = switchNames[i];
    sw.on = Math.random() < 0.5;
    sw.locked = true;
    doc.components.set(sw.id, sw);
    createdIds.push(sw.id);
    switches.push(sw);
    switchVals.push(sw.on);
  }

  // 5. Create operator layers (Column 1 to Column numLayers)
  const layers: Component[][] = [];

  for (let l = 0; l < numLayers; l++) {
    const gateCount = pattern[l];
    const layerH = (gateCount - 1) * GATE_DY;
    const gy0 = stageCenterY - layerH / 2;
    const gx = sx + (l + 1) * STAGE_DX;
    const currentGates: Component[] = [];

    // How many gates in this layer MUST have 2 inputs?
    const prevCount = l === 0 ? numInputs : pattern[l - 1];
    let mustHave2Inputs = Math.max(0, prevCount - gateCount);

    for (let k = 0; k < gateCount; k++) {
      let isNot = false;
      if (mustHave2Inputs > 0) {
        isNot = false;
        mustHave2Inputs--;
      } else {
        if (numInputs === 1 && l === 0) {
          isNot = Math.random() < 0.7;
        } else {
          isNot = Math.random() < 0.35;
        }
      }

      const kind: ComponentKind = isNot ? 'buffer' : (Math.random() < 0.5 ? 'and' : 'or');
      const negate = isNot;

      const gate = makeComponent(kind, gx, gy0 + k * GATE_DY, uid(doc, `tg${l + 1}_`));
      gate.negate = negate;
      gate.inputs = isNot ? 1 : 2;
      gate.locked = true;
      doc.components.set(gate.id, gate);
      createdIds.push(gate.id);
      currentGates.push(gate);
    }

    layers.push(currentGates);
  }

  // 6. Connect Layer 0 (first layer) from switches
  const l0Pins: { gate: Component; pin: number }[] = [];
  for (const g of layers[0]) {
    l0Pins.push({ gate: g, pin: 0 });
    if (g.inputs === 2) l0Pins.push({ gate: g, pin: 1 });
  }

  // Wire each switch to at least one pin in Layer 0
  for (let s = 0; s < numInputs; s++) {
    const target = l0Pins[s % l0Pins.length];
    addWire(switches[s].id, target.gate.id, target.pin);
  }
  // Fill any remaining pins in Layer 0
  for (let k = numInputs; k < l0Pins.length; k++) {
    const target = l0Pins[k];
    addWire(switches[k % numInputs].id, target.gate.id, target.pin);
  }

  // 7. Wire intermediate layers: Layer l -> Layer l + 1
  for (let l = 0; l < numLayers - 1; l++) {
    const curLayer = layers[l];
    const nextLayer = layers[l + 1];

    const nextPins: { gate: Component; pin: number }[] = [];
    for (const g of nextLayer) {
      nextPins.push({ gate: g, pin: 0 });
      if (g.inputs === 2) nextPins.push({ gate: g, pin: 1 });
    }

    // Every gate in curLayer connects to a distinct pin in nextPins
    for (let i = 0; i < curLayer.length; i++) {
      addWire(curLayer[i].id, nextPins[i].gate.id, nextPins[i].pin);
    }
    // Any remaining pins in nextLayer are fed by switches
    for (let k = curLayer.length; k < nextPins.length; k++) {
      addWire(switches[k % numInputs].id, nextPins[k].gate.id, nextPins[k].pin);
    }
  }

  // 8. Create output bulbs (Column numLayers + 1)
  const bulbX = sx + (numLayers + 1) * STAGE_DX;
  const bulbH = (numOutputs - 1) * BULB_DY;
  const by0 = stageCenterY - bulbH / 2;
  const bulbNames = ['X', 'Y'].slice(0, numOutputs);
  const bulbs: Component[] = [];

  for (let b = 0; b < numOutputs; b++) {
    const bulb = makeComponent('bulb', bulbX, by0 + b * BULB_DY, uid(doc, 'tblb_'));
    bulb.name = bulbNames[b];
    bulb.locked = true;
    doc.components.set(bulb.id, bulb);
    createdIds.push(bulb.id);
    bulbs.push(bulb);

    // Final layer gate feeds this bulb
    const feederGate = layers[numLayers - 1][b];
    addWire(feederGate.id, bulb.id, 0);
  }

  // 9. Wire switches to traceComp input pins
  for (let i = 0; i < numInputs; i++) {
    addWire(switches[i].id, traceComp.id, i, true);
  }

  // 10. Wire bulbs to traceComp output pins (pin 0 of bulb to traceComp)
  for (let j = 0; j < numOutputs; j++) {
    addWire(bulbs[j].id, traceComp.id, TABLE_OUT + j, true);
  }

  // 11. Compute actual output values
  const valMap = new Map<string, boolean>();
  for (const sw of switches) {
    valMap.set(sw.id, sw.on);
  }
  for (let l = 0; l < numLayers; l++) {
    for (const g of layers[l]) {
      let in0 = false;
      let in1 = false;
      for (const w of doc.wires.values()) {
        if (w.to === g.id) {
          if (w.input === 0) in0 = valMap.get(w.from) ?? false;
          else if (w.input === 1) in1 = valMap.get(w.from) ?? false;
        }
      }
      const out = evalGate(g.kind, g.negate, in0, in1);
      valMap.set(g.id, out);
    }
  }

  const actualVals: boolean[] = [];
  for (let b = 0; b < numOutputs; b++) {
    const feeder = layers[numLayers - 1][b];
    actualVals.push(valMap.get(feeder.id) ?? false);
  }

  // 12. Update traceComp.trace data
  const nextTrace: TraceData = {
    inputs: numInputs,
    outputs: numOutputs,
    names: [...switchNames, ...bulbNames],
    predicted: Array(numOutputs).fill(false),
    actual: actualVals,
    inputStates: switchVals,
    correctCount: prevTrace.correctCount,
    incorrectCount: prevTrace.incorrectCount,
    state: 'guess',
    lastResult: undefined,
    circuitIds: createdIds,
  };

  traceComp.trace = nextTrace;
  const finalLay = layoutTrace(nextTrace);
  traceComp.w = finalLay.w;
  traceComp.h = finalLay.h;
}
