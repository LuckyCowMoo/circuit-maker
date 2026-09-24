import { describe, expect, it } from 'vitest';
import { docToText, parseCircuit } from '../io/format';
import { buildBoxTree } from '../model/ports';
import type { Doc } from '../model/types';
import { Simulator } from '../sim/simulator';
import { EXAMPLES } from './catalog';

const example = (id: string): Doc => {
  for (const g of EXAMPLES) for (const e of g.items) if (e.id === id) return e.build();
  throw new Error(id);
};

/** Drives switches and reads bulbs by label. */
function harness(doc: Doc) {
  const sim = new Simulator();
  sim.compile(doc);
  sim.settle();
  const byName = new Map<string, string>();
  for (const c of doc.components.values()) if (c.name && c.kind !== 'port') byName.set(c.name, c.id);
  const id = (name: string) => {
    const v = byName.get(name);
    if (!v) throw new Error(`no part named ${name}`);
    return v;
  };
  return {
    set(name: string, on: boolean) {
      sim.setSwitch(id(name), on);
    },
    word(prefix: string, bits: number, value: number) {
      for (let i = 0; i < bits; i++) sim.setSwitch(id(`${prefix}${i}`), !!(value & (1 << i)));
    },
    settle() {
      expect(sim.settle()).toBe(true);
    },
    get(name: string) {
      return sim.value(id(name));
    },
    read(prefix: string, bits: number) {
      let v = 0;
      for (let i = 0; i < bits; i++) if (sim.value(id(`${prefix}${i}`))) v |= 1 << i;
      return v;
    },
    sim,
  };
}

describe('examples', () => {
  it('builds every example with ports on every box crossing and survives a file round trip', () => {
    for (const g of EXAMPLES) {
      for (const e of g.items) {
        const doc = e.build();
        const tree = buildBoxTree(doc);
        for (const w of doc.wires.values()) {
          const s = doc.components.get(w.from)!;
          const t = doc.components.get(w.to)!;
          if (s.kind === 'port' || t.kind === 'port') continue;
          expect(tree.scope(s), `${e.id}: ${s.id} -> ${t.id}`).toBe(tree.scope(t));
        }
        const text = docToText(doc);
        const again = parseCircuit(text);
        expect(again.warnings, e.id).toEqual([]);
        expect(docToText(again.doc), e.id).toBe(text);
      }
    }
  });

  it('8-bit adder', () => {
    const doc = example('adder8');
    const cables = [...doc.wires.values()].filter((w) => w.cable);
    const label = (id: string | null | undefined) =>
      [...doc.boxes.values()].find((b) => b.id === id)?.name ?? '?';
    const links = cables.map((w) => {
      const s = doc.components.get(w.from)!;
      const t = doc.components.get(w.to)!;
      return `${label(s.box)}(${s.inputs})→${label(t.box)}`;
    });
    expect(links.sort()).toEqual(['A(8)→8-bit adder', 'B(8)→8-bit adder', '8-bit adder(9)→Sum'].sort());
    expect([...doc.boxes.values()].some((b) => b.name === 'A in' || b.name === 'B in')).toBe(false);
    const add = harness(doc);
    for (let k = 0; k < 40; k++) {
      const a = (k * 97 + 13) & 255;
      const b = (k * 61 + 200) & 255;
      add.word('A', 8, a);
      add.word('B', 8, b);
      add.settle();
      expect(add.read('S', 8) + (add.get('Cout') ? 256 : 0)).toBe(a + b);
    }
  });

  it('3-digit display shows 0 through 255, including 1', () => {
    const SEGS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
    const doc = example('seg3');
    const segBulbs = (box: string) => {
      const bx = [...doc.boxes.values()].find((x) => x.name === box)!;
      return [...doc.components.values()]
        .filter((c) => c.kind === 'bulb' && c.x >= bx.x && c.x < bx.x + bx.w && c.y >= bx.y && c.y < bx.y + bx.h)
        .sort((p, q) => p.id.localeCompare(q.id, undefined, { numeric: true }))
        .map((c) => c.id);
    };
    const shown = (ids: string[]) => ids.reduce((v, id, i) => v | (h.sim.value(id) ? 1 << i : 0), 0);
    const h = harness(doc);
    const ids = ['100s', '10s', '1s'].map((n) => segBulbs(n));
    for (let v = 0; v < 256; v++) {
      h.word('B', 8, v);
      h.settle();
      const want = [Math.floor(v / 100), Math.floor(v / 10) % 10, v % 10];
      ids.forEach((bulbIds, k) => expect(shown(bulbIds), `${v} digit ${k}`).toBe(SEGS[want[k]]));
    }
  });
});
