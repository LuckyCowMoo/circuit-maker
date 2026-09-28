export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GAP = 12;

function overlapArea(a: ScreenBox, b: ScreenBox): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

function clampBox(raw: ScreenBox, view: ScreenBox, w: number, h: number): ScreenBox {
  const maxLeft = Math.max(view.left, view.right - w);
  const maxTop = Math.max(view.top, view.bottom - h);
  const left = Math.min(Math.max(raw.left, view.left), maxLeft);
  const top = Math.min(Math.max(raw.top, view.top), maxTop);
  return { left, top, right: left + w, bottom: top + h };
}

/**
 * Places a menu just outside `anchor`. Tries the sides and the diagonals, and keeps the
 * spot that covers the least of `obstacles` (and of the selection itself).
 */
export function choosePropsBox(
  anchor: ScreenBox,
  menuW: number,
  menuH: number,
  viewport: ScreenBox,
  obstacles: ScreenBox[],
): ScreenBox {
  const cx = (anchor.left + anchor.right) / 2;
  const cy = (anchor.top + anchor.bottom) / 2;
  const spots: Array<[number, number]> = [
    [cx - menuW / 2, anchor.top - GAP - menuH],
    [anchor.right + GAP, cy - menuH / 2],
    [anchor.left - GAP - menuW, cy - menuH / 2],
    [cx - menuW / 2, anchor.bottom + GAP],
    [anchor.right + GAP, anchor.top - GAP - menuH],
    [anchor.left - GAP - menuW, anchor.top - GAP - menuH],
    [anchor.right + GAP, anchor.bottom + GAP],
    [anchor.left - GAP - menuW, anchor.bottom + GAP],
  ];
  let best: ScreenBox = { left: spots[0][0], top: spots[0][1], right: spots[0][0] + menuW, bottom: spots[0][1] + menuH };
  let bestScore = Infinity;
  spots.forEach(([left, top], index) => {
    const raw = { left, top, right: left + menuW, bottom: top + menuH };
    const box = clampBox(raw, viewport, menuW, menuH);
    let score = overlapArea(box, anchor) * 4;
    for (const obstacle of obstacles) score += overlapArea(box, obstacle);
    score += Math.hypot(box.left - raw.left, box.top - raw.top) * 30;
    score += index * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = box;
    }
  });
  return best;
}
