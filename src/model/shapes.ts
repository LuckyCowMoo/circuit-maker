import { BUBBLE_D, geomFor, MARKER_FONT, PIN_LEN, type Geom } from './geometry';
import type { Theme } from './themes';
import type { Component, ComponentKind } from './types';
import { isGate } from './types';

/** A drawing instruction in component-local coordinates, rendered by both the canvas and SVG export. */
export type DrawOp =
  | { t: 'path'; d: string; fill?: string; stroke?: string; width?: number; alpha?: number }
  | {
      t: 'text';
      text: string;
      x: number;
      y: number;
      size: number;
      fill: string;
      bold?: boolean;
      anchor?: 'start' | 'middle' | 'end';
    };

const f = (n: number) => Math.round(n * 100) / 100;

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx + r)} ${f(cy)}A${r} ${r} 0 1 1 ${f(cx - r)} ${f(cy)}A${r} ${r} 0 1 1 ${f(cx + r)} ${f(cy)}Z`;
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

export function stubsPath(g: Geom): string {
  let d = '';
  for (let i = 0; i < g.inputs.length; i++) {
    const p = g.inputs[i];
    d += `M${p.x} ${f(p.y)}H${f(g.back[i])}`;
  }
  if (g.output && g.tip < g.output.x) d += `M${g.tip} ${f(g.output.y)}H${g.output.x}`;
  return d;
}

interface GatePaths {
  stubs: string;
  body: string;
  extra: string | null;
  bubble: string | null;
}

const gatePathCache = new WeakMap<Geom, GatePaths>();

function gatePaths(g: Geom): GatePaths {
  let p = gatePathCache.get(g);
  if (!p) {
    p = { stubs: stubsPath(g), body: gateBodyPath(g), extra: gateExtraPath(g), bubble: bubblePath(g) };
    gatePathCache.set(g, p);
  }
  return p;
}

const ROUND_RECT_40 = 'M6 0H34Q40 0 40 6V34Q40 40 34 40H6Q0 40 0 34V6Q0 0 6 0Z';
const SWITCH_TRACK = 'M14 13H26A7 7 0 0 1 26 27H14A7 7 0 0 1 14 13Z';
const MARKER_PIN = 'M15 40C11 33 0 24 0 15A15 15 0 0 1 30 15C30 24 19 33 15 40Z';
const FILAMENT = 'M13 24L16.5 15L20 22L23.5 15L27 24';

/**
 * Drawing ops for a component.
 * `active` is the switch state, button pressed state or bulb lit state.
 */
export function componentOps(c: Component, theme: Theme, active: boolean): DrawOp[] {
  const stroke = c.stroke ?? theme.stroke;
  const fill = c.fill ?? theme.fill;
  const g = geomFor(c.kind, c.inputs, c.negate);
  if (isGate(c.kind)) {
    const p = gatePaths(g);
    const ops: DrawOp[] = [
      { t: 'path', d: p.stubs, stroke },
      { t: 'path', d: p.body, fill, stroke },
    ];
    if (p.extra) ops.push({ t: 'path', d: p.extra, stroke });
    if (p.bubble) ops.push({ t: 'path', d: p.bubble, fill, stroke });
    return ops;
  }
  switch (c.kind) {
    case 'switch':
      return [
        { t: 'path', d: gatePaths(g).stubs, stroke },
        { t: 'path', d: ROUND_RECT_40, fill, stroke },
        { t: 'path', d: SWITCH_TRACK, fill: active ? theme.on : theme.trackOff, stroke, width: 1.8 },
        { t: 'path', d: circlePath(active ? 26 : 14, 20, 5), fill, stroke, width: 1.8 },
      ];
    case 'button':
      return [
        { t: 'path', d: gatePaths(g).stubs, stroke },
        { t: 'path', d: ROUND_RECT_40, fill, stroke },
        { t: 'path', d: circlePath(20, 20, 13), fill: theme.trackOff, stroke, width: 1.8 },
        { t: 'path', d: circlePath(20, 20, active ? 8.5 : 10), fill: active ? theme.on : fill, stroke, width: 1.8 },
      ];
    case 'bulb': {
      const lit = c.color ?? theme.bulb;
      const ops: DrawOp[] = [{ t: 'path', d: `M${-PIN_LEN} 20H3`, stroke }];
      if (active) ops.push({ t: 'path', d: circlePath(20, 20, 30), fill: lit, alpha: 0.3 });
      ops.push(
        { t: 'path', d: circlePath(20, 20, 17), fill: active ? lit : fill, stroke },
        { t: 'path', d: FILAMENT, stroke: active ? '#6b3f00' : stroke, width: 1.6 },
      );
      return ops;
    }
    default: {
      const color = c.color ?? theme.marker;
      const ops: DrawOp[] = [
        { t: 'path', d: MARKER_PIN, fill: color, stroke: color, width: 1.5 },
        { t: 'path', d: circlePath(15, 15, 5.5), fill: '#ffffff' },
      ];
      if (c.name) {
        ops.push({ t: 'text', text: c.name, x: 38, y: 16, size: MARKER_FONT, fill: color, bold: true, anchor: 'start' });
      }
      return ops;
    }
  }
}

/** Small preview used by toolbar icons. */
export function iconOps(kind: ComponentKind | 'box', theme: Theme, negate = false): { ops: DrawOp[]; viewBox: string } {
  if (kind === 'box') {
    return {
      ops: [
        { t: 'path', d: 'M4 4H56V40H4Z', fill: theme.box, alpha: 0.12 },
        { t: 'path', d: 'M4 4H56V40H4Z', stroke: theme.box },
      ],
      viewBox: '0 0 60 44',
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
  };
  const g = geomFor(kind, c.inputs, negate);
  const b = g.bounds;
  return { ops: componentOps(c, theme, kind === 'bulb'), viewBox: `${b.x - 3} ${b.y - 3} ${b.w + 6} ${b.h + 6}` };
}
