export const GATE_KINDS = ['and', 'or', 'xor', 'buffer'] as const;
export type GateKind = (typeof GATE_KINDS)[number];
export const IO_KINDS = ['switch', 'button', 'bulb'] as const;
export type IOKind = (typeof IO_KINDS)[number];
export type ComponentKind = GateKind | IOKind | 'marker';
export const COMPONENT_KINDS: readonly ComponentKind[] = [...GATE_KINDS, ...IO_KINDS, 'marker'];

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

export interface Component {
  id: string;
  kind: ComponentKind;
  /** Top-left corner of the body (pin stubs stick out beyond this). */
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
  /** Marker label. */
  name: string;
  /** Marker colour or bulb lit colour, or null for the theme default. */
  color: string | null;
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

export const hasOutput = (k: ComponentKind): boolean => isGate(k) || k === 'switch' || k === 'button';

export const inputCount = (c: Component): number =>
  isGate(c.kind) ? c.inputs : c.kind === 'bulb' ? 1 : 0;
