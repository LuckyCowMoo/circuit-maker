import type { Editor, PlaceKind } from './Editor';
import { boxInBox, componentInBox, signalKeys } from '../model/doc';
import {
  componentBounds,
  CABLE_PITCH,
  curveBounds,
  geomFor,
  inflate,
  pointInRect,
  rectsOverlap,
  localSize,
  xformOf,
  type WireCurve,
  type Xf,
} from '../model/geometry';
import { floatsAboveBoxes } from '../model/parts';
import { avoidMap, routedWire } from '../model/route';
import { componentOutline, roundRectD } from '../model/shapes';
import { accentAura, kindAura, parseRgb, vividAura, wireColors, type Rgb } from '../model/themes';
import type { Box, Component, Rect } from '../model/types';
import { isInput, laneCount } from '../model/types';

/** How long the toolbar drag-out ripple stays up. */
const RIPPLE_MS = 700;

/**
 * How far a part's wave can reach past its outline, as a fraction of its smaller side.
 * The visible edge sits inside this. 0.13 puts that edge about a tenth of the body out,
 * matching the switch reference.
 */
const WAVE_REACH = 0.13;

/** Twice a 2-input AND's current wave, so smaller parts don't shrink below that. */
const AND2 = geomFor('and', 2, false);
const MIN_WAVE_REACH = WAVE_REACH * Math.min(AND2.tip, AND2.h) * 2;

/** Wire sleeve, past the drawn stroke, in multiples of that stroke's width. One layer only. */
const WIRE_SLEEVE = 2.4;

function partReach(w: number, h: number): number {
  return Math.max(MIN_WAVE_REACH, WAVE_REACH * Math.min(w, h));
}

export interface PlaceRipple {
  /** Viewport point on the top edge of the toolbar where the part left. */
  x: number;
  y: number;
  t0: number;
  kind: PlaceKind;
}

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uHalo;
uniform sampler2D uFlow;
uniform sampler2D uNoise;
uniform float uTime;
uniform vec2 uCss;
uniform vec4 uRipple;
uniform vec3 uRippleColor;
uniform vec4 uBar;

vec3 hueShift(vec3 c, float rad) {
  float s = sin(rad);
  float co = cos(rad);
  vec3 k = vec3(0.57735027);
  return clamp(c * co + cross(k, c) * s + k * dot(k, c) * (1.0 - co), 0.0, 1.0);
}

/** Hue shift that keeps the colour saturated, so a red gate's partner stays a bright orange. */
vec3 vividShift(vec3 c, float rad) {
  vec3 shifted = hueShift(c, rad);
  float l = dot(shifted, vec3(0.299, 0.587, 0.114));
  return clamp(l + (shifted - l) * 1.9, 0.0, 1.0);
}

void main() {
  vec4 halo = texture(uHalo, vUv);
  vec3 flow = texture(uFlow, vUv).rgb;
  float strength = flow.b;
  float t = uTime;
  vec2 css = vec2(vUv.x, 1.0 - vUv.y) * uCss;
  // Two-layer parts store red at half of blue. One-layer wires store red at a quarter. Opacity auras store 0 or 1.
  float two = step(0.03, strength) * step(abs(flow.r * 2.0 - strength), 0.12);
  float one = step(0.03, strength) * step(abs(flow.r * 4.0 - strength), 0.12);
  float nOuter = texture(uNoise, css * 0.0018 + vec2(t * 0.04, t * 0.024)).r;
  float nInner = texture(uNoise, css * 0.0018 - vec2(t * 0.032, t * 0.02) + 7.1).r;
  float wGate = min(max(fwidth(nOuter), fwidth(nInner)), 0.05);
  float wave = 0.0;
  vec3 col = vec3(0.0);
  if (two + one > 0.5) {
    // Edge pixels are blended toward black, which would otherwise look like a mid distance and draw a ring.
    float dist = clamp(flow.g / strength, 0.0, 1.0);
    float cOuter = smoothstep(0.2, 1.0, dist) * 1.02;
    float aOuter = smoothstep(cOuter - wGate, cOuter, nOuter);
    float gain = clamp(strength, 0.0, 1.0);
    if (one > two) {
      wave = aOuter * gain;
      col = halo.rgb;
    } else {
      float cInner = smoothstep(0.05, 0.55, dist) * 1.02;
      float aInner = smoothstep(cInner - wGate, cInner, nInner);
      vec3 top = vividShift(halo.rgb, 0.66);
      wave = (aInner + aOuter * (1.0 - aInner)) * gain;
      col = (top * aInner + halo.rgb * aOuter * (1.0 - aInner)) / max(wave, 0.001);
    }
  } else {
    float envelope = flow.g;
    float band = step(0.04, strength) * step(0.02, envelope);
    float innerM = step(0.75, flow.r);
    float outerM = band * (1.0 - innerM);
    float n1 = texture(uNoise, css * 0.00092 + vec2(t * 0.012, t * 0.007)).r;
    float n2 = texture(uNoise, css * 0.00145 - vec2(t * 0.02, t * 0.011) + 9.2).r;
    float dye = texture(uNoise, css * 0.0013 + vec2(t * 0.008, 4.0)).r;
    float showO = step(0.5, n1);
    float showI = step(0.52, n2);
    vec3 base = halo.rgb;
    vec3 cOuter = mix(hueShift(base, 0.2), vec3(1.0), 0.12 + 0.28 * dye);
    vec3 cInner = mix(hueShift(base, -0.16), vec3(1.0), 0.08 * dye);
    float mO = outerM * showO;
    float mI = innerM * showI;
    wave = max(mO, mI) * envelope * strength;
    col = cOuter * mO + cInner * mI;
  }

  float rip = 0.0;
  if (uRipple.w > 0.5) {
    float age = clamp(uRipple.z, 0.0, 1.0);
    float fade = pow(1.0 - age, 1.2);
    float dist = abs(css.x - uRipple.x);
    float spread = mix(48.0, max(uBar.z * 0.85, 120.0), smoothstep(0.0, 0.8, age));
    float reach = exp(-dist * dist / (spread * spread * 0.7));
    float above = max(0.0, uRipple.y - css.y);
    float rise = mix(10.0, 64.0, age);
    float plume = exp(-dist * dist / 980.0) * exp(-above * above / (rise * rise));
    float fromTop = css.y - uBar.y;
    float inX = smoothstep(uBar.x - 10.0, uBar.x, css.x) * (1.0 - smoothstep(uBar.x + uBar.z, uBar.x + uBar.z + 10.0, css.x));
    float inBar = inX * step(-2.0, fromTop) * step(fromTop, uBar.w + 2.0);
    float edge = exp(-fromTop * fromTop / 220.0);
    float along = inBar * reach * edge;
    float rn = step(0.48, texture(uNoise, vec2(css.x * 0.0035 - age * 1.6, 0.17)).r);
    rip = (plume * 1.25 + along * 1.7) * fade * rn;
  }

  float alpha = wave;
  if (rip > 0.004) {
    float sum = min(1.0, alpha + rip);
    col = (col * alpha + uRippleColor * rip) / max(sum, 0.001);
    alpha = sum;
  }
  outColor = vec4(col * alpha, alpha);
}`;

interface View {
  wx: number;
  wy: number;
  tx: number;
  ty: number;
  s: number;
  zoom: number;
}

interface RippleDraw {
  x: number;
  y: number;
  age: number;
  color: Rgb;
  bar: DOMRect;
}

const outlineCache = new Map<string, Path2D>();
function cachedPath(d: string): Path2D {
  let p = outlineCache.get(d);
  if (!p) outlineCache.set(d, (p = new Path2D(d)));
  return p;
}

function curvePath(curve: WireCurve): Path2D {
  const p = new Path2D();
  p.moveTo(curve.a.x, curve.a.y);
  p.bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.b.x, curve.b.y);
  for (const s of curve.tail ?? []) p.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.b.x, s.b.y);
  return p;
}

/** 2 = a part's two layers, 1 = a wire's single layer, 0 = anything else. */
function waveLayer(r: number, b: number, a: number): number {
  if (b < 8 || a < 16) return 0;
  if (Math.abs(r * 2 - b) < 40) return 2;
  if (Math.abs(r * 4 - b) < 40) return 1;
  return 0;
}

function componentAura(ed: Editor, c: Component): Rgb {
  if (isInput(c.kind)) {
    const root = ed.parts.roots.get(c.id) ?? c.id;
    return parseRgb(wireColors(root, ed.theme).on) ?? kindAura(ed.theme, c.kind, c.id);
  }
  if (c.kind === 'marker') return vividAura(ed.theme, c.color ?? ed.theme.marker, c.id);
  const kind = c.kind === 'port' && c.inputs > 1 ? 'ribbon-port' : c.kind;
  return kindAura(ed.theme, kind, c.id);
}

/** Drawn width of a selected signal wire, in world units. Matches the scene stroke. */
function wireCore(zoom: number, dpr: number): number {
  if (zoom < 0.3) return 1 / (zoom * Math.max(dpr, 1));
  return Math.max(3, 1.5 / zoom);
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
}


function toolbarEl(): Element | null {
  return document.querySelector('.tb-row .toolbar:not(.tb-measure)');
}

function liveRect(sel: string): DOMRect | null {
  const root = toolbarEl();
  const el = root?.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2 ? r : null;
}

function placeRect(): DOMRect | null {
  return liveRect('[data-aura-place]') ?? liveRect('[data-aura-armed]');
}

function toastRect(): DOMRect | null {
  const el = document.querySelector('[data-aura-toast]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 2 && r.height > 2 ? r : null;
}

function domSig(ed: Editor): string {
  const pack = (r: DOMRect | null) => (r ? `${r.x.toFixed(0)},${r.y.toFixed(0)},${r.width.toFixed(0)},${r.height.toFixed(0)}` : '');
  const building = ed.toastMessage?.startsWith('Building ') ? pack(toastRect()) : '';
  return `${ed.placing ?? ''}|${pack(placeRect())}|${building}`;
}

function noiseBytes(): Uint8Array {
  const n = 16;
  const size = 256;
  const data = new Uint8Array(size * size);
  const hash = (ix: number, iy: number) => {
    const x = ((ix % n) + n) % n;
    const y = ((iy % n) + n) % n;
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const value = (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = smooth(x - x0);
    const fy = smooth(y - y0);
    const v00 = hash(x0, y0);
    const v10 = hash(x0 + 1, y0);
    const v01 = hash(x0, y0 + 1);
    const v11 = hash(x0 + 1, y0 + 1);
    return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) data[y * size + x] = Math.round(value((x / size) * n, (y / size) * n) * 255);
  }
  return data;
}

function partHidden(ed: Editor, c: Component, covered: Box[]): boolean {
  if (!covered.length) return false;
  if (c.kind === 'port') {
    const own = c.box ? ed.doc.boxes.get(c.box) : undefined;
    if (!own) return false;
    return covered.some((b) => b !== own && boxInBox(own, b));
  }
  if (floatsAboveBoxes(c)) return false;
  return covered.some((b) => componentInBox(ed.doc, c, b));
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Screen-space selection aura. One static noise texture scrolls through a half-resolution
 * stamp of every highlighted outline, so many selections still cost a single composite.
 */
export class AuraOverlay {
  ok = false;
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private haloTex: WebGLTexture | null = null;
  private flowTex: WebGLTexture | null = null;
  private noiseTex: WebGLTexture | null = null;
  private loc: {
    uTime: WebGLUniformLocation | null;
    uCss: WebGLUniformLocation | null;
    uRipple: WebGLUniformLocation | null;
    uRippleColor: WebGLUniformLocation | null;
    uBar: WebGLUniformLocation | null;
  } = { uTime: null, uCss: null, uRipple: null, uRippleColor: null, uBar: null };
  private colorCanvas = document.createElement('canvas');
  private flowCanvas = document.createElement('canvas');
  private colorCtx: CanvasRenderingContext2D | null = null;
  private flowCtx: CanvasRenderingContext2D | null = null;
  /** One gate's distance field, merged into the stamp so a neighbour cannot overwrite it. */
  private gateColor = document.createElement('canvas');
  private gateFlow = document.createElement('canvas');
  private gateColorCtx: CanvasRenderingContext2D | null = null;
  private gateFlowCtx: CanvasRenderingContext2D | null = null;
  private view: View = { wx: 1, wy: 1, tx: 0, ty: 0, s: 1, zoom: 1 };
  private stampW = 1;
  private stampH = 1;
  private hasStamp = false;
  private shown = false;
  private sizeDirty = true;
  private domSig = '';

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (!gl) return;
    this.colorCtx = this.colorCanvas.getContext('2d', { willReadFrequently: true });
    this.flowCtx = this.flowCanvas.getContext('2d', { willReadFrequently: true });
    this.gateColorCtx = this.gateColor.getContext('2d', { willReadFrequently: true });
    this.gateFlowCtx = this.gateFlow.getContext('2d', { willReadFrequently: true });
    if (!this.colorCtx || !this.flowCtx || !this.gateColorCtx || !this.gateFlowCtx || !this.link(gl)) return;
    this.gl = gl;
    this.ok = true;
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    if (!this.gl) return;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.sizeDirty = true;
    }
  }

  frame(ed: Editor, now: number, sceneDrawn: boolean): void {
    if (!this.ok || !this.gl || !this.colorCtx) return;
    const ripple = this.rippleOf(ed, now);
    const dom = domSig(ed);
    const rebuild = sceneDrawn || this.sizeDirty || dom !== this.domSig;
    if (rebuild) {
      this.domSig = dom;
      this.sizeDirty = false;
      this.rebuild(ed);
    }
    if (!this.hasStamp && !ripple) {
      if (this.shown) this.clearGl();
      this.shown = false;
      return;
    }
    if (rebuild) this.upload();
    this.draw(ed, now, ripple);
    this.shown = true;
  }

  dispose(): void {
    this.ok = false;
    this.gl = null;
  }

  private link(gl: WebGL2RenderingContext): boolean {
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const prog = gl.createProgram();
    if (!prog) return false;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn(gl.getProgramInfoLog(prog));
      return false;
    }
    this.prog = prog;
    const vao = gl.createVertexArray();
    const buf = gl.createBuffer();
    const halo = gl.createTexture();
    const flow = gl.createTexture();
    const noise = gl.createTexture();
    if (!vao || !buf || !halo || !flow || !noise) return false;
    this.vao = vao;
    this.haloTex = halo;
    this.flowTex = flow;
    this.noiseTex = noise;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const at = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(at);
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const blank = (tex: WebGLTexture, pixel: Uint8Array) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    };
    blank(halo, new Uint8Array([0, 0, 0, 0]));
    blank(flow, new Uint8Array([128, 128, 0, 255]));
    gl.bindTexture(gl.TEXTURE_2D, noise);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, 256, 0, gl.RED, gl.UNSIGNED_BYTE, noiseBytes());

    gl.useProgram(prog);
    gl.uniform1i(gl.getUniformLocation(prog, 'uHalo'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'uFlow'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'uNoise'), 2);
    this.loc = {
      uTime: gl.getUniformLocation(prog, 'uTime'),
      uCss: gl.getUniformLocation(prog, 'uCss'),
      uRipple: gl.getUniformLocation(prog, 'uRipple'),
      uRippleColor: gl.getUniformLocation(prog, 'uRippleColor'),
      uBar: gl.getUniformLocation(prog, 'uBar'),
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }

  private rippleOf(ed: Editor, now: number): RippleDraw | null {
    const rip = ed.placeRipple;
    if (!rip) return null;
    const age = (now - rip.t0) / RIPPLE_MS;
    if (age >= 1) {
      ed.placeRipple = null;
      return null;
    }
    const bar = toolbarEl()?.getBoundingClientRect();
    if (!bar || bar.width < 2) return null;
    return { x: rip.x, y: rip.y, age, color: kindAura(ed.theme, rip.kind), bar };
  }

  private ensureStamp(cssW: number, cssH: number, dpr: number): boolean {
    const dw = Math.max(1, Math.round(cssW * dpr));
    const dh = Math.max(1, Math.round(cssH * dpr));
    let sw = Math.max(1, Math.round(dw / 2));
    let sh = Math.max(1, Math.round(dh / 2));
    const cap = 1400;
    const m = Math.max(sw, sh);
    if (m > cap) {
      sw = Math.max(1, Math.round((sw * cap) / m));
      sh = Math.max(1, Math.round((sh * cap) / m));
    }
    if (this.colorCanvas.width !== sw || this.colorCanvas.height !== sh) {
      this.colorCanvas.width = sw;
      this.colorCanvas.height = sh;
      this.flowCanvas.width = sw;
      this.flowCanvas.height = sh;
    }
    this.stampW = sw;
    this.stampH = sh;
    return true;
  }

  private rebuild(ed: Editor): void {
    this.hasStamp = false;
    const cssW = ed.width;
    const cssH = ed.height;
    if (cssW < 2 || cssH < 2 || !this.colorCtx || !this.flowCtx) return;
    this.ensureStamp(cssW, cssH, ed.dpr);
    const s = this.stampW / cssW;
    const zoom = ed.cam.zoom || 1;
    this.view = {
      wx: zoom * s,
      wy: zoom * s,
      tx: -ed.cam.x * zoom * s,
      ty: -ed.cam.y * zoom * s,
      s,
      zoom,
    };
    this.clearStamp();
    const view = inflate(ed.viewRect, 40 / zoom);
    const covered: Box[] = [];
    for (const b of ed.doc.boxes.values()) if ((ed.boxT.get(b.id) ?? 1) < 0.02) covered.push(b);

    for (const c of ed.doc.components.values()) {
      const selected = ed.selection.has(c.id);
      const powered = !selected && isInput(c.kind) && ed.isActive(c);
      if (!selected && !powered) continue;
      if (!rectsOverlap(componentBounds(c), view)) continue;
      if (partHidden(ed, c, covered)) continue;
      const local = localSize(c);
      const reach = partReach(local.w, local.h);
      this.paintLocalField(
        xformOf(c),
        cachedPath(componentOutline(c)),
        componentAura(ed, c),
        reach,
        selected ? 1 : 0.5,
        local.w,
        local.h,
        c.kind === 'note',
      );
    }

    for (const b of ed.doc.boxes.values()) {
      if (!ed.selection.has(b.id)) continue;
      if (!rectsOverlap(b, view)) continue;
      if (covered.some((o) => o !== b && boxInBox(b, o))) continue;
      const reach = partReach(b.w, b.h);
      this.paintWorldField(
        cachedPath(roundRectD(b.x, b.y, b.w, b.h, 8)),
        vividAura(ed.theme, b.color ?? ed.theme.box, b.id),
        reach,
        0,
        1,
        'two',
        b,
        true,
      );
    }

    this.paintWires(ed, covered, view);

    if (ed.placing) {
      const rect = placeRect();
      if (rect) this.paintCss(rect, 10, kindAura(ed.theme, ed.placing), 18, 0.35);
    }
    if (ed.toastMessage?.startsWith('Building ')) {
      const rect = toastRect();
      if (rect) this.paintCss(rect, 10, accentAura(ed.theme), 22, 1);
    }
  }

  private paintWires(ed: Editor, covered: Box[], view: Rect): void {
    let picked = false;
    for (const id of ed.selection) {
      if (ed.doc.wires.has(id)) {
        picked = true;
        break;
      }
    }
    if (!picked) return;
    const doc = ed.doc;
    const signals = signalKeys(doc);
    const laneKey = (id: string, lane = 0) => (lane ? `${id}#${lane}` : id);
    const nets = new Set<string>();
    for (const id of ed.selection) {
      const w = doc.wires.get(id);
      const src = w && doc.components.get(w.from);
      if (!w || !src) continue;
      const n = w.cable ? laneCount(src) : 1;
      for (let i = 0; i < n; i++) {
        const lane = w.cable ? i : (w.lane ?? 0);
        nets.add(signals.get(laneKey(w.from, lane)) ?? laneKey(w.from, lane));
      }
    }
    const onNet = (from: string, lane: number) => nets.has(signals.get(laneKey(from, lane)) ?? laneKey(from, lane));
    const map = ed.routeMap ?? avoidMap(doc);
    const zoom = this.view.zoom;
    const core = wireCore(zoom, ed.dpr);
    for (const w of doc.wires.values()) {
      if (w.cable) continue;
      if (!onNet(w.from, w.lane ?? 0)) continue;
      const a = doc.components.get(w.from);
      const b = doc.components.get(w.to);
      if (!a || !b) continue;
      const curve = routedWire(map, a, b, w.input, w.lane ?? 0, 10, ed.wireStyle);
      if (!curve) continue;
      if (!rectsOverlap(inflate(curveBounds(curve), 8), view)) continue;
      if (covered.length && covered.some((bx) => pointInRect(curve.a, bx) && pointInRect(curve.b, bx))) continue;
      const srcKey = w.lane ? `${w.from}#${w.lane}` : w.from;
      const rgb = parseRgb(wireColors(ed.parts.roots.get(srcKey) ?? w.from, ed.theme).on);
      if (!rgb) continue;
      this.paintWireField(curve, rgb, core);
    }
    for (const w of doc.wires.values()) {
      if (!w.cable) continue;
      const a = doc.components.get(w.from);
      const b = doc.components.get(w.to);
      if (!a || !b) continue;
      const n = Math.min(laneCount(a), laneCount(b));
      let hit = -1;
      for (let i = 0; i < n; i++) if (onNet(w.from, i)) {
        hit = i;
        break;
      }
      if (hit < 0) continue;
      const curve = routedWire(map, a, b, 0, 0, n * CABLE_PITCH * 0.5 + 8, ed.wireStyle, true);
      if (!curve) continue;
      if (!rectsOverlap(inflate(curveBounds(curve), n * CABLE_PITCH), view)) continue;
      const key = hit ? `${w.from}#${hit}` : w.from;
      const rgb = parseRgb(wireColors(ed.parts.roots.get(key) ?? w.from, ed.theme).on);
      if (!rgb) continue;
      this.paintWireField(curve, rgb, n * CABLE_PITCH + 0.8);
    }
  }

  private clearStamp(): void {
    const c = this.colorCtx!;
    const f = this.flowCtx!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    f.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    f.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    f.globalAlpha = 1;
    c.clearRect(0, 0, this.stampW, this.stampH);
    f.fillStyle = '#000';
    f.fillRect(0, 0, this.stampW, this.stampH);
    for (const ctx of [c, f]) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
    }
  }

  private both(fn: (ctx: CanvasRenderingContext2D) => void): void {
    fn(this.colorCtx!);
    fn(this.flowCtx!);
  }

  private setCss(): void {
    const { s } = this.view;
    this.both((ctx) => ctx.setTransform(s, 0, 0, s, 0, 0));
  }

  /**
   * Full strength at the outline, then a smooth falloff.
   * The fade runs out to 5× the previous reach: a smoothstep's amplitude-weighted
   * middle sits at 30% of that span, which is 1.5× the old maximum distance.
   * `holePx` is the wire body; parts pass 0 and the silhouette is the edge.
   */
  private strokeBands(path: Path2D, rgb: Rgb, outerPx: number, strength: number, zoomDiv: number, holePx = 0): void {
    const c = this.colorCtx!;
    const f = this.flowCtx!;
    const oldReach = Math.max(0.5, (outerPx - holePx) / 2);
    const far = oldReach * 5;
    const edge0 = holePx / 2;
    const blue = Math.round(strength * 255);
    const steps = 12;
    c.strokeStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    c.globalAlpha = 1;
    f.globalAlpha = 1;
    for (let i = steps; i >= 1; i--) {
      const dist = (i / steps) * far;
      const env = 1 - smoothstep(0, far, dist);
      const lw = ((edge0 + dist) * 2) / zoomDiv;
      c.lineWidth = lw;
      c.stroke(path);
      const layer = dist <= oldReach * 1.5 ? 255 : 0;
      f.strokeStyle = `rgb(${layer},${Math.round(env * 255)},${blue})`;
      f.lineWidth = lw;
      f.stroke(path);
    }
    this.hasStamp = true;
  }

  private eraseFill(path: Path2D): void {
    this.both((ctx) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.fill(path);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  /**
   * Distance measured in the part's own units, so zooming scales the wave with the part.
   * 0 on the outline, 1 at `reach` past it. Two layers store red at half of blue; a wire's single layer stores a quarter.
   * Notes and boxes are hollow so the wave stays outside the shape. Each field is merged by the closer outline.
   */
  private paintLocalField(
    m: Xf,
    path: Path2D,
    rgb: Rgb,
    reach: number,
    strength: number,
    bodyW: number,
    bodyH: number,
    hollow: boolean,
  ): void {
    const pad = reach * 1.2 + 16;
    const rect = this.gateStampRect(m, bodyW, bodyH, pad);
    if (!rect) return;
    this.prepareScratch(rect.w, rect.h);
    const { wx, wy, tx, ty } = this.view;
    const place = (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(wx * m.a, wy * m.b, wx * m.c, wy * m.d, wx * m.e + tx - rect.x, wy * m.f + ty - rect.y);
      this.readyStroke(ctx);
    };
    this.strokeField(place, path, rgb, reach, 0, strength, 'two', hollow);
    this.keepCloserField(rect);
    this.hasStamp = true;
  }

  private paintWorldField(
    path: Path2D,
    rgb: Rgb,
    reach: number,
    inner: number,
    strength: number,
    mode: 'one' | 'two',
    bounds: Rect,
    hollow: boolean,
  ): void {
    const pad = reach * 1.2 + inner + 4;
    const rect = this.worldStampRect(bounds, pad);
    if (!rect) return;
    this.prepareScratch(rect.w, rect.h);
    const { wx, wy, tx, ty } = this.view;
    const place = (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(wx, 0, 0, wy, tx - rect.x, ty - rect.y);
      this.readyStroke(ctx);
    };
    this.strokeField(place, path, rgb, reach, inner, strength, mode, hollow);
    this.keepCloserField(rect);
    this.hasStamp = true;
  }

  private paintWireField(curve: WireCurve, rgb: Rgb, core: number): void {
    const reach = Math.max(core, 0.5) * WIRE_SLEEVE;
    this.paintWorldField(curvePath(curve), rgb, reach, core / 2, 0.5, 'one', curveBounds(curve), false);
  }

  /** Stamp-space bounds of a local body expanded by `pad` world units. */
  private gateStampRect(m: Xf, bodyW: number, bodyH: number, pad: number): { x: number; y: number; w: number; h: number } | null {
    const { wx, wy, tx, ty } = this.view;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const px of [-pad, bodyW + pad]) {
      for (const py of [-pad, bodyH + pad]) {
        const x = wx * (m.a * px + m.c * py + m.e) + tx;
        const y = wy * (m.b * px + m.d * py + m.f) + ty;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    const x0 = Math.max(0, Math.floor(minX) - 2);
    const y0 = Math.max(0, Math.floor(minY) - 2);
    const x1 = Math.min(this.stampW, Math.ceil(maxX) + 2);
    const y1 = Math.min(this.stampH, Math.ceil(maxY) + 2);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  private prepareScratch(w: number, h: number): void {
    const gc = this.gateColorCtx!;
    const gf = this.gateFlowCtx!;
    if (this.gateColor.width !== w || this.gateColor.height !== h) {
      this.gateColor.width = w;
      this.gateColor.height = h;
      this.gateFlow.width = w;
      this.gateFlow.height = h;
    } else {
      gc.setTransform(1, 0, 0, 1, 0, 0);
      gf.setTransform(1, 0, 0, 1, 0, 0);
      gc.clearRect(0, 0, w, h);
      gf.clearRect(0, 0, w, h);
    }
  }

  private readyStroke(ctx: CanvasRenderingContext2D): void {
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
  }

  /** Stamp-space bounds of a world rectangle expanded by `pad` world units. */
  private worldStampRect(b: Rect, pad: number): { x: number; y: number; w: number; h: number } | null {
    const { wx, wy, tx, ty } = this.view;
    const minX = wx * (b.x - pad) + tx;
    const minY = wy * (b.y - pad) + ty;
    const maxX = wx * (b.x + b.w + pad) + tx;
    const maxY = wy * (b.y + b.h + pad) + ty;
    const x0 = Math.max(0, Math.floor(Math.min(minX, maxX)) - 2);
    const y0 = Math.max(0, Math.floor(Math.min(minY, maxY)) - 2);
    const x1 = Math.min(this.stampW, Math.ceil(Math.max(minX, maxX)) + 2);
    const y1 = Math.min(this.stampH, Math.ceil(Math.max(minY, maxY)) + 2);
    if (x1 - x0 < 1 || y1 - y0 < 1) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * `reach` and `inner` are in the same units as the current transform (local units, or world units).
   * The stroke is centered, so a reach of R extends R past the path. `inner` is the wire's half-width:
   * distance 0 starts at the wire edge, then the core is punched out.
   */
  private strokeField(
    place: (ctx: CanvasRenderingContext2D) => void,
    path: Path2D,
    rgb: Rgb,
    reach: number,
    inner: number,
    strength: number,
    mode: 'one' | 'two',
    hollow: boolean,
  ): void {
    const c = this.gateColorCtx!;
    const f = this.gateFlowCtx!;
    place(c);
    place(f);
    const span = Math.max(reach, 0.5) * this.view.zoom * this.view.s;
    const steps = Math.max(8, Math.min(48, Math.round(span)));
    const blue = Math.round(Math.max(0, Math.min(1, strength)) * 255);
    const red = Math.round(blue / (mode === 'one' ? 4 : 2));
    const colour = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    c.strokeStyle = colour;
    c.fillStyle = colour;
    const shell = (inner + reach * 1.12) * 2;
    c.lineWidth = shell;
    c.stroke(path);
    f.strokeStyle = `rgb(${red},${blue},${blue})`;
    f.lineWidth = shell;
    f.stroke(path);
    for (let i = steps; i >= 1; i--) {
      const dist = i / steps;
      const lw = (inner + dist * reach) * 2;
      c.lineWidth = lw;
      c.stroke(path);
      f.strokeStyle = `rgb(${red},${Math.round(dist * blue)},${blue})`;
      f.lineWidth = lw;
      f.stroke(path);
    }
    if (!hollow && inner <= 0) {
      c.fill(path);
      f.fillStyle = `rgb(${red},0,${blue})`;
      f.fill(path);
    }
    if (hollow) {
      c.globalCompositeOperation = 'destination-out';
      f.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
      f.fillStyle = '#000';
      c.fill(path);
      f.fill(path);
    } else if (inner > 0) {
      const hole = inner * 2;
      c.globalCompositeOperation = 'destination-out';
      f.globalCompositeOperation = 'destination-out';
      c.lineWidth = hole;
      f.lineWidth = hole;
      c.stroke(path);
      f.stroke(path);
    }
    c.globalCompositeOperation = 'source-over';
    f.globalCompositeOperation = 'source-over';
  }

  /** Parts stay above wires. Same kind of field keeps whichever outline is closer. */
  private keepCloserField(rect: { x: number; y: number; w: number; h: number }): void {
    const srcC = this.gateColorCtx!.getImageData(0, 0, rect.w, rect.h);
    const srcF = this.gateFlowCtx!.getImageData(0, 0, rect.w, rect.h);
    const dstC = this.colorCtx!.getImageData(rect.x, rect.y, rect.w, rect.h);
    const dstF = this.flowCtx!.getImageData(rect.x, rect.y, rect.w, rect.h);
    const sc = srcC.data;
    const sf = srcF.data;
    const dc = dstC.data;
    const df = dstF.data;
    for (let i = 0; i < sf.length; i += 4) {
      const srcL = waveLayer(sf[i], sf[i + 2], sf[i + 3]);
      if (!srcL) continue;
      const sb = sf[i + 2];
      const db = df[i + 2];
      const dstL = waveLayer(df[i], db, df[i + 3]);
      if (dstL > srcL) continue;
      if (dstL === srcL && sf[i + 1] / sb >= df[i + 1] / db) continue;
      df[i] = sf[i];
      df[i + 1] = sf[i + 1];
      df[i + 2] = sf[i + 2];
      df[i + 3] = sf[i + 3];
      dc[i] = sc[i];
      dc[i + 1] = sc[i + 1];
      dc[i + 2] = sc[i + 2];
      dc[i + 3] = sc[i + 3];
    }
    this.flowCtx!.putImageData(dstF, rect.x, rect.y);
    this.colorCtx!.putImageData(dstC, rect.x, rect.y);
  }

  private paintCss(r: DOMRect, radius: number, rgb: Rgb, outer: number, strength: number): void {
    const rad = Math.min(radius, r.width / 2, r.height / 2);
    const path = new Path2D(roundRectD(r.x, r.y, r.width, r.height, rad));
    this.setCss();
    this.strokeBands(path, rgb, outer, strength, 1);
    this.eraseFill(path);
  }

  private upload(): void {
    const gl = this.gl;
    if (!gl || !this.haloTex || !this.flowTex) return;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.haloTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.colorCanvas);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.flowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.flowCanvas);
  }

  private clearGl(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private draw(ed: Editor, now: number, ripple: RippleDraw | null): void {
    const gl = this.gl;
    if (!gl || !this.prog || !this.vao) return;
    gl.useProgram(this.prog);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.haloTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.flowTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.uniform1f(this.loc.uTime, now / 1000);
    gl.uniform2f(this.loc.uCss, ed.width, ed.height);
    if (ripple) {
      gl.uniform4f(this.loc.uRipple, ripple.x, ripple.y, ripple.age, 1);
      gl.uniform3f(this.loc.uRippleColor, ripple.color.r / 255, ripple.color.g / 255, ripple.color.b / 255);
      gl.uniform4f(this.loc.uBar, ripple.bar.x, ripple.bar.y, ripple.bar.width, ripple.bar.height);
    } else {
      gl.uniform4f(this.loc.uRipple, 0, 0, 0, 0);
      gl.uniform3f(this.loc.uRippleColor, 0, 0, 0);
      gl.uniform4f(this.loc.uBar, 0, 0, 1, 1);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
