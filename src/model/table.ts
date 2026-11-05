import { idleWire, wireColors, type Theme } from './themes';
import type { Component, Doc, Point, Rect, TableData, Wire } from './types';

/** Most input or output columns a truth table will grow to. */
export const TABLE_MAX = 8;
/** Output-column pins start here so adding an input never renumbers them. */
export const TABLE_OUT = 8;
export const TABLE_VISIBLE = 8;
/** How long a solution test holds each row before the next one. */
export const TABLE_STEP_MS = 1000;
/** How long the discovery button must be held before it converts. */
export const TABLE_CONVERT_MS = 3000;
export const TABLE_CONVERT_LABEL = 'convert to question';
export const TABLE_ROW_H = 22;
/** Full-width convert / Test row above the column labels. */
export const TABLE_BTN_ROW = 32;
/** Column-name row between the button and the cells. */
export const TABLE_LABEL = 28;
export const TABLE_COL = 46;
/** Clear space between the input pins and the output pins. */
export const TABLE_GAP = 28;
export const TABLE_PAD = 8;
/** Room for a spare pin outside the grid. A column appears only after a wire lands. */
export const TABLE_PIN_GUTTER = 16;
/** Wide enough for the convert label, with space inside the rounded ends. */
export const TABLE_BTN_W = 138;
export const TABLE_BTN_H = 22;

export interface TablePin {
  pin: number;
  /** Centre of the pin, local to the body. The stub tip sits `pinLen` above the body. */
  x: number;
  spare: boolean;
  side: 'in' | 'out';
  /** Column index on that side. Spares use the would-be new index. */
  index: number;
  colX: number;
  colW: number;
}

export interface TableLayout {
  w: number;
  h: number;
  rows: number;
  visible: number;
  pins: TablePin[];
  button: Rect;
  /** Left edge of the gap between the two halves. */
  gapX: number;
  /** Width of the gap between the two halves. */
  gap: number;
  gridLeft: number;
  gridRight: number;
  /** Top of the cell grid, below the button and the labels. */
  gridTop: number;
  /** Vertical centre of the column names. */
  labelY: number;
}

export function freshTable(): TableData {
  return { mode: 'discovery', inputs: 0, outputs: 0, rows: [null], names: [] };
}

export function cloneTable(t: TableData): TableData {
  return {
    mode: t.mode,
    inputs: t.inputs,
    outputs: t.outputs,
    rows: t.rows.slice(),
    names: t.names.slice(),
    marks: t.marks?.map((m) => m),
  };
}

export function rowCount(inputs: number): number {
  return 1 << inputs;
}

/** Leftmost bit is the high bit, matching a truth table read left to right. */
export function comboIndex(bits: boolean[]): number {
  let n = 0;
  for (const bit of bits) n = (n << 1) | (bit ? 1 : 0);
  return n;
}

export function rowBit(inputs: number, row: number, col: number): '0' | '1' {
  return (row >> (inputs - 1 - col)) & 1 ? '1' : '0';
}

export function maxScroll(t: TableData): number {
  return Math.max(0, rowCount(t.inputs) - TABLE_VISIBLE);
}

export function tableComplete(t: TableData): boolean {
  if (t.inputs < 1 || t.outputs < 1) return false;
  if (t.rows.length !== rowCount(t.inputs)) return false;
  return t.rows.every((row) => row != null && knownOutputs(row, t.outputs));
}

function knownOutputs(row: string, outputs: number): boolean {
  if (row.length < outputs) return false;
  for (let i = 0; i < outputs; i++) if (row[i] !== '0' && row[i] !== '1') return false;
  return true;
}

/** Record a combination the first time it appears. Known output cells are left alone. */
export function observe(t: TableData, bits: boolean[], outs: boolean[]): boolean {
  if (bits.length !== t.inputs || outs.length !== t.outputs) return false;
  const i = comboIndex(bits);
  const cur = t.rows[i];
  let next = '';
  let changed = cur == null;
  for (let k = 0; k < t.outputs; k++) {
    const known = cur != null && (cur[k] === '0' || cur[k] === '1');
    if (known) next += cur![k];
    else {
      next += outs[k] ? '1' : '0';
      changed = true;
    }
  }
  if (!changed) return false;
  t.rows[i] = next;
  return true;
}

export function wipeRows(t: TableData): void {
  t.rows = Array.from({ length: rowCount(t.inputs) }, () => null);
  delete t.marks;
}

export function addInputColumn(t: TableData, name: string): void {
  t.names.splice(0, 0, name);
  t.inputs++;
  wipeRows(t);
}

export function addOutputColumn(t: TableData, name: string): void {
  t.names.push(name);
  t.outputs++;
}

export function dropInput(t: TableData, index: number): void {
  t.names.splice(index, 1);
  t.inputs--;
  wipeRows(t);
}

export function dropOutput(t: TableData, index: number): void {
  t.names.splice(t.inputs + index, 1);
  for (let r = 0; r < t.rows.length; r++) {
    const row = t.rows[r];
    if (row != null) t.rows[r] = row.slice(0, index) + row.slice(index + 1);
  }
  if (t.marks) {
    for (let r = 0; r < t.marks.length; r++) {
      const mark = t.marks[r];
      if (mark != null) t.marks[r] = mark.slice(0, index) + mark.slice(index + 1);
    }
  }
  t.outputs--;
}

/** Forget one output column so the next sighting of each combination can fill it again. */
export function blankOutputColumn(t: TableData, index: number): void {
  for (let r = 0; r < t.rows.length; r++) {
    const row = t.rows[r];
    if (row == null) continue;
    const chars = row.split('');
    while (chars.length < t.outputs) chars.push('.');
    chars[index] = '.';
    t.rows[r] = chars.join('');
  }
  if (!t.marks) return;
  for (let r = 0; r < t.marks.length; r++) {
    const mark = t.marks[r];
    if (mark == null) continue;
    const chars = mark.split('');
    while (chars.length < t.outputs) chars.push('.');
    chars[index] = '.';
    t.marks[r] = chars.join('');
  }
}

export function clearMarks(t: TableData): void {
  delete t.marks;
}

/** `p` when the bulb matches the saved bit, `f` when it does not. */
export function gradeRow(expected: string, actual: boolean[]): string {
  let s = '';
  for (let i = 0; i < actual.length; i++) {
    const want = expected[i] === '1';
    s += actual[i] === want ? 'p' : 'f';
  }
  return s;
}

export function setRowMark(t: TableData, row: number, mark: string): void {
  if (!t.marks || t.marks.length !== t.rows.length) {
    t.marks = Array.from({ length: t.rows.length }, () => null);
  }
  t.marks[row] = mark;
}

/** Every recorded output matched when the solution was tested. */
export function tablePassed(t: TableData): boolean {
  if (t.mode !== 'solution' || t.inputs < 1 || t.outputs < 1) return false;
  const marks = t.marks;
  if (!marks || marks.length !== t.rows.length || !t.rows.length) return false;
  for (const mark of marks) {
    if (!mark || mark.length < t.outputs) return false;
    for (let i = 0; i < t.outputs; i++) if (mark[i] !== 'p') return false;
  }
  return true;
}

export function pinSide(t: TableData, pin: number): 'in' | 'out' | null {
  if (pin >= 0 && pin < TABLE_OUT) {
    const limit = t.inputs + (t.mode === 'discovery' && t.inputs < TABLE_MAX ? 1 : 0);
    return pin < limit ? 'in' : null;
  }
  if (pin >= TABLE_OUT && pin < TABLE_OUT * 2) {
    const index = pin - TABLE_OUT;
    const limit = t.outputs + (t.mode === 'discovery' && t.outputs < TABLE_MAX ? 1 : 0);
    return index < limit ? 'out' : null;
  }
  return null;
}

export function pinIsSpare(t: TableData, pin: number): boolean {
  if (t.mode !== 'discovery') return false;
  if (pin === t.inputs && t.inputs < TABLE_MAX) return true;
  if (pin === TABLE_OUT + t.outputs && t.outputs < TABLE_MAX) return true;
  return false;
}

export function nameIndex(t: TableData, pin: number): number {
  if (pin < TABLE_OUT) return pin;
  return t.inputs + (pin - TABLE_OUT);
}

export function wireAt(doc: Doc, id: string, pin: number): Wire | null {
  for (const w of doc.wires.values()) if (w.to === id && w.input === pin && !w.cable) return w;
  return null;
}

/** Bulbs whose input is driven by `srcId`, ignoring probes into a truth table. */
export function bulbsDrivenBy(doc: Doc, srcId: string): Component[] {
  const out: Component[] = [];
  const seen = new Set<string>();
  for (const w of doc.wires.values()) {
    if (w.from !== srcId || w.cable) continue;
    const dst = doc.components.get(w.to);
    if (dst?.kind !== 'bulb' || seen.has(dst.id)) continue;
    seen.add(dst.id);
    out.push(dst);
  }
  return out;
}

/**
 * The bulb an output column is watching. The wire may start at the bulb's input
 * pin, or at the single component that feeds that bulb.
 */
export function columnBulb(doc: Doc, tableId: string, pin: number): Component | null {
  const wire = wireAt(doc, tableId, pin);
  if (!wire) return null;
  const src = doc.components.get(wire.from);
  if (!src) return null;
  if (src.kind === 'bulb') return src;
  const bulbs = bulbsDrivenBy(doc, src.id);
  return bulbs.length === 1 ? bulbs[0] : null;
}

/** Live component name while wired, otherwise the name saved with the table. */
export function columnTitles(doc: Doc, c: Component): string[] {
  const t = c.table;
  if (!t) return [];
  const titles: string[] = [];
  for (let i = 0; i < t.inputs + t.outputs; i++) {
    const pin = i < t.inputs ? i : TABLE_OUT + (i - t.inputs);
    const bulb = i >= t.inputs ? columnBulb(doc, c.id, pin) : null;
    const wire = wireAt(doc, c.id, pin);
    const src = wire ? doc.components.get(wire.from) : undefined;
    titles.push((bulb?.name || src?.name || '') || t.names[i] || '');
  }
  return titles;
}

/** Label ink for each column: the on or off colour of the wire plugged into it. */
export function columnTitleColors(
  doc: Doc,
  c: Component,
  theme: Theme,
  roots: Map<string, string>,
  live: Set<string>,
  powered: (id: string, lane?: number) => boolean,
): string[] {
  const t = c.table;
  if (!t) return [];
  const idle = idleWire(theme);
  const colors: string[] = [];
  for (let i = 0; i < t.inputs + t.outputs; i++) {
    const pin = i < t.inputs ? i : TABLE_OUT + (i - t.inputs);
    const wire = wireAt(doc, c.id, pin);
    if (!wire) {
      colors.push(theme.text);
      continue;
    }
    const srcKey = wire.lane ? `${wire.from}#${wire.lane}` : wire.from;
    const cols = wireColors(roots.get(srcKey) ?? wire.from, theme);
    const connected = live.has(wire.id);
    const on = connected && powered(wire.from, wire.lane ?? 0);
    colors.push(on ? cols.on : connected ? cols.off : idle);
  }
  return colors;
}

export function layoutTable(t: TableData): TableLayout {
  const spareIn = t.mode === 'discovery' && t.inputs < TABLE_MAX;
  const spareOut = t.mode === 'discovery' && t.outputs < TABLE_MAX;
  const left = spareIn ? TABLE_PIN_GUTTER : TABLE_PAD;
  const right = spareOut ? TABLE_PIN_GUTTER : TABLE_PAD;
  const inW = t.inputs * TABLE_COL;
  const outW = t.outputs * TABLE_COL;
  let gap = TABLE_GAP;
  let w = left + inW + gap + outW + right;
  const minW = TABLE_BTN_W + TABLE_PAD * 2;
  if (w < minW) {
    gap += minW - w;
    w = minW;
  }
  const rows = rowCount(t.inputs);
  const visible = Math.min(rows, TABLE_VISIBLE);
  const gridTop = TABLE_BTN_ROW + TABLE_LABEL;
  const h = gridTop + visible * TABLE_ROW_H;
  const pins: TablePin[] = [];
  let x = left;
  if (spareIn) {
    pins.push({ pin: t.inputs, x: left / 2, spare: true, side: 'in', index: t.inputs, colX: 0, colW: 0 });
  }
  for (let i = 0; i < t.inputs; i++) {
    pins.push({ pin: i, x: x + TABLE_COL / 2, spare: false, side: 'in', index: i, colX: x, colW: TABLE_COL });
    x += TABLE_COL;
  }
  const gapX = x;
  x += gap;
  for (let i = 0; i < t.outputs; i++) {
    pins.push({ pin: TABLE_OUT + i, x: x + TABLE_COL / 2, spare: false, side: 'out', index: i, colX: x, colW: TABLE_COL });
    x += TABLE_COL;
  }
  const gridRight = x;
  if (spareOut) {
    pins.push({
      pin: TABLE_OUT + t.outputs,
      x: gridRight + right / 2,
      spare: true,
      side: 'out',
      index: t.outputs,
      colX: 0,
      colW: 0,
    });
  }
  return {
    w,
    h,
    rows,
    visible,
    pins,
    gapX,
    gap,
    gridLeft: left,
    gridRight,
    gridTop,
    labelY: TABLE_BTN_ROW + TABLE_LABEL / 2,
    button: {
      x: TABLE_PAD,
      y: (TABLE_BTN_ROW - TABLE_BTN_H) / 2,
      w: w - TABLE_PAD * 2,
      h: TABLE_BTN_H,
    },
  };
}

export function tablePinLocal(t: TableData, pin: number, pinLen: number): Point | null {
  const found = layoutTable(t).pins.find((p) => p.pin === pin);
  return found ? { x: found.x, y: -pinLen } : null;
}

/** Clamp counts and row storage after a file load. */
export function normalizeTable(raw: unknown): TableData {
  const t = freshTable();
  if (!raw || typeof raw !== 'object') return t;
  const o = raw as Record<string, unknown>;
  t.mode = o.mode === 'solution' ? 'solution' : 'discovery';
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(TABLE_MAX, Math.round(v))) : 0);
  t.inputs = n(o.inputs);
  t.outputs = n(o.outputs);
  t.names = Array.isArray(o.names) ? o.names.map((name) => (typeof name === 'string' ? name : '')) : [];
  while (t.names.length < t.inputs + t.outputs) t.names.push('');
  t.names = t.names.slice(0, t.inputs + t.outputs);
  const src = Array.isArray(o.rows) ? o.rows : [];
  t.rows = [];
  for (let i = 0; i < rowCount(t.inputs); i++) {
    const row = src[i];
    t.rows.push(typeof row === 'string' ? row.slice(0, t.outputs) : null);
  }
  if (Array.isArray(o.marks)) {
    const marks: (string | null)[] = [];
    for (let i = 0; i < t.rows.length; i++) {
      const mark = o.marks[i];
      marks.push(typeof mark === 'string' ? mark.slice(0, t.outputs) : null);
    }
    if (marks.some((m) => m)) t.marks = marks;
  }
  if (t.mode === 'solution') {
    // A solution always shows a full answer. Missing cells become 0 so the grid is readable.
    t.rows = t.rows.map((row) => {
      let s = row ?? '';
      while (s.length < t.outputs) s += '0';
      return s.slice(0, t.outputs).replace(/[^01]/g, '0');
    });
  }
  return t;
}
