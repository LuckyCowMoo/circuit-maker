import { describe, expect, it } from 'vitest';
import type { Doc } from '../model/types';
import { Simulator } from '../sim/simulator';
import { bcdDoc, FRUIT_X, FRUIT_Y, segmentLive, snakeDoc } from './snake';

const HEX = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

function part(doc: Doc, name: string) {
  const found = [...doc.components.values()].find((c) => c.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found.id;
}

function lit(sim: Simulator, doc: Doc, name: string, on: string) {
  for (const ch of 'abcdefg') expect(sim.value(part(doc, `${name} ${ch}`)), `${name} ${ch}`).toBe(on.includes(ch));
}

describe('snake helpers', () => {
  it('marks the live slots of a wrapping snake', () => {
    expect([0, 1, 2, 3].every((i) => segmentLive(i, 0, 4))).toBe(true);
    expect(segmentLive(4, 0, 4)).toBe(false);
    expect(segmentLive(97, 97, 4)).toBe(true);
    expect(segmentLive(98, 97, 4)).toBe(true);
    expect(segmentLive(0, 97, 4)).toBe(true);
    expect(segmentLive(1, 97, 4)).toBe(true);
    expect(segmentLive(2, 97, 4)).toBe(false);
    expect(segmentLive(0, 0, 99)).toBe(true);
    expect(segmentLive(50, 10, 99)).toBe(true);
  });
});

describe('score digits', () => {
  it('shows 0, 1, 10, 42 and 99', () => {
    const doc = bcdDoc();
    const sim = new Simulator();
    sim.compile(doc);
    const show = (n: number, tens: string, ones: string) => {
      for (let i = 0; i < 8; i++) sim.setSwitch(part(doc, `S${i}`), !!((n >> i) & 1));
      expect(sim.settle(), String(n)).toBe(true);
      lit(sim, doc, '10s', tens);
      lit(sim, doc, '1s', ones);
    };
    show(0, HEX[0], HEX[0]);
    show(1, HEX[0], HEX[1]);
    show(10, HEX[1], HEX[0]);
    show(42, HEX[4], HEX[2]);
    show(99, HEX[9], HEX[9]);
  });
});

describe('snake', () => {
  it('moves, turns, eats, dies and resets', () => {
    const doc = snakeDoc();
    const sim = new Simulator();
    sim.compile(doc);
    expect(sim.settle()).toBe(true);

    const rgb = (x: number, y: number) => {
      const id = part(doc, `c${x}_${y}`);
      return (sim.value(id, 0) ? 4 : 0) | (sim.value(id, 1) ? 2 : 0) | (sim.value(id, 2) ? 1 : 0);
    };
    const press = (name: string, down: boolean) => sim.setPressed(part(doc, name), down);
    let t = 0;
    const boot = () => {
      sim.tickTime(0);
      expect(sim.settle()).toBe(true);
    };
    const step = (hold?: string[]) => {
      sim.tickTime(t + 300);
      expect(sim.settle()).toBe(true);
      for (const name of hold ?? []) press(name, true);
      expect(sim.settle()).toBe(true);
      sim.tickTime(t + 500);
      expect(sim.settle()).toBe(true);
      for (const name of hold ?? []) press(name, false);
      t += 500;
    };

    boot();
    expect(rgb(9, 8)).toBe(0b110);
    expect(rgb(8, 8)).toBe(0b010);
    expect(rgb(7, 8)).toBe(0b010);
    expect(rgb(6, 8)).toBe(0b010);
    expect(rgb(5, 8)).toBe(0);
    expect(rgb(FRUIT_X[0], FRUIT_Y[0])).toBe(0b100);
    lit(sim, doc, '10s', HEX[0]);
    lit(sim, doc, '1s', HEX[0]);

    step();
    expect(rgb(10, 8)).toBe(0b110);
    expect(rgb(9, 8)).toBe(0b010);
    expect(rgb(6, 8)).toBe(0);

    step(['Up']);
    expect(rgb(11, 8)).toBe(0b110);
    step();
    expect(rgb(11, 7)).toBe(0b110);

    step(['Down']);
    expect(rgb(11, 6)).toBe(0b110);
    step();
    expect(rgb(11, 5)).toBe(0b110);

    step(['Up', 'Left']);
    expect(rgb(11, 4)).toBe(0b110);

    press('Reset', true);
    step();
    press('Reset', false);
    expect(rgb(9, 8)).toBe(0b110);
    expect(rgb(6, 8)).toBe(0b010);
    expect(rgb(11, 4)).toBe(0);
    lit(sim, doc, '1s', HEX[0]);

    step();
    step();
    step();
    expect(rgb(12, 8)).toBe(0b110);
    expect(rgb(8, 8)).toBe(0);
    expect(rgb(9, 8)).toBe(0b010);
    step();
    expect(rgb(13, 8)).toBe(0b110);
    expect(rgb(9, 8)).toBe(0b010);
    expect(rgb(FRUIT_X[1], FRUIT_Y[1])).toBe(0b001);
    lit(sim, doc, '1s', HEX[1]);
    lit(sim, doc, '10s', HEX[0]);

    for (let n = 0; n < 3; n++) step();
    expect(rgb(15, 8)).toBe(0b110);
    const frozen = rgb(14, 8);
    step();
    expect(rgb(15, 8)).toBe(0b110);
    expect(rgb(14, 8)).toBe(frozen);
    step();
    expect(rgb(15, 8)).toBe(0b110);

    press('Reset', true);
    step();
    press('Reset', false);
    expect(rgb(9, 8)).toBe(0b110);
    expect(rgb(15, 8)).toBe(0);
    lit(sim, doc, '1s', HEX[0]);
  }, 60_000);
});
