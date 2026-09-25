import type { Component, ComponentKind, Doc } from '../model/types';
import { bundleDest, bundleSource, hasOutput, inputCount, laneCount } from '../model/types';
import { GpuSession, type GpuNet } from './gpu';

const K_AND = 0;
const K_OR = 1;
const K_XOR = 2;
const K_BUF = 3;
const K_SWITCH = 4;
const K_BUTTON = 5;
const K_TIMER = 6;
const K_BULB = 7;
const K_MARKER = 8;

const KIND_CODE: Record<ComponentKind, number> = {
  and: K_AND,
  or: K_OR,
  xor: K_XOR,
  buffer: K_BUF,
  switch: K_SWITCH,
  button: K_BUTTON,
  timer: K_TIMER,
  bulb: K_BULB,
  rgb: K_BULB,
  marker: K_MARKER,
  note: K_MARKER,
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
  private timers: { index: number; periodMs: number; pulseMs: number }[] = [];
  /** Set whenever an output changes; the owner clears it after redrawing. */
  changed = false;
  /** `gpu` once a live step has proved the GPU matches the CPU and is faster. */
  get backend(): 'cpu' | 'gpu' {
    return this.accel === 'gpu' ? 'gpu' : 'cpu';
  }
  /** Why the live sim stayed on the CPU, when it did. */
  gpuNote = '';
  private layoutGen = 1;
  private accel: 'unknown' | 'gpu' | 'cpu' = 'unknown';
  private gpuPromise: Promise<GpuSession | null> | null = null;

  get pending(): boolean {
    return this.qLen > 0;
  }

  compile(doc: Doc): void {
    const prevIndex = this.index;
    const prevOut = this.out;
    const comps = [...doc.components.values()];
    const nodes: { id: string; lane: number; comp: Component }[] = [];
    for (const c of comps) {
      const lanes = laneCount(c);
      for (let lane = 0; lane < lanes; lane++) nodes.push({ id: c.id, lane, comp: c });
    }
    const n = nodes.length;
    const index = new Map<string, number>();
    nodes.forEach((node, i) => {
      index.set(node.lane ? `${node.id}#${node.lane}` : node.id, i);
    });

    const kind = new Uint8Array(n);
    const neg = new Uint8Array(n);
    const src = new Uint8Array(n);
    const inStart = new Int32Array(n + 1);
    const timers: { index: number; periodMs: number; pulseMs: number }[] = [];
    for (let i = 0; i < n; i++) {
      const c = nodes[i].comp;
      const multi = laneCount(c) > 1;
      kind[i] = multi ? K_BUF : KIND_CODE[c.kind];
      neg[i] = !multi && c.negate && kind[i] <= K_BUF ? 1 : 0;
      if (c.kind === 'switch') src[i] = c.on ? 1 : 0;
      else if (c.kind === 'button') src[i] = this.pressed.has(c.id) ? 1 : 0;
      else if (c.kind === 'timer') {
        const periodSec = Math.max(0.01, Math.min(3600, c.period ?? 5));
        const pulseSec = Math.max(0.001, Math.min(periodSec, c.pulse ?? 1));
        timers.push({
          index: i,
          periodMs: periodSec * 1000,
          pulseMs: pulseSec * 1000,
        });
      }
      inStart[i + 1] = inStart[i] + (multi ? 1 : inputCount(c));
    }

    const inSrc = new Int32Array(inStart[n]).fill(-1);
    const foCount = new Int32Array(n + 1);
    const join = (s: number, t: number) => {
      const slot = inStart[t];
      const multi = laneCount(nodes[t].comp) > 1;
      const at = multi ? slot : slot + 0;
      if (at < inStart[t] || at >= inStart[t + 1]) return;
      if (inSrc[at] >= 0) foCount[inSrc[at] + 1]--;
      inSrc[at] = s;
      foCount[s + 1]++;
    };
    for (const w of doc.wires.values()) {
      const srcNode = nodes.find((node) => node.id === w.from);
      const dest = doc.components.get(w.to);
      if (!dest || !srcNode || !hasOutput(srcNode.comp.kind)) continue;
      if (w.cable && bundleSource(srcNode.comp) && bundleDest(dest)) {
        const n = Math.min(laneCount(srcNode.comp), laneCount(dest));
        for (let i = 0; i < n; i++) {
          const s = index.get(i ? `${w.from}#${i}` : w.from);
          const t = index.get(i ? `${w.to}#${i}` : w.to);
          if (s !== undefined && t !== undefined) join(s, t);
        }
        continue;
      }
      const s = index.get(w.lane ? `${w.from}#${w.lane}` : w.from);
      if (s === undefined) continue;
      const t = laneCount(dest) > 1 ? index.get(w.input ? `${w.to}#${w.input}` : w.to) : index.get(w.to);
      if (t === undefined) continue;
      const slot = laneCount(dest) > 1 ? inStart[t] : inStart[t] + w.input;
      if (slot < inStart[t] || slot >= inStart[t + 1]) continue;
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
      const node = nodes[i];
      const prev = prevIndex.get(node.lane ? `${node.id}#${node.lane}` : node.id);
      if (prev !== undefined && prev < prevOut.length) out[i] = prevOut[prev];
      else fresh++;
    }

    this.ids = nodes.map((node) => (node.lane ? `${node.id}#${node.lane}` : node.id));
    this.index = index;
    this.kind = kind;
    this.neg = neg;
    this.src = src;
    this.timers = timers;
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
    this.layoutGen++;
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
      case K_TIMER:
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

  /**
   * Live step used by the editor. Large circuits run on the GPU when WebGPU is available
   * and a short comparison shows it matches the CPU and finishes sooner.
   */
  async stepLive(maxWaves = 400, maxEvals = 2_000_000): Promise<boolean> {
    if (this.ids.length < 4096 || this.accel === 'cpu') {
      if (this.ids.length < 4096) this.gpuNote = 'cpu (small circuit)';
      return this.step(maxWaves, maxEvals);
    }
    const gpu = await this.gpuReady();
    if (!gpu) {
      this.accel = 'cpu';
      this.gpuNote = this.gpuNote || 'no WebGPU device';
      return this.step(maxWaves, maxEvals);
    }
    if (this.accel === 'unknown') {
      const faster = await this.proveGpu(gpu);
      this.accel = faster ? 'gpu' : 'cpu';
      if (!this.qLen || maxWaves <= 8) return this.qLen > 0;
      if (faster) return this.gpuStep(gpu, maxWaves - 8, maxEvals);
      return this.step(maxWaves - 8, maxEvals);
    }
    try {
      return await this.gpuStep(gpu, maxWaves, maxEvals);
    } catch (err) {
      this.accel = 'cpu';
      this.gpuNote = err instanceof Error ? err.message : String(err);
      return this.step(maxWaves, maxEvals);
    }
  }

  /** Runs until stable or the wave cap is hit. Mostly for tests. */
  settle(maxWaves = 100_000): boolean {
    return !this.step(maxWaves, Infinity);
  }

  private gpuReady(): Promise<GpuSession | null> {
    if (typeof navigator === 'undefined' || !navigator.gpu) return Promise.resolve(null);
    if (!this.gpuPromise) {
      this.gpuPromise = GpuSession.probe().catch((err) => {
        this.gpuNote = err instanceof Error ? err.message : String(err);
        return null;
      });
    }
    return this.gpuPromise;
  }

  private net(): GpuNet {
    return {
      layout: this.layoutGen,
      n: this.ids.length,
      kind: this.kind,
      neg: this.neg,
      inStart: this.inStart,
      inSrc: this.inSrc,
      foStart: this.foStart,
      fo: this.fo,
      src: this.src,
      out: this.out,
      inQ: this.inQ,
      queue: this.queue,
      qLen: this.qLen,
    };
  }

  private async gpuStep(gpu: GpuSession, maxWaves: number, maxEvals: number): Promise<boolean> {
    const result = await gpu.step(this.net(), maxWaves, maxEvals);
    this.qLen = result.qLen;
    if (result.changed) this.changed = true;
    return this.qLen > 0;
  }

  /** Eight waves on each backend. Leaves the faster result in place when they agree. */
  private async proveGpu(gpu: GpuSession): Promise<boolean> {
    const snap = {
      out: this.out.slice(),
      src: this.src.slice(),
      queue: this.queue.slice(),
      spare: this.spare.slice(),
      inQ: this.inQ.slice(),
      qLen: this.qLen,
      changed: this.changed,
    };
    const restore = () => {
      this.out.set(snap.out);
      this.src.set(snap.src);
      this.queue.set(snap.queue);
      this.spare.set(snap.spare);
      this.inQ.set(snap.inQ);
      this.qLen = snap.qLen;
      this.changed = snap.changed;
    };
    try {
      const t0 = performance.now();
      await this.gpuStep(gpu, 8, 2_000_000);
      const gpuMs = performance.now() - t0;
      const gpuOut = this.out.slice();
      const gpuInQ = this.inQ.slice();
      const gpuQueue = this.queue.slice();
      const gpuLen = this.qLen;
      const gpuChanged = this.changed;
      restore();
      const t1 = performance.now();
      this.step(8, 2_000_000);
      const cpuMs = performance.now() - t1;
      let same = gpuLen === this.qLen;
      for (let i = 0; same && i < gpuOut.length; i++) {
        if (gpuOut[i] !== this.out[i] || gpuInQ[i] !== this.inQ[i]) same = false;
      }
      if (!same || gpuMs >= cpuMs) {
        this.gpuNote = `cpu kept (${gpuMs.toFixed(0)}ms gpu vs ${cpuMs.toFixed(0)}ms cpu, match ${same})`;
        return false;
      }
      this.out.set(gpuOut);
      this.inQ.set(gpuInQ);
      this.queue.set(gpuQueue);
      this.qLen = gpuLen;
      this.changed = gpuChanged;
      this.gpuNote = `gpu (${gpuMs.toFixed(0)}ms vs ${cpuMs.toFixed(0)}ms cpu)`;
      return true;
    } catch (err) {
      restore();
      this.step(8, 2_000_000);
      this.gpuNote = err instanceof Error ? err.message : String(err);
      return false;
    }
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

  /** Updates real-time timer sources. Returns true when at least one timer edge occurred. */
  tickTime(now: number): boolean {
    let moved = false;
    for (const timer of this.timers) {
      const value = now % timer.periodMs < timer.pulseMs ? 1 : 0;
      if (this.src[timer.index] === value) continue;
      this.src[timer.index] = value;
      this.schedule(timer.index);
      moved = true;
    }
    return moved;
  }

  isPressed(id: string): boolean {
    return this.pressed.has(id);
  }

  /** Output of one lane. Parts with a single output use lane 0. */
  value(id: string, lane = 0): boolean {
    const i = this.index.get(lane ? `${id}#${lane}` : id);
    return i !== undefined && this.out[i] === 1;
  }
}
