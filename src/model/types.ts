export const GATE_KINDS = ['and', 'or', 'xor', 'buffer'] as const;
export type GateKind = (typeof GATE_KINDS)[number];
export const IO_KINDS = ['switch', 'button', 'timer', 'bulb', 'rgb'] as const;
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
  /**
   * Keyboard binding for switches and buttons (`KeyboardEvent.code`, e.g. `"KeyA"`, `"Space"`).
   * Switches toggle on press; buttons stay on while the key is held.
   */
  key?: string | null;
  /** Timer cycle length in seconds. */
  period?: number;
  /** Timer high-time in seconds. */
  pulse?: number;
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
  /**
   * Legacy ribbon layout. Kept for old project files; new code uses `inputBundle`/`outputBundle`.
   */
  plug?: 'in' | 'out';
  /** Ribbon input/output face uses one cable socket instead of one pin per lane. */
  inputBundle?: boolean;
  outputBundle?: boolean;
  /** Ports placed from the toolbar stay when unwired. */
  placed?: boolean;
}

export interface Wire {
  id: string;
  /** Component whose output drives this wire. */
  from: string;
  /** Component receiving the signal. */
  to: string;
  /** Input pin index on `to`. */
  input: number;
  /** Which output lane of `from` drives this wire. Omitted (0) for parts with one output. */
  lane?: number;
  /**
   * A ribbon cable between two ribbon ports. Lane i of `from` drives lane i of `to`.
   * Drawn as parallel stripes, not as a component.
   */
  cable?: boolean;
  /** Editor-created branch should get a new wall port instead of reusing the driver's port. */
  separatePort?: boolean;
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

export const isIO = (k: ComponentKind): k is IOKind =>
  k === 'switch' || k === 'button' || k === 'timer' || k === 'bulb' || k === 'rgb';

export const isInput = (k: ComponentKind): boolean => k === 'switch' || k === 'button' || k === 'timer';

/** Parts the user can rotate, flip and (for IO) resize. */
export const canRotate = (k: ComponentKind): boolean => isGate(k) || isIO(k);

/** Fewest lanes that auto-bundle into a ribbon cable. Narrower runs stay as ordinary wires. */
export const CABLE_MIN = 4;

export const hasOutput = (k: ComponentKind): boolean =>
  isGate(k) || k === 'switch' || k === 'button' || k === 'timer' || k === 'port';

/** How many signals a ribbon port carries. */
export const laneCount = (c: Component): number =>
  c.kind === 'rgb' ? 3 : c.kind === 'port' && c.inputs > 1 ? Math.max(1, c.inputs) : 1;

/** A multi-lane port that can take a ribbon cable (or individual lane wires). */
export const isRibbonPort = (c: Component): boolean => c.kind === 'port' && c.inputs > 1;

/** Whether each face of a ribbon port is a cable socket. Legacy `plug` supplies the default. */
export const bundleInput = (c: Component): boolean =>
  (c.kind === 'rgb' && c.inputBundle === true) ||
  (isRibbonPort(c) && (c.inputBundle ?? c.plug === 'in'));
export const bundleOutput = (c: Component): boolean =>
  isRibbonPort(c) && (c.outputBundle ?? c.plug === 'out');

export const bundleSource = bundleOutput;
export const bundleDest = bundleInput;

export const inputCount = (c: Component): number => {
  // Ribbon ports accept one wire per lane (input index = lane), whether the plug faces in or out.
  if (c.kind === 'port' && c.inputs > 1) return Math.max(1, c.inputs);
  if (isGate(c.kind)) return Math.max(1, c.inputs);
  if (c.kind === 'rgb') return 3;
  if (c.kind === 'bulb' || c.kind === 'port') return Math.max(1, c.inputs || 1);
  return 0;
};
