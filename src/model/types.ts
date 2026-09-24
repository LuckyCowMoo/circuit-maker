export const GATE_KINDS = ['and', 'or', 'xor', 'buffer'] as const;
export type GateKind = (typeof GATE_KINDS)[number];
export const IO_KINDS = ['switch', 'button', 'bulb'] as const;
export type IOKind = (typeof IO_KINDS)[number];
/** `port` is the connector where a wire passes through the wall of a box. */
export type ComponentKind = GateKind | IOKind | 'marker' | 'port';
export const COMPONENT_KINDS: readonly ComponentKind[] = [...GATE_KINDS, ...IO_KINDS, 'marker', 'port'];

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Quarter turns clockwise. */
export type Rotation = 0 | 1 | 2 | 3;

export interface Component {
  id: string;
  kind: ComponentKind;
  /** Top-left corner of the (rotated) body; pin stubs stick out beyond this. */
  x: number;
  y: number;
  /** Gates only: number of input pins. */
  inputs: number;
  /** Gates only: NOT bubble on the output. */
  negate: boolean;
  /** Custom outline colour, or null for the theme default. */
  stroke: string | null;
  /** Custom interior colour, or null for the theme default. */
  fill: string | null;
  /** Switch state. */
  on: boolean;
  /** Label of a marker, switch, button, bulb or port. */
  name: string;
  /** Marker colour or bulb lit colour, or null for the theme default. */
  color: string | null;
  /** Rotation, applied after `flip`. Markers and ports ignore user rotation. */
  rot: Rotation;
  /** Mirror left-right before rotating. */
  flip: boolean;
  /** Switch, button and bulb body size before rotation. */
  w: number;
  h: number;
  /** Ports only: the box whose wall this port sits in. */
  box: string | null;
}

export interface Wire {
  id: string;
  /** Component whose output drives this wire. */
  from: string;
  /** Component receiving the signal. */
  to: string;
  /** Input pin index on `to`. */
  input: number;
}

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  color: string | null;
}

export interface Doc {
  name: string;
  components: Map<string, Component>;
  wires: Map<string, Wire>;
  boxes: Map<string, Box>;
}

export const isGate = (k: ComponentKind): k is GateKind =>
  k === 'and' || k === 'or' || k === 'xor' || k === 'buffer';

export const isIO = (k: ComponentKind): k is IOKind => k === 'switch' || k === 'button' || k === 'bulb';

export const isInput = (k: ComponentKind): boolean => k === 'switch' || k === 'button';

/** Parts the user can rotate, flip and (for IO) resize. */
export const canRotate = (k: ComponentKind): boolean => isGate(k) || isIO(k);

export const hasOutput = (k: ComponentKind): boolean =>
  isGate(k) || k === 'switch' || k === 'button' || k === 'port';

export const inputCount = (c: Component): number =>
  isGate(c.kind) ? c.inputs : c.kind === 'bulb' || c.kind === 'port' ? 1 : 0;
