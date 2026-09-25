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
  /** A ribbon cable is plugged into that face. Lane wires do not count. */
  cableIn?: boolean;
  cableOut?: boolean;
  /** Switch pip position, 0 off to 1 on. Logic ignores this and uses `active`. */
  switchT?: number;
  /** Bulb glow, 0–1. Colour crossfades separately via `bulbColor`. */
  bulbPower?: number;
  bulbColor?: string;
}

const f = (n: number) => Math.round(n * 100) / 100;

export const NOTE_BG = '#ffe08a';

/** Hue opposite `hex`, with lightness chosen so the text stays readable. */
export function complementColor(hex: string): string {
  const raw = hex.trim();
  const m = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(raw);
  if (!m) return '#073642';
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  const d = max - min;
  if (d > 1e-6) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const nh = (hue + 180) % 360;
  const nl = l > 0.55 ? 0.16 : 0.94;
  const c = (1 - Math.abs(2 * nl - 1)) * 0.72;
  const x = c * (1 - Math.abs(((nh / 60) % 2) - 1));
  const m2 = nl - c / 2;
  const seg = Math.floor(nh / 60);
  const rgb =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  const hex2 = (v: number) => Math.round(Math.min(1, Math.max(0, v + m2)) * 255).toString(16).padStart(2, '0');
  return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
}

const WAVE_K = 0.5522847498;

export function noteAmp(w: number, h: number): number {
  return Math.max(3.5, Math.min(7, Math.min(w, h) * 0.07));
}

/** Space kept inside the wave, between the outline and the words. */
export const notePad = (w: number, h: number): number => noteAmp(w, h) + 22;

const NOTE_FONT = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif";

export interface NoteLine {
  text: string;
  start: number;
}

export interface NoteLayout {
  pad: number;
  innerW: number;
  innerH: number;
  size: number;
  lineH: number;
  lines: NoteLine[];
}

let noteMeasure: CanvasRenderingContext2D | null = null;

function noteWidth(text: string, size: number): number {
  if (noteMeasure === null && typeof document !== 'undefined') {
    noteMeasure = document.createElement('canvas').getContext('2d');
  }
  if (!noteMeasure) return text.length * size * 0.56;
  noteMeasure.font = `700 ${size}px ${NOTE_FONT}`;
  return noteMeasure.measureText(text).width;
}

/** Breaks text on spaces so each line fits `maxW`. A word longer than the line breaks on its own. */
export function wrapNote(text: string, maxW: number, size: number): NoteLine[] {
  if (!text) return [{ text: '', start: 0 }];
  const lines: NoteLine[] = [];
  let i = 0;
  while (i < text.length) {
    if (lines.length && text[i] === ' ') i++;
    if (i >= text.length) break;
    let end = i;
    let breakAt = -1;
    while (end < text.length && text[end] !== '\n') {
      const next = end + 1;
      if (next > i + 1 && noteWidth(text.slice(i, next), size) > maxW) break;
      if (text[end] === ' ') breakAt = end;
      end = next;
    }
    if (end < text.length && text[end] !== '\n' && breakAt > i) end = breakAt;
    if (end === i) end = Math.min(text.length, i + 1);
    lines.push({ text: text.slice(i, end).trimEnd(), start: i });
    i = end;
    if (text[i] === ' ' || text[i] === '\n') i++;
  }
  return lines.length ? lines : [{ text: '', start: 0 }];
}

/** Font size and wrapped lines for a text box, centered in the area inside the padding. */
export function noteLayout(text: string, w: number, h: number): NoteLayout {
  const pad = notePad(w, h);
  const innerW = Math.max(8, w - pad * 2);
  const innerH = Math.max(8, h - pad * 2);
  let size = Math.min(32, innerH * 0.62);
  let lines = wrapNote(text, innerW, size);
  const lineH = (s: number) => s * 1.25;
  while (size > 8 && lines.length * lineH(size) > innerH) {
    size -= 1;
    lines = wrapNote(text, innerW, size);
  }
  return { pad, innerW, innerH, size, lineH: lineH(size), lines };
}

/** Character index in `text` nearest a point in the box's local coordinates. */
export function noteCaret(text: string, w: number, h: number, x: number, y: number): number {
  const layout = noteLayout(text, w, h);
  const block = layout.lines.length * layout.lineH;
  const top = layout.pad + (layout.innerH - block) / 2;
  if (y <= top) return 0;
  if (y >= top + block) return text.length;
  const line = layout.lines[Math.min(layout.lines.length - 1, Math.floor((y - top) / layout.lineH))];
  const shown = line.text;
  const lineW = noteWidth(shown, layout.size);
  const left = layout.pad + (layout.innerW - lineW) / 2;
  if (x <= left) return line.start;
  let acc = 0;
  for (let i = 0; i < shown.length; i++) {
    const dw = noteWidth(shown[i], layout.size);
    if (x < left + acc + dw / 2) return line.start + i;
    acc += dw;
  }
  return Math.min(text.length, line.start + shown.length);
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wave spans that average about 45px, then exactly fill `length`. */
function waveSpans(length: number, rand: () => number): number[] {
  if (length < 1) return [];
  const spans: number[] = [];
  let used = 0;
  while (used < length - 0.5) {
    const span = 45 * (0.62 + rand() * 0.76);
    const room = length - used;
    if (spans.length && room < span * 0.55) {
      spans[spans.length - 1] += room;
      break;
    }
    const next = Math.min(span, room);
    spans.push(next);
    used += next;
  }
  return spans;
}

/** Smooth bumps of uneven length. Each crest reaches a different distance toward the center. */
function waveSide(x: number, y: number, dx: number, dy: number, length: number, amp: number, rand: () => number): string {
  const spans = waveSpans(length, rand);
  if (!spans.length) return '';
  const ux = dx / length;
  const uy = dy / length;
  const ix = -uy;
  const iy = ux;
  let d = '';
  let s = 0;
  for (const wave of spans) {
    const depth = amp * (0.25 + rand() * 1.45);
    const half = wave / 2;
    const k = half / 3;
    const m = s + half;
    const e = s + wave;
    const sx = x + ux * s;
    const sy = y + uy * s;
    const mx = x + ux * m + ix * depth;
    const my = y + uy * m + iy * depth;
    const ex = x + ux * e;
    const ey = y + uy * e;
    d += `C${f(sx + ux * k)} ${f(sy + uy * k)} ${f(mx - ux * k)} ${f(my - uy * k)} ${f(mx)} ${f(my)}`;
    d += `C${f(mx + ux * k)} ${f(my + uy * k)} ${f(ex - ux * k)} ${f(ey - uy * k)} ${f(ex)} ${f(ey)}`;
    s = e;
  }
  return d;
}

/** The wavy hole outline in component-local coordinates. */
export function noteHole(w: number, h: number, seed: string): string {
  return wavyRect(w, h, seed);
}

/** Rectangle whose sides are smooth waves, joined by round corners. `seed` keeps one box stable. */
function wavyRect(w: number, h: number, seed = 'note'): string {
  const amp = noteAmp(w, h);
  const rand = mulberry32(hashSeed(seed));
  const r = Math.min(amp, w / 4, h / 4);
  const top = Math.max(0, w - 2 * r);
  const side = Math.max(0, h - 2 * r);
  const kr = WAVE_K * r;
  return (
    `M${f(r)} 0` +
    waveSide(r, 0, top, 0, top, amp, rand) +
    `C${f(w - r + kr)} 0 ${f(w)} ${f(r - kr)} ${f(w)} ${f(r)}` +
    waveSide(w, r, 0, side, side, amp, rand) +
    `C${f(w)} ${f(h - r + kr)} ${f(w - r + kr)} ${f(h)} ${f(w - r)} ${f(h)}` +
    waveSide(w - r, h, -top, 0, top, amp, rand) +
    `C${f(r - kr)} ${f(h)} 0 ${f(h - r + kr)} 0 ${f(h - r)}` +
    waveSide(0, h - r, 0, -side, side, amp, rand) +
    `C0 ${f(r - kr)} ${f(r - kr)} 0 ${f(r)} 0Z`
  );
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}Z`;
}

/** Glow around a bulb. A square bulb at the default size gets a circle, not a rounded square. */
function bulbGlow(g: Geom, power: number): string {
  const pad = 7 * power;
  const w = g.w + 2 * pad;
  const h = g.h + 2 * pad;
  return roundRectD(-pad, -pad, w, h, Math.min(w, h) / 2);
}

/** Horizontal capsule. Equal ends collapse to a circle, so a resting pip hides it completely. */
function capsuleH(x0: number, x1: number, cy: number, rad: number): string {
  if (x1 - x0 < 0.01) return circlePath(x0, cy, rad);
  return (
    `M${f(x0)} ${f(cy - rad)}H${f(x1)}` +
    `A${f(rad)} ${f(rad)} 0 0 1 ${f(x1)} ${f(cy + rad)}` +
    `H${f(x0)}A${f(rad)} ${f(rad)} 0 0 1 ${f(x0)} ${f(cy - rad)}Z`
  );
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
  if (g.kind === 'bulb' || g.kind === 'rgb') {
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
      const cableWired = info.cableIn ?? mask[lanesN] === '1';
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
      const cableWired = info.cableOut ?? mask[0] === '1';
      const pin = g.outputs![0];
      if (!cableWired) {
        stub(g.w, pin.x, pin.y);
        ops.push({ t: 'path', d: roundRectD(pin.x - 3, pin.y - 5, 6, 10, 2), fill: stroke });
      }
    } else {
      (g.outputs ?? []).forEach((p, i) => {
        if (mask[i] === '1' || mask[lanesN + i] === '1') return;
        stub(g.w, p.x, p.y, info.lanes?.[i]?.color);
      });
    }
    return ops;
  }
  if (c.kind === 'rgb') {
    const mask = info.mask ?? '';
    const cable = bundleInput(c);
    const cableWired = mask[3] === '1';
    const channel = info.lanes ?? [];
    const r = channel[0]?.on ? 255 : 0;
    const green = channel[1]?.on ? 255 : 0;
    const b = channel[2]?.on ? 255 : 0;
    const lit = r + green + b > 0;
    const mixed = `rgb(${r},${green},${b})`;
    const stub = (x0: number, x1: number, y: number, color: string) =>
      ops.push({ t: 'path', d: `M${f(x0)} ${f(y)}H${f(x1)}`, stroke: color, width: 2 });
    if (cable) {
      const pin = g.inputs[0];
      if (!cableWired) {
        stub(pin.x, g.back[0] ?? 3, pin.y, stroke);
        ops.push({ t: 'path', d: roundRectD(pin.x - 3, pin.y - 5, 6, 10, 2), fill: stroke });
      }
    } else {
      g.inputs.forEach((pin, i) => {
        if (mask[3 + i] !== '1') stub(pin.x, g.back[i] ?? 3, pin.y, ['#ef4444', '#22c55e', '#3b82f6'][i]);
      });
    }
    const power = info.bulbPower ?? (lit ? 1 : 0);
    const shown = info.bulbColor ?? mixed;
    if (power > 0.01) ops.push({ t: 'path', d: bulbGlow(g, power), fill: shown, alpha: 0.3 * power });
    ops.push({ t: 'path', d: shapes(g).body, fill: c.fill ?? undefined, stroke });
    if (power > 0.01) ops.push({ t: 'path', d: shapes(g).body, fill: shown, alpha: power });
    const labels = ['R', 'G', 'B'];
    if (!cable) {
      g.inputs.forEach((pin, i) =>
        ops.push({
          t: 'text',
          text: labels[i],
          x: g.w / 2,
          y: pin.y,
          size: 8,
          fill: stroke,
          bold: true,
          anchor: 'middle',
        }),
      );
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
      const t = info.switchT ?? (active ? 1 : 0);
      const cap = cx - half;
      const trackL = cap - r;
      const pipX = cap + 2 * half * t;
      ops.push({ t: 'path', d: shapes(g).body, fill, stroke });
      ops.push({ t: 'path', d: roundRectD(trackL, cy - r, 2 * (half + r), 2 * r, r), fill: theme.trackOff });
      ops.push({ t: 'path', d: capsuleH(cap, pipX, cy, r - 1.2), fill: onColor });
      ops.push({ t: 'path', d: roundRectD(trackL, cy - r, 2 * (half + r), 2 * r, r), stroke, width: 1.8 });
      ops.push({ t: 'path', d: circlePath(pipX, cy, r - 0.8), fill, stroke, width: 1.6 });
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
    case 'timer': {
      if (stubs) ops.push({ t: 'path', d: stubs, stroke });
      ops.push({ t: 'path', d: shapes(g).body, fill, stroke });
      const y0 = cy + 6 * s;
      const y1 = cy - 6 * s;
      const x0 = cx - 12 * s;
      const x1 = cx - 4 * s;
      const x2 = cx + 5 * s;
      const x3 = cx + 12 * s;
      ops.push({
        t: 'path',
        d: `M${f(x0)} ${f(y0)}H${f(x1)}V${f(y1)}H${f(x2)}V${f(y0)}H${f(x3)}`,
        stroke: active ? onColor : stroke,
        width: 2,
      });
      return ops;
    }
    case 'bulb': {
      const litColor = c.color ?? theme.bulb;
      const power = info.bulbPower ?? (active ? 1 : 0);
      const shown = info.bulbColor ?? litColor;
      const bodyFill = c.fill;
      if (stubs) ops.push({ t: 'path', d: stubs, stroke });
      if (power > 0.01) ops.push({ t: 'path', d: bulbGlow(g, power), fill: shown, alpha: 0.3 * power });
      ops.push({ t: 'path', d: shapes(g).body, fill: bodyFill ?? undefined, stroke });
      if (power > 0.01 && power < 1) ops.push({ t: 'path', d: shapes(g).body, fill: shown, alpha: power });
      else if (power >= 1) ops.push({ t: 'path', d: shapes(g).body, fill: shown });
      if (Math.min(g.w, g.h) >= 30) ops.push({ t: 'path', d: filament(g), stroke: power > 0.5 ? '#6b3f00' : stroke, width: 1.6 });
      return ops;
    }
    case 'note': {
      const bg = c.color ?? NOTE_BG;
      const ink = complementColor(bg);
      const label = c.name || 'Text';
      const layout = noteLayout(label, g.w, g.h);
      const block = layout.lines.length * layout.lineH;
      const y0 = layout.pad + (layout.innerH - block) / 2 + layout.lineH / 2;
      ops.push({ t: 'path', d: wavyRect(g.w, g.h, c.id), fill: bg, stroke: ink, width: 1.8 });
      layout.lines.forEach((line, i) => {
        if (!line.text) return;
        ops.push({
          t: 'text',
          text: line.text,
          x: g.w / 2,
          y: y0 + i * layout.lineH,
          size: layout.size,
          fill: ink,
          bold: true,
          anchor: 'middle',
        });
      });
      return ops;
    }
    case 'port': {
      const accent = info.accent ?? theme.box;
      if (stubs) ops.push({ t: 'path', d: stubs, stroke: accent, width: 2 });
      ops.push(
        { t: 'path', d: PORT_PLUG, fill: theme.bg, stroke: accent, width: 2 },
        { t: 'path', d: PORT_ARROW, fill: active ? onColor : accent },
      );
      return ops;
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

function wavyIcon(): DrawOp[] {
  const ink = complementColor(NOTE_BG);
  return [{ t: 'path', d: wavyRect(56, 32, 'note-icon'), fill: NOTE_BG, stroke: ink, width: 1.6 }];
}

/** Small preview used by toolbar icons. */
export function iconOps(kind: ComponentKind | 'box' | 'not' | 'ribbon-port', theme: Theme, negate = false): { ops: DrawOp[]; viewBox: string } {
  if (kind === 'note') {
    return {
      ops: [
        ...wavyIcon(),
        { t: 'text', text: 'Text', x: 28, y: 16, size: 11, fill: complementColor(NOTE_BG), bold: true, anchor: 'middle' },
      ],
      viewBox: '0 0 56 32',
    };
  }
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
    inputs: kind === 'buffer' ? 1 : isGate(kind) ? 2 : kind === 'rgb' ? 3 : 0,
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
    inputBundle: false,
  };
  const g = geomFor(kind, c.inputs, negate);
  const b = g.bounds;
  return {
    ops: componentOps(c, theme, {
      active: kind === 'bulb' || kind === 'timer',
      netOn: theme.on,
      lanes: kind === 'rgb'
        ? [
            { on: true, color: '#ef4444' },
            { on: true, color: '#22c55e' },
            { on: true, color: '#3b82f6' },
          ]
        : undefined,
    }),
    viewBox: `${b.x - 3} ${b.y - 3} ${b.w + 6} ${b.h + 6}`,
  };
}

export { PIN_LEN };
