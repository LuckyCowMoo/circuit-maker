import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { iconOps, type DrawOp } from '../model/shapes';
import { auraPartner, kindAura, parseRgb, type Rgb, type Theme } from '../model/themes';
import type { PlaceKind } from '../editor/Editor';

/** Toolbar icon drawn from the same shapes as the canvas. */
export function ComponentIcon({
  kind,
  theme,
  negate,
  wave,
}: {
  kind: PlaceKind;
  theme: Theme;
  negate?: boolean;
  wave?: boolean;
}) {
  if (wave) return <WaveOutline kind={kind} theme={theme} negate={negate} />;
  const iconTheme: Theme = { ...theme, stroke: 'currentColor', fill: 'transparent', box: 'currentColor' };
  const { ops, viewBox } = iconOps(kind, iconTheme, negate);
  return (
    <svg viewBox={viewBox} className="icon-shape" aria-hidden="true" strokeLinejoin="round" strokeLinecap="round">
      {ops.map((op, i) =>
        op.t === 'path' ? (
          <path
            key={i}
            d={op.d}
            fill={op.fill ?? 'none'}
            stroke={op.stroke}
            strokeWidth={(op.width ?? 2.5) * 1.7}
            opacity={op.alpha}
          />
        ) : null,
      )}
    </svg>
  );
}

/** Screen drift of the component waves, in CSS pixels per second. */
const WAVE_SPEED = { x: 0.04 / 0.0018, y: 0.024 / 0.0018 };
/** Finer than the canvas waves so both colours show along a toolbar stroke. */
const ICON_SCALE = 0.08;

const pathCache = new Map<string, Path2D>();
function pathOf(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) pathCache.set(d, (p = new Path2D(d)));
  return p;
}

function hashCell(ix: number, iy: number): number {
  const n = 8;
  const x = ((ix % n) + n) % n;
  const y = ((iy % n) + n) % n;
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ 0x51ed_b2e1;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function iconNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const v00 = hashCell(x0, y0);
  const v10 = hashCell(x0 + 1, y0);
  const v01 = hashCell(x0, y0 + 1);
  const v11 = hashCell(x0 + 1, y0 + 1);
  return v00 * (1 - sx) * (1 - sy) + v10 * sx * (1 - sy) + v01 * (1 - sx) * sy + v11 * sx * sy;
}

function mixChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function parseBox(viewBox: string): { x: number; y: number; w: number; h: number } {
  const [x, y, w, h] = viewBox.split(/[\s,]+/).map(Number);
  return { x, y, w, h };
}

const FILAMENT = '#6b3f00';

function isFilament(op: DrawOp): boolean {
  return op.t === 'path' && op.stroke?.toLowerCase() === FILAMENT;
}

/** Light selection boxes (dark themes) wash out bright outline colours, so those get pulled down. */
function inkForSelection(theme: Theme, rgb: Rgb): Rgb {
  const bg = parseRgb(theme.ui.active);
  if (!bg) return rgb;
  const lum = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
  if (lum < 160) return rgb;
  const k = 0.42;
  return { r: Math.round(rgb.r * k), g: Math.round(rgb.g * k), b: Math.round(rgb.b * k) };
}

/** Selected toolbar outline: one noise field, kind colour above 0.5 and its partner below. */
function paintWaveIcon(
  canvas: HTMLCanvasElement,
  shape: HTMLCanvasElement,
  dye: HTMLCanvasElement,
  kind: PlaceKind,
  theme: Theme,
  negate: boolean,
  now: number,
): void {
  const cssW = canvas.clientWidth || 34;
  const cssH = canvas.clientHeight || 24;
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.max(1, Math.round(cssW * dpr));
  const bh = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  for (const c of [shape, dye]) {
    if (c.width !== bw || c.height !== bh) {
      c.width = bw;
      c.height = bh;
    }
  }
  const ctx = canvas.getContext('2d');
  const shapeCtx = shape.getContext('2d');
  const dyeCtx = dye.getContext('2d');
  if (!ctx || !shapeCtx || !dyeCtx) return;

  const iconTheme: Theme = { ...theme, fill: 'transparent' };
  const { ops, viewBox } = iconOps(kind, iconTheme, negate);
  const box = parseBox(viewBox);
  const fit = Math.min(cssW / box.w, cssH / box.h);
  const ox = (cssW - box.w * fit) / 2 - box.x * fit;
  const oy = (cssH - box.h * fit) / 2 - box.y * fit;
  const place = (g: CanvasRenderingContext2D) => g.setTransform(dpr * fit, 0, 0, dpr * fit, dpr * ox, dpr * oy);

  shapeCtx.setTransform(1, 0, 0, 1, 0, 0);
  shapeCtx.globalCompositeOperation = 'source-over';
  shapeCtx.clearRect(0, 0, bw, bh);
  place(shapeCtx);
  shapeCtx.lineJoin = 'round';
  shapeCtx.lineCap = 'round';
  shapeCtx.strokeStyle = '#fff';
  for (const op of ops) {
    if (op.t !== 'path' || !op.stroke || isFilament(op)) continue;
    shapeCtx.lineWidth = (op.width ?? 2.5) * 1.7;
    shapeCtx.stroke(pathOf(op.d));
  }

  const primary = inkForSelection(theme, kindAura(theme, kind));
  const other = inkForSelection(theme, auraPartner(kindAura(theme, kind)));
  const rect = canvas.getBoundingClientRect();
  const t = now / 1000;
  const img = dyeCtx.createImageData(bw, bh);
  const data = img.data;
  for (let y = 0; y < bh; y++) {
    const cssY = rect.top + y / dpr;
    for (let x = 0; x < bw; x++) {
      const cssX = rect.left + x / dpr;
      const n = iconNoise(cssX * ICON_SCALE + t * WAVE_SPEED.x * ICON_SCALE, cssY * ICON_SCALE + t * WAVE_SPEED.y * ICON_SCALE);
      const blend = n < 0.46 ? 0 : n > 0.54 ? 1 : (n - 0.46) / 0.08;
      const i = (y * bw + x) * 4;
      data[i] = mixChannel(other.r, primary.r, blend);
      data[i + 1] = mixChannel(other.g, primary.g, blend);
      data[i + 2] = mixChannel(other.b, primary.b, blend);
      data[i + 3] = 255;
    }
  }
  dyeCtx.setTransform(1, 0, 0, 1, 0, 0);
  dyeCtx.globalCompositeOperation = 'source-over';
  dyeCtx.putImageData(img, 0, 0);
  dyeCtx.globalCompositeOperation = 'destination-in';
  dyeCtx.drawImage(shape, 0, 0);
  dyeCtx.globalCompositeOperation = 'source-over';

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bw, bh);
  place(ctx);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const op of ops) drawFill(ctx, op);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(dye, 0, 0);
  place(ctx);
  ctx.strokeStyle = theme.ui.active;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const op of ops) {
    if (!isFilament(op) || op.t !== 'path') continue;
    ctx.lineWidth = (op.width ?? 1.6) * 1.7;
    ctx.stroke(pathOf(op.d));
  }
  place(ctx);
  for (const op of ops) {
    if (op.t !== 'text') continue;
    ctx.globalAlpha = 1;
    ctx.fillStyle = op.fill;
    ctx.font = `${op.bold ? '700 ' : ''}${op.size}px Inter, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = op.anchor === 'middle' ? 'center' : (op.anchor ?? 'start');
    ctx.textBaseline = 'middle';
    ctx.fillText(op.text, op.x, op.y);
  }
}

function drawFill(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  if (op.t !== 'path' || !op.fill || op.fill === 'transparent') return;
  ctx.globalAlpha = op.alpha ?? 1;
  ctx.fillStyle = op.fill;
  ctx.fill(pathOf(op.d));
  ctx.globalAlpha = 1;
}

function WaveOutline({ kind, theme, negate }: { kind: PlaceKind; theme: Theme; negate?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const shape = document.createElement('canvas');
    const dye = document.createElement('canvas');
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!canvas.isConnected || getComputedStyle(canvas).visibility === 'hidden') return;
      paintWaveIcon(canvas, shape, dye, kind, themeRef.current, !!negate, now);
    };
    paintWaveIcon(canvas, shape, dye, kind, themeRef.current, !!negate, performance.now());
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [kind, negate]);
  return <canvas ref={ref} className="icon-shape" width={68} height={48} aria-hidden="true" />;
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icons = {
  select: (
    <Svg>
      <path d="M5 3l14 8-6 1.5L10 19z" />
    </Svg>
  ),
  pan: (
    <Svg>
      <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a6 6 0 01-4.7-2.3L4 15a1.6 1.6 0 012.4-2.1L8 14.5" />
    </Svg>
  ),
  undo: (
    <Svg>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 010 10h-3" />
    </Svg>
  ),
  redo: (
    <Svg>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9a5 5 0 000 10h3" />
    </Svg>
  ),
  fit: (
    <Svg>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  ),
  open: (
    <Svg>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </Svg>
  ),
  save: (
    <Svg>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </Svg>
  ),
  theme: (
    <Svg>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 000 16z" fill="currentColor" />
    </Svg>
  ),
  people: (
    <Svg>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-2.8 2.7-4 5.5-4s4.9 1.2 5.5 4" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M16 15c1.8.2 3.2 1.2 3.8 3" />
    </Svg>
  ),
  help: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.3M12 17h.01" />
    </Svg>
  ),
  trash: (
    <Svg>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
    </Svg>
  ),
  copy: (
    <Svg>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </Svg>
  ),
  rotate: (
    <Svg>
      <path d="M20 12a8 8 0 11-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </Svg>
  ),
  flip: (
    <Svg>
      <path d="M12 3v18" strokeDasharray="2 3" />
      <path d="M9 7L4 17h5zM15 7l5 10h-5z" />
    </Svg>
  ),
  inputs: (
    <Svg>
      <rect x="3" y="8" width="12" height="8" rx="4" />
      <circle cx="11" cy="12" r="2" />
      <path d="M15 12h6" />
    </Svg>
  ),
  outputs: (
    <Svg>
      <circle cx="15" cy="12" r="6" />
      <path d="M3 12h6M13 13.5l1-3 1 2.5 1-2.5 1 3" />
    </Svg>
  ),
  locate: (
    <Svg>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </Svg>
  ),
  newTab: (
    <Svg>
      <path d="M14 4h6v6M20 4l-8 8" />
      <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
    </Svg>
  ),
  add: (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </Svg>
  ),
  blank: (
    <Svg>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </Svg>
  ),
  chevron: (
    <Svg>
      <path d="M6 15l6-6 6 6" />
    </Svg>
  ),
  navigation: (
    <Svg>
      <circle cx="12" cy="12" r="8" />
      <path d="M14.6 9.4l-1.3 4.1-4.1 1.3 1.3-4.1z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  gates: (
    <Svg>
      <path d="M6 5h6a6 6 0 010 12H6z" />
      <path d="M3 8h3M3 14h3M18 11h3" />
    </Svg>
  ),
  io: (
    <Svg>
      <rect x="3" y="8" width="14" height="8" rx="4" />
      <circle cx="13" cy="12" r="2.2" />
      <path d="M17 12h4" />
    </Svg>
  ),
  comments: (
    <Svg>
      <path d="M4 8c1.6-1.6 3.2 1.6 4.8 0S12.4 9.6 14 8s3.2 1.6 4.8 0 1.2-1.6 1.2 0v7c-1.6 1.6-3.2-1.6-4.8 0s-3.2 1.6-4.8 0-3.2-1.6-4.8 0S4 16.6 4 15z" />
    </Svg>
  ),
  components: (
    <Svg>
      <rect x="7" y="6" width="10" height="12" rx="2" />
      <path d="M3 9h4M3 15h4M17 12h4" />
    </Svg>
  ),
  time: (
    <Svg>
      <circle cx="12" cy="13" r="7" />
      <path d="M12 10v3.5l2.5 1.5M8 4.5h8" />
    </Svg>
  ),
  menu: (
    <Svg>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  ),
};
