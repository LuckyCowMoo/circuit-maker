/** WebGPU wave engine. Matches the CPU simulator's unit-delay step, in parallel. */

export interface GpuNet {
  layout: number;
  n: number;
  kind: Uint8Array;
  neg: Uint8Array;
  inStart: Int32Array;
  inSrc: Int32Array;
  foStart: Int32Array;
  fo: Int32Array;
  src: Uint8Array;
  out: Uint8Array;
  inQ: Uint8Array;
  queue: Int32Array;
  qLen: number;
}

export interface GpuStep {
  qLen: number;
  changed: boolean;
}

const COMPUTE = 0x4;
const MAP_READ = 0x1;
const USAGE_STORAGE = 0x80;
const USAGE_COPY_SRC = 0x4;
const USAGE_COPY_DST = 0x8;
const USAGE_UNIFORM = 0x40;
const USAGE_INDIRECT = 0x100;
const USAGE_MAP_READ = 0x1;

const WGSL = /* wgsl */ `
struct Off {
  n: u32,
  kind: u32,
  neg: u32,
  inStart: u32,
  foStart: u32,
  inSrc: u32,
  fo: u32,
  src: u32,
  outV: u32,
  tmp: u32,
  queue: u32,
  nextQ: u32,
  maxEvals: u32,
  _pad: u32,
  _pad2: u32,
  _pad3: u32,
}
struct Ctrl {
  qLen: atomic<u32>,
  nextLen: atomic<u32>,
  evals: atomic<u32>,
  changed: atomic<u32>,
  waveLen: u32,
  skip: u32,
  maxEvals: u32,
  _pad: u32,
}

@group(0) @binding(0) var<storage, read> u32s: array<u32>;
@group(0) @binding(1) var<storage, read> i32s: array<i32>;
@group(0) @binding(2) var<storage, read_write> dyn: array<u32>;
@group(0) @binding(3) var<storage, read_write> inQ: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> ctrl: Ctrl;
@group(0) @binding(5) var<storage, read_write> indirect: array<u32>;
@group(0) @binding(6) var<uniform> off: Off;

fn evaluate(i: u32) -> u32 {
  let k = u32s[off.kind + i];
  let a = u32s[off.inStart + i];
  let b = u32s[off.inStart + i + 1u];
  var v = 0u;
  if (k == 0u) {
    v = select(0u, 1u, b > a);
    let bend = min(b, a + 256u);
    for (var j = a; j < bend; j = j + 1u) {
      let s = i32s[off.inSrc + j];
      if (s < 0 || dyn[off.outV + u32(s)] == 0u) { v = 0u; }
    }
  } else if (k == 1u || k == 3u) {
    let bend = min(b, a + 256u);
    for (var j = a; j < bend; j = j + 1u) {
      let s = i32s[off.inSrc + j];
      if (s >= 0 && dyn[off.outV + u32(s)] != 0u) { v = 1u; }
    }
  } else if (k == 2u) {
    let bend = min(b, a + 256u);
    for (var j = a; j < bend; j = j + 1u) {
      let s = i32s[off.inSrc + j];
      if (s >= 0) { v = v ^ dyn[off.outV + u32(s)]; }
    }
  } else if (k == 4u || k == 5u || k == 6u) {
    v = dyn[off.src + i];
  } else if (k == 7u) {
    if (b > a) {
      let s = i32s[off.inSrc + a];
      if (s >= 0) { v = dyn[off.outV + u32(s)]; }
    }
  }
  return v ^ u32s[off.neg + i];
}

@compute @workgroup_size(1)
fn prepare() {
  let q = atomicLoad(&ctrl.qLen);
  let ev = atomicLoad(&ctrl.evals);
  if (q == 0u || ev >= ctrl.maxEvals) {
    ctrl.skip = 1u;
    ctrl.waveLen = 0u;
    indirect[0] = 0u;
  } else {
    ctrl.skip = 0u;
    ctrl.waveLen = q;
    indirect[0] = (q + 63u) / 64u;
  }
  indirect[1] = 1u;
  indirect[2] = 1u;
}

@compute @workgroup_size(64)
fn eval(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ctrl.waveLen) { return; }
  let i = dyn[off.queue + gid.x];
  atomicStore(&inQ[i], 0u);
  dyn[off.tmp + i] = evaluate(i);
}

@compute @workgroup_size(64)
fn commit(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= ctrl.waveLen) { return; }
  let i = dyn[off.queue + gid.x];
  let v = dyn[off.tmp + i];
  if (dyn[off.outV + i] == v) { return; }
  dyn[off.outV + i] = v;
  atomicStore(&ctrl.changed, 1u);
  let a = u32s[off.foStart + i];
  let b = u32s[off.foStart + i + 1u];
  let fend = min(b, a + off.n);
  for (var j = a; j < fend; j = j + 1u) {
    let d = u32(i32s[off.fo + j]);
    if (atomicExchange(&inQ[d], 1u) == 0u) {
      let pos = atomicAdd(&ctrl.nextLen, 1u);
      dyn[off.nextQ + pos] = d;
    }
  }
}

@compute @workgroup_size(1)
fn copyPrep() {
  if (ctrl.skip != 0u) {
    indirect[4] = 0u;
  } else {
    indirect[4] = (atomicLoad(&ctrl.nextLen) + 63u) / 64u;
  }
  indirect[5] = 1u;
  indirect[6] = 1u;
}

@compute @workgroup_size(64)
fn copyq(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= atomicLoad(&ctrl.nextLen)) { return; }
  dyn[off.queue + gid.x] = dyn[off.nextQ + gid.x];
}

@compute @workgroup_size(1)
fn finalize() {
  if (ctrl.skip != 0u) { return; }
  atomicAdd(&ctrl.evals, ctrl.waveLen);
  let added = atomicLoad(&ctrl.nextLen);
  atomicStore(&ctrl.qLen, added);
  atomicStore(&ctrl.nextLen, 0u);
}
`;

function bytes(count: number): number {
  return Math.max(16, count * 4);
}

function buffer(device: GPUDevice, size: number, usage: number): GPUBuffer {
  return device.createBuffer({ size: bytes(size / 4), usage });
}

/** One GPU device, reused across compiles. Null when WebGPU is missing. */
export class GpuSession {
  private layout = -1;
  private n = 0;
  private u32s!: GPUBuffer;
  private i32s!: GPUBuffer;
  private dyn!: GPUBuffer;
  private inQ!: GPUBuffer;
  private ctrl!: GPUBuffer;
  private indirect!: GPUBuffer;
  private uniform!: GPUBuffer;
  private stageDyn!: GPUBuffer;
  private stageCtrl!: GPUBuffer;
  private dynHost = new Uint32Array(0);
  private u32Host = new Uint32Array(0);
  private off = new Uint32Array(16);
  private bind!: GPUBindGroup;

  private constructor(
    private device: GPUDevice,
    private pipes: {
      prepare: GPUComputePipeline;
      eval: GPUComputePipeline;
      commit: GPUComputePipeline;
      copyPrep: GPUComputePipeline;
      copyq: GPUComputePipeline;
      finalize: GPUComputePipeline;
    },
    private layoutBGL: GPUBindGroupLayout,
  ) {}

  static async probe(): Promise<GpuSession | null> {
    const nav = globalThis.navigator;
    if (!nav?.gpu) return null;
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const module = device.createShaderModule({ code: WGSL });
    const info = await module.getCompilationInfo();
    if (info.messages.some((m) => m.type === 'error')) {
      throw new Error(info.messages.map((m) => m.message).join('\n'));
    }
    const bgl = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    const pipeline = (entryPoint: string) =>
      device.createComputePipeline({
        layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        compute: { module, entryPoint },
      });
    return new GpuSession(
      device,
      {
        prepare: pipeline('prepare'),
        eval: pipeline('eval'),
        commit: pipeline('commit'),
        copyPrep: pipeline('copyPrep'),
        copyq: pipeline('copyq'),
        finalize: pipeline('finalize'),
      },
      bgl,
    );
  }

  /** Runs waves and writes the resulting outputs and queue back into `net`. */
  async step(net: GpuNet, maxWaves: number, maxEvals: number): Promise<GpuStep> {
    const n = net.n;
    if (net.layout !== this.layout || n !== this.n) this.alloc(net);
    this.uploadDynamic(net, maxEvals);
    this.device.pushErrorScope('validation');
    const encoder = this.device.createCommandEncoder();
    const groups = Math.max(1, Math.ceil(n / 64));
    for (let w = 0; w < maxWaves; w++) {
      const prep = encoder.beginComputePass();
      prep.setPipeline(this.pipes.prepare);
      prep.setBindGroup(0, this.bind);
      prep.dispatchWorkgroups(1);
      prep.end();
      const wave = encoder.beginComputePass();
      wave.setPipeline(this.pipes.eval);
      wave.setBindGroup(0, this.bind);
      wave.dispatchWorkgroups(groups);
      wave.setPipeline(this.pipes.commit);
      wave.setBindGroup(0, this.bind);
      wave.dispatchWorkgroups(groups);
      wave.end();
      const done = encoder.beginComputePass();
      done.setPipeline(this.pipes.copyq);
      done.setBindGroup(0, this.bind);
      done.dispatchWorkgroups(groups);
      done.setPipeline(this.pipes.finalize);
      done.setBindGroup(0, this.bind);
      done.dispatchWorkgroups(1);
      done.end();
    }
    const outAt = this.off[8] * 4;
    const queueAt = this.off[10] * 4;
    encoder.copyBufferToBuffer(this.dyn, outAt, this.stageDyn, outAt, n * 4);
    encoder.copyBufferToBuffer(this.dyn, queueAt, this.stageDyn, queueAt, n * 4);
    encoder.copyBufferToBuffer(this.ctrl, 0, this.stageCtrl, 0, 32);
    this.device.queue.submit([encoder.finish()]);
    const validation = await this.device.popErrorScope();
    if (validation) throw new Error(validation.message);
    const maps = Promise.all([this.stageDyn.mapAsync(MAP_READ), this.stageCtrl.mapAsync(MAP_READ)]);
    const timed = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('GPU step timed out')), 5000));
    await Promise.race([maps, timed]);
    const dyn = new Uint32Array(this.stageDyn.getMappedRange());
    const ctrl = new Uint32Array(this.stageCtrl.getMappedRange());
    for (let i = 0; i < n; i++) net.out[i] = dyn[this.off[8] + i] ? 1 : 0;
    net.inQ.fill(0);
    const rawLen = Math.min(ctrl[0], n);
    let qLen = 0;
    for (let k = 0; k < rawLen; k++) {
      const i = dyn[this.off[10] + k];
      if (i >= n || net.inQ[i]) continue;
      net.inQ[i] = 1;
      net.queue[qLen++] = i;
    }
    const changed = ctrl[3] !== 0;
    this.stageDyn.unmap();
    this.stageCtrl.unmap();
    return { qLen, changed };
  }

  private alloc(net: GpuNet): void {
    const n = net.n;
    const inN = net.inSrc.length;
    const foN = net.fo.length;
    const destroy = (b: GPUBuffer | undefined) => b?.destroy();
    destroy(this.u32s);
    destroy(this.i32s);
    destroy(this.dyn);
    destroy(this.inQ);
    destroy(this.ctrl);
    destroy(this.indirect);
    destroy(this.uniform);
    destroy(this.stageDyn);
    destroy(this.stageCtrl);

    // u32 tables: kind[n] neg[n] inStart[n+1] foStart[n+1]
    const kindAt = 0;
    const negAt = n;
    const inAt = n * 2;
    const foAt = inAt + (n + 1);
    const u32Count = foAt + (n + 1);
    this.u32Host = new Uint32Array(u32Count);
    for (let i = 0; i < n; i++) {
      this.u32Host[kindAt + i] = net.kind[i];
      this.u32Host[negAt + i] = net.neg[i];
    }
    for (let i = 0; i <= n; i++) {
      this.u32Host[inAt + i] = net.inStart[i];
      this.u32Host[foAt + i] = net.foStart[i];
    }
    const store = USAGE_STORAGE | USAGE_COPY_DST | USAGE_COPY_SRC;
    this.u32s = buffer(this.device, u32Count * 4, store);
    this.device.queue.writeBuffer(this.u32s, 0, this.u32Host);

    const inSrcAt = 0;
    const foOff = Math.max(inN, 1);
    const i32Host = new Int32Array(foOff + Math.max(foN, 1));
    if (inN) i32Host.set(net.inSrc, inSrcAt);
    if (foN) i32Host.set(net.fo, foOff);
    this.i32s = buffer(this.device, i32Host.length * 4, store);
    this.device.queue.writeBuffer(this.i32s, 0, i32Host);

    const srcAt = 0;
    const outAt = n;
    const tmpAt = n * 2;
    const queueAt = n * 3;
    const nextAt = n * 4;
    this.off = new Uint32Array(16);
    this.off[0] = n;
    this.off[1] = kindAt;
    this.off[2] = negAt;
    this.off[3] = inAt;
    this.off[4] = foAt;
    this.off[5] = inSrcAt;
    this.off[6] = foOff;
    this.off[7] = srcAt;
    this.off[8] = outAt;
    this.off[9] = tmpAt;
    this.off[10] = queueAt;
    this.off[11] = nextAt;
    this.dynHost = new Uint32Array(n * 5);
    this.dyn = buffer(this.device, this.dynHost.length * 4, store);
    this.inQ = buffer(this.device, n * 4, store);
    this.ctrl = buffer(this.device, 32, store);
    this.indirect = buffer(this.device, 32, store | USAGE_INDIRECT);
    this.uniform = buffer(this.device, 64, USAGE_UNIFORM | USAGE_COPY_DST);
    this.device.queue.writeBuffer(this.uniform, 0, this.off);
    this.stageDyn = buffer(this.device, this.dynHost.length * 4, USAGE_MAP_READ | USAGE_COPY_DST);
    this.stageCtrl = buffer(this.device, 32, USAGE_MAP_READ | USAGE_COPY_DST);
    this.bind = this.device.createBindGroup({
      layout: this.layoutBGL,
      entries: [
        { binding: 0, resource: { buffer: this.u32s } },
        { binding: 1, resource: { buffer: this.i32s } },
        { binding: 2, resource: { buffer: this.dyn } },
        { binding: 3, resource: { buffer: this.inQ } },
        { binding: 4, resource: { buffer: this.ctrl } },
        { binding: 5, resource: { buffer: this.indirect } },
        { binding: 6, resource: { buffer: this.uniform } },
      ],
    });
    this.layout = net.layout;
    this.n = n;
  }

  private uploadDynamic(net: GpuNet, maxEvals: number): void {
    const n = net.n;
    const srcAt = this.off[7];
    const outAt = this.off[8];
    const queueAt = this.off[10];
    const dyn = this.dynHost;
    for (let i = 0; i < n; i++) {
      dyn[srcAt + i] = net.src[i];
      dyn[outAt + i] = net.out[i];
      dyn[queueAt + i] = net.queue[i];
    }
    this.device.queue.writeBuffer(this.dyn, 0, dyn);
    const inQ = new Uint32Array(n);
    for (let i = 0; i < n; i++) inQ[i] = net.inQ[i] ? 1 : 0;
    this.device.queue.writeBuffer(this.inQ, 0, inQ);
    const cap = maxEvals > 0xffff_ffff ? 0xffff_ffff : maxEvals;
    const ctrl = new Uint32Array([net.qLen, 0, 0, 0, 0, 0, cap, 0]);
    this.device.queue.writeBuffer(this.ctrl, 0, ctrl);
  }
}
