import { describe, expect, it } from 'vitest';
import { docToText, parseCircuit } from '../io/format';
import { netRoots } from '../model/doc';
import { bodyRect, rectsOverlap } from '../model/geometry';
import { buildBoxTree } from '../model/ports';
import type { Doc } from '../model/types';
import { bundleInput, bundleOutput } from '../model/types';
import { Simulator } from '../sim/simulator';
import { EXAMPLES } from './catalog';

describe('examples', () => {
  it('builds every example and survives a file round trip', () => {
    for (const g of EXAMPLES) {
      for (const e of g.items) {
        const doc = e.build();
        // Stress circuits deliberately cross boxes without ports to exercise routing.
        if (e.id !== 'stress') {
          const tree = buildBoxTree(doc);
          for (const w of doc.wires.values()) {
            const s = doc.components.get(w.from)!;
            const t = doc.components.get(w.to)!;
            if (s.kind === 'port' || t.kind === 'port') continue;
            expect(tree.scope(s), `${e.id}: ${s.id} -> ${t.id}`).toBe(tree.scope(t));
          }
        }
        const text = docToText(doc);
        const again = parseCircuit(text);
        expect(again.warnings, e.id).toEqual([]);
        if (e.id === 'stress') {
          expect(again.doc.components.size).toBeGreaterThan(400);
          expect(again.doc.wires.size).toBeGreaterThan(700);
        } else {
          expect(docToText(again.doc), e.id).toBe(text);
        }
      }
    }
  }, 180000);

  it('joins a numbered bus into one cable, bit 0 on top', () => {
    for (const g of EXAMPLES) {
      for (const e of g.items) {
        if (e.id === 'stress') continue;
        const doc = e.build();
        const roots = netRoots(doc);
        const between = new Map<string, { cable: number; loose: number; widths: string[] }>();
        for (const w of doc.wires.values()) {
          const a = doc.components.get(w.from);
          const b = doc.components.get(w.to);
          if (!a || !b || a.kind !== 'port' || b.kind !== 'port' || !a.box || !b.box || a.box === b.box) continue;
          const key = `${a.box}>${b.box}`;
          const row = between.get(key) ?? { cable: 0, loose: 0, widths: [] };
          if (w.cable) {
            row.cable++;
            if (a.inputs !== b.inputs) row.widths.push(`${a.inputs}↔${b.inputs}`);
          } else if (bundleOutput(a) || bundleInput(b)) row.loose++;
          between.set(key, row);
        }
        for (const [key, row] of between) {
          const names = key.split('>').map((id) => doc.boxes.get(id)?.name ?? id);
          expect(row.widths, `${e.id} ${names.join(' → ')}`).toEqual([]);
          if (row.loose >= 4 || (row.cable > 0 && row.loose > 0)) {
            expect.fail(`${e.id}: ${names.join(' → ')} is ${row.cable} cable(s) and ${row.loose} wires`);
          }
        }
        for (const c of doc.components.values()) {
          if (c.kind !== 'port' || c.inputs < 4) continue;
          const names: string[] = [];
          for (let i = 0; i < c.inputs; i++) {
            const root = roots.get(i ? `${c.id}#${i}` : c.id);
            names.push((root && doc.components.get(root)?.name) || '');
          }
          if (!names.every((n) => /^(\D*?)(\d+)$/.test(n))) continue;
          const parsed = names.map((n) => /^(\D*?)(\d+)$/.exec(n)!);
          for (let i = 1; i < parsed.length; i++) {
            const prev = parsed[i - 1];
            const cur = parsed[i];
            const ordered = prev[1] < cur[1] || (prev[1] === cur[1] && Number(prev[2]) < Number(cur[2]));
            expect(ordered, `${e.id} ${names.join(' ')}`).toBe(true);
          }
        }
      }
    }
  }, 180000);

  it('keeps parts inside a box from sitting on each other', () => {
    for (const g of EXAMPLES) {
      for (const e of g.items) {
        if (e.id === 'stress') continue;
        const doc = e.build();
        const tree = buildBoxTree(doc);
        const byScope = new Map<string, { id: string; rect: ReturnType<typeof bodyRect> }[]>();
        for (const c of doc.components.values()) {
          if (c.kind === 'port') continue;
          const key = tree.scope(c) ?? '';
          const list = byScope.get(key);
          const item = { id: c.id, rect: bodyRect(c) };
          if (list) list.push(item);
          else byScope.set(key, [item]);
        }
        // A spatial hash keeps this honest for large boxes. A 200-unit cell is
        // bigger than a gate, so only nearby parts are compared.
        const cell = 200;
        for (const parts of byScope.values()) {
          const bins = new Map<number, number[]>();
          parts.forEach((p, i) => {
            const x0 = Math.floor(p.rect.x / cell);
            const y0 = Math.floor(p.rect.y / cell);
            const x1 = Math.floor((p.rect.x + p.rect.w) / cell);
            const y1 = Math.floor((p.rect.y + p.rect.h) / cell);
            for (let x = x0; x <= x1; x++) {
              for (let y = y0; y <= y1; y++) {
                const k = x * 73856093 + y * 19349663;
                const bin = bins.get(k);
                if (bin) bin.push(i);
                else bins.set(k, [i]);
              }
            }
          });
          const seen = new Set<string>();
          for (const bin of bins.values()) {
            for (let a = 0; a < bin.length; a++) {
              for (let b = a + 1; b < bin.length; b++) {
                const i = bin[a] < bin[b] ? bin[a] : bin[b];
                const j = bin[a] < bin[b] ? bin[b] : bin[a];
                const pair = `${i}:${j}`;
                if (seen.has(pair)) continue;
                seen.add(pair);
                expect(rectsOverlap(parts[i].rect, parts[j].rect), `${e.id}: ${parts[i].id} overlaps ${parts[j].id}`).toBe(false);
              }
            }
          }
        }
      }
    }
  }, 180000);
});

function part(doc: Doc, name: string) {
  const found = [...doc.components.values()].find((c) => c.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found.id;
}

function word(sim: Simulator, doc: Doc, prefix: string, bits: number, value: number) {
  for (let i = 0; i < bits; i++) sim.setSwitch(part(doc, `${prefix}${i}`), !!((value >> i) & 1));
}

function read(sim: Simulator, doc: Doc, prefix: string, bits: number) {
  let n = 0;
  for (let i = 0; i < bits; i++) if (sim.value(part(doc, `${prefix}${i}`))) n |= 1 << i;
  return n;
}

describe('example behaviour', () => {
  it('adds', () => {
    const half = halfOf('half');
    const sim = new Simulator();
    sim.compile(half);
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        sim.setSwitch(part(half, 'A'), !!a);
        sim.setSwitch(part(half, 'B'), !!b);
        expect(sim.settle()).toBe(true);
        expect(sim.value(part(half, 'Sum'))).toBe(!!(a ^ b));
        expect(sim.value(part(half, 'Carry'))).toBe(!!(a & b));
      }
    }
    const small = halfOf('adder4');
    expect(small.boxes.size).toBe(1);
    const add4 = new Simulator();
    add4.compile(small);
    for (const [a, b] of [[0, 0], [1, 1], [15, 1], [7, 9], [15, 15]]) {
      word(add4, small, 'A', 4, a);
      word(add4, small, 'B', 4, b);
      expect(add4.settle(), `${a}+${b}`).toBe(true);
      expect(read(add4, small, 'S', 4)).toBe((a + b) & 15);
      expect(add4.value(part(small, 'Cout'))).toBe(a + b > 15);
    }
    const doc = halfOf('adder8');
    const add = new Simulator();
    add.compile(doc);
    for (const [a, b] of [[0, 0], [1, 1], [255, 1], [200, 100], [13, 240]]) {
      word(add, doc, 'A', 8, a);
      word(add, doc, 'B', 8, b);
      expect(add.settle(), `${a}+${b}`).toBe(true);
      expect(read(add, doc, 'S', 8)).toBe((a + b) & 255);
      expect(add.value(part(doc, 'Cout'))).toBe(a + b > 255);
    }
  });

  it('subtracts, multiplies, divides and compares the low 4 bits', () => {
    const sub = halfOf('sub8');
    const sim = new Simulator();
    sim.compile(sub);
    for (const [a, b] of [[5, 3], [3, 5], [0, 1], [255, 255], [100, 40]]) {
      word(sim, sub, 'A', 8, a);
      word(sim, sub, 'B', 8, b);
      expect(sim.settle(), `${a}-${b}`).toBe(true);
      expect(read(sim, sub, 'D', 8)).toBe((a - b) & 255);
      expect(sim.value(part(sub, 'Borrow'))).toBe(a < b);
    }
    const sub4 = halfOf('sub4');
    const s4 = new Simulator();
    s4.compile(sub4);
    for (const [a, b] of [[5, 3], [3, 5], [0, 1], [15, 15], [7, 9], [8, 0]]) {
      word(s4, sub4, 'A', 4, a);
      word(s4, sub4, 'B', 4, b);
      expect(s4.settle(), `4bit ${a}-${b}`).toBe(true);
      expect(read(s4, sub4, 'D', 4)).toBe((a - b) & 15);
      expect(s4.value(part(sub4, 'Borrow'))).toBe(a < b);
    }
    const mul = halfOf('mul4');
    const ms = new Simulator();
    ms.compile(mul);
    for (const [a, b] of [[0, 5], [7, 3], [15, 15], [9, 0]]) {
      word(ms, mul, 'A', 8, a);
      word(ms, mul, 'B', 8, b);
      expect(ms.settle(), `${a}*${b}`).toBe(true);
      expect(read(ms, mul, 'P', 8)).toBe(a * b);
    }
    const div = halfOf('div4');
    const ds = new Simulator();
    ds.compile(div);
    const mod = halfOf('mod4');
    const rs = new Simulator();
    rs.compile(mod);
    for (const [a, b] of [[15, 2], [7, 3], [8, 8], [1, 1], [9, 4]]) {
      word(ds, div, 'A', 8, a);
      word(ds, div, 'B', 8, b);
      word(rs, mod, 'A', 8, a);
      word(rs, mod, 'B', 8, b);
      expect(ds.settle(), `${a}/${b}`).toBe(true);
      expect(rs.settle(), `${a}%${b}`).toBe(true);
      expect(read(ds, div, 'Q', 8)).toBe(Math.floor(a / b));
      expect(read(rs, mod, 'R', 8)).toBe(a % b);
    }
    const cmp = halfOf('cmp4');
    const cs = new Simulator();
    cs.compile(cmp);
    for (const [a, b] of [[5, 3], [3, 5], [7, 7], [0, 1], [15, 0]]) {
      word(cs, cmp, 'A', 8, a);
      word(cs, cmp, 'B', 8, b);
      expect(cs.settle()).toBe(true);
      expect(cs.value(part(cmp, 'A>B'))).toBe(a > b);
      expect(cs.value(part(cmp, 'A=B'))).toBe(a === b);
      expect(cs.value(part(cmp, 'A<B'))).toBe(a < b);
    }
  });

  it('routes, displays and remembers', () => {
    const mux = halfOf('mux4');
    const ms = new Simulator();
    ms.compile(mux);
    for (let s = 0; s < 4; s++) {
      for (let d = 0; d < 4; d++) ms.setSwitch(part(mux, `D${d}`), d === s);
      ms.setSwitch(part(mux, 'S0'), !!(s & 1));
      ms.setSwitch(part(mux, 'S1'), !!(s & 2));
      expect(ms.settle()).toBe(true);
      expect(ms.value(part(mux, 'Y'))).toBe(true);
    }
    const dec = halfOf('dec2');
    const ds = new Simulator();
    ds.compile(dec);
    for (let s = 0; s < 4; s++) {
      ds.setSwitch(part(dec, 'S0'), !!(s & 1));
      ds.setSwitch(part(dec, 'S1'), !!(s & 2));
      expect(ds.settle()).toBe(true);
      for (let y = 0; y < 4; y++) expect(ds.value(part(dec, `Y${y}`))).toBe(y === s);
    }
    const seg = halfOf('seg7');
    const ss = new Simulator();
    ss.compile(seg);
    word(ss, seg, 'B', 8, 0xa);
    expect(ss.settle()).toBe(true);
    for (const ch of 'abcdefg') expect(ss.value(part(seg, `Display ${ch}`))).toBe('abcefg'.includes(ch));
    const dig = halfOf('seg3');
    const td = new Simulator();
    td.compile(dig);
    word(td, dig, 'B', 8, 42);
    expect(td.settle()).toBe(true);
    const lit = (place: string, on: string) => {
      for (const ch of 'abcdefg') expect(td.value(part(dig, `${place} ${ch}`)), place).toBe(on.includes(ch));
    };
    lit('100s', 'abcdef');
    lit('10s', 'bcfg');
    lit('1s', 'abdeg');

    const sr = halfOf('sr');
    const latch = new Simulator();
    latch.compile(sr);
    expect(latch.settle()).toBe(true);
    latch.setPressed(part(sr, 'S'), true);
    expect(latch.settle()).toBe(true);
    expect(latch.value(part(sr, 'Q'))).toBe(true);
    latch.setPressed(part(sr, 'S'), false);
    expect(latch.settle()).toBe(true);
    expect(latch.value(part(sr, 'Q'))).toBe(true);
    latch.setPressed(part(sr, 'R'), true);
    expect(latch.settle()).toBe(true);
    expect(latch.value(part(sr, 'Q'))).toBe(false);

    const mem = halfOf('mem');
    const cell = new Simulator();
    cell.compile(mem);
    cell.setSwitch(part(mem, 'D'), true);
    cell.setPressed(part(mem, 'Write'), true);
    expect(cell.settle()).toBe(true);
    expect(cell.value(part(mem, 'Q'))).toBe(true);
    cell.setPressed(part(mem, 'Write'), false);
    cell.setSwitch(part(mem, 'D'), false);
    expect(cell.settle()).toBe(true);
    expect(cell.value(part(mem, 'Q'))).toBe(true);

    const ff = halfOf('dff');
    const flip = new Simulator();
    flip.compile(ff);
    flip.setSwitch(part(ff, 'D'), true);
    expect(flip.settle()).toBe(true);
    flip.setPressed(part(ff, 'Clock'), true);
    expect(flip.settle()).toBe(true);
    expect(flip.value(part(ff, 'Q'))).toBe(true);
    flip.setSwitch(part(ff, 'D'), false);
    expect(flip.settle()).toBe(true);
    expect(flip.value(part(ff, 'Q'))).toBe(true);
    flip.setPressed(part(ff, 'Clock'), false);
    expect(flip.settle()).toBe(true);

    const reg = halfOf('reg8');
    const rs = new Simulator();
    rs.compile(reg);
    word(rs, reg, 'D', 8, 0b10110001);
    rs.setPressed(part(reg, 'Load'), true);
    expect(rs.settle()).toBe(true);
    expect(read(rs, reg, 'Q', 8)).toBe(0b10110001);
    rs.setPressed(part(reg, 'Load'), false);
    word(rs, reg, 'D', 8, 0);
    expect(rs.settle()).toBe(true);
    expect(read(rs, reg, 'Q', 8)).toBe(0b10110001);

    const ctr = halfOf('count8');
    const cs = new Simulator();
    cs.compile(ctr);
    expect(cs.settle()).toBe(true);
    expect(read(cs, ctr, 'Q', 8)).toBe(0);
    const clock = part(ctr, 'Clock');
    for (let n = 1; n <= 256; n++) {
      cs.setPressed(clock, true);
      expect(cs.settle(), `rise ${n}`).toBe(true);
      cs.setPressed(clock, false);
      expect(cs.settle(), `fall ${n}`).toBe(true);
      expect(read(cs, ctr, 'Q', 8), `count ${n}`).toBe(n & 255);
    }
  });

  it('runs the shift register, memory, ALU, parity, ring and lock', () => {
    const edge = (sim: Simulator, id: string) => {
      sim.setPressed(id, true);
      expect(sim.settle()).toBe(true);
      sim.setPressed(id, false);
      expect(sim.settle()).toBe(true);
    };

    const shift = halfOf('shift');
    const sh = new Simulator();
    sh.compile(shift);
    sh.setSwitch(part(shift, 'In'), true);
    expect(sh.settle()).toBe(true);
    expect(read(sh, shift, 'Q', 4)).toBe(0);
    edge(sh, part(shift, 'Clock'));
    expect(read(sh, shift, 'Q', 4)).toBe(1);
    sh.setSwitch(part(shift, 'In'), false);
    expect(sh.settle()).toBe(true);
    expect(read(sh, shift, 'Q', 4)).toBe(1);
    edge(sh, part(shift, 'Clock'));
    expect(read(sh, shift, 'Q', 4)).toBe(2);
    edge(sh, part(shift, 'Clock'));
    expect(read(sh, shift, 'Q', 4)).toBe(4);
    edge(sh, part(shift, 'Clock'));
    expect(read(sh, shift, 'Q', 4)).toBe(8);
    edge(sh, part(shift, 'Clock'));
    expect(read(sh, shift, 'Q', 4)).toBe(0);

    const ram = halfOf('ram');
    const rm = new Simulator();
    rm.compile(ram);
    const write = (addr: number, bit: boolean) => {
      rm.setSwitch(part(ram, 'A0'), !!(addr & 1));
      rm.setSwitch(part(ram, 'A1'), !!(addr & 2));
      rm.setSwitch(part(ram, 'D'), bit);
      rm.setPressed(part(ram, 'Write'), true);
      expect(rm.settle(), `write ${addr}`).toBe(true);
      rm.setPressed(part(ram, 'Write'), false);
      expect(rm.settle(), `hold ${addr}`).toBe(true);
    };
    const readQ = (addr: number) => {
      rm.setSwitch(part(ram, 'A0'), !!(addr & 1));
      rm.setSwitch(part(ram, 'A1'), !!(addr & 2));
      rm.setSwitch(part(ram, 'D'), false);
      expect(rm.settle(), `read ${addr}`).toBe(true);
      return rm.value(part(ram, 'Q'));
    };
    write(0, true);
    write(2, true);
    expect(readQ(0)).toBe(true);
    expect(readQ(1)).toBe(false);
    expect(readQ(2)).toBe(true);
    expect(readQ(3)).toBe(false);
    write(0, false);
    expect(readQ(0)).toBe(false);
    expect(readQ(2)).toBe(true);

    const alu = halfOf('alu');
    const al = new Simulator();
    al.compile(alu);
    for (let op = 0; op < 4; op++) {
      for (let a = 0; a < 2; a++) {
        for (let bbit = 0; bbit < 2; bbit++) {
          for (let cin = 0; cin < 2; cin++) {
            al.setSwitch(part(alu, 'Op0'), !!(op & 1));
            al.setSwitch(part(alu, 'Op1'), !!(op & 2));
            al.setSwitch(part(alu, 'A'), !!a);
            al.setSwitch(part(alu, 'B'), !!bbit);
            al.setSwitch(part(alu, 'Cin'), !!cin);
            expect(al.settle(), `op ${op} ${a}${bbit}${cin}`).toBe(true);
            const sum = a ^ bbit ^ cin;
            const cout = (a & bbit) | (cin & (a ^ bbit));
            const y = op === 0 ? a & bbit : op === 1 ? a | bbit : op === 2 ? sum : a;
            expect(al.value(part(alu, 'Y')), `Y op ${op}`).toBe(!!y);
            expect(al.value(part(alu, 'Cout'))).toBe(!!cout);
          }
        }
      }
    }

    const parity = halfOf('parity');
    const py = new Simulator();
    py.compile(parity);
    for (let n = 0; n < 16; n++) {
      word(py, parity, 'A', 4, n);
      expect(py.settle(), `parity ${n}`).toBe(true);
      let ones = 0;
      for (let i = 0; i < 4; i++) if (n & (1 << i)) ones++;
      expect(py.value(part(parity, 'Odd')), `odd ${n}`).toBe(ones % 2 === 1);
    }

    const ring = halfOf('ring');
    const rg = new Simulator();
    rg.compile(ring);
    expect(rg.settle()).toBe(true);
    expect(read(rg, ring, 'Q', 8)).toBe(0);
    const pulsePart = [...ring.components.values()].find((c) => c.kind === 'timer')!;
    const periodMs = (pulsePart.period ?? 1) * 1000;
    const pulseMs = (pulsePart.pulse ?? 0.2) * 1000;
    let t = pulseMs / 2;
    for (let i = 0; i < 9; i++) {
      expect(rg.tickTime(t), `rise ${i}`).toBe(true);
      expect(rg.settle(), `rise ${i}`).toBe(true);
      expect(read(rg, ring, 'Q', 8), `bit ${i}`).toBe(1 << (i % 8));
      expect(rg.tickTime(t + pulseMs), `fall ${i}`).toBe(true);
      expect(rg.settle(), `fall ${i}`).toBe(true);
      expect(read(rg, ring, 'Q', 8)).toBe(1 << (i % 8));
      t += periodMs;
    }

    const lock = halfOf('lock');
    const lk = new Simulator();
    lk.compile(lock);
    for (let n = 0; n < 16; n++) {
      word(lk, lock, 'C', 4, n);
      expect(lk.settle(), `lock ${n}`).toBe(true);
      expect(lk.value(part(lock, 'Open')), `open ${n}`).toBe(n === 0b1101);
    }
  });
});

function halfOf(id: string): Doc {
  for (const g of EXAMPLES) for (const e of g.items) if (e.id === id) return e.build();
  throw new Error(id);
}
