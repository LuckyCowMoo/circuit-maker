import type { Editor, PlaceKind } from './Editor';
import { boxInBox, componentInBox, signalKeys } from '../model/doc';
import {
  componentBounds,
  CABLE_PITCH,
  curveBounds,
  inflate,
  pointInRect,
  rectsOverlap,
  rotatedSize,
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

void main() {
  vec4 halo = texture(uHalo, vUv);
  vec3 flow = texture(uFlow, vUv).rgb;
  float envelope = flow.g;
  float strength = flow.b;
  float band = step(0.04, strength) * step(0.02, envelope);
  float innerM = step(0.75, flow.r);
  float outerM = band * (1.0 - innerM);
  float t = uTime;
  vec2 css = vec2(vUv.x, 1.0 - vUv.y) * uCss;
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
  float wave = max(mO, mI) * envelope * strength;
  vec3 col = cOuter * mO + cInner * mI;

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

/** Screen-pixel width of the old outer stroke. Half of this is the old reach past the outline. */
function bandWidth(screen: number): number {
  const t = Math.max(0, Math.min(1, screen / 48));
  return 2 + 16 * t;
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
    this.colorCtx = this.colorCanvas.getContext('2d');
    this.flowCtx = this.flowCanvas.getContext('2d');
    if (!this.colorCtx || !this.flowCtx || !this.link(gl)) return;
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
      const size = rotatedSize(c);
      const screen = Math.min(size.w, size.h) * zoom;
      const rgb = c.kind === 'marker' ? vividAura(ed.theme, c.color ?? ed.theme.marker, c.id) : kindAura(ed.theme, c.kind === 'port' && c.inputs > 1 ? 'ribbon-port' : c.kind, c.id);
      this.paintLocal(xformOf(c), cachedPath(componentOutline(c)), rgb, bandWidth(screen), selected ? 1 : 0.5);
    }

    for (const b of ed.doc.boxes.values()) {
      if (!ed.selection.has(b.id)) continue;
      if (!rectsOverlap(b, view)) continue;
      if (covered.some((o) => o !== b && boxInBox(b, o))) continue;
      const screen = Math.min(b.w, b.h) * zoom;
      this.paintWorld(roundRectD(b.x, b.y, b.w, b.h, 8), vividAura(ed.theme, b.color ?? ed.theme.box, b.id), bandWidth(screen), 1);
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
    const zoomT = Math.max(0, Math.min(1, zoom / 0.55));
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
      const hole = 1.6 + 2.2 * zoomT;
      const outer = hole + 4 + 10 * zoomT;
      this.paintCurve(curve, rgb, outer, hole, 1);
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
      const body = Math.max(1.6 + 2.2 * zoomT, n * CABLE_PITCH * zoom);
      const outer = body + 4 + 10 * zoomT;
      this.paintCurve(curve, rgb, outer, Math.max(1.5, body - 1), 1);
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

  private setLocal(m: Xf): void {
    const { wx, wy, tx, ty } = this.view;
    this.both((ctx) => ctx.setTransform(wx * m.a, wy * m.b, wx * m.c, wy * m.d, wx * m.e + tx, wy * m.f + ty));
  }

  private setWorld(): void {
    const { wx, wy, tx, ty } = this.view;
    this.both((ctx) => ctx.setTransform(wx, 0, 0, wy, tx, ty));
  }

  private setCss(): void {
    const { s } = this.view;
    this.both((ctx) => ctx.setTransform(s, 0, 0, s, 0, 0));
  }

  /**
   * Full strength at the outline, fading to nothing at three times the previous reach,
   * so the middle of the falloff sits at 1.5× the old maximum distance.
   * `holePx` is the wire body; parts pass 0 and the silhouette is the edge.
   */
  private strokeBands(path: Path2D, rgb: Rgb, outerPx: number, strength: number, zoomDiv: number, holePx = 0): void {
    const c = this.colorCtx!;
    const f = this.flowCtx!;
    const oldReach = Math.max(0.5, (outerPx - holePx) / 2);
    const far = oldReach * 3;
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

  private eraseStroke(path: Path2D, widthPx: number, zoomDiv: number): void {
    this.both((ctx) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = widthPx / zoomDiv;
      ctx.stroke(path);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  private paintLocal(m: Xf, path: Path2D, rgb: Rgb, outer: number, strength: number): void {
    this.setLocal(m);
    this.strokeBands(path, rgb, outer, strength, this.view.zoom);
    this.eraseFill(path);
  }

  private paintWorld(d: string, rgb: Rgb, outer: number, strength: number): void {
    const path = new Path2D(d);
    this.setWorld();
    this.strokeBands(path, rgb, outer, strength, this.view.zoom);
    this.eraseFill(path);
  }

  private paintCss(r: DOMRect, radius: number, rgb: Rgb, outer: number, strength: number): void {
    const rad = Math.min(radius, r.width / 2, r.height / 2);
    const path = new Path2D(roundRectD(r.x, r.y, r.width, r.height, rad));
    this.setCss();
    this.strokeBands(path, rgb, outer, strength, 1);
    this.eraseFill(path);
  }

  private paintCurve(curve: WireCurve, rgb: Rgb, outer: number, hole: number, strength: number): void {
    const path = curvePath(curve);
    this.setWorld();
    this.strokeBands(path, rgb, outer, strength, this.view.zoom, hole);
    this.eraseStroke(path, hole, this.view.zoom);
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
