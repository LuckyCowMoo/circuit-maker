import { describe, expect, it } from 'vitest';
import { choosePropsBox, type ScreenBox } from './propsPlace';

const view: ScreenBox = { left: 0, top: 0, right: 1000, bottom: 800 };
const anchor: ScreenBox = { left: 400, top: 300, right: 480, bottom: 380 };

describe('component menu placement', () => {
  it('sits above the part when that side is clear', () => {
    const box = choosePropsBox(anchor, 100, 40, view, []);
    expect(box.bottom).toBeLessThanOrEqual(anchor.top);
    expect(box.left).toBeGreaterThan(anchor.left - 40);
    expect(box.right).toBeLessThan(anchor.right + 40);
  });

  it('moves to a clear side when the spot above covers another part', () => {
    const above: ScreenBox = { left: 360, top: 230, right: 520, bottom: 300 };
    const box = choosePropsBox(anchor, 100, 40, view, [above]);
    const overlapsAbove = box.left < above.right && box.right > above.left && box.top < above.bottom && box.bottom > above.top;
    expect(overlapsAbove).toBe(false);
    expect(box.left).toBeGreaterThanOrEqual(anchor.right);
  });

  it('picks the side that covers the least when every side touches something', () => {
    const block = (left: number, top: number, right: number, bottom: number): ScreenBox => ({ left, top, right, bottom });
    const obstacles = [
      block(350, 240, 530, 300),
      block(492, 300, 640, 400),
      block(240, 300, 388, 400),
      block(350, 392, 530, 460),
      block(492, 240, 640, 300),
      block(240, 240, 388, 300),
      block(492, 392, 700, 500),
    ];
    const box = choosePropsBox(anchor, 80, 30, view, obstacles);
    expect(box.right).toBeLessThanOrEqual(anchor.left);
    expect(box.top).toBeGreaterThanOrEqual(anchor.bottom);
  });
});
