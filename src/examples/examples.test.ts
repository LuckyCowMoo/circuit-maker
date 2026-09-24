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
    /** Settles first: changing data in the same instant as a clock edge is a setup violation. */
    press(name: string) {
      expect(sim.settle()).toBe(true);
      sim.setPressed(id(name), true);
      expect(sim.settle()).toBe(true);
      sim.setPressed(id(name), false);
      expect(sim.settle()).toBe(true);
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

  it('logic gates', () => {
    const h = harness(example('gates'));
    for (let v = 0; v < 4; v++) {
      const a = !!(v & 1);
      const b = !!(v & 2);
      h.set('A', a);
      h.set('B', b);
      h.settle();
      expect(h.get('AND')).toBe(a && b);
      expect(h.get('OR')).toBe(a || b);
      expect(h.get('XOR')).toBe(a !== b);
      expect(h.get('NAND')).toBe(!(a && b));
      expect(h.get('NOR')).toBe(!(a || b));
      expect(h.get('XNOR')).toBe(a === b);
      expect(h.get('NOT A')).toBe(!a);
    }
  });

  it('full adder', () => {
    const h = harness(example('full-adder'));
    for (let v = 0; v < 8; v++) {
      h.set('A', !!(v & 1));
      h.set('B', !!(v & 2));
      h.set('Cin', !!(v & 4));
      h.settle();
      const n = (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1);
      expect(h.get('Sum')).toBe(!!(n & 1));
      expect(h.get('Cout')).toBe(n >= 2);
    }
  });

  it('8-bit adder and subtractor', () => {
    const add = harness(example('adder8'));
    const sub = harness(example('sub8'));
    for (let k = 0; k < 200; k++) {
      const a = (k * 97 + 13) & 255;
      const b = (k * 61 + 200) & 255;
      add.word('A', 8, a);
      add.word('B', 8, b);
      add.settle();
      expect(add.read('S', 8) + (add.get('Cout') ? 256 : 0)).toBe(a + b);
      sub.word('A', 8, a);
      sub.word('B', 8, b);
      sub.settle();
      expect(sub.read('D', 8)).toBe((a - b) & 255);
      expect(sub.get('A≥B')).toBe(a >= b);
    }
  });

  it('4-bit multiplier', () => {
    const h = harness(example('mul4'));
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        h.word('A', 4, a);
        h.word('B', 4, b);
        h.settle();
        expect(h.read('P', 8)).toBe(a * b);
      }
    }
  });

  it('4-bit divider and modulus', () => {
    const div = harness(example('div4'));
    const mod = harness(example('mod4'));
    for (let a = 0; a < 16; a++) {
      for (let b = 1; b < 16; b++) {
        div.word('A', 4, a);
        div.word('B', 4, b);
        div.settle();
        expect(div.read('Q', 4), `${a}/${b}`).toBe(Math.floor(a / b));
        expect(div.read('R', 4), `${a}%${b}`).toBe(a % b);
        mod.word('A', 4, a);
        mod.word('B', 4, b);
        mod.settle();
        expect(mod.read('R', 4)).toBe(a % b);
      }
    }
  });

  it('4-bit comparator', () => {
    const h = harness(example('cmp4'));
    for (let a = 0; a < 16; a++) {
      for (let b = 0; b < 16; b++) {
        h.word('A', 4, a);
        h.word('B', 4, b);
        h.settle();
        expect(h.get('A>B')).toBe(a > b);
        expect(h.get('A=B')).toBe(a === b);
        expect(h.get('A<B')).toBe(a < b);
      }
    }
  });

  it('SR latch starts stable and holds its state', () => {
    const h = harness(example('sr'));
    expect(h.get('Q')).not.toBe(h.get("Q'"));
    h.press('Set');
    expect(h.get('Q')).toBe(true);
    expect(h.get("Q'")).toBe(false);
    h.press('Reset');
    expect(h.get('Q')).toBe(false);
    expect(h.get("Q'")).toBe(true);
  });

  it('memory cell and register only change on write', () => {
    const h = harness(example('cell'));
    h.set('D', true);
    h.settle();
    h.press('Write');
    expect(h.get('Q')).toBe(true);
    h.set('D', false);
    h.settle();
    expect(h.get('Q')).toBe(true);
    h.press('Write');
    expect(h.get('Q')).toBe(false);

    const r = harness(example('reg8'));
    r.word('D', 8, 0xa5);
    r.press('Write');
    expect(r.read('Q', 8)).toBe(0xa5);
    r.word('D', 8, 0x3c);
    r.settle();
    expect(r.read('Q', 8)).toBe(0xa5);
    r.press('Write');
    expect(r.read('Q', 8)).toBe(0x3c);
  });

  it('D flip-flop captures on the clock edge', () => {
    const h = harness(example('dff'));
    h.set('D', true);
    h.press('Clock');
    expect(h.get('Q')).toBe(true);
    h.set('D', false);
    h.settle();
    expect(h.get('Q')).toBe(true);
    h.press('Clock');
    expect(h.get('Q')).toBe(false);
  });

  it('4-bit counter counts up', () => {
    const h = harness(example('count4'));
    let v = h.read('Q', 4);
    for (let k = 0; k < 20; k++) {
      h.press('Count');
      v = (v + 1) & 15;
      expect(h.read('Q', 4)).toBe(v);
    }
  });

  it('7-segment and 3-digit displays', () => {
    const SEGS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71];
    const segBulbs = (doc: Doc, box: string) => {
      const b = [...doc.boxes.values()].find((x) => x.name === box)!;
      return [...doc.components.values()]
        .filter((c) => c.kind === 'bulb' && c.x >= b.x && c.x < b.x + b.w && c.y >= b.y && c.y < b.y + b.h)
        .sort((p, q) => p.id.localeCompare(q.id, undefined, { numeric: true }))
        .map((c) => c.id);
    };
    const shown = (sim: Simulator, ids: string[]) => ids.reduce((v, id, i) => v | (sim.value(id) ? 1 << i : 0), 0);

    const doc = example('seg7');
    const h = harness(doc);
    const bulbs = segBulbs(doc, 'Display');
    for (let v = 0; v < 16; v++) {
      h.word('X', 4, v);
      h.settle();
      expect(shown(h.sim, bulbs), `digit ${v}`).toBe(SEGS[v]);
    }

    const doc3 = example('seg3');
    const h3 = harness(doc3);
    const digits = ['100s', '10s', '1s'].map((n) => segBulbs(doc3, n));
    for (let v = 0; v < 256; v++) {
      h3.word('B', 8, v);
      h3.settle();
      const want = [Math.floor(v / 100), Math.floor(v / 10) % 10, v % 10];
      digits.forEach((ids, k) => expect(shown(h3.sim, ids), `${v} digit ${k}`).toBe(SEGS[want[k]]));
    }
  });

  it('multiplexer, decoder and parity', () => {
    const m = harness(example('mux4'));
    for (let d = 0; d < 16; d++) {
      for (let s = 0; s < 4; s++) {
        m.word('D', 4, d);
        m.word('S', 2, s);
        m.settle();
        expect(m.get('Y')).toBe(!!(d & (1 << s)));
      }
    }
    const dec = harness(example('dec2'));
    for (let a = 0; a < 4; a++) {
      dec.word('A', 2, a);
      dec.settle();
      expect(dec.read('Y', 4)).toBe(1 << a);
    }
    const p = harness(example('parity'));
    for (let x = 0; x < 256; x++) {
      p.word('X', 8, x);
      p.settle();
      let bits = 0;
      for (let v = x; v; v &= v - 1) bits++;
      expect(p.get('Odd')).toBe(bits % 2 === 1);
    }
  });
});
