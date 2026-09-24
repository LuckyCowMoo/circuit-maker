import { boxesOuterFirst, netRoots, pinMasks } from '../model/doc';
import {
  componentBounds,
  curveBounds,
  curveSvgPath,
  inflate,
  STROKE_W,
  unionRects,
  wireBetween,
  xformOf,
} from '../model/geometry';
import { partInfo, partLabel, type PartContext } from '../model/parts';
import { componentOps, textRect, type DrawOp } from '../model/shapes';
import { wireColors, type Theme } from '../model/themes';
import type { Doc, Rect } from '../model/types';
import type { Simulator } from '../sim/simulator';

export const FONT_STACK = "Inter, 'Segoe UI', system-ui, -apple-system, sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function opToSvg(op: DrawOp): string {
  if (op.t === 'text') {
    const anchor = op.anchor ?? 'start';
    return `<text x="${op.x}" y="${op.y}" font-size="${op.size}" font-weight="${op.bold ? 700 : 400}" fill="${esc(op.fill)}" text-anchor="${anchor}" dominant-baseline="middle">${esc(op.text)}</text>`;
  }
  const attrs = [`d="${op.d}"`, `fill="${op.fill ? esc(op.fill) : 'none'}"`];
  if (op.stroke) attrs.push(`stroke="${esc(op.stroke)}"`, `stroke-width="${op.width ?? STROKE_W}"`);
  if (op.alpha !== undefined) attrs.push(`opacity="${op.alpha}"`);
  return `<path ${attrs.join(' ')}/>`;
}

export interface SvgResult {
  svg: string;
  width: number;
  height: number;
}

/** Renders the document (or the given ids) to a standalone SVG, showing the current signal state. */
export function buildSvg(doc: Doc, theme: Theme, sim: Simulator, ids?: Set<string>): SvgResult {
  const comps = [...doc.components.values()].filter((c) => !ids || ids.has(c.id));
  const compIds = new Set(comps.map((c) => c.id));
  const boxes = boxesOuterFirst(doc).filter((b) => !ids || ids.has(b.id));
  const wires = [...doc.wires.values()].filter((w) => compIds.has(w.from) && compIds.has(w.to));
  const curves = wires
    .map((w) => {
      const curve = wireBetween(doc.components.get(w.from)!, doc.components.get(w.to)!, w.input);
      return curve ? { w, curve } : null;
    })
    .filter((x) => x !== null);
  const sub: Doc = {
    ...doc,
    components: new Map(comps.map((c) => [c.id, c])),
    wires: new Map(wires.map((w) => [w.id, w])),
  };
  const pc: PartContext = { doc, masks: pinMasks(sub), roots: netRoots(doc), colors: wireColors };

  const labels = comps.map((c) => partLabel(doc, c, theme)).filter((l) => l !== null);
  const rects: Rect[] = [
    ...comps.map(componentBounds),
    ...boxes,
    ...curves.map((c) => curveBounds(c.curve)),
    ...labels.map(textRect),
  ];
  const bounds = inflate(unionRects(rects) ?? { x: 0, y: 0, w: 200, h: 120 }, 30);
  const { x, y } = bounds;
  const width = Math.ceil(bounds.w);
  const height = Math.ceil(bounds.h);

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" font-family="${esc(FONT_STACK)}" stroke-linejoin="round" stroke-linecap="round">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${theme.bg}"/>`,
  );
  for (const b of boxes) {
    const col = esc(b.color ?? theme.box);
    out.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="${col}" fill-opacity="0.13" stroke="${col}" stroke-width="2"/>`,
    );
  }
  for (const { w, curve } of curves) {
    const cols = wireColors(pc.roots.get(w.from) ?? w.from, theme);
    const d = curveSvgPath(curve);
    if (sim.value(w.from)) {
      out.push(`<path d="${d}" fill="none" stroke="${cols.glow}" stroke-width="9"/>`);
      out.push(`<path d="${d}" fill="none" stroke="${cols.on}" stroke-width="3"/>`);
    } else {
      out.push(`<path d="${d}" fill="none" stroke="${cols.off}" stroke-width="${STROKE_W}"/>`);
    }
  }
  for (const c of comps) {
    const active = c.kind === 'switch' ? c.on : c.kind === 'button' ? sim.isPressed(c.id) : sim.value(c.id);
    const m = xformOf(c);
    const t = `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((n) => Math.round(n * 100) / 100).join(' ')})`;
    out.push(`<g transform="${t}">${componentOps(c, theme, partInfo(pc, c, theme, active)).map(opToSvg).join('')}</g>`);
  }
  for (const l of labels) out.push(opToSvg(l));
  for (const b of boxes) {
    if (!b.name) continue;
    const col = b.color ?? theme.box;
    const size = Math.min(14, b.h * 0.25);
    out.push(
      `<text x="${b.x + b.w - 8}" y="${b.y + 8 + size / 2}" font-size="${size}" font-weight="700" fill="${esc(col)}" text-anchor="end" dominant-baseline="middle">${esc(b.name)}</text>`,
    );
  }
  out.push('</svg>');
  return { svg: out.join('\n'), width, height };
}

/** Rasterises an SVG to a PNG blob. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  const s = Math.max(0.1, Math.min(scale, 8192 / Math.max(width, height)));
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * s);
  canvas.height = Math.round(height * s);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed.'))), 'image/png'),
  );
}