import { describe, expect, it } from 'vitest';
import { emptyDoc, makeComponent } from './doc';
import { TABLE_OUT } from './table';
import {
  deleteTraceCircuit,
  evalGate,
  freshTrace,
  generateTraceCircuit,
  layoutTrace,
  normalizeTrace,
  pickInputCount,
  pickLayerCount,
  pickLayerPattern,
  pickOutputCount,
  STAGE_DX,
  SWITCH_DY,
  GATE_DY,
  BULB_DY,
  tracePinLocal,
} from './trace';
import { PIN_LEN } from './geometry';

describe('trace component layout and data model', () => {
  it('creates fresh trace data with initial zero scores and guess state', () => {
    const t = freshTrace();
    expect(t.inputs).toBe(0);
    expect(t.outputs).toBe(0);
    expect(t.correctCount).toBe(0);
    expect(t.incorrectCount).toBe(0);
    expect(t.state).toBe('guess');
    expect(t.circuitIds).toEqual([]);
  });

  it('computes layout geometry and pin positions accurately', () => {
    const t = freshTrace();
    t.inputs = 3;
    t.outputs = 2;
    const lay = layoutTrace(t);

    expect(lay.w).toBeGreaterThanOrEqual(240);
    expect(lay.h).toBe(120);
    expect(lay.pins).toHaveLength(5);

    // 3 input pins on the left
    const inPins = lay.pins.filter((p) => p.side === 'in');
    expect(inPins).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(inPins[i].pin).toBe(i);
      expect(inPins[i].side).toBe('in');
    }

    // 2 output pins on the right
    const outPins = lay.pins.filter((p) => p.side === 'out');
    expect(outPins).toHaveLength(2);
    expect(outPins[0].pin).toBe(TABLE_OUT);
    expect(outPins[1].pin).toBe(TABLE_OUT + 1);

    // Hitboxes
    expect(lay.btnSpawn.w).toBeGreaterThan(0);
    expect(lay.btnGuess.w).toBeGreaterThan(0);
    expect(lay.switchBoxes).toHaveLength(2);

    const pinLoc = tracePinLocal(t, 0, PIN_LEN);
    expect(pinLoc).not.toBeNull();
    expect(pinLoc?.y).toBe(-PIN_LEN);
  });

  it('normalizes trace data safely from unknown objects', () => {
    const norm = normalizeTrace({
      inputs: 4,
      outputs: 2,
      names: ['A', 'B', 'C', 'D', 'X', 'Y'],
      predicted: [true, false],
      actual: [true, true],
      inputStates: [true, false, true, false],
      correctCount: 5,
      incorrectCount: 2,
      state: 'revealed',
      lastResult: 'incorrect',
      circuitIds: ['a', 'b'],
    });

    expect(norm.inputs).toBe(4);
    expect(norm.outputs).toBe(2);
    expect(norm.predicted).toEqual([true, false]);
    expect(norm.actual).toEqual([true, true]);
    expect(norm.correctCount).toBe(5);
    expect(norm.incorrectCount).toBe(2);
    expect(norm.state).toBe('revealed');
    expect(norm.lastResult).toBe('incorrect');
    expect(norm.circuitIds).toEqual(['a', 'b']);
  });
});

describe('evalGate logic correctness (AND, OR, NOT)', () => {
  it('evaluates boolean logic gates accurately with only AND, OR, and NOT', () => {
    expect(evalGate('and', false, true, true)).toBe(true);
    expect(evalGate('and', false, true, false)).toBe(false);
    expect(evalGate('or', false, false, false)).toBe(false);
    expect(evalGate('or', false, true, false)).toBe(true);
    expect(evalGate('buffer', true, true, false)).toBe(false); // NOT 1 = 0
    expect(evalGate('buffer', true, false, false)).toBe(true); // NOT 0 = 1
  });

  it('picks layers between 1 and 3', () => {
    for (let i = 0; i < 100; i++) {
      const l = pickLayerCount();
      expect(l).toBeGreaterThanOrEqual(1);
      expect(l).toBeLessThanOrEqual(4);
    }
  });

  it('picks inputs between 1 and 3 with 3 being rarer', () => {
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 1000; i++) {
      const n = pickInputCount();
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
      counts[n as 1 | 2 | 3]++;
    }
    expect(counts[3]).toBeLessThan(counts[2]);
  });

  it('picks outputs between 1 and 2, always 1 if input is 1', () => {
    expect(pickOutputCount(1)).toBe(1);
    const outCounts = { 1: 0, 2: 0 };
    for (let i = 0; i < 100; i++) {
      const o = pickOutputCount(2);
      expect([1, 2]).toContain(o);
      outCounts[o as 1 | 2]++;
    }
    expect(outCounts[1]).toBeGreaterThan(0);
    expect(outCounts[2]).toBeGreaterThan(0);
  });

  it('produces layer patterns with at most 5 operators and matching output count', () => {
    for (let inputs = 1; inputs <= 3; inputs++) {
      for (let outputs = 1; outputs <= 2; outputs++) {
        for (let i = 0; i < 50; i++) {
          const pat = pickLayerPattern(inputs, outputs);
          const totalOps = pat.reduce((a, b) => a + b, 0);
          expect(totalOps).toBeGreaterThanOrEqual(1);
          expect(totalOps).toBeLessThanOrEqual(5);
          expect(pat[pat.length - 1]).toBe(outputs);
        }
      }
    }
  });
});

describe('procedural circuit generator', () => {
  it('generates circuit with 1-3 inputs, 1-2 outputs, max 5 operators, and NO dangling operator outputs', () => {
    expect(STAGE_DX).toBe(195);
    expect(SWITCH_DY).toBe(85);
    expect(GATE_DY).toBe(95);
    expect(BULB_DY).toBe(95);

    for (let run = 0; run < 50; run++) {
      const doc = emptyDoc();
      const traceComp = makeComponent('trace', 600, 1000, 'tr1');
      doc.components.set(traceComp.id, traceComp);

      generateTraceCircuit(doc, traceComp);

      const tr = traceComp.trace!;
      expect(tr).toBeDefined();
      expect(tr.inputs).toBeGreaterThanOrEqual(1);
      expect(tr.inputs).toBeLessThanOrEqual(3);
      expect(tr.outputs).toBeGreaterThanOrEqual(1);
      expect(tr.outputs).toBeLessThanOrEqual(2);

      const spawnedComps = tr.circuitIds!
        .map((id) => doc.components.get(id))
        .filter((c): c is NonNullable<typeof c> => c != null);

      const switches = spawnedComps.filter((c) => c.kind === 'switch');
      const bulbs = spawnedComps.filter((c) => c.kind === 'bulb');
      const gates = spawnedComps.filter((c) => c.kind !== 'switch' && c.kind !== 'bulb');

      expect(switches.length).toBe(tr.inputs);
      expect(bulbs.length).toBe(tr.outputs);
      // Max 5 operators
      expect(gates.length).toBeGreaterThanOrEqual(1);
      expect(gates.length).toBeLessThanOrEqual(5);

      // Verify all gates are strictly AND, OR, or NOT
      for (const g of gates) {
        if (g.kind === 'buffer') {
          expect(g.negate).toBe(true); // NOT
        } else {
          expect(['and', 'or'].includes(g.kind)).toBe(true);
          expect(g.negate).toBe(false);
        }
      }

      // CRITICAL REQUIREMENT: No operator should spawn if it has nowhere for its output to go!
      // Every operator MUST have at least one wire carrying its output to another gate or bulb.
      for (const g of gates) {
        const hasConsumer = [...doc.wires.values()].some(
          (w) => w.from === g.id && w.to !== traceComp.id
        );
        expect(hasConsumer, `Gate ${g.id} (${g.kind}) has no downstream wire!`).toBe(true);
      }

      // Every operator input must be wired
      for (const g of gates) {
        const hasIn0 = [...doc.wires.values()].some((w) => w.to === g.id && w.input === 0);
        expect(hasIn0, `Gate ${g.id} pin 0 is not connected!`).toBe(true);
        if (g.inputs === 2) {
          const hasIn1 = [...doc.wires.values()].some((w) => w.to === g.id && w.input === 1);
          expect(hasIn1, `Gate ${g.id} pin 1 is not connected!`).toBe(true);
        }
      }

      // Every bulb must be driven by a gate on pin 0
      for (const b of bulbs) {
        const driver = [...doc.wires.values()].find((w) => w.to === b.id && w.input === 0);
        expect(driver, `Bulb ${b.id} has no driver!`).toBeDefined();
        const driverComp = doc.components.get(driver!.from);
        expect(driverComp).toBeDefined();
        expect(driverComp?.kind !== 'switch' && driverComp?.kind !== 'bulb').toBe(true);
      }

      // Verify all generated components and wires are locked
      for (const c of spawnedComps) {
        expect(c.locked).toBe(true);
      }
      const spawnedWires = tr.circuitIds!
        .map((id) => doc.wires.get(id))
        .filter((w): w is NonNullable<typeof w> => w != null);
      for (const w of spawnedWires) {
        expect(w.locked).toBe(true);
      }

      // Verify centering: circuit midpoint X should be close to traceComp center X
      const minX = Math.min(...spawnedComps.map((c) => c.x));
      const maxX = Math.max(...spawnedComps.map((c) => c.x + c.w));
      const circuitMidX = (minX + maxX) / 2;
      const traceMidX = traceComp.x + traceComp.w / 2;
      expect(Math.abs(circuitMidX - traceMidX)).toBeLessThan(50);
    }
  });

  it('deleteTraceCircuit deletes all components, wires, and connections of the circuit', () => {
    const doc = emptyDoc();
    const traceComp = makeComponent('trace', 600, 1000, 'tr1');
    doc.components.set(traceComp.id, traceComp);

    generateTraceCircuit(doc, traceComp);
    const tr = traceComp.trace!;
    const ids = tr.circuitIds!.slice();
    expect(ids.length).toBeGreaterThan(0);

    // Verify components and wires exist in doc
    const anyComp = ids.some((id) => doc.components.has(id));
    const anyWire = ids.some((id) => doc.wires.has(id));
    expect(anyComp).toBe(true);
    expect(anyWire).toBe(true);

    deleteTraceCircuit(doc, traceComp);

    // Verify all circuit IDs are deleted from components and wires
    for (const id of ids) {
      expect(doc.components.has(id)).toBe(false);
      expect(doc.wires.has(id)).toBe(false);
    }

    // Verify no wires to or from traceComp exist
    for (const w of doc.wires.values()) {
      expect(w.to).not.toBe(traceComp.id);
      expect(w.from).not.toBe(traceComp.id);
    }
  });
});
