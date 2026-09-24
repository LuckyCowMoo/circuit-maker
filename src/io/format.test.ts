import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { boxContents } from '../model/doc';
import { Simulator } from '../sim/simulator';
import { docToText, parseCircuit } from './format';

const example = (name: string) => readFileSync(new URL(`../../examples/${name}`, import.meta.url), 'utf8');

describe('file format', () => {
  it('round-trips the examples', () => {
    for (const name of ['half-adder.cmk.json', 'full-adder.cmk.json']) {
      const first = parseCircuit(example(name));
      expect(first.warnings).toEqual([]);
      const again = parseCircuit(docToText(first.doc));
      expect(again.warnings).toEqual([]);
      expect(again.doc.components.size).toBe(first.doc.components.size);
      expect(again.doc.wires.size).toBe(first.doc.wires.size);
      expect(again.doc.boxes.size).toBe(first.doc.boxes.size);
      expect(docToText(again.doc)).toBe(docToText(first.doc));
    }
  });

  it('simulates the full adder example correctly', () => {
    const { doc } = parseCircuit(example('full-adder.cmk.json'));
    const sim = new Simulator();
    sim.compile(doc);
    for (let v = 0; v < 8; v++) {
      const [a, b, c] = [v & 1, (v >> 1) & 1, (v >> 2) & 1];
      sim.setSwitch('a', !!a);
      sim.setSwitch('b', !!b);
      sim.setSwitch('cin', !!c);
      sim.settle();
      const total = a + b + c;
      expect(sim.value('sum')).toBe((total & 1) === 1);
      expect(sim.value('cout')).toBe(total >= 2);
    }
  });

  it('nests the full adder boxes geometrically', () => {
    const { doc } = parseCircuit(example('full-adder.cmk.json'));
    const outer = boxContents(doc, doc.boxes.get('full_adder')!);
    expect(outer.boxes.map((b) => b.id).sort()).toEqual(['ha1', 'ha2']);
    expect(outer.components.map((c) => c.id).sort()).toEqual(['a1', 'a2', 'o1', 'x1', 'x2']);
    const ha1 = boxContents(doc, doc.boxes.get('ha1')!);
    expect(ha1.components.map((c) => c.id).sort()).toEqual(['a1', 'x1']);
  });

  it('accepts LLM-style input: code fences, aliases and shorthand pins', () => {
    const text = [
      'Here is your circuit:',
      '```json',
      JSON.stringify({
        format: 'circuit-maker',
        version: 1,
        name: 'test',
        components: [
          { id: 'a', type: 'toggle', x: 0, y: 0 },
          { id: 'g', type: 'NAND', x: 100, y: 0 },
          { id: 'l', type: 'lamp', x: 200, y: 0 },
        ],
        wires: [
          { from: 'a', to: 'g.3' },
          { from: 'g', to: 'l' },
        ],
      }),
      '```',
    ].join('\n');
    const { doc, warnings } = parseCircuit(text);
    const g = doc.components.get('g')!;
    expect(g.kind).toBe('and');
    expect(g.negate).toBe(true);
    expect(g.inputs).toBe(4);
    expect(doc.components.get('a')!.kind).toBe('switch');
    expect(doc.components.get('l')!.kind).toBe('bulb');
    expect(doc.wires.size).toBe(2);
    expect(warnings.some((w) => w.includes('grown'))).toBe(true);
  });

  it('reports bad references without failing the whole file', () => {
    const { doc, warnings } = parseCircuit(
      JSON.stringify({
        format: 'circuit-maker',
        version: 1,
        name: 'bad',
        components: [
          { id: 'l', type: 'bulb', x: 0, y: 0 },
          { id: 'q', type: 'flux-capacitor', x: 0, y: 0 },
        ],
        wires: [
          { from: 'l', to: 'l', input: 0 },
          { from: 'nope', to: 'l', input: 0 },
        ],
      }),
    );
    expect(doc.components.size).toBe(1);
    expect(doc.wires.size).toBe(0);
    expect(warnings.length).toBe(3);
  });

  it('rejects non-circuit text', () => {
    expect(() => parseCircuit('hello')).toThrow();
    expect(() => parseCircuit('{"format":"something-else"}')).toThrow();
  });
});
