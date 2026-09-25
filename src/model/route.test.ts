import { describe, expect, it } from 'vitest';
import { curvePoint, pointInRect } from './geometry';
import { emptyDoc, makeComponent } from './doc';
import { avoidMap, bendAround, routeSeed, routedWire } from './route';

const RIGHT = { x: 1, y: 0 };
const LEFT = { x: -1, y: 0 };

function crosses(rect: { x: number; y: number; w: number; h: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const curve = bendAround(a, RIGHT, b, LEFT, [rect]);
  for (let i = 1; i < 20; i++) {
    const p = curvePoint(curve, i / 20);
    const near = Math.hypot(p.x - a.x, p.y - a.y) < 16 || Math.hypot(p.x - b.x, p.y - b.y) < 16;
    if (!near && pointInRect(p, rect)) return true;
  }
  return false;
}

describe('wire routing', () => {
  it('keeps a clear run as a plain curve', () => {
    const curve = bendAround({ x: 0, y: 0 }, RIGHT, { x: 200, y: 0 }, LEFT, []);
    expect(curve.tail).toBeUndefined();
    expect(curve.b).toEqual({ x: 200, y: 0 });
  });

  it('bends around a box sitting on the straight run', () => {
    const box = { x: 80, y: -30, w: 80, h: 60 };
    expect(crosses(box, { x: 0, y: 0 }, { x: 240, y: 0 })).toBe(false);
    expect(crosses(box, { x: 0, y: 0 }, { x: 1600, y: 0 })).toBe(false);
  });

  it('bends a long wire more gently than a short one past the same obstacle', () => {
    const box = { x: 400, y: -30, w: 80, h: 60 };
    const rise = (span: number) => {
      const curve = bendAround({ x: 0, y: 0 }, RIGHT, { x: span, y: 0 }, LEFT, [box]);
      let peak = 0;
      for (let i = 1; i < 24; i++) peak = Math.max(peak, Math.abs(curvePoint(curve, i / 24).y));
      return peak / span;
    };
    expect(rise(700)).toBeGreaterThan(0.04);
    expect(rise(2200)).toBeGreaterThan(0.015);
    expect(rise(2200)).toBeLessThan(rise(700));
    const far = bendAround({ x: 0, y: 0 }, RIGHT, { x: 2200, y: 0 }, LEFT, [box]);
    let peak = 0;
    for (let i = 1; i < 32; i++) peak = Math.max(peak, Math.abs(curvePoint(far, i / 32).y));
    expect(peak).toBeLessThan(90);
    const low = { x: 700, y: -20, w: 120, h: 220 };
    const over = bendAround({ x: 0, y: 0 }, RIGHT, { x: 1600, y: 0 }, LEFT, [low]);
    let lowPeak = 0;
    for (let i = 1; i < 32; i++) lowPeak = Math.max(lowPeak, Math.abs(curvePoint(over, i / 32).y));
    expect(lowPeak).toBeLessThan(50);
    expect(crosses(low, { x: 0, y: 0 }, { x: 1600, y: 0 })).toBe(false);
    expect(crosses(box, { x: 0, y: 0 }, { x: 2200, y: 0 })).toBe(false);
  });

  it('goes over one obstacle and under the next when that is shorter', () => {
    const left = { x: 70, y: -24, w: 80, h: 280 };
    const right = { x: 360, y: -200, w: 80, h: 230 };
    const curve = bendAround({ x: 0, y: 0 }, RIGHT, { x: 620, y: 0 }, LEFT, [left, right]);
    let overLeft = false;
    let underRight = false;
    for (let i = 1; i < 48; i++) {
      const p = curvePoint(curve, i / 48);
      const near = Math.hypot(p.x, p.y) < 16 || Math.hypot(p.x - 620, p.y) < 16;
      if (!near) {
        expect(pointInRect(p, left)).toBe(false);
        expect(pointInRect(p, right)).toBe(false);
      }
      if (p.x > 80 && p.x < 140 && p.y < -24) overLeft = true;
      if (p.x > 370 && p.x < 430 && p.y > 30) underRight = true;
    }
    expect(overLeft).toBe(true);
    expect(underRight).toBe(true);
  });
  it('does not wrap a further corner when the pin is already clear', () => {
    const box = { x: 100, y: 40, w: 140, h: 180 };
    const a = { x: 270, y: -20 };
    const b = { x: box.x + box.w, y: 110 };
    const curve = bendAround(a, { x: 0, y: 1 }, b, { x: 1, y: 0 }, [box]);
    let low = -Infinity;
    for (let i = 0; i <= 32; i++) {
      const p = curvePoint(curve, i / 32);
      low = Math.max(low, p.y);
      const near = Math.hypot(p.x - a.x, p.y - a.y) < 16 || Math.hypot(p.x - b.x, p.y - b.y) < 16;
      if (!near) expect(pointInRect(p, box)).toBe(false);
    }
    expect(low).toBeLessThan(box.y + box.h);
  });

  it('tucks every corner in when full clearance still hits the next object', () => {
    const mid = { x: 90, y: -20, w: 40, h: 40 };
    const above = { x: 70, y: -55, w: 80, h: 22 };
    const below = { x: 70, y: 33, w: 80, h: 22 };
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 0 };
    const curve = bendAround(a, RIGHT, b, LEFT, [mid, above, below]);
    for (let i = 1; i < 36; i++) {
      const p = curvePoint(curve, i / 36);
      const near = Math.hypot(p.x - a.x, p.y - a.y) < 16 || Math.hypot(p.x - b.x, p.y - b.y) < 16;
      if (near) continue;
      expect(pointInRect(p, mid)).toBe(false);
      expect(pointInRect(p, above)).toBe(false);
      expect(pointInRect(p, below)).toBe(false);
    }
  });

  it('spreads wires that share a corner so their bend points differ', () => {
    const box = { x: 80, y: -40, w: 100, h: 80 };
    const a = { x: 0, y: 0 };
    const b = { x: 280, y: 0 };
    const samples = (seed: number) => {
      const curve = bendAround(a, RIGHT, b, LEFT, [box], seed);
      const pts = [];
      for (let i = 1; i < 40; i++) {
        const p = curvePoint(curve, i / 40);
        if (p.x > 70 && p.x < 190) pts.push(p);
      }
      return pts;
    };
    const paths = ['d', 'e', 'f', 'g'].map((id) => samples(routeSeed('s', id, 0, 0)));
    expect(paths[0].length).toBeGreaterThan(3);
    let separated = 0;
    for (let n = 1; n < paths.length; n++) {
      for (let i = 0; i < paths[0].length; i++) {
        separated = Math.max(separated, Math.hypot(paths[0][i].x - paths[n][i].x, paths[0][i].y - paths[n][i].y));
      }
    }
    expect(separated).toBeGreaterThan(2);
    expect(separated).toBeLessThan(20);
    for (const path of paths) for (const p of path) expect(pointInRect(p, box)).toBe(false);
  });

  it('leaves a wire inside its own box alone and still avoids a part in the way', () => {
    const doc = emptyDoc();
    doc.boxes.set('box', { id: 'box', name: 'Box', x: 0, y: 0, w: 400, h: 200, color: null });
    const src = makeComponent('switch', 20, 80, 's');
    const dst = makeComponent('bulb', 300, 80, 'd');
    const mid = makeComponent('and', 150, 70, 'g');
    doc.components.set(src.id, src);
    doc.components.set(dst.id, dst);
    doc.components.set(mid.id, mid);
    const curve = routedWire(avoidMap(doc), src, dst, 0, 0, 8);
    expect(curve).not.toBeNull();
    let hitGate = false;
    const body = { x: mid.x, y: mid.y, w: 60, h: 40 };
    for (let i = 2; i < 18; i++) {
      if (pointInRect(curvePoint(curve!, i / 20), body)) hitGate = true;
    }
    expect(hitGate).toBe(false);
  });

  it('draws square wires on axis and separates ones that share a run', () => {
    const doc = emptyDoc();
    const src = makeComponent('switch', 0, 80, 's');
    const up = makeComponent('bulb', 360, 0, 'u');
    const down = makeComponent('bulb', 360, 160, 'd');
    doc.components.set(src.id, src);
    doc.components.set(up.id, up);
    doc.components.set(down.id, down);
    doc.wires.set('w1', { id: 'w1', from: src.id, to: up.id, input: 0 });
    doc.wires.set('w2', { id: 'w2', from: src.id, to: down.id, input: 0 });
    const map = avoidMap(doc);
    const top = routedWire(map, src, up, 0, 0, 10, 'square')!;
    const bot = routedWire(map, src, down, 0, 0, 10, 'square')!;
    const corners = (curve: NonNullable<typeof top>) => {
      const pts = [curve.a, curve.b];
      for (const s of curve.tail ?? []) pts.push(s.b);
      return pts;
    };
    const axis = (pts: { x: number; y: number }[]) => {
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.abs(pts[i].x - pts[i - 1].x);
        const dy = Math.abs(pts[i].y - pts[i - 1].y);
        expect(dx < 0.6 || dy < 0.6).toBe(true);
      }
    };
    const a = corners(top);
    const b = corners(bot);
    axis(a);
    axis(b);
    expect(a.length).toBeLessThanOrEqual(6);
    expect(b.length).toBeLessThanOrEqual(6);
    const ys = [...a, ...b].map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(8);
  });

  it('keeps a cable curved when square mode is on', () => {
    const doc = emptyDoc();
    const src = makeComponent('port', 0, 0, 's');
    const dst = makeComponent('port', 200, 80, 'd');
    src.inputs = 4;
    dst.inputs = 4;
    src.outputBundle = true;
    dst.inputBundle = true;
    doc.components.set(src.id, src);
    doc.components.set(dst.id, dst);
    const curve = routedWire(avoidMap(doc), src, dst, 0, 0, 16, 'square', true)!;
    const pts = [curve.a, curve.b, ...(curve.tail ?? []).map((s) => s.b)];
    const diagonal = pts.some((p, i) => i > 0 && Math.abs(p.x - pts[i - 1].x) > 1 && Math.abs(p.y - pts[i - 1].y) > 1);
    expect(diagonal).toBe(true);
  });
});
