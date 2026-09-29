import { describe, expect, it } from 'vitest';
import { emptyDoc, findFreeSpot, liveChannels, makeComponent, signalKeys } from './doc';
import { rectInside, rectsOverlap } from './geometry';

describe('findFreeSpot', () => {
  it('returns the rect unchanged when it is already free', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 };
    expect(findFreeSpot(r, [{ x: 500, y: 500, w: 10, h: 10 }])).toEqual(r);
  });

  it('moves past obstacles to the nearest side', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 };
    const spot = findFreeSpot(r, [r], 20);
    expect(rectsOverlap(spot, r)).toBe(false);
    expect(Math.hypot(spot.x, spot.y)).toBeLessThanOrEqual(90);
  });

  it('never leaves the copy straddling a container edge', () => {
    const parent = { x: 0, y: 0, w: 300, h: 200 };
    const original = { x: 20, y: 20, w: 120, h: 160 };
    const spot = findFreeSpot(original, [original], 30, [parent]);
    expect(rectsOverlap(spot, original)).toBe(false);
    const inside = rectInside(spot, parent);
    const outside = !rectsOverlap(spot, parent);
    expect(inside || outside).toBe(true);
  });

  it('fits inside a container when there is room', () => {
    const parent = { x: 0, y: 0, w: 600, h: 300 };
    const original = { x: 40, y: 40, w: 150, h: 150 };
    const spot = findFreeSpot(original, [original], 30, [parent]);
    expect(rectInside(spot, parent)).toBe(true);
  });
});

describe('signalKeys', () => {
  it('groups every wire leaving the same output, including through a port', () => {
    const doc = emptyDoc();
    const and = makeComponent('and', 0, 0, 'and');
    const a = makeComponent('or', 200, -40, 'a');
    const b = makeComponent('or', 200, 40, 'b');
    const port = makeComponent('port', 80, 0, 'p');
    const c = makeComponent('or', 200, 120, 'c');
    const other = makeComponent('switch', 0, 200, 's');
    for (const part of [and, a, b, port, c, other]) doc.components.set(part.id, part);
    doc.wires.set('w1', { id: 'w1', from: and.id, to: a.id, input: 0 });
    doc.wires.set('w2', { id: 'w2', from: and.id, to: b.id, input: 0 });
    doc.wires.set('w3', { id: 'w3', from: and.id, to: port.id, input: 0 });
    doc.wires.set('w4', { id: 'w4', from: port.id, to: c.id, input: 0 });
    doc.wires.set('w5', { id: 'w5', from: other.id, to: c.id, input: 1 });
    const keys = signalKeys(doc);
    expect(keys.get(and.id)).toBe(and.id);
    expect(keys.get(port.id)).toBe(and.id);
    expect(keys.get(other.id)).toBe(other.id);
  });
});

describe('liveChannels', () => {
  it('keeps a wire that runs from an output to an input', () => {
    const doc = emptyDoc();
    const and = makeComponent('and', 0, 0, 'and');
    const or = makeComponent('or', 200, 0, 'or');
    doc.components.set(and.id, and);
    doc.components.set(or.id, or);
    doc.wires.set('w1', { id: 'w1', from: and.id, to: or.id, input: 0 });
    expect(liveChannels(doc).has('w1')).toBe(true);
  });

  it('drops a wire that never reaches an input, and both hops once a port continues', () => {
    const doc = emptyDoc();
    const and = makeComponent('and', 0, 0, 'and');
    const port = makeComponent('port', 80, 0, 'p');
    doc.components.set(and.id, and);
    doc.components.set(port.id, port);
    doc.wires.set('dead', { id: 'dead', from: and.id, to: port.id, input: 0 });
    expect(liveChannels(doc).has('dead')).toBe(false);

    const or = makeComponent('or', 200, 0, 'or');
    doc.components.set(or.id, or);
    doc.wires.set('on', { id: 'on', from: port.id, to: or.id, input: 0 });
    const live = liveChannels(doc);
    expect(live.has('dead')).toBe(true);
    expect(live.has('on')).toBe(true);
  });

  it('drops a wire whose source is an undriven port', () => {
    const doc = emptyDoc();
    const port = makeComponent('port', 0, 0, 'p');
    const or = makeComponent('or', 200, 0, 'or');
    doc.components.set(port.id, port);
    doc.components.set(or.id, or);
    doc.wires.set('w1', { id: 'w1', from: port.id, to: or.id, input: 0 });
    expect(liveChannels(doc).has('w1')).toBe(false);
  });
});
