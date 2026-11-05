import { emptyDoc } from './doc';
import { Simulator } from '../sim/simulator';
import { columnBulb, rowBit, wireAt, TABLE_OUT } from './table';
import type { Component, ComponentKind, Doc } from './types';

/** Hover preview stays hidden once the connected circuit reaches this many parts. */
export const TABLE_PREVIEW_MAX = 50;

const PREVIEW_KIND = new Set<ComponentKind>([
  'and',
  'or',
  'xor',
  'buffer',
  'switch',
  'button',
  'timer',
  'bulb',
  'rgb',
  'port',
]);

export interface RowPreviewModel {
  title: string;
  /** Parts and the wires between them, with the rest of the canvas left out. */
  doc: Doc;
  parts: Component[];
  sim: Simulator;
}

/**
 * Parts that share a wire path with this table's columns: the plugged-in inputs
 * and bulbs, and every gate between them. A circuit with no wire into that set
 * is left out. The table itself is not one of the parts.
 */
export function connectedParts(doc: Doc, table: Component): Component[] {
  const t = table.table;
  if (!t) return [];
  const seeds: string[] = [];
  for (let i = 0; i < t.inputs; i++) {
    const wire = wireAt(doc, table.id, i);
    if (wire) seeds.push(wire.from);
  }
  for (let i = 0; i < t.outputs; i++) {
    const pin = TABLE_OUT + i;
    const wire = wireAt(doc, table.id, pin);
    if (wire) seeds.push(wire.from);
    const bulb = columnBulb(doc, table.id, pin);
    if (bulb) seeds.push(bulb.id);
  }
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (a === table.id || b === table.id) return;
    const left = doc.components.get(a);
    const right = doc.components.get(b);
    if (!left || !right || !PREVIEW_KIND.has(left.kind) || !PREVIEW_KIND.has(right.kind)) return;
    let list = adj.get(a);
    if (!list) adj.set(a, (list = []));
    list.push(b);
    let back = adj.get(b);
    if (!back) adj.set(b, (back = []));
    back.push(a);
  };
  for (const w of doc.wires.values()) link(w.from, w.to);
  const seen = new Set<string>();
  const stack = seeds.filter((id) => id !== table.id);
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    const c = doc.components.get(id);
    if (!c || !PREVIEW_KIND.has(c.kind)) continue;
    seen.add(id);
    for (const next of adj.get(id) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return [...seen].map((id) => doc.components.get(id)!);
}

/** Snapshot of the connected circuit with this solution row's inputs forced on. */
export function buildRowPreview(doc: Doc, table: Component, row: number): RowPreviewModel | null {
  const t = table.table;
  if (!t || t.mode !== 'solution') return null;
  const parts = connectedParts(doc, table);
  if (parts.length === 0 || parts.length >= TABLE_PREVIEW_MAX) return null;
  const ids = new Set(parts.map((p) => p.id));
  const sub = emptyDoc(doc.name);
  for (const p of parts) sub.components.set(p.id, p);
  for (const w of doc.wires.values()) {
    if (!ids.has(w.from) || !ids.has(w.to)) continue;
    sub.wires.set(w.id, w);
  }
  const sim = new Simulator();
  sim.compile(sub);
  for (let i = 0; i < t.inputs; i++) {
    const wire = wireAt(doc, table.id, i);
    const src = wire ? doc.components.get(wire.from) : undefined;
    if (!src || !ids.has(src.id)) continue;
    const on = rowBit(t.inputs, row, i) === '1';
    if (src.kind === 'switch') sim.setSwitch(src.id, on);
    else if (src.kind === 'button') sim.setPressed(src.id, on);
    else if (src.kind === 'timer') sim.hold(src.id, on ? 1 : 0);
  }
  sim.settle();
  const bits: string[] = [];
  for (let i = 0; i < t.inputs; i++) {
    const name = t.names[i];
    const bit = rowBit(t.inputs, row, i);
    bits.push(name ? `${name} ${bit}` : bit);
  }
  return { title: bits.join('  '), doc: sub, parts, sim };
}
