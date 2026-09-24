import { describe, expect, it } from 'vitest';
import { docToText, parseCircuit } from '../io/format';
import { emptyDoc, makeComponent } from './doc';
import { attachPos, pinPos, RIBBON_PITCH } from './geometry';
import { cableConnectedPorts, normalizePorts, placePort, portHasSideWiring, setPortWidth } from './ports';
import { componentOps } from './shapes';
import { DEFAULT_THEME } from './themes';
import { bundleDest, bundleInput, bundleOutput, bundleSource } from './types';

describe('ribbon ports', () => {
  it('keeps lane pins spaced and the plug centred after re-seat', () => {
    const doc = emptyDoc();
    const box = { id: 'b1', x: 0, y: 0, w: 200, h: 200, name: 'Box', color: null };
    doc.boxes.set(box.id, box);
    const port = makeComponent('port', 0, 0, 'p1');
    port.box = box.id;
    port.placed = true;
    port.inputs = 1;
    doc.components.set(port.id, port);
    placePort(doc, port, box, { x: 0, y: 100 }, true);

    setPortWidth(doc, port, 3);
    expect(port.inputs).toBe(3);
    expect(port.plug).toBe('in');

    const plug = pinPos(port, 0)!;
    const lanes = [pinPos(port, -1)!, pinPos(port, -2)!, pinPos(port, -3)!];
    expect(plug.y).toBeCloseTo(100, 5);
    expect(attachPos(port, 0)!.y).toBeCloseTo(100, 5);
    expect(lanes[1].y).toBeCloseTo(100, 5);
    expect(lanes[0].y).toBeCloseTo(lanes[1].y - RIBBON_PITCH, 5);
    expect(lanes[2].y).toBeCloseTo(lanes[1].y + RIBBON_PITCH, 5);
    expect(new Set(lanes.map((p) => `${p.x},${p.y}`)).size).toBe(3);
  });

  it('treats any multi-lane port as a cable endpoint', () => {
    const a = makeComponent('port', 0, 0, 'a');
    a.inputs = 3;
    a.plug = 'out';
    const b = makeComponent('port', 0, 0, 'b');
    b.inputs = 3;
    b.plug = 'in';
    expect(bundleSource(a)).toBe(true);
    expect(bundleDest(b)).toBe(true);
  });

  it('draws the same centred cable face and spaced wire pins used for hit testing', () => {
    const port = makeComponent('port', 0, 0, 'p');
    port.inputs = 4;
    port.inputBundle = true;
    port.outputBundle = false;
    const ops = componentOps(port, DEFAULT_THEME, { active: false, mask: '' });
    const paths = ops.filter((op) => op.t === 'path').map((op) => op.d);
    expect(paths).toContain('M22 8H42');
    expect(paths).toContain('M22 24H42');
    expect(paths).toContain('M22 40H42');
    expect(paths).toContain('M22 56H42');
    expect(paths.some((d) => d.startsWith('M-21 27H-19'))).toBe(true);
  });

  it('hides the cable drag handle once that face is connected', () => {
    const port = makeComponent('port', 0, 0, 'p');
    port.inputs = 4;
    port.inputBundle = true;
    port.outputBundle = true;
    const free = componentOps(port, DEFAULT_THEME, { active: false, mask: '' })
      .filter((op) => op.t === 'path')
      .map((op) => op.d);
    expect(free.some((d) => d.startsWith('M-21 27H-19'))).toBe(true);
    expect(free.some((d) => d.startsWith('M41 27H43'))).toBe(true);
    expect(free).toContain('M-20 32H0');
    expect(free).toContain('M22 32H42');

    // mask: 4 output bits then 4 input bits; cable uses output lane 0 and input 0.
    const wired = componentOps(port, DEFAULT_THEME, { active: false, mask: '10001000' })
      .filter((op) => op.t === 'path')
      .map((op) => op.d);
    expect(wired.some((d) => d.startsWith('M-21 27H-19'))).toBe(false);
    expect(wired.some((d) => d.startsWith('M41 27H43'))).toBe(false);
    expect(wired).not.toContain('M-20 32H0');
    expect(wired).not.toContain('M22 32H42');
  });

  it('allows cable or lane pins independently on either face', () => {
    const port = makeComponent('port', 0, 0, 'p');
    port.inputs = 4;
    port.inputBundle = true;
    port.outputBundle = true;
    expect(bundleInput(port)).toBe(true);
    expect(bundleOutput(port)).toBe(true);
    expect(pinPos(port, 0)!.y).toBe(32);
    expect(pinPos(port, -1)!.y).toBe(32);

    port.inputBundle = false;
    port.outputBundle = false;
    expect(pinPos(port, 0)!.y).toBe(8);
    expect(pinPos(port, 3)!.y).toBe(56);
    expect(pinPos(port, -1)!.y).toBe(8);
    expect(pinPos(port, -4)!.y).toBe(56);
  });

  it('keeps connected wires attached to component bodies when free stubs disappear', () => {
    const sw = makeComponent('switch', 10, 20, 's');
    expect(pinPos(sw, -1)!.x).toBe(70);
    expect(attachPos(sw, -1)!.x).toBe(50);
    const bulb = makeComponent('bulb', 100, 20, 'b');
    expect(pinPos(bulb, 0)!.x).toBe(80);
    expect(attachPos(bulb, 0)!.x).toBe(103);
  });

  it('uses three spaced RGB wire pins or one centred cable socket', () => {
    const rgb = makeComponent('rgb', 100, 20, 'rgb');
    expect([0, 1, 2].map((pin) => pinPos(rgb, pin))).toEqual([
      { x: 80, y: 30 },
      { x: 80, y: 40 },
      { x: 80, y: 50 },
    ]);
    const attach = [0, 1, 2].map((pin) => attachPos(rgb, pin)!);
    expect(attach[1]).toEqual({ x: 103, y: 40 });
    // R and B meet the circle further right than the mid-height tangent.
    expect(attach[0].x).toBeGreaterThan(attach[1].x);
    expect(attach[2].x).toBeGreaterThan(attach[1].x);
    expect(attach[0].x).toBeCloseTo(attach[2].x, 5);
    expect(attach[0].y).toBe(30);
    expect(attach[2].y).toBe(50);

    rgb.inputBundle = true;
    expect(pinPos(rgb, 0)).toEqual({ x: 80, y: 40 });
    expect(attachPos(rgb, 0)).toEqual({ x: 103, y: 40 });
    expect(pinPos(rgb, 1)).toBeNull();
    expect(pinPos(rgb, 2)).toBeNull();
  });

  it('normalises and round-trips wired free ports with independent face modes', () => {
    const doc = emptyDoc();
    const a = makeComponent('port', 0, 0, 'a');
    Object.assign(a, { inputs: 4, placed: true, inputBundle: false, outputBundle: true });
    const b = makeComponent('port', 100, 0, 'b');
    Object.assign(b, { inputs: 4, placed: true, inputBundle: true, outputBundle: true });
    doc.components.set(a.id, a);
    doc.components.set(b.id, b);
    doc.wires.set('w', { id: 'w', from: a.id, to: b.id, input: 0, cable: true });
    expect(() => normalizePorts(doc)).not.toThrow();
    const parsed = parseCircuit(docToText(doc));
    expect(parsed.warnings).toEqual([]);
    expect(bundleInput(parsed.doc.components.get('b')!)).toBe(true);
    expect(bundleOutput(parsed.doc.components.get('b')!)).toBe(true);
  });

  it('finds ports linked by a ribbon cable', () => {
    const doc = emptyDoc();
    const a = makeComponent('port', 0, 0, 'a');
    a.inputs = 4;
    a.plug = 'out';
    a.placed = true;
    const b = makeComponent('port', 80, 0, 'b');
    b.inputs = 4;
    b.plug = 'in';
    b.placed = true;
    doc.components.set(a.id, a);
    doc.components.set(b.id, b);
    doc.wires.set('w1', { id: 'w1', from: a.id, to: b.id, input: 0, cable: true });
    const peers = cableConnectedPorts(doc, a).map((c) => c.id).sort();
    expect(peers).toEqual(['a', 'b']);
    expect(portHasSideWiring(doc, b)).toBe(false);
  });
});
