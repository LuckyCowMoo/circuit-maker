import { describe, expect, it } from 'vitest';
import { emptyDoc, makeComponent } from './doc';
import { TABLE_STEP_MS } from './table';
import { buildRowPreview, connectedParts, TABLE_PREVIEW_MAX } from './tablePreview';
import type { Component, Doc } from './types';

function add(doc: Doc, kind: Component['kind'], id: string, x = 0, y = 0): Component {
  const c = makeComponent(kind, x, y, id);
  doc.components.set(id, c);
  return c;
}

function link(doc: Doc, from: string, to: string, input = 0): void {
  const id = `w${doc.wires.size}`;
  doc.wires.set(id, { id, from, to, input });
}

function solutionTable(doc: Doc, inputs: number, outputs: number): Component {
  const table = add(doc, 'table', 'tt', 0, 200);
  const t = table.table!;
  t.mode = 'solution';
  t.inputs = inputs;
  t.outputs = outputs;
  t.names = Array.from({ length: inputs + outputs }, (_, i) => String(i));
  t.rows = Array.from({ length: 1 << inputs }, () => '0');
  return table;
}

describe('solution row preview', () => {
  it('steps a test once a second', () => {
    expect(TABLE_STEP_MS).toBe(1000);
  });

  it('includes the gates between the columns and ignores a separate circuit', () => {
    const doc = emptyDoc();
    add(doc, 'switch', 'a', 0, 0);
    add(doc, 'switch', 'b', 0, 80);
    add(doc, 'and', 'g', 120, 40);
    add(doc, 'bulb', 'l', 220, 40);
    const table = solutionTable(doc, 2, 1);
    link(doc, 'a', 'g', 0);
    link(doc, 'b', 'g', 1);
    link(doc, 'g', 'l');
    link(doc, 'a', 'tt', 0);
    link(doc, 'b', 'tt', 1);
    link(doc, 'l', 'tt', 8);
    add(doc, 'or', 'far', 800, 0);
    add(doc, 'and', 'far2', 900, 0);
    link(doc, 'far', 'far2', 0);
    expect(connectedParts(doc, table).map((c) => c.id).sort()).toEqual(['a', 'b', 'g', 'l']);
    const off = buildRowPreview(doc, table, 0);
    const on = buildRowPreview(doc, table, 3);
    expect(off?.sim.value('l')).toBe(false);
    expect(on?.sim.value('l')).toBe(true);
    expect(on?.sim.value('g')).toBe(true);
    expect(on?.title).toContain('0 1');
  });

  it('hides the popup once 50 parts are connected', () => {
    const doc = emptyDoc();
    add(doc, 'switch', 'a');
    let prev = 'a';
    const gates = TABLE_PREVIEW_MAX - 2;
    for (let i = 0; i < gates; i++) {
      const id = `g${i}`;
      add(doc, 'buffer', id, i * 40, 0);
      link(doc, prev, id);
      prev = id;
    }
    add(doc, 'bulb', 'l', 2000, 0);
    link(doc, prev, 'l');
    const table = solutionTable(doc, 1, 1);
    link(doc, 'a', 'tt', 0);
    link(doc, 'l', 'tt', 8);
    expect(connectedParts(doc, table)).toHaveLength(TABLE_PREVIEW_MAX);
    expect(buildRowPreview(doc, table, 0)).toBeNull();
  });
});
