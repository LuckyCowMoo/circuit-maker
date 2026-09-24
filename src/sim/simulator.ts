import type { ComponentKind, Doc } from '../model/types';
import { hasOutput, inputCount } from '../model/types';

const K_AND = 0;
const K_OR = 1;
const K_XOR = 2;
const K_BUF = 3;
const K_SWITCH = 4;
const K_BUTTON = 5;
const K_BULB = 6;
const K_MARKER = 7;

const KIND_CODE: Record<ComponentKind, number> = {
  and: K_AND,
  or: K_OR,
  xor: K_XOR,
  buffer: K_BUF,
  switch: K_SWITCH,
  button: K_BUTTON,
  bulb: K_BULB,
  marker: K_MARKER,
  port: K_BUF,
};

/**
 * Event-driven logic simulator.
 *
 * The document is compiled into flat typed arrays (CSR adjacency for inputs and fan-out).
 * Only components whose inputs changed are re-evaluated, in unit-delay waves: every
 * component in a wave reads the previous outputs, then all results are applied at once.
 * This makes feedback circuits (latches) behave deterministically, and oscillators simply
 * keep producing waves, which are capped per frame so the UI never locks up.
 */
export class Simulator {
  ids: string[] = [];
  index = new Map<string, number>();
  out = new Uint8Array(0);
  /** Value driven by switches (on) and buttons (pressed). */
  private src = new Uint8Array(0);
  private kind = new Uint8Array(0);
  private neg = new Uint8Array(0);
  private inStart = new Int32Array(1);
  private inSrc = new Int32Array(0);
  private foStart = new Int32Array(1);
  private fo = new Int32Array(0);
  private queue = new Int32Array(0);
  private spare = new Int32Array(0);
  private tmp = new Uint8Array(0);
  private inQ = new Uint8Array(0);
  private qLen = 0;
  private pressed = new Set<string>();
  /** Set whenever an output changes; the owner clears it after redrawing. */
  changed = false;

  get pending(): boolean {
    return this.qLen > 0;
  }

  compile(doc: Doc): void {
    const prevIndex = this.index;
    const prevOut = this.out;
    const comps = [...doc.components.values()];
    const n = comps.length;
    const index = new Map<string, number>();
    comps.forEach((c, i) => index.set(c.id, i));

    const kind = new Uint8Array(n);
    const neg = new Uint8Array(n);
    const src = new Uint8Array(n);
    const inStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      const c = comps[i];
      kind[i] = KIND_CODE[c.kind];
      neg[i] = c.negate && kind[i] <= K_BUF ? 1 : 0;
      if (c.kind === 'switch') src[i] = c.on ? 1 : 0;
      else if (c.kind === 'button') src[i] = this.pressed.has(c.id) ? 1 : 0;
      inStart[i + 1] = inStart[i] + inputCount(c);
    }

    const inSrc = new Int32Array(inStart[n]).fill(-1);
    const foCount = new Int32Array(n + 1);
    for (const w of doc.wires.values()) {
      const t = index.get(w.to);
      const s = index.get(w.from);
      if (t === undefined || s === undefined) continue;
      if (!hasOutput(comps[s].kind) || w.input < 0 || w.input >= inStart[t + 1] - inStart[t]) continue;
      const slot = inStart[t] + w.input;
      if (inSrc[slot] >= 0) foCount[inSrc[slot] + 1]--;
      inSrc[slot] = s;
      foCount[s + 1]++;
    }
    const foStart = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) foStart[i + 1] = foStart[i] + foCount[i + 1];
    const fo = new Int32Array(foStart[n]);
    const fill = foStart.slice(0, n);
    for (let t = 0; t < n; t++) {
      for (let k = inStart[t]; k < inStart[t + 1]; k++) {
        const s = inSrc[k];
        if (s >= 0) fo[fill[s]++] = t;
      }
    }

    const out = new Uint8Array(n);
    let fresh = 0;
    for (let i = 0; i < n; i++) {
      const prev = prevIndex.get(comps[i].id);
      if (prev !== undefined && prev < prevOut.length) out[i] = prevOut[prev];
      else fresh++;
    }

    this.ids = comps.map((c) => c.id);
    this.index = index;
    this.kind = kind;
    this.neg = neg;
    this.src = src;
    this.inStart = inStart;
    this.inSrc = inSrc;
    this.foStart = foStart;
    this.fo = fo;
    this.out = out;
    this.queue = new Int32Array(n);
    this.spare = new Int32Array(n);
    this.tmp = new Uint8Array(n);
    this.inQ = new Uint8Array(n);
    this.qLen = 0;
    if (fresh) this.presettle();
    for (let i = 0; i < n; i++) this.schedule(i);
    this.changed = true;
  }

  /**
   * Settles new parts one at a time, each seeing the others' latest values. Unlike the lock-step
   * waves this lets symmetric feedback (an SR latch made of two NOR gates) pick a stable state
   * instead of oscillating forever from all-zero.
   */
  private presettle(): void {
    const n = this.ids.length;
    const passes = Math.min(64, Math.floor(4_000_000 / Math.max(1, n)));
    for (let p = 0; p < passes; p++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const v = this.evaluate(i);
        if (v !== this.out[i]) {
          this.out[i] = v;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  private schedule(i: number): void {
    if (this.inQ[i]) return;
    this.inQ[i] = 1;
    this.queue[this.qLen++] = i;
  }

  private evaluate(i: number): number {
    const k = this.kind[i];
    const a = this.inStart[i];
    const b = this.inStart[i + 1];
    const out = this.out;
    const inSrc = this.inSrc;
    let v = 0;
    switch (k) {
      case K_AND:
        v = b > a ? 1 : 0;
        for (let j = a; j < b; j++) {
          const s = inSrc[j];
          if (s < 0 || !out[s]) {
            v = 0;
            break;
          }
        }
        break;
      case K_OR:
      case K_BUF:
        for (let j = a; j < b; j++) {
          const s = inSrc[j];
          if (s >= 0 && out[s]) {
            v = 1;
            break;
          }
        }
        break;
      case K_XOR:
        for (let j = a; j < b; j++) {
          const s = inSrc[j];
          if (s >= 0) v ^= out[s];
        }
        break;
      case K_SWITCH:
      case K_BUTTON:
        v = this.src[i];
        break;
      case K_BULB: {
        const s = b > a ? inSrc[a] : -1;
        v = s >= 0 ? out[s] : 0;
        break;
      }
      default:
        v = 0;
    }
    return v ^ this.neg[i];
  }

  /** Runs up to `maxWaves` propagation waves. Returns true if work remains (e.g. an oscillator). */
  step(maxWaves = 400, maxEvals = 2_000_000): boolean {
    let waves = 0;
    let evals = 0;
    while (this.qLen > 0 && waves < maxWaves && evals < maxEvals) {
      const wave = this.queue;
      const n = this.qLen;
      this.queue = this.spare;
      this.spare = wave;
      this.qLen = 0;
      for (let k = 0; k < n; k++) this.inQ[wave[k]] = 0;
      for (let k = 0; k < n; k++) this.tmp[k] = this.evaluate(wave[k]);
      for (let k = 0; k < n; k++) {
        const i = wave[k];
        const v = this.tmp[k];
        if (this.out[i] === v) continue;
        this.out[i] = v;
        this.changed = true;
        for (let j = this.foStart[i]; j < this.foStart[i + 1]; j++) this.schedule(this.fo[j]);
      }
      evals += n;
      waves++;
    }
    return this.qLen > 0;
  }

  /** Runs until stable or the wave cap is hit. Mostly for tests. */
  settle(maxWaves = 100_000): boolean {
    return !this.step(maxWaves, Infinity);
  }

  setSwitch(id: string, on: boolean): void {
    const i = this.index.get(id);
    if (i === undefined) return;
    this.src[i] = on ? 1 : 0;
    this.schedule(i);
  }

  setPressed(id: string, pressed: boolean): void {
    if (pressed) this.pressed.add(id);
    else this.pressed.delete(id);
    const i = this.index.get(id);
    if (i === undefined) return;
    this.src[i] = pressed ? 1 : 0;
    this.schedule(i);
  }

  isPressed(id: string): boolean {
    return this.pressed.has(id);
  }

  /** Output value of a component (for bulbs, whether it is lit). */
  value(id: string): boolean {
    const i = this.index.get(id);
    return i !== undefined && this.out[i] === 1;
  }
}
