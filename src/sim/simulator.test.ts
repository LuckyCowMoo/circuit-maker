import { describe, expect, it } from 'vitest';
import { emptyDoc, makeComponent } from '../model/doc';
import type { ComponentKind, Doc } from '../model/types';
import { Simulator } from './simulator';

function build(
  parts: [id: string, kind: ComponentKind, opts?: { inputs?: number; not?: boolean }][],
  wires: [from: string, to: string, input: number][],
): Doc {
  const doc = emptyDoc();
  for (const [id, kind, opts] of parts) {
    const c = makeComponent(kind, 0, 0, id);
    if (opts?.inputs) c.inputs = opts.inputs;
    if (opts?.not) c.negate = true;
    doc.components.set(id, c);
  }
  wires.forEach(([from, to, input], i) => doc.wires.set(`w${i}`, { id: `w${i}`, from, to, input }));
  return doc;
}

function run(doc: Doc, sim = new Simulator()): Simulator {
  sim.compile(doc);
  sim.settle();
  return sim;
}

describe('Simulator', () => {
  it('evaluates a half adder for every input combination', () => {
    const doc = build(
      [
        ['a', 'switch'],
        ['b', 'switch'],
        ['x', 'xor'],
        ['n', 'and'],
        ['sum', 'bulb'],
        ['carry', 'bulb'],
      ],
      [
        ['a', 'x', 0],
        ['b', 'x', 1],
        ['a', 'n', 0],
        ['b', 'n', 1],
        ['x', 'sum', 0],
        ['n', 'carry', 0],
      ],
    );
    const sim = run(doc);
    for (const [a, b] of [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]) {
      sim.setSwitch('a', !!a);
      sim.setSwitch('b', !!b);
      sim.settle();
      expect(sim.value('sum')).toBe((a ^ b) === 1);
      expect(sim.value('carry')).toBe((a & b) === 1);
    }
  });

  it('treats unconnected inputs as off and applies NOT bubbles', () => {
    const doc = build(
      [
        ['nand', 'and', { not: true }],
        ['nor', 'or', { not: true }],
        ['not', 'buffer', { inputs: 1, not: true }],
      ],
      [],
    );
    const sim = run(doc);
    expect(sim.value('nand')).toBe(true);
    expect(sim.value('nor')).toBe(true);
    expect(sim.value('not')).toBe(true);
  });

  it('computes n-input XOR as parity', () => {
    const doc = build(
      [
        ['s0', 'switch'],
        ['s1', 'switch'],
        ['s2', 'switch'],
        ['x', 'xor', { inputs: 3 }],
      ],
      [
        ['s0', 'x', 0],
        ['s1', 'x', 1],
        ['s2', 'x', 2],
      ],
    );
    const sim = run(doc);
    sim.setSwitch('s0', true);
    sim.setSwitch('s1', true);
    sim.setSwitch('s2', true);
    sim.settle();
    expect(sim.value('x')).toBe(true);
    sim.setSwitch('s2', false);
    sim.settle();
    expect(sim.value('x')).toBe(false);
  });

  it('updates timer outputs from cycle and pulse lengths in seconds', () => {
    const doc = build(
      [
        ['clock', 'timer'],
        ['lamp', 'bulb'],
      ],
      [['clock', 'lamp', 0]],
    );
    const clock = doc.components.get('clock')!;
    clock.period = 0.5;
    clock.pulse = 0.1;
    const sim = run(doc);

    expect(sim.tickTime(50)).toBe(true);
    sim.settle();
    expect(sim.value('clock')).toBe(true);
    expect(sim.value('lamp')).toBe(true);

    expect(sim.tickTime(150)).toBe(true);
    sim.settle();
    expect(sim.value('clock')).toBe(false);
    expect(sim.value('lamp')).toBe(false);
    expect(sim.tickTime(499)).toBe(false);
    expect(sim.tickTime(550)).toBe(true);
  });

  it('simulates three independent RGB inputs from wires or a cable', () => {
    const wires = build(
      [
        ['red', 'switch'],
        ['green', 'switch'],
        ['blue', 'switch'],
        ['rgb', 'rgb'],
      ],
      [
        ['red', 'rgb', 0],
        ['green', 'rgb', 1],
        ['blue', 'rgb', 2],
      ],
    );
    const wireSim = run(wires);
    wireSim.setSwitch('red', true);
    wireSim.setSwitch('blue', true);
    wireSim.settle();
    expect([0, 1, 2].map((lane) => wireSim.value('rgb', lane))).toEqual([true, false, true]);

    const cable = build(
      [
        ['red', 'switch'],
        ['green', 'switch'],
        ['blue', 'switch'],
        ['port', 'port', { inputs: 3 }],
        ['rgb', 'rgb'],
      ],
      [
        ['red', 'port', 0],
        ['green', 'port', 1],
        ['blue', 'port', 2],
      ],
    );
    const port = cable.components.get('port')!;
    port.outputBundle = true;
    const rgb = cable.components.get('rgb')!;
    rgb.inputBundle = true;
    cable.wires.set('cable', { id: 'cable', from: 'port', to: 'rgb', input: 0, cable: true });
    const cableSim = run(cable);
    cableSim.setSwitch('green', true);
    cableSim.setSwitch('blue', true);
    cableSim.settle();
    expect([0, 1, 2].map((lane) => cableSim.value('rgb', lane))).toEqual([false, true, true]);
  });

  it('holds state in an SR latch across recompiles', () => {
    const doc = build(
      [
        ['s', 'button'],
        ['r', 'button'],
        ['q', 'or', { not: true }],
        ['qn', 'or', { not: true }],
      ],
      [
        ['r', 'q', 0],
        ['qn', 'q', 1],
        ['s', 'qn', 0],
        ['q', 'qn', 1],
      ],
    );
    const sim = run(doc);
    sim.setPressed('s', true);
    sim.settle();
    sim.setPressed('s', false);
    sim.settle();
    expect(sim.value('q')).toBe(true);
    expect(sim.value('qn')).toBe(false);
    sim.compile(doc);
    sim.settle();
    expect(sim.value('q')).toBe(true);
    sim.setPressed('r', true);
    sim.settle();
    sim.setPressed('r', false);
    sim.settle();
    expect(sim.value('q')).toBe(false);
    expect(sim.value('qn')).toBe(true);
  });

  it('keeps oscillators bounded instead of hanging', () => {
    const doc = build([['n', 'buffer', { inputs: 1, not: true }]], [['n', 'n', 0]]);
    const sim = new Simulator();
    sim.compile(doc);
    expect(sim.step(100)).toBe(true);
    expect(sim.pending).toBe(true);
  });

  it('handles a long chain efficiently', () => {
    const parts: [string, ComponentKind, { inputs?: number; not?: boolean }?][] = [['in', 'switch']];
    const wires: [string, string, number][] = [];
    const n = 20000;
    for (let i = 0; i < n; i++) {
      parts.push([`g${i}`, 'buffer', { inputs: 1, not: true }]);
      wires.push([i === 0 ? 'in' : `g${i - 1}`, `g${i}`, 0]);
    }
    const doc = build(parts, wires);
    const sim = run(doc);
    expect(sim.value(`g${n - 1}`)).toBe(false);
    sim.setSwitch('in', true);
    sim.settle();
    expect(sim.value(`g${n - 1}`)).toBe(true);
  });
});
