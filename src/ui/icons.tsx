import type { ReactNode } from 'react';
import { iconOps } from '../model/shapes';
import type { Theme } from '../model/themes';
import type { PlaceKind } from '../editor/Editor';

/** Toolbar icon drawn from the same shapes as the canvas. */
export function ComponentIcon({ kind, theme, negate }: { kind: PlaceKind; theme: Theme; negate?: boolean }) {
  const iconTheme: Theme = { ...theme, stroke: 'currentColor', fill: 'transparent', box: 'currentColor' };
  const { ops, viewBox } = iconOps(kind, iconTheme, negate);
  return (
    <svg viewBox={viewBox} className="icon-shape" aria-hidden="true" strokeLinejoin="round" strokeLinecap="round">
      {ops.map((op, i) =>
        op.t === 'path' ? (
          <path
            key={i}
            d={op.d}
            fill={op.fill ?? 'none'}
            stroke={op.stroke}
            strokeWidth={(op.width ?? 2.5) * 1.7}
            opacity={op.alpha}
          />
        ) : null,
      )}
    </svg>
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="icon"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icons = {
  select: (
    <Svg>
      <path d="M5 3l14 8-6 1.5L10 19z" />
    </Svg>
  ),
  pan: (
    <Svg>
      <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-1V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a6 6 0 01-4.7-2.3L4 15a1.6 1.6 0 012.4-2.1L8 14.5" />
    </Svg>
  ),
  undo: (
    <Svg>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h11a5 5 0 010 10h-3" />
    </Svg>
  ),
  redo: (
    <Svg>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9a5 5 0 000 10h3" />
    </Svg>
  ),
  fit: (
    <Svg>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  ),
  open: (
    <Svg>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    </Svg>
  ),
  save: (
    <Svg>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </Svg>
  ),
  theme: (
    <Svg>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 000 16z" fill="currentColor" />
    </Svg>
  ),
  help: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.3M12 17h.01" />
    </Svg>
  ),
  trash: (
    <Svg>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
    </Svg>
  ),
  copy: (
    <Svg>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </Svg>
  ),
};
