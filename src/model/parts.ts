import { bodyRect, componentCenter, pinDir } from './geometry';
import { outwardNormal, portSide } from './ports';
import { labelBeside, portLabel, type DrawInfo, type TextOp } from './shapes';
import type { Theme, WireColors } from './themes';
import type { Component, Doc } from './types';
import { isIO } from './types';

/** Per-document data needed to draw parts, recomputed when the wiring changes. */
export interface PartContext {
  doc: Doc;
  /** Wired pins per component (see `pinMasks`). */
  masks: Map<string, string>;
  /** The real driver behind each component's output (see `netRoots`). */
  roots: Map<string, string>;
  colors: (net: string, theme: Theme) => WireColors;
}

export function partInfo(pc: PartContext, c: Component, theme: Theme, active: boolean): DrawInfo {
  const info: DrawInfo = { active, mask: pc.masks.get(c.id) };
  if (c.kind === 'switch' || c.kind === 'button' || c.kind === 'port') {
    info.netOn = pc.colors(pc.roots.get(c.id) ?? c.id, theme).on;
  }
  if (c.kind === 'port') info.accent = (c.box && pc.doc.boxes.get(c.box)?.color) || theme.box;
  return info;
}

/** The world-space name label of a switch, button, bulb or port, placed away from its wire. */
export function partLabel(doc: Doc, c: Component, theme: Theme): TextOp | null {
  if (!c.name) return null;
  if (isIO(c.kind)) {
    const d = pinDir(c, c.kind === 'bulb' ? 0 : -1);
    return labelBeside(bodyRect(c), { x: -d.x, y: -d.y }, c.name, theme.text);
  }
  if (c.kind === 'port') {
    const box = c.box ? doc.boxes.get(c.box) : undefined;
    if (!box) return null;
    return portLabel(componentCenter(c), outwardNormal(portSide(c, box)), c.name, box.color ?? theme.box);
  }
  return null;
}

/** Parts drawn above box covers so they stay visible when a box is closed. */
export const floatsAboveBoxes = (c: Component): boolean => isIO(c.kind) || c.kind === 'port';
