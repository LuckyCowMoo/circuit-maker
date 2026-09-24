import { BUBBLE_D, geomFor, geomOf, IO_SIZE, MARKER_FONT, PIN_LEN, PORT_SIZE, RIBBON_PITCH, type Geom } from './geometry';
import type { Theme } from './themes';
import type { Component, ComponentKind, Point, Rect } from './types';
import { bundleInput, bundleOutput, isGate } from './types';

/** A drawing instruction in component-local coordinates, rendered by both the canvas and SVG export. */
export type DrawOp =
  | { t: 'path'; d: string; fill?: string; stroke?: string; width?: number; alpha?: number }
  | TextOp;

export interface TextOp {
  t: 'text';
  text: string;
  x: number;
  y: number;
  size: number;
  fill: string;
  bold?: boolean;
  anchor?: 'start' | 'middle' | 'end';
}

/** Per-frame state that changes how a component looks. */
export interface DrawInfo {
  /** Switch on, button pressed, bulb lit, or port carrying a 1. */
  active: boolean;
  /** Powered colour of the net this component drives. */
  netOn?: string;
  /** Wired pins: character 0 is the output, 1.. the inputs; '1' means connected. */
  mask?: string;
  /** Ports: the colour of their box. */
  accent?: string;
  /** Ribbon lanes, in order. */
  lanes?: { on: boolean; color: string }[];
}

const f = (n: number) => Math.round(n * 100) / 100;

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}Z`;
}

export function roundRectD(x: number, y: number, w: number, h: number, r: number): string {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  return (
    `M${f(x + q)} ${f(y)}H${f(x + w - q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + w)} ${f(y + q)}` +
    `V${f(y + h - q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + w - q)} ${f(y + h)}` +
    `H${f(x + q)}A${f(q)} ${f(q)} 0 0 1 ${f(x)} ${f(y + h - q)}` +
    `V${f(y + q)}A${f(q)} ${f(q)} 0 0 1 ${f(x + q)} ${f(y)}Z`
  );
}

export function gateBodyPath(g: Geom): string {
  const { w, h } = g;
  switch (g.kind) {
    case 'and': {
      const rx = w - 30;
      return `M0 0H30A${rx} ${f(h / 2)} 0 0 1 30 ${h}H0Z`;
    }
    case 'buffer':
      return `M0 0L${w} ${f(h / 2)}L0 ${h}Z`;
    default: {
      const o = g.offset;
      const ow = w - o;
      const d = g.depth;
      return (
        `M${o} 0Q${f(o + 2 * d)} ${f(h / 2)} ${o} ${h}` +
        `C${f(o + 0.32 * ow)} ${h} ${f(o + 0.82 * ow)} ${f(0.83 * h)} ${w} ${f(h / 2)}` +
        `C${f(o + 0.82 * ow)} ${f(0.17 * h)} ${f(o + 0.32 * ow)} 0 ${o} 0Z`
      );
    }
  }
}

/** The second back curve of an XOR gate. */
export function gateExtraPath(g: Geom): string | null {
  if (g.kind !== 'xor') return null;
  return `M0 0Q${f(2 * g.depth)} ${f(g.h / 2)} 0 ${g.h}`;
}

export function bubblePath(g: Geom): string | null {
  if (!g.negate) return null;
  return circlePath(g.w + BUBBLE_D / 2, g.h / 2, BUBBLE_D / 2);
}

/** Stubs for the pins that aren't wired, so free pins stay visible and wires reach the body. */
export function stubsPath(g: Geom, mask = ''): string {
  let d = '';
  for (let i = 0; i < g.inputs.length; i++) {
    if (mask[i + 1] === '1') continue;
    const p = g.inputs[i];
    if (p.x < g.back[i]) d += `M${p.x} ${f(p.y)}H${f(g.back[i])}`;
  }
  if (g.output && g.tip < g.output.x && mask[0] !== '1') d += `M${g.tip} ${f(g.output.y)}H${g.output.x}`;
  return d;
}

interface ShapePaths {
  body: string;
  extra: string | null;
  bubble: string | null;
  stubs: Map<string, string>;
}

const shapeCache = new WeakMap<Geom, ShapePaths>();

function ioBody(g: Geom): string {
  if (g.kind === 'bulb') {
    const w = g.w - 6;
    const h = g.h - 6;
    return roundRectD(3, 3, w, h, Math.min(w, h) / 2);
  }
  return roundRectD(0, 0, g.w, g.h, Math.min(6, g.w / 4, g.h / 4));
}

function shapes(g: Geom): ShapePaths {
  let p = shapeCache.get(g);
  if (!p) {
    const gate = isGate(g.kind);
    p = {
      body: gate ? gateBodyPath(g) : ioBody(g),
      extra: gate ? gateExtraPath(g) : null,
      bubble: gate ? bubblePath(g) : null,
      stubs: new Map(),
    };
    shapeCache.set(g, p);
  }
  return p;
}

function stubsFor(g: Geom, mask: string | undefined): string {
  const p = shapes(g);
  const key = mask ?? '';
  let d = p.stubs.get(key);
  if (d === undefined) {
    d = stubsPath(g, key);
    p.stubs.set(key, d);
  }
  return d;
}

const MARKER_PIN = 'M15 40C11 33 0 24 0 15A15 15 0 0 1 30 15C30 24 19 33 15 40Z';
const PORT_PLUG = roundRectD(0, 3, PORT_SIZE, PORT_SIZE - 6, 4);
const PORT_ARROW = 'M6.5 6L14.5 10L6.5 14Z';

function filament(g: Geom): string {
  const s = Math.min(g.w, g.h) / IO_SIZE;
  const cx = g.w / 2;
  const cy = g.h / 2;
  const pts: [number, number][] = [
    [-7, 4],
    [-3.5, -5],
    [0, 2],
    [3.5, -5],
    [7, 4],
  ];
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(cx + x * s)} ${f(cy + y * s)}`).join('');
}

/** Drawing ops for a component in its unrotated local frame. Labels are drawn separately. */
export function componentOps(c: Component, theme: Theme, info: DrawInfo): DrawOp[] {
  const stroke = c.stroke ?? theme.stroke;
  const fill = c.fill ?? theme.fill;
  const g = geomOf(c);
  const active = info.active;
  const onColor = info.netOn ?? theme.on;
  const ops: DrawOp[] = [];
  const stubs = stubsFor(g, info.mask);
  if (isGate(c.kind)) {
    const p = shapes(g);
    if (stubs) ops.push({ t: 'path', d: stubs, stroke });
    ops.push({ t: 'path', d: p.body, fill, stroke });
    if (p.extra) ops.push({ t: 'path', d: p.extra, stroke });
    if (p.bubble) ops.push({ t: 'path', d: p.bubble, fill, stroke });
    return ops;
  }
  if (c.kind === 'port' && c.inputs > 1) {
    const mask = info.mask ?? '';
    const lanesN = Math.max(1, c.inputs);
    const cableIn = bundleInput(c);
    const cableOut = bundleOutput(c);
    ops.push({ t: 'path', d: roundRectD(0, 1, g.w, g.h - 2, 3), fill: info.accent ?? theme.box, stroke });
    for (let i = 0; i < lanesN; i++) {
      const lane = info.lanes?.[i];
      const y = RIBBON_PITCH / 2 + i * RIBBON_PITCH;
      ops.push({
        t: 'path',
        d: `M3 ${f(y)}H${g.w - 3}`,
        stroke: lane?.on ? lane.color : stroke,
        width: lane?.on ? 2.6 : 1.2,
      });
    }
    const stub = (x0: number, x1: number, y: number, color?: string) => {
      ops.push({ t: 'path', d: `M${f(x0)} ${f(y)}H${f(x1)}`, stroke: color ?? stroke, width: 2 });
    };
    // Each face independently exposes either one cable socket or one pin per lane.
    if (cableIn) {
      const cableWired = mask[lanesN] === '1';
      const pin = g.inputs[0];
      if (!cableWired) {
        stub(pin.x, 0, pin.y);
        ops.push({ t: 'path', d: roundRectD(pin.x - 3, pin.y - 5, 6, 10, 2), fill: stroke });
      }
    } else {
      g.inputs.forEach((p, i) => {
        if (mask[lanesN + i] === '1') return;
        stub(p.x, 0, p.y, info.lanes?.[i]?.color);
      });
    }
    if (cableOut) {
      const cableWired = mask[0] === '1';
      const pin = g.outputs![0];
      if (!cableWired) {
        stub(g.w, pin.x, pin.y);
        ops.push({ t: 'path', d: roundRectD(pin.x - 3, pin.y - 5, 6, 10, 2), fill: stroke });
      }
    } else {
      (g.outputs ?? []).forEach((p, i) => {
        if (mask[i] === '1') return;
        stub(g.w, p.x, p.y, info.lanes?.[i]?.color);
      });
    }
    return ops;
  }
  const s = Math.min(g.w, g.h) / IO_SIZE;
  const cx = g.w / 2;
  const cy = g.h / 2;
  switch (c.kind) {
    case 'switch': {
      if (stubs) ops.push({ t: 'path', d: stubs, stroke });
      const half = 6 * s + Math.max(0, g.w - g.h) * 0.25;
      const r = 7 * s;
      ops.push(
        { t: 'path', d: shapes(g).body, fill, stroke },
        { t: 'path', d: roundRectD(cx - half - r, cy - r, 2 * (half + r), 2 * r, r), fill: active ? onColor : theme.trackOff, stroke, width: 1.8 },
        { t: 'path', d: circlePath(active ? cx + half : cx - half, cy, 5 * s), fill, stroke, width: 1.8 },
      );
      return ops;
    }
    case 'button': {
      if (stubs) ops.push({ t: 'path', d: stubs, stroke });
      const outer = 7 * s;
      const inner = active ? 11.5 * s : 10 * s;
      const rr = (inset: number) => {
        const w = g.w - 2 * inset;
        const h = g.h - 2 * inset;
        return roundRectD(inset, inset, w, h, Math.min(w, h) / 2);
      };
      ops.push(
        { t: 'path', d: shapes(g).body, fill, stroke },
        { t: 'path', d: rr(outer), fill: theme.trackOff, stroke, width: 1.8 },
        { t: 'path', d: rr(inner), fill: active ? onColor : fill, stroke, width: 1.8 },
      );
      return ops;
    }
    case 'bulb': {
      const lit = c.color ?? theme.bulb;
      // Unlit bulbs are hollow unless the user set a fill colour.
      const bodyFill = active ? lit : c.fill ?? undefined;
      if (stubs) ops.push({ t: 'path', d: stubs, stroke });
      if (active) {
        const w = g.w + 14;
        const h = g.h + 14;
        ops.push({ t: 'path', d: roundRectD(-7, -7, w, h, Math.min(w, h) / 2), fill: lit, alpha: 0.3 });
      }
      ops.push({ t: 'path', d: shapes(g).body, fill: bodyFill, stroke });
      if (Math.min(g.w, g.h) >= 30) ops.push({ t: 'path', d: filament(g), stroke: active ? '#6b3f00' : stroke, width: 1.6 });
      return ops;
    }
    case 'port': {
      const accent = info.accent ?? theme.box;
      return [
        { t: 'path', d: PORT_PLUG, fill: theme.bg, stroke: accent, width: 2 },
        { t: 'path', d: PORT_ARROW, fill: active ? onColor : accent },
      ];
    }
    default: {
      const color = c.color ?? theme.marker;
      ops.push(
        { t: 'path', d: MARKER_PIN, fill: color, stroke: color, width: 1.5 },
        { t: 'path', d: circlePath(15, 15, 5.5), fill: '#ffffff' },
      );
      if (c.name) {
        ops.push({ t: 'text', text: c.name, x: 38, y: 16, size: MARKER_FONT, fill: color, bold: true, anchor: 'start' });
      }
      return ops;
    }
  }
}

export const LABEL_SIZE = 14;
export const PORT_LABEL_SIZE = 12;

/** A label beside `rect` on the side `dir` points to, in world coordinates. */
export function labelBeside(rect: Rect, dir: Point, text: string, fill: string, size = LABEL_SIZE): TextOp {
  const gap = 8;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  if (Math.abs(dir.x) >= Math.abs(dir.y)) {
    const right = dir.x > 0;
    return { t: 'text', text, x: right ? rect.x + rect.w + gap : rect.x - gap, y: cy, size, fill, bold: true, anchor: right ? 'start' : 'end' };
  }
  const down = dir.y > 0;
  return { t: 'text', text, x: cx, y: down ? rect.y + rect.h + gap + size / 2 : rect.y - gap - size / 2, size, fill, bold: true, anchor: 'middle' };
}

/** Rough world-space rect covered by a text label. */
export function textRect(op: TextOp): Rect {
  const w = op.text.length * op.size * 0.62;
  const x = op.anchor === 'middle' ? op.x - w / 2 : op.anchor === 'end' ? op.x - w : op.x;
  return { x, y: op.y - op.size * 0.6, w, h: op.size * 1.2 };
}

/** A port's label, just outside its box and beside the wire leaving it. `out` is the box's outward normal. */
export function portLabel(center: Point, out: Point, text: string, fill: string): TextOp {
  const size = PORT_LABEL_SIZE;
  if (out.x !== 0) {
    const right = out.x > 0;
    return { t: 'text', text, x: center.x + out.x * 6, y: center.y - 16, size, fill, bold: true, anchor: right ? 'start' : 'end' };
  }
  return { t: 'text', text, x: center.x + 14, y: center.y + out.y * 12, size, fill, bold: true, anchor: 'start' };
}

/** Small preview used by toolbar icons. */
export function iconOps(kind: ComponentKind | 'box' | 'not' | 'ribbon-port', theme: Theme, negate = false): { ops: DrawOp[]; viewBox: string } {
  if (kind === 'box') {
    return {
      ops: [
        { t: 'path', d: 'M4 4H56V40H4Z', fill: theme.box, alpha: 0.12 },
        { t: 'path', d: 'M4 4H56V40H4Z', stroke: theme.box },
      ],
      viewBox: '0 0 60 44',
    };
  }
  if (kind === 'not') {
    return { ops: [{ t: 'path', d: circlePath(12, 12, 6), stroke: theme.stroke, fill: theme.fill }], viewBox: '-6 0 36 24' };
  }
  if (kind === 'ribbon-port') {
    return {
      ops: [
        { t: 'path', d: roundRectD(8, 2, 14, 36, 3), fill: theme.box, stroke: theme.stroke },
        { t: 'path', d: 'M2 20H8', stroke: theme.stroke, width: 3 },
        { t: 'path', d: 'M22 8H30M22 16H30M22 24H30M22 32H30', stroke: theme.stroke },
      ],
      viewBox: '0 0 34 40',
    };
  }
  if (kind === 'port') {
    return {
      ops: [
        { t: 'path', d: roundRectD(8, 10, 14, 14, 3), fill: theme.box, stroke: theme.stroke },
        { t: 'path', d: 'M2 17H8M22 17H28', stroke: theme.stroke },
      ],
      viewBox: '0 0 32 34',
    };
  }
  const c: Component = {
    id: 'icon',
    kind,
    x: 0,
    y: 0,
    inputs: isGate(kind) ? 2 : 0,
    negate,
    stroke: null,
    fill: null,
    on: false,
    name: '',
    color: null,
    rot: 0,
    flip: false,
    w: IO_SIZE,
    h: IO_SIZE,
    box: null,
  };
  const g = geomFor(kind, c.inputs, negate);
  const b = g.bounds;
  return {
    ops: componentOps(c, theme, { active: kind === 'bulb', netOn: theme.on }),
    viewBox: `${b.x - 3} ${b.y - 3} ${b.w + 6} ${b.h + 6}`,
  };
}

export { PIN_LEN };
