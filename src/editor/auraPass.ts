/** WebGL composite for the selection waves. Safe to construct on a worker thread. */

export interface AuraRipple {
  x: number;
  y: number;
  age: number;
  dirx: number;
  diry: number;
  /** Exit speed, CSS pixels per millisecond. */
  speed: number;
  radius: number;
  color: [number, number, number];
  mate: [number, number, number];
  bar: [number, number, number, number];
}

export interface AuraDraw {
  cssW: number;
  cssH: number;
  building: boolean;
  /** Selection distance field. Off leaves a toolbar ripple without painting a stale stamp. */
  field: boolean;
  /** zoomRatio, panX, panY. Slides a stamp drawn for an older camera onto the current one. */
  map: [number, number, number];
  /**
   * scale, translateX, translateY. Screen position of a stamp pixel after the picture is placed.
   * Ripple and the building circle are drawn so they land on the screen once that place is applied.
   */
  place: [number, number, number];
  ripple: AuraRipple | null;
}

/** How a picture drawn for `from` has to sit to look like `to`. Scale, then translate, origin top-left. */
export function cameraPlace(
  from: { x: number; y: number; zoom: number } | null,
  to: { x: number; y: number; zoom: number },
): [number, number, number] {
  if (!from) return [1, 0, 0];
  const zoom = to.zoom || 1;
  const s = zoom / (from.zoom || 1);
  return [s, -(to.x - from.x) * zoom, -(to.y - from.y) * zoom];
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
uniform vec4 uRippleDir;
uniform vec3 uRippleColor;
uniform vec3 uRippleMate;
uniform vec4 uBar;
uniform float uBuild;
uniform float uField;
uniform vec3 uMap;
uniform vec3 uPlace;

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

vec3 spectrum(float h) {
  vec3 k = fract(vec3(h) + vec3(1.0, 0.667, 0.333));
  return clamp(abs(k * 6.0 - 3.0) - 1.0, 0.0, 1.0);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

/** Clockwise arc length from the left end of the top edge. p is relative to the centre, y down. */
float roundBoxArc(vec2 p, vec2 b, float r) {
  float ix = max(b.x - r, 0.0);
  float iy = max(b.y - r, 0.0);
  float arcLen = 1.5707963 * r;
  float top = ix * 2.0;
  float side = iy * 2.0;
  vec2 ap = abs(p);
  if (ap.x > ix && ap.y > iy) {
    vec2 sp = vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
    vec2 c = vec2(ix, iy) * sp;
    float ang = atan(p.y - c.y, p.x - c.x);
    float t;
    float base;
    if (sp.x > 0.0 && sp.y < 0.0) {
      t = clamp((ang + 1.5707963) / 1.5707963, 0.0, 1.0);
      base = top;
    } else if (sp.x > 0.0 && sp.y > 0.0) {
      t = clamp(ang / 1.5707963, 0.0, 1.0);
      base = top + arcLen + side;
    } else if (sp.x < 0.0 && sp.y > 0.0) {
      t = clamp((ang - 1.5707963) / 1.5707963, 0.0, 1.0);
      base = top * 2.0 + side + arcLen * 2.0;
    } else {
      t = clamp((ang + 3.14159265) / 1.5707963, 0.0, 1.0);
      base = top * 2.0 + side * 2.0 + arcLen * 3.0;
    }
    return base + t * arcLen;
  }
  if ((b.x - ap.x) < (b.y - ap.y)) {
    if (p.x >= 0.0) return top + arcLen + (clamp(p.y, -iy, iy) + iy);
    return top * 2.0 + side + arcLen * 3.0 + (iy - clamp(p.y, -iy, iy));
  }
  if (p.y <= 0.0) return clamp(p.x, -ix, ix) + ix;
  return top + arcLen * 2.0 + side + (ix - clamp(p.x, -ix, ix));
}

/**
 * Solid bump standing on the outline. The crest is the graph of a rounded hump, so the
 * sides settle flat onto the toolbar instead of meeting it on a steep wall.
 * curve 0 is a sharper tip; curve 1 is a broad smooth crown.
 */
float waveRand(float id, float seed) {
  return fract(sin(seed + id * 12.9898) * 43758.5453);
}

/** Distance along the outline. A shorter wave starts slower. Drag time still varies a little on its own. */
float paced(float pace, float size) {
  return mix(1.0, pace, mix(0.15, 1.0, size));
}

float waveRun(float id, float seed, float sim, float size) {
  float tauR = 0.12;
  float tau = 0.7 * mix(0.82, 1.18, waveRand(id + 4.0, seed));
  float v = 2000.0 * mix(0.2, 1.22, size);
  return v * (tau * (1.0 - exp(-sim / tau)) - tauR * (1.0 - exp(-sim / tauR)));
}

float gooPacket(float pixelArc, float waveArc, float peri, float sd, float sigma, float reach, float shear, float curve) {
  float along = mod(pixelArc - waveArc + peri * 0.5, peri) - peri * 0.5;
  float lift = clamp(max(sd, 0.0) / max(reach, 1.0), 0.0, 1.15);
  float leaned = along - shear * (0.62 * lift + 0.38 * lift * lift);
  float u = abs(leaned) / max(sigma, 1.0);
  float tip = mix(1.35, 3.15, curve);
  float cap = exp(-pow(u, tip));
  float skirt = exp(-u * u * 0.62);
  float height = reach * (0.74 * cap + 0.26 * skirt);
  float gap = sd - height;
  return exp(-max(gap, 0.0) / 5.0);
}

void main() {
  vec2 css = vec2(vUv.x, 1.0 - vUv.y) * uCss;
  // Where this stamp pixel will land once the picture is placed on the current camera.
  vec2 screen = css * uPlace.x + uPlace.yz;
  // Stamp pixels are from the camera that drew them. Slide that picture onto this frame's camera.
  vec2 stamped = css / max(uCss, vec2(1.0)) * uMap.x + uMap.yz;
  vec2 suv = vec2(stamped.x, 1.0 - stamped.y);
  float inside = step(0.0, stamped.x) * step(stamped.x, 1.0) * step(0.0, stamped.y) * step(stamped.y, 1.0);
  vec4 halo = texture(uHalo, suv) * inside;
  vec3 flow = texture(uFlow, suv).rgb * inside;
  float strength = flow.b;
  float t = uTime;
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
  vec3 ripCol = vec3(0.0);
  if (uRipple.w > 0.5 && uBar.z > 2.0 && uBar.w > 2.0) {
    // Seconds since the exit. Volume climbs out of the bar, runs the outline under drag,
    // then shrinks and sinks back under the toolbar.
    float sim = clamp(uRipple.z, 0.0, 1.0) * 3.2;
    vec2 halfB = vec2(uBar.z, uBar.w) * 0.5;
    float rad = min(max(uRippleDir.z, 1.0), max(min(halfB.x, halfB.y) - 0.75, 1.0));
    vec2 center = vec2(uBar.x, uBar.y) + halfB;
    vec2 rel = screen - center;
    float sd = sdRoundBox(rel, halfB, rad);
    if (sd < 460.0 && sd > -8.0) {
      float ix = max(halfB.x - rad, 0.0);
      float iy = max(halfB.y - rad, 0.0);
      float arcLen = 1.5707963 * rad;
      float top = ix * 2.0;
      float side = iy * 2.0;
      float P = top * 2.0 + side * 2.0 + arcLen * 4.0;
      vec2 exitP = vec2(clamp(uRipple.x, uBar.x, uBar.x + uBar.z), uBar.y) - center;
      float pixelArc = mod(roundBoxArc(rel, halfB, rad) - roundBoxArc(exitP, halfB, rad) + P, P);

      float emerge = 1.0 - exp(-sim * 18.0);
      // Pixels per millisecond. A slow leave stays small; a flick grows the bulge.
      float haste = clamp(uRippleDir.w, 0.0, 8.0);
      float pace = clamp(haste / 1.15, 0.0, 5.0);
      float burst = mix(0.28, 2.05, 1.0 - exp(-pace));
      float curve = 1.0 - exp(-sim * 0.38);
      float reach = 56.0 * burst * emerge * exp(-sim * 0.36);
      float sigma = 92.0 * burst * mix(1.0, 1.32, curve);
      float submerge = 38.0 * burst * (1.0 - exp(-sim * 0.32));
      float seed = uRipple.x + uRippleDir.x * 40.0;

      // Signed horizontal pointer speed, CSS pixels per millisecond.
      float horiz = clamp(uRippleDir.x, -1.0, 1.0) * haste;
      float shear = horiz * reach * 0.18 * emerge * exp(-sim * 0.55);
      float sideSign = horiz < -0.08 ? -1.0 : 1.0;
      float slip = horiz * 5.0 * emerge * exp(-sim * 1.1);
      float push = horiz * 0.32;
      float posPace = clamp(1.0 + push, 0.4, 1.9);
      float negPace = clamp(1.0 - push, 0.4, 1.9);
      float head = max(sideSign * slip, 0.0);
      float headPos = sideSign > 0.0 ? head : 0.0;
      float headNeg = sideSign < 0.0 ? head : 0.0;
      float gap = 32.0;

      float n = texture(uNoise, screen * 0.00038 + vec2(t * 0.007, t * 0.004)).r;
      float n2 = texture(uNoise, screen * 0.00022 - vec2(t * 0.004, t * 0.003) + 2.2).r;
      float jag = (n - 0.5) * 0.65 + (n2 - 0.5) * 0.35;
      float sdN = sd + submerge - jag * 5.0;

      float narrow = sigma * 0.7;
      float r1 = waveRand(1.0, seed);
      float r2 = waveRand(2.0, seed);
      float r3 = waveRand(3.0, seed);
      float r4 = waveRand(4.0, seed);
      // Same-colour crests stop when they meet, instead of crossing the far side and being cut off.
      float run1 = headPos + waveRun(1.0, seed, sim, r1) * paced(posPace, r1);
      float run3 = headNeg + waveRun(3.0, seed, sim, r3) * paced(negPace, r3);
      float fitB = min(1.0, P / max(run1 + run3, 1.0));
      run1 *= fitB;
      run3 *= fitB;
      float run2 = headPos + gap + waveRun(2.0, seed, sim, r2) * paced(posPace, r2);
      float run4 = headNeg + gap + waveRun(4.0, seed, sim, r4) * paced(negPace, r4);
      float fitM = min(1.0, P / max(run2 + run4, 1.0));
      run2 *= fitM;
      run4 *= fitM;
      float fBase = max(
        gooPacket(pixelArc, run1, P, sdN, narrow * mix(0.92, 1.08, r1), reach * mix(0.82, 1.22, r1), shear, curve),
        gooPacket(pixelArc, -run3, P, sdN, narrow * mix(0.92, 1.08, r3), reach * mix(0.82, 1.22, r3), shear, curve)
      );
      float fMate = max(
        gooPacket(pixelArc, run2, P, sdN, narrow * 0.94 * mix(0.92, 1.08, r2), reach * mix(0.82, 1.22, r2), shear, curve),
        gooPacket(pixelArc, -run4, P, sdN, narrow * 0.94 * mix(0.92, 1.08, r4), reach * mix(0.82, 1.22, r4), shear, curve)
      );
      float cover = max(fBase, fMate) * smoothstep(-2.0, 0.0, sd);
      float aa = clamp(fwidth(cover), 0.012, 0.055);
      rip = smoothstep(0.48 - aa, 0.48 + aa, cover);
      float split = smoothstep(-0.05, 0.05, fMate - fBase);
      ripCol = mix(uRippleColor, uRippleMate, split);
    }
  }

  wave *= uField;
  float alpha = wave;
  if (rip > 0.004) {
    float sum = min(1.0, alpha + rip);
    col = (col * alpha + ripCol * rip) / max(sum, 0.001);
    alpha = sum;
  }
  if (uBuild > 0.5) {
    // Five layers of the same cutoff noise as a selected part, stacked around a circle.
    vec2 mid = uCss * 0.5;
    float d = length(screen - mid);
    float hole = clamp(min(uCss.x, uCss.y) * 0.11, 70.0, 140.0);
    float reach = min(uCss.x, uCss.y) * 0.26;
    float span = d - hole;
    float rim = smoothstep(0.0, 1.5, span);
    float acc = 0.0;
    vec3 bc = vec3(0.0);
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float along = fi / 4.0;
      float ri = reach * mix(1.0, 0.48, along);
      float dist = clamp(span / ri, 0.0, 1.0);
      vec2 scroll = mix(vec2(t * 0.04, t * 0.024), -vec2(t * 0.032, t * 0.02), mod(fi, 2.0));
      float n = texture(uNoise, screen * 0.0018 + scroll + fi * 3.7).r;
      float cutoff = smoothstep(mix(0.2, 0.05, along), mix(1.0, 0.55, along), dist) * 1.02;
      float a = smoothstep(cutoff - wGate, cutoff, n) * rim;
      float sum = a + acc * (1.0 - a);
      bc = (spectrum(fi * 0.2) * a + bc * acc * (1.0 - a)) / max(sum, 0.001);
      acc = sum;
    }
    float sum = min(1.0, alpha + acc);
    col = (col * alpha + bc * acc) / max(sum, 0.001);
    alpha = sum;
  }
  outColor = vec4(col * alpha, alpha);
}`;

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

function canvasSource(src: TexImageSource): TexImageSource {
  if (typeof ImageBitmap === 'undefined' || !(src instanceof ImageBitmap)) return src;
  const c = new OffscreenCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  if (!ctx) return src;
  ctx.drawImage(src, 0, 0);
  return c;
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

/** One fullscreen pass. The clock that drives uTime belongs to whoever calls draw. */
export class AuraPass {
  ok = false;
  private prog: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private haloTex: WebGLTexture | null = null;
  private flowTex: WebGLTexture | null = null;
  private noiseTex: WebGLTexture | null = null;
  private loc: {
    uTime: WebGLUniformLocation | null;
    uCss: WebGLUniformLocation | null;
    uRipple: WebGLUniformLocation | null;
    uRippleDir: WebGLUniformLocation | null;
    uRippleColor: WebGLUniformLocation | null;
    uRippleMate: WebGLUniformLocation | null;
    uBar: WebGLUniformLocation | null;
    uBuild: WebGLUniformLocation | null;
    uField: WebGLUniformLocation | null;
    uMap: WebGLUniformLocation | null;
    uPlace: WebGLUniformLocation | null;
  } = {
    uTime: null,
    uCss: null,
    uRipple: null,
    uRippleDir: null,
    uRippleColor: null,
    uRippleMate: null,
    uBar: null,
    uBuild: null,
    uField: null,
    uMap: null,
    uPlace: null,
  };

  constructor(private gl: WebGL2RenderingContext) {
    this.ok = this.link();
  }

  resize(width: number, height: number): void {
    const canvas = this.gl.canvas;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  upload(color: TexImageSource, flow: TexImageSource): void {
    const gl = this.gl;
    if (!this.haloTex || !this.flowTex) return;
    // ImageBitmap ignores the canvas orientation this flip was written for, so the
    // stamp lands mirrored. Blit it onto a canvas first and upload that.
    const colorSrc = canvasSource(color);
    const flowSrc = canvasSource(flow);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.haloTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, colorSrc);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.flowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flowSrc);
  }

  /** Drop the selection distance field so a later ripple cannot replay a deleted part. */
  clearField(): void {
    const gl = this.gl;
    if (!this.haloTex || !this.flowTex) return;
    const blank = (tex: WebGLTexture, pixel: Uint8Array) => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    };
    blank(this.haloTex, new Uint8Array([0, 0, 0, 0]));
    blank(this.flowTex, new Uint8Array([0, 0, 0, 255]));
  }

  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  draw(timeSec: number, state: AuraDraw): void {
    const gl = this.gl;
    if (!this.prog || !this.vao) return;
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
    gl.uniform1f(this.loc.uTime, timeSec);
    gl.uniform2f(this.loc.uCss, state.cssW, state.cssH);
    gl.uniform3f(this.loc.uMap, state.map[0], state.map[1], state.map[2]);
    gl.uniform3f(this.loc.uPlace, state.place[0], state.place[1], state.place[2]);
    gl.uniform1f(this.loc.uBuild, state.building ? 1 : 0);
    gl.uniform1f(this.loc.uField, state.field ? 1 : 0);
    const ripple = state.ripple;
    if (ripple) {
      gl.uniform4f(this.loc.uRipple, ripple.x, ripple.y, ripple.age, 1);
      gl.uniform4f(this.loc.uRippleDir, ripple.dirx, ripple.diry, ripple.radius, ripple.speed);
      gl.uniform3f(this.loc.uRippleColor, ripple.color[0], ripple.color[1], ripple.color[2]);
      gl.uniform3f(this.loc.uRippleMate, ripple.mate[0], ripple.mate[1], ripple.mate[2]);
      gl.uniform4f(this.loc.uBar, ripple.bar[0], ripple.bar[1], ripple.bar[2], ripple.bar[3]);
    } else {
      gl.uniform4f(this.loc.uRipple, 0, 0, 0, 0);
      gl.uniform4f(this.loc.uRippleDir, 0, -1, 16, 0);
      gl.uniform3f(this.loc.uRippleColor, 0, 0, 0);
      gl.uniform3f(this.loc.uRippleMate, 0, 0, 0);
      gl.uniform4f(this.loc.uBar, 0, 0, 1, 1);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.prog) gl.deleteProgram(this.prog);
    this.prog = null;
    this.ok = false;
  }

  private link(): boolean {
    const gl = this.gl;
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
      uRippleDir: gl.getUniformLocation(prog, 'uRippleDir'),
      uRippleColor: gl.getUniformLocation(prog, 'uRippleColor'),
      uRippleMate: gl.getUniformLocation(prog, 'uRippleMate'),
      uBar: gl.getUniformLocation(prog, 'uBar'),
      uBuild: gl.getUniformLocation(prog, 'uBuild'),
      uField: gl.getUniformLocation(prog, 'uField'),
      uMap: gl.getUniformLocation(prog, 'uMap'),
      uPlace: gl.getUniformLocation(prog, 'uPlace'),
    };
    gl.uniform3f(this.loc.uMap, 1, 0, 0);
    gl.uniform3f(this.loc.uPlace, 1, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return true;
  }
}
