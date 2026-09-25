import { bodyRect, componentCenter, pinDir } from './geometry';
import { outwardNormal, portSide } from './ports';
import { labelBeside, portLabel, type DrawInfo, type TextOp } from './shapes';
import type { Theme, WireColors } from './themes';
import type { Component, Doc } from './types';
import { bundleInput, isIO, isRibbonPort, laneCount } from './types';

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
  if (c.kind === 'switch' || c.kind === 'button' || c.kind === 'timer' || c.kind === 'port') {
    info.netOn = pc.colors(pc.roots.get(c.id) ?? c.id, theme).on;
  }
  if (c.kind === 'port') info.accent = (c.box && pc.doc.boxes.get(c.box)?.color) || theme.box;
  if (isRibbonPort(c)) {
    let cableIn = false;
    let cableOut = false;
    for (const w of pc.doc.wires.values()) {
      if (!w.cable) continue;
      if (w.to === c.id) cableIn = true;
      if (w.from === c.id) cableOut = true;
    }
    info.cableIn = cableIn;
    info.cableOut = cableOut;
  }
  if (laneCount(c) > 1) {
    info.lanes = [];
    for (let i = 0; i < laneCount(c); i++) {
      const root = pc.roots.get(i ? `${c.id}#${i}` : c.id) ?? c.id;
      const cols = pc.colors(root, theme);
      info.lanes.push({ on: false, color: cols.on });
    }
  }
  return info;
}

/** The world-space name label of a switch, button, bulb or port, placed away from its wire. */
export function partLabel(doc: Doc, c: Component, theme: Theme): TextOp | null {
  if (!c.name) return null;
  if (isIO(c.kind)) {
    const d = pinDir(c, c.kind === 'bulb' || c.kind === 'rgb' ? 0 : -1);
    return labelBeside(bodyRect(c), { x: -d.x, y: -d.y }, c.name, theme.text);
  }
  if (c.kind === 'port') {
    const box = c.box ? doc.boxes.get(c.box) : undefined;
    if (box) return portLabel(componentCenter(c), outwardNormal(portSide(c, box)), c.name, box.color ?? theme.box);
    const d = pinDir(c, bundleInput(c) ? 0 : -1);
    return labelBeside(bodyRect(c), { x: -d.x, y: -d.y }, c.name, theme.text);
  }
  return null;
}

/** Parts drawn above box covers so they stay visible when a box is closed. */
export const floatsAboveBoxes = (c: Component): boolean => isIO(c.kind) || c.kind === 'port';
