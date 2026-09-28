import { describe, expect, it } from 'vitest';
import { rectInside, rectsOverlap } from '../model/geometry';
import { buildBoxTree } from '../model/ports';
import type { Doc } from '../model/types';
import { bundleInput, bundleOutput } from '../model/types';
import { Simulator } from '../sim/simulator';
import { calculatorDoc } from './calculator';

const HEX = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

/** Restoring division, matching the gates: first bit is an xnor plus or, then full adders. */
function restoring(dividend: number, divisor: number, n = 16): number {
  const bit = (v: number, i: number) => (v >> i) & 1;
  const nb = Array.from({ length: n }, (_, j) => bit(divisor, j) ^ 1);
  let rem = Array<number>(n).fill(0);
  const q = Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    const bi = n - 1 - k;
    const s = [bit(dividend, bi), ...rem];
    const diff = [s[0] === nb[0] ? 1 : 0];
    let c = s[0] | nb[0];
    for (let j = 1; j < n; j++) {
      const sum = (s[j] ^ nb[j] ^ c) & 1;
      c = (s[j] & nb[j]) | (s[j] & c) | (nb[j] & c);
      diff.push(sum);
    }
    const qk = s[n] | c;
    const nq = qk ? 0 : 1;
    rem = diff.map((dj, j) => (qk & dj) | (nq & s[j]));
    q[bi] = qk;
  }
  return q.reduce((acc, part, i) => acc | (part << i), 0);
}

function dabble(value: number): number[] {
  const nibbles = [0, 0, 0, 0, 0];
  for (let bit = 15; bit >= 0; bit--) {
    for (let d = 0; d < 4; d++) if (nibbles[d] >= 5) nibbles[d] += 3;
    const next = [0, 0, 0, 0, 0];
    next[0] = ((nibbles[0] << 1) & 0xf) | ((value >> bit) & 1);
    for (let d = 1; d < 5; d++) next[d] = ((nibbles[d] << 1) & 0xf) | ((nibbles[d - 1] >> 3) & 1);
    for (let d = 0; d < 5; d++) nibbles[d] = next[d];
  }
  return nibbles;
}

describe('calculator arithmetic', () => {
  it('divides magnitudes toward zero and dabble-converts them', () => {
    expect(restoring(20, 3)).toBe(6);
    expect(restoring(7, 2)).toBe(3);
    expect(restoring(100, 10)).toBe(10);
    expect(restoring(8, 3)).toBe(2);
    expect(restoring(32768, 1)).toBe(32768);
    expect(restoring(15, 1)).toBe(15);
    expect(dabble(0)).toEqual([0, 0, 0, 0, 0]);
    expect(dabble(15)).toEqual([5, 1, 0, 0, 0]);
    expect(dabble(30)).toEqual([0, 3, 0, 0, 0]);
    expect(dabble(32767)).toEqual([7, 6, 7, 2, 3]);
    expect(dabble(32768)).toEqual([8, 6, 7, 2, 3]);
  });
});

function part(doc: Doc, name: string) {
  const found = [...doc.components.values()].find((c) => c.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found.id;
}

function screen(sim: Simulator, doc: Doc): string {
  const on = (name: string) => sim.value(part(doc, name));
  const places = ['10000s', '1000s', '100s', '10s', '1s'].map((place) => {
    let lit = '';
    for (const ch of 'abcdefg') if (on(`${place} ${ch}`)) lit += ch;
    return lit || 'blank';
  });
  return `${on('Minus') ? '-' : ''}${places.join(' ')}${on('Overflow') ? ' ovf' : ''}`;
}

function expectNumber(sim: Simulator, doc: Doc, n: number, overflow = false) {
  const neg = n < 0;
  const mag = Math.abs(n);
  const digits = [10000, 1000, 100, 10, 1].map((place, i) => Math.floor(mag / place) % 10);
  const names = ['10000s', '1000s', '100s', '10s', '1s'];
  names.forEach((name, i) => {
    const show = i === 4 || mag >= 10 ** (4 - i);
    const pattern = show ? HEX[digits[i]] : '';
    for (const ch of 'abcdefg') {
      expect(sim.value(part(doc, `${name} ${ch}`)), `${screen(sim, doc)} wanted ${n}`).toBe(pattern.includes(ch));
    }
  });
  expect(sim.value(part(doc, 'Minus')), screen(sim, doc)).toBe(neg);
  expect(sim.value(part(doc, 'Overflow')), screen(sim, doc)).toBe(overflow);
}

describe('calculator', () => {
  it('puts the display beside the keypad and binds the number pad', () => {
    const doc = calculatorDoc();
    const box = (name: string) => [...doc.boxes.values()].find((b) => b.name === name)!;
    const keys = box('Keypad');
    const digits = box('Digits');
    const gap = digits.x - (keys.x + keys.w);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(400);
    const beside = Math.min(keys.y + keys.h, digits.y + digits.h) - Math.max(keys.y, digits.y);
    expect(beside).toBeGreaterThan(200);
    const button = (name: string) => [...doc.components.values()].find((c) => c.kind === 'button' && c.name === name)!;
    expect(button('7').key).toBe('Numpad7');
    expect(button('0').key).toBe('Numpad0');
    expect(button('+').key).toBe('NumpadAdd');
    expect(button('−').key).toBe('NumpadSubtract');
    expect(button('×').key).toBe('NumpadMultiply');
    expect(button('÷').key).toBe('NumpadDivide');
    expect(button('=').key).toBe('NumpadEnter');
    expect(button('C').key).toBe('NumpadDecimal');
  }, 60000);

  it('adds, multiplies, subtracts, divides, remembers and overflows', () => {
    const doc = calculatorDoc();
    const sim = new Simulator();
    sim.compile(doc);
    expect(sim.settle()).toBe(true);
    expectNumber(sim, doc, 0);

    let now = 0;
    const press = (name: string) => {
      sim.setPressed(part(doc, name), true);
      expect(sim.settle(), name).toBe(true);
      for (let i = 0; i < 8; i++) {
        now += 25;
        sim.tickTime(now);
        expect(sim.settle(), `${name} down ${now}`).toBe(true);
      }
      sim.setPressed(part(doc, name), false);
      expect(sim.settle(), name).toBe(true);
      for (let i = 0; i < 8; i++) {
        now += 25;
        sim.tickTime(now);
        expect(sim.settle(), `${name} up ${now}`).toBe(true);
      }
    };
    const type = (keys: string) => {
      for (const key of keys) press(key);
    };

    type('12+3=');
    expectNumber(sim, doc, 15);
    type('×2=');
    expectNumber(sim, doc, 30);
    type('5−8=');
    expectNumber(sim, doc, -3);
    type('20÷3=');
    expectNumber(sim, doc, 6);
    press('MS');
    press('C');
    expectNumber(sim, doc, 0);
    press('MR');
    expectNumber(sim, doc, 6);
  }, 180000);

  it('repeats the last operation when equals is pressed again', () => {
    const doc = calculatorDoc();
    const sim = new Simulator();
    sim.compile(doc);
    expect(sim.settle()).toBe(true);

    let now = 0;
    const press = (name: string) => {
      sim.setPressed(part(doc, name), true);
      expect(sim.settle(), name).toBe(true);
      for (let i = 0; i < 8; i++) {
        now += 25;
        sim.tickTime(now);
        expect(sim.settle(), `${name} down ${now}`).toBe(true);
      }
      sim.setPressed(part(doc, name), false);
      expect(sim.settle(), name).toBe(true);
      for (let i = 0; i < 8; i++) {
        now += 25;
        sim.tickTime(now);
        expect(sim.settle(), `${name} up ${now}`).toBe(true);
      }
    };
    const type = (keys: string) => {
      for (const key of keys) press(key);
    };

    type('12+3=');
    expectNumber(sim, doc, 15);
    press('=');
    expectNumber(sim, doc, 18);
    type('×2=');
    expectNumber(sim, doc, 36);
    press('=');
    expectNumber(sim, doc, 72);
  }, 180000);

  it('keeps boxes from covering each other', () => {
    const doc = calculatorDoc();
    const boxes = [...doc.boxes.values()];
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (!rectsOverlap(a, b) || rectInside(a, b) || rectInside(b, a)) continue;
        hits.push(`${a.name} overlaps ${b.name}`);
      }
    }
    expect(hits.slice(0, 12), `${hits.length} overlapping pairs`).toEqual([]);

    const tree = buildBoxTree(doc);
    for (const w of doc.wires.values()) {
      const s = doc.components.get(w.from)!;
      const t = doc.components.get(w.to)!;
      if (s.kind === 'port' || t.kind === 'port') continue;
      expect(tree.scope(s), `${s.id} -> ${t.id}`).toBe(tree.scope(t));
    }
    const between = new Map<string, { cable: number; loose: number }>();
    for (const w of doc.wires.values()) {
      const a = doc.components.get(w.from);
      const b = doc.components.get(w.to);
      if (!a || !b || a.kind !== 'port' || b.kind !== 'port' || !a.box || !b.box || a.box === b.box) continue;
      const key = `${doc.boxes.get(a.box)?.name} → ${doc.boxes.get(b.box)?.name}`;
      const row = between.get(key) ?? { cable: 0, loose: 0 };
      if (w.cable) row.cable++;
      else if (bundleOutput(a) || bundleInput(b)) row.loose++;
      between.set(key, row);
    }
    for (const [key, row] of between) {
      if (row.loose >= 4 || (row.cable > 0 && row.loose > 0)) expect.fail(`${key} is ${row.cable} cable(s) and ${row.loose} wires`);
    }
  }, 60000);
});
