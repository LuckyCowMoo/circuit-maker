import { componentCenter, IO_MAX, IO_MIN, IO_SIZE, MAX_INPUTS, snap } from '../model/geometry';
import { emptyDoc, idTaken, makeComponent, uid } from '../model/doc';
import { normalizePorts, placePort, portInward } from '../model/ports';
import type { Box, Component, ComponentKind, Doc, Rotation, Wire } from '../model/types';
import { canRotate, hasOutput, inputCount, isGate, isIO } from '../model/types';

export const FORMAT_ID = 'circuit-maker';
export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.cmk.json';

/** Camera: world point at the centre of the screen, and zoom. */
export interface FileView {
  x: number;
  y: number;
  zoom: number;
}

export interface FileComponent {
  id: string;
  type: ComponentKind;
  x: number;
  y: number;
  inputs?: number;
  not?: boolean;
  on?: boolean;
  name?: string;
  color?: string;
  stroke?: string;
  fill?: string;
  /** Degrees clockwise: 0, 90, 180 or 270. */
  rotate?: number;
  flip?: boolean;
  w?: number;
  h?: number;
  /** Ports: the box they sit in and which way the signal goes through its wall. */
  box?: string;
  dir?: 'in' | 'out';
}

export interface FileWire {
  from: string;
  to: string;
  input: number;
}

export interface FileBox {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
}

export interface CircuitFile {
  format: typeof FORMAT_ID;
  version: number;
  name: string;
  view?: FileView;
  boxes: FileBox[];
  components: FileComponent[];
  wires: FileWire[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function serialize(doc: Doc, opts: { ids?: Set<string>; view?: FileView; name?: string } = {}): CircuitFile {
  const { ids } = opts;
  const components: FileComponent[] = [];
  const included = new Set<string>();
  for (const c of doc.components.values()) {
    if (ids && !ids.has(c.id)) continue;
    const portBox = c.kind === 'port' && c.box ? doc.boxes.get(c.box) : undefined;
    if (c.kind === 'port' && (!portBox || (ids && !ids.has(portBox.id)))) continue;
    included.add(c.id);
    const fc: FileComponent = { id: c.id, type: c.kind, x: r2(c.x), y: r2(c.y) };
    if (isGate(c.kind)) {
      fc.inputs = c.inputs;
      if (c.negate) fc.not = true;
    }
    if (c.kind === 'switch' && c.on) fc.on = true;
    if (c.kind === 'marker' || (c.name && !isGate(c.kind))) fc.name = c.name;
    if (c.color && (c.kind === 'marker' || c.kind === 'bulb')) fc.color = c.color;
    if (c.stroke && c.kind !== 'marker' && c.kind !== 'port') fc.stroke = c.stroke;
    if (c.fill && c.kind !== 'marker' && c.kind !== 'port') fc.fill = c.fill;
    if (canRotate(c.kind)) {
      if (c.rot) fc.rotate = c.rot * 90;
      if (c.flip) fc.flip = true;
    }
    if (isIO(c.kind)) {
      if (c.w !== IO_SIZE) fc.w = c.w;
      if (c.h !== IO_SIZE) fc.h = c.h;
    }
    if (portBox) {
      fc.box = portBox.id;
      fc.dir = portInward(c, portBox) ? 'in' : 'out';
    }
    components.push(fc);
  }
  const wires: FileWire[] = [];
  for (const w of doc.wires.values()) {
    if (included.has(w.from) && included.has(w.to)) wires.push({ from: w.from, to: w.to, input: w.input });
  }
  const boxes: FileBox[] = [];
  for (const b of doc.boxes.values()) {
    if (ids && !ids.has(b.id)) continue;
    const fb: FileBox = { id: b.id, name: b.name, x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h) };
    if (b.color) fb.color = b.color;
    boxes.push(fb);
  }
  const file: CircuitFile = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    name: opts.name ?? doc.name,
    boxes,
    components,
    wires,
  };
  if (opts.view) file.view = { x: r2(opts.view.x), y: r2(opts.view.y), zoom: r2(opts.view.zoom) };
  return file;
}

/** Pretty JSON with one item per line, so files stay short and easy to edit by hand. */
export function stringifyFile(file: CircuitFile): string {
  const list = (key: string, items: object[]) =>
    items.length
      ? `  "${key}": [\n${items.map((i) => '    ' + JSON.stringify(i)).join(',\n')}\n  ]`
      : `  "${key}": []`;
  const parts = [
    `  "format": ${JSON.stringify(file.format)}`,
    `  "version": ${file.version}`,
    `  "name": ${JSON.stringify(file.name)}`,
  ];
  if (file.view) parts.push(`  "view": ${JSON.stringify(file.view)}`);
  parts.push(list('boxes', file.boxes), list('components', file.components), list('wires', file.wires));
  return `{\n${parts.join(',\n')}\n}\n`;
}

export function docToText(doc: Doc, opts?: Parameters<typeof serialize>[1]): string {
  return stringifyFile(serialize(doc, opts));
}

const TYPE_ALIASES: Record<string, { kind: ComponentKind; not?: boolean }> = {
  and: { kind: 'and' },
  nand: { kind: 'and', not: true },
  or: { kind: 'or' },
  nor: { kind: 'or', not: true },
  xor: { kind: 'xor' },
  xnor: { kind: 'xor', not: true },
  buffer: { kind: 'buffer' },
  buf: { kind: 'buffer' },
  not: { kind: 'buffer', not: true },
  inverter: { kind: 'buffer', not: true },
  switch: { kind: 'switch' },
  toggle: { kind: 'switch' },
  input: { kind: 'switch' },
  button: { kind: 'button' },
  pushbutton: { kind: 'button' },
  push: { kind: 'button' },
  bulb: { kind: 'bulb' },
  lamp: { kind: 'bulb' },
  light: { kind: 'bulb' },
  led: { kind: 'bulb' },
  output: { kind: 'bulb' },
  marker: { kind: 'marker' },
  label: { kind: 'marker' },
  flag: { kind: 'marker' },
  port: { kind: 'port' },
  connector: { kind: 'port' },
};

export interface ParseResult {
  doc: Doc;
  view: FileView | null;
  warnings: string[];
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const color = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Extracts the JSON object from text that may be wrapped in a Markdown code fence or prose. */
function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('No JSON object found.');
  return text.slice(start, end + 1);
}

export function parseCircuit(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(extractJson(text));
  } catch (e) {
    throw new Error(`Not a valid Circuit Maker file: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a valid Circuit Maker file.');
  const root = raw as Record<string, unknown>;
  if (root.format !== undefined && root.format !== FORMAT_ID) {
    throw new Error(`Unknown format "${String(root.format)}".`);
  }
  const warnings: string[] = [];
  const doc = emptyDoc(str(root.name) ?? 'Untitled circuit');
  const arr = (key: string): unknown[] => {
    const v = root[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      warnings.push(`"${key}" should be an array; ignored.`);
      return [];
    }
    return v;
  };

  arr('boxes').forEach((item, i) => {
    if (!item || typeof item !== 'object') return warnings.push(`boxes[${i}] is not an object.`);
    const o = item as Record<string, unknown>;
    let id = str(o.id);
    if (!id || idTaken(doc, id)) id = uid(doc, 'b');
    const b: Box = {
      id,
      x: num(o.x, 0),
      y: num(o.y, 0),
      w: Math.max(40, num(o.w, 200)),
      h: Math.max(40, num(o.h, 150)),
      name: str(o.name) ?? 'Box',
      color: color(o.color),
    };
    doc.boxes.set(id, b);
  });

  const ports: { c: Component; box: Box; inward: boolean }[] = [];
  arr('components').forEach((item, i) => {
    if (!item || typeof item !== 'object') return warnings.push(`components[${i}] is not an object.`);
    const o = item as Record<string, unknown>;
    const typeName = (str(o.type) ?? '').toLowerCase().replace(/[\s_-]/g, '');
    const alias = TYPE_ALIASES[typeName];
    if (!alias) return warnings.push(`components[${i}]: unknown type "${String(o.type)}"; skipped.`);
    let id = str(o.id);
    if (!id || idTaken(doc, id)) {
      if (id) warnings.push(`Duplicate id "${id}"; renamed.`);
      id = uid(doc, 'c');
    }
    const c: Component = makeComponent(alias.kind, num(o.x, 0), num(o.y, 0), id);
    if (isGate(c.kind)) {
      c.inputs = Math.max(1, Math.min(MAX_INPUTS, Math.round(num(o.inputs, 2))));
      c.negate = Boolean(alias.not) !== Boolean(o.not);
    }
    if (c.kind === 'switch') c.on = o.on === true;
    if (c.kind === 'marker') c.name = str(o.name) ?? 'Marker';
    else if (!isGate(c.kind)) c.name = str(o.name) ?? '';
    c.color = color(o.color);
    c.stroke = color(o.stroke);
    c.fill = color(o.fill);
    if (isIO(c.kind)) {
      const size = (v: unknown) => Math.max(IO_MIN, Math.min(IO_MAX, snap(num(v, IO_SIZE)) || IO_SIZE));
      c.w = size(o.w);
      c.h = size(o.h);
    }
    if (canRotate(c.kind)) {
      c.rot = ((((Math.round(num(o.rotate, 0) / 90) % 4) + 4) % 4) as Rotation);
      c.flip = o.flip === true;
    }
    if (c.kind === 'port') {
      const box = doc.boxes.get(str(o.box) ?? '');
      if (!box) return warnings.push(`components[${i}]: port needs "box" naming one of the boxes; skipped.`);
      c.box = box.id;
      ports.push({ c, box, inward: o.dir !== 'out' });
    }
    doc.components.set(id, c);
  });
  for (const p of ports) placePort(doc, p.c, p.box, componentCenter(p.c), p.inward);

  const splitRef = (ref: string): { id: string; pin: number | null } => {
    if (doc.components.has(ref)) return { id: ref, pin: null };
    const m = /^(.*)[.:](\w+)$/.exec(ref);
    if (m && doc.components.has(m[1])) {
      const pin = Number(m[2]);
      return { id: m[1], pin: Number.isInteger(pin) ? pin : null };
    }
    return { id: ref, pin: null };
  };

  const taken = new Map<string, string>();
  arr('wires').forEach((item, i) => {
    if (!item || typeof item !== 'object') return warnings.push(`wires[${i}] is not an object.`);
    const o = item as Record<string, unknown>;
    const fromRef = str(o.from);
    const toRef = str(o.to);
    if (!fromRef || !toRef) return warnings.push(`wires[${i}] needs "from" and "to".`);
    const from = splitRef(fromRef).id;
    const to = splitRef(toRef);
    const src = doc.components.get(from);
    const dst = doc.components.get(to.id);
    if (!src) return warnings.push(`wires[${i}]: no component "${from}".`);
    if (!dst) return warnings.push(`wires[${i}]: no component "${to.id}".`);
    if (!hasOutput(src.kind)) return warnings.push(`wires[${i}]: "${from}" (${src.kind}) has no output.`);
    const input = Math.round(num(o.input, to.pin ?? 0));
    if (input < 0) return warnings.push(`wires[${i}]: negative input index.`);
    if (isGate(dst.kind) && input >= dst.inputs) {
      if (input >= MAX_INPUTS) return warnings.push(`wires[${i}]: input ${input} is too large.`);
      warnings.push(`"${dst.id}" grown to ${input + 1} inputs to fit a wire.`);
      dst.inputs = input + 1;
    }
    if (input >= inputCount(dst)) return warnings.push(`wires[${i}]: "${dst.id}" (${dst.kind}) has no input ${input}.`);
    const key = `${dst.id}#${input}`;
    const prev = taken.get(key);
    if (prev) {
      warnings.push(`Input ${input} of "${dst.id}" had two wires; the last one wins.`);
      doc.wires.delete(prev);
    }
    const w: Wire = { id: uid(doc, 'w'), from, to: dst.id, input };
    doc.wires.set(w.id, w);
    taken.set(key, w.id);
  });

  normalizePorts(doc);

  let view: FileView | null = null;
  if (root.view && typeof root.view === 'object') {
    const v = root.view as Record<string, unknown>;
    view = { x: num(v.x, 0), y: num(v.y, 0), zoom: num(v.zoom, 1) };
  }
  return { doc, view, warnings };
}
