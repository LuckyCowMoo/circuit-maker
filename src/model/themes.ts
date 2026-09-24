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
    ui: {
      bg: 'rgba(255,255,255,0.94)',
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
    ui: {
      bg: 'rgba(28,31,38,0.94)',
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
    ui: {
      bg: 'rgba(12,42,78,0.94)',
      fg: '#e8f1ff',
      muted: '#9fb8d9',
      border: 'rgba(255,255,255,0.14)',
      hover: 'rgba(255,255,255,0.10)',
      active: '#e8f1ff',
      activeFg: '#0f3460',
      shadow: '0 10px 30px rgba(0,0,0,0.4)',
    },
  },
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
    ui: {
      bg: 'rgba(253,246,227,0.95)',
      fg: '#073642',
      muted: '#657b83',
      border: 'rgba(7,54,66,0.14)',
      hover: 'rgba(7,54,66,0.07)',
      active: '#073642',
      activeFg: '#fdf6e3',
      shadow: '0 10px 30px rgba(7,54,66,0.18)',
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
