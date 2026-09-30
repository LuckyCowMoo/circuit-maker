import type { ComponentKind } from './types';

export interface Theme {
  id: string;
  name: string;
  bg: string;
  grid: string;
  /** Default component outline. Must be #rrggbb so it can seed colour pickers. */
  stroke: string;
  /** Default component interior. Must be #rrggbb. */
  fill: string;
  text: string;
  selection: string;
  /** Active switch / pressed button colour. */
  on: string;
  trackOff: string;
  bulb: string;
  marker: string;
  box: string;
  /** Saturation/lightness for unpowered wires; hue comes from the wire id. */
  wireOff: { s: number; l: number };
  wireOn: { s: number; l: number };
  glowAlpha: number;
  /** Saturation and lightness for selection auras. Hue comes from the part kind. */
  aura: { s: number; l: number };
  ui: {
    bg: string;
    fg: string;
    muted: string;
    border: string;
    hover: string;
    active: string;
    activeFg: string;
    shadow: string;
  };
}

export const THEMES: Theme[] = [
  {
    id: 'solar',
    name: 'Solar',
    bg: '#fdf6e3',
    grid: 'rgba(88,110,117,0.13)',
    stroke: '#073642',
    fill: '#fffaf0',
    text: '#073642',
    selection: '#268bd2',
    on: '#859900',
    trackOff: '#e2dcc8',
    bulb: '#ffcf33',
    marker: '#dc322f',
    box: '#6c71c4',
    wireOff: { s: 50, l: 28 },
    wireOn: { s: 95, l: 47 },
    glowAlpha: 0.35,
    aura: { s: 88, l: 46 },
    ui: {
      bg: '#c4a47a',
      fg: '#073642',
      muted: '#657b83',
      border: 'rgba(7,54,66,0.14)',
      hover: 'rgba(7,54,66,0.07)',
      active: '#073642',
      activeFg: '#fdf6e3',
      shadow: '0 10px 30px rgba(7,54,66,0.18)',
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    bg: '#f5f4f0',
    grid: 'rgba(0,0,0,0.09)',
    stroke: '#111111',
    fill: '#ffffff',
    text: '#111111',
    selection: '#2f7cf6',
    on: '#16a34a',
    trackOff: '#d4d4d4',
    bulb: '#ffc93c',
    marker: '#e5484d',
    box: '#6e56cf',
    wireOff: { s: 55, l: 26 },
    wireOn: { s: 100, l: 50 },
    glowAlpha: 0.35,
    aura: { s: 90, l: 48 },
    ui: {
      bg: '#bebcb7',
      fg: '#1a1a1a',
      muted: '#6b6b6b',
      border: 'rgba(0,0,0,0.12)',
      hover: 'rgba(0,0,0,0.06)',
      active: '#111111',
      activeFg: '#ffffff',
      shadow: '0 10px 30px rgba(0,0,0,0.16), 0 2px 6px rgba(0,0,0,0.08)',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    bg: '#111318',
    grid: 'rgba(255,255,255,0.06)',
    stroke: '#e6e6e6',
    fill: '#1c1f26',
    text: '#eeeeee',
    selection: '#4c9aff',
    on: '#22c55e',
    trackOff: '#3a3f4a',
    bulb: '#ffd23f',
    marker: '#ff6369',
    box: '#8e7cff',
    wireOff: { s: 40, l: 34 },
    wireOn: { s: 100, l: 62 },
    glowAlpha: 0.4,
    aura: { s: 90, l: 64 },
    ui: {
      bg: '#323b4e',
      fg: '#ececec',
      muted: '#9aa0aa',
      border: 'rgba(255,255,255,0.10)',
      hover: 'rgba(255,255,255,0.08)',
      active: '#ececec',
      activeFg: '#111318',
      shadow: '0 10px 30px rgba(0,0,0,0.5)',
    },
  },
  {
    id: 'blueprint',
    name: 'Blueprint',
    bg: '#0f3460',
    grid: 'rgba(255,255,255,0.09)',
    stroke: '#e8f1ff',
    fill: '#15457d',
    text: '#e8f1ff',
    selection: '#ffd166',
    on: '#ffd166',
    trackOff: '#2d5f99',
    bulb: '#fff3b0',
    marker: '#ff8fa3',
    box: '#7fdbff',
    wireOff: { s: 45, l: 16 },
    wireOn: { s: 100, l: 66 },
    glowAlpha: 0.4,
    aura: { s: 94, l: 66 },
    ui: {
      bg: '#1a4f86',
      fg: '#e8f1ff',
      muted: '#9fb8d9',
      border: 'rgba(255,255,255,0.14)',
      hover: 'rgba(255,255,255,0.10)',
      active: '#e8f1ff',
      activeFg: '#0f3460',
      shadow: '0 10px 30px rgba(0,0,0,0.4)',
    },
  },
];

export const DEFAULT_THEME = THEMES[0];

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? DEFAULT_THEME;
}

const hueCache = new Map<string, number>();

/** Number of distinct wire hues. Few enough that the renderer can batch wires by colour. */
export const WIRE_HUES = 24;

/** Stable, well-spread hue for a net (keyed by the id of the component driving it). */
export function wireHue(id: string): number {
  let hue = hueCache.get(id);
  if (hue === undefined) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    hue = Math.floor((((h >>> 0) * 0.618033988749895) % 1) * WIRE_HUES) * (360 / WIRE_HUES);
    hueCache.set(id, hue);
  }
  return hue;
}

export interface WireColors {
  off: string;
  on: string;
  glow: string;
}

export function wireColors(id: string, theme: Theme): WireColors {
  const h = wireHue(id);
  return {
    off: `hsl(${h}, ${theme.wireOff.s}%, ${theme.wireOff.l}%)`,
    on: `hsl(${h}, ${theme.wireOn.s}%, ${theme.wireOn.l}%)`,
    glow: `hsla(${h}, ${theme.wireOn.s}%, ${theme.wireOn.l}%, ${theme.glowAlpha})`,
  };
}

export function toHex6(color: string | null | undefined, fallback = '#000000'): string {
  if (!color) return fallback;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  if (m) return `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase();
  return fallback;
}

/** Black or white, whichever reads better on the given colour. */
export function contrastText(color: string): string {
  const hex = toHex6(color, '#808080');
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111111' : '#ffffff';
}

export type AuraKind = ComponentKind | 'box' | 'not' | 'ribbon-port';

/** Kind hues for the selection aura. Same kinds stay in one family. */
export const AURA_HUE: Record<AuraKind, number> = {
  and: 4,
  or: 214,
  xor: 278,
  buffer: 228,
  not: 332,
  switch: 142,
  button: 170,
  timer: 304,
  bulb: 196,
  rgb: 318,
  note: 128,
  marker: 350,
  port: 188,
  'ribbon-port': 204,
  box: 262,
};

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const wrap360 = (h: number) => ((h % 360) + 360) % 360;

/** Stable hue offset in [-24, 24]. An empty id is the pure kind colour used by toolbar buttons. */
export function auraJitter(id: string): number {
  if (!id) return 0;
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) / 4294967295) * 2 - 1) * 24;
}

/** Hue for a kind, plus a small stable shift when `id` is set. */
export function auraHueOf(kind: AuraKind, id = ''): number {
  return wrap360(AURA_HUE[kind] + auraJitter(id));
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = wrap360(h);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(hue / 60) % 6;
  const rgb =
    seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x];
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  };
}

/** Kind colour at this theme's aura vividness. */
export function kindAura(theme: Theme, kind: AuraKind, id = ''): Rgb {
  return hslToRgb(auraHueOf(kind, id), theme.aura.s / 100, theme.aura.l / 100);
}

/**
 * The second wave colour. Same shift as the canvas shader: 0.66 rad toward a neighbour,
 * then pushed more vivid. Toolbar outlines swap between this and the kind colour.
 */
export function auraPartner(rgb: Rgb): Rgb {
  const rad = 0.66;
  const s = Math.sin(rad);
  const co = Math.cos(rad);
  const k = 0.57735026919;
  const c = [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  const dot = k * (c[0] + c[1] + c[2]);
  const cross = [k * (c[2] - c[1]), k * (c[0] - c[2]), k * (c[1] - c[0])];
  const shifted = [0, 1, 2].map((i) => Math.min(1, Math.max(0, c[i] * co + cross[i] * s + k * dot * (1 - co))));
  const l = 0.299 * shifted[0] + 0.587 * shifted[1] + 0.114 * shifted[2];
  const vivid = shifted.map((ch) => Math.min(1, Math.max(0, l + (ch - l) * 1.9)));
  return { r: Math.round(vivid[0] * 255), g: Math.round(vivid[1] * 255), b: Math.round(vivid[2] * 255) };
}

/** Theme accent, pushed to aura vividness. Used for the building toast. */
export function accentAura(theme: Theme): Rgb {
  return hslToRgb(colorHue(theme.selection) ?? 210, theme.aura.s / 100, theme.aura.l / 100);
}

/** An existing colour's hue, retuned to the theme's aura vividness, with optional per-id jitter. */
export function vividAura(theme: Theme, color: string, id = ''): Rgb {
  return hslToRgb((colorHue(color) ?? AURA_HUE.marker) + auraJitter(id), theme.aura.s / 100, theme.aura.l / 100);
}

/** A signal with no real output or no real input: black on a light canvas, gray on a dark one. */
export function idleWire(theme: Theme): string {
  const rgb = parseRgb(theme.bg);
  if (!rgb) return '#111111';
  const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  return lum < 140 ? '#9aa0aa' : '#111111';
}

export function parseRgb(color: string): Rgb | null {
  const raw = color.trim();
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(raw);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  const hsl = /^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i.exec(raw);
  if (!hsl) return null;
  return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
}

export function colorHue(color: string): number | null {
  const rgb = parseRgb(color);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d < 1e-6) return 0;
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return h;
}
