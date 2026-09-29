import { AuraPass, cameraPlace, type AuraRipple } from './auraPass';

/** Matches the toolbar goo on the main thread. The worker clock is absolute, so age does not depend on performance.now(). */
const RIPPLE_MS = 2600;

interface RippleMsg extends Omit<AuraRipple, 'age'> {
  startAbs: number;
}

interface Cam {
  x: number;
  y: number;
  zoom: number;
}

interface Live {
  cssW: number;
  cssH: number;
  building: boolean;
  show: boolean;
  /** Camera the page is showing. The stamp stays in `basis` space; placement happens on the main thread. */
  cam: Cam;
  ripple: RippleMsg | null;
}

let pass: AuraPass | null = null;
let canvas: OffscreenCanvas | null = null;
let live: Live = { cssW: 1, cssH: 1, building: false, show: false, cam: { x: 0, y: 0, zoom: 1 }, ripple: null };
/** Camera baked into the stamp. Pictures are labelled with this so the main thread can place them. */
let basis: Cam | null = null;
let painted = false;
let raf = 0;
let snapBusy = false;
let snapSeq = 0;

function rippleNow(): AuraRipple | null {
  const rip = live.ripple;
  if (!rip) return null;
  const age = (performance.timeOrigin + performance.now() - rip.startAbs) / RIPPLE_MS;
  if (age >= 1) {
    live.ripple = null;
    return null;
  }
  return {
    x: rip.x,
    y: rip.y,
    age,
    dirx: rip.dirx,
    diry: rip.diry,
    radius: rip.radius,
    color: rip.color,
    mate: rip.mate,
    bar: rip.bar,
  };
}

function paint(): void {
  if (!pass?.ok) return;
  const ripple = rippleNow();
  const active = live.show || live.building || ripple !== null;
  if (!active) {
    if (painted) {
      pass.clear();
      painted = false;
    }
    return;
  }
  pass.draw(performance.now() / 1000, {
    cssW: live.cssW,
    cssH: live.cssH,
    building: live.building,
    map: [1, 0, 0],
    place: cameraPlace(basis, live.cam),
    ripple,
  });
  painted = true;
  snapshot();
}

function snapshot(): void {
  if (!canvas || snapBusy) return;
  const from = basis ?? live.cam;
  snapBusy = true;
  const seq = ++snapSeq;
  const shot = { x: from.x, y: from.y, zoom: from.zoom };
  createImageBitmap(canvas)
    .then((bitmap) => {
      snapBusy = false;
      postMessage({ type: 'picture', bitmap, basis: shot, seq }, [bitmap]);
    })
    .catch(() => {
      snapBusy = false;
    });
}

function frame(): void {
  raf = requestAnimationFrame(frame);
  paint();
}

self.onmessage = (event: MessageEvent) => {
  const msg = event.data as {
    type: string;
    canvas?: OffscreenCanvas;
    width?: number;
    height?: number;
    cssW?: number;
    cssH?: number;
    color?: ImageBitmap;
    flow?: ImageBitmap;
    building?: boolean;
    show?: boolean;
    basis?: Cam;
    cam?: Cam;
    ripple?: RippleMsg | null;
  };
  if (msg.type === 'init' && msg.canvas) {
    const gl = msg.canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) {
      postMessage({ type: 'fail' });
      return;
    }
    canvas = msg.canvas;
    pass = new AuraPass(gl);
    if (!pass.ok) {
      postMessage({ type: 'fail' });
      return;
    }
    postMessage({ type: 'ready' });
    frame();
    return;
  }
  if (!pass) return;
  if (msg.type === 'resize') {
    pass.resize(msg.width ?? 1, msg.height ?? 1);
    live.cssW = msg.cssW ?? live.cssW;
    live.cssH = msg.cssH ?? live.cssH;
  } else if (msg.type === 'stamps' && msg.color && msg.flow) {
    pass.upload(msg.color, msg.flow);
    msg.color.close();
    msg.flow.close();
    if (msg.basis) basis = { x: msg.basis.x, y: msg.basis.y, zoom: msg.basis.zoom };
    paint();
  } else if (msg.type === 'state') {
    live.cssW = msg.cssW ?? live.cssW;
    live.cssH = msg.cssH ?? live.cssH;
    live.building = !!msg.building;
    live.show = !!msg.show;
    if (msg.cam) live.cam = { x: msg.cam.x, y: msg.cam.y, zoom: msg.cam.zoom };
    live.ripple = msg.ripple ?? null;
    paint();
  } else if (msg.type === 'stop') {
    cancelAnimationFrame(raf);
    pass.dispose();
    pass = null;
  }
};
