import { describe, expect, it } from 'vitest';
import { docToText, parseCircuit } from '../io/format';
import { Simulator } from '../sim/simulator';
import { componentCenter } from './geometry';
import { buildBoxTree, normalizePorts, portInward } from './ports';
import type { Doc } from './types';

const circuit = () =>
  parseCircuit(
    JSON.stringify({
      format: 'circuit-maker',
      version: 1,
      name: 'ports',
      boxes: [{ id: 'B', name: 'B', x: 100, y: 0, w: 200, h: 100 }],
      components: [
        { id: 's', type: 'switch', x: 0, y: 30 },
        { id: 'g', type: 'not', x: 180, y: 30 },
        { id: 'l', type: 'bulb', x: 400, y: 30 },
      ],
      wires: [
        { from: 's', to: 'g' },
        { from: 'g', to: 'l' },
      ],
    }),
  ).doc;

const ports = (doc: Doc) => [...doc.components.values()].filter((c) => c.kind === 'port');

describe('box ports', () => {
  it('adds a port wherever a wire crosses a box wall', () => {
    const doc = circuit();
    const ps = ports(doc);
    expect(ps.length).toBe(2);
    const box = doc.boxes.get('B')!;
    expect(ps.map((p) => portInward(p, box)).sort()).toEqual([false, true]);
    for (const p of ps) {
      const c = componentCenter(p);
      const onWall = c.x === box.x || c.x === box.x + box.w || c.y === box.y || c.y === box.y + box.h;
      expect(onWall).toBe(true);
    }
    const sim = new Simulator();
    sim.compile(doc);
    sim.settle();
    expect(sim.value('l')).toBe(true);
    sim.setSwitch('s', true);
    sim.settle();
    expect(sim.value('l')).toBe(false);
  });

  it('names a new port after the switch that drives it', () => {
    const doc = circuit();
    doc.components.get('s')!.name = 'A';
    for (const p of ports(doc)) doc.components.delete(p.id);
    doc.wires.clear();
    doc.wires.set('w1', { id: 'w1', from: 's', to: 'g', input: 0 });
    normalizePorts(doc);
    expect(ports(doc).map((p) => p.name)).toEqual(['A']);
  });

  it('keeps the inside half connected to the port when the outside half is removed', () => {
    const doc = circuit();
    const inPort = ports(doc).find((p) => portInward(p, doc.boxes.get('B')!))!;
    for (const [id, w] of doc.wires) if (w.to === inPort.id) doc.wires.delete(id);
    normalizePorts(doc);
    expect(doc.components.has(inPort.id)).toBe(true);
    expect([...doc.wires.values()].some((w) => w.from === inPort.id && w.to === 'g')).toBe(true);
  });

  it('bypasses a port when the part it feeds moves out of the box', () => {
    const doc = circuit();
    doc.components.get('g')!.x = 500;
    normalizePorts(doc);
    const tree = buildBoxTree(doc);
    for (const w of doc.wires.values()) {
      const s = doc.components.get(w.from)!;
      const t = doc.components.get(w.to)!;
      if (s.kind !== 'port' && t.kind !== 'port') expect(tree.scope(s)).toBe(tree.scope(t));
    }
    expect([...doc.wires.values()].some((w) => w.from === 's' && w.to === 'g')).toBe(true);
  });

  it('round-trips ports through the file format', () => {
    const doc = circuit();
    const text = docToText(doc);
    const again = parseCircuit(text);
    expect(again.warnings).toEqual([]);
    expect(docToText(again.doc)).toBe(text);
  });
});
