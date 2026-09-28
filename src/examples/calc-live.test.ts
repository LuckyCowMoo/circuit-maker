import { describe, expect, it } from 'vitest';
import type { Doc } from '../model/types';
import { Simulator } from '../sim/simulator';
import { calculatorDoc } from './calculator';

const HEX = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

function part(doc: Doc, name: string) {
  const found = [...doc.components.values()].find((c) => c.name === name);
  if (!found) throw new Error(name);
  return found.id;
}

function read(sim: Simulator, doc: Doc, names: string[], minus: string) {
  const digits = names.map((name) => {
    let lit = '';
    for (const ch of 'abcdefg') if (sim.value(part(doc, `${name} ${ch}`))) lit += ch;
    const n = HEX.indexOf(lit);
    return n >= 0 ? String(n) : lit ? `?${lit}` : '';
  });
  return `${sim.value(part(doc, minus)) ? '-' : ''}${digits.join('')}`;
}

/** The editor advances about 400 waves per frame while the timer keeps running. */
describe('calculator live frames', () => {
  it('repeats 1 + 1 when each frame is only 400 waves', () => {
    const doc = calculatorDoc();
    const sim = new Simulator();
    sim.compile(doc);
    let now = 0;
    const frames = (n: number) => {
      let busy = 0;
      for (let i = 0; i < n; i++) {
        now += 16;
        sim.tickTime(now);
        if (sim.step(400)) busy++;
      }
      return busy;
    };
    frames(5);
    const lamp = (name: string) => sim.value([...doc.components.values()].find((c) => c.kind === 'bulb' && c.name === name)!.id);
    const press = (name: string) => {
      sim.setPressed(part(doc, name), true);
      const down = frames(40);
      sim.setPressed(part(doc, name), false);
      const up = frames(20);
      const main = read(sim, doc, ['10000s', '1000s', '100s', '10s', '1s'], 'Minus');
      const acc = read(sim, doc, ['Acc 10000s', 'Acc 1000s', 'Acc 100s', 'Acc 10s', 'Acc 1s'], 'Acc Minus');
      const op = ['+', '−', '×', '÷'].filter((n) => lamp(n)).join('') || 'none';
      return `${name} main ${main} acc ${acc} op ${op} pend ${sim.pending} busy ${down + up}`;
    };
    const lines = ['1', '+', '1', '=', '='].map(press);
    expect(lines.map((line) => line.replace(/ busy \d+$/, '')).join('\n'), lines.join('\n')).toBe(
      ['1 main 1 acc 0 op none pend false', '+ main 1 acc 1 op + pend false', '1 main 1 acc 1 op + pend false', '= main 2 acc 2 op + pend false', '= main 3 acc 3 op + pend false'].join('\n'),
    );
  }, 120000);
});
