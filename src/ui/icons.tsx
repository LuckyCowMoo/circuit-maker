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
  people: (
    <Svg>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.6-2.8 2.7-4 5.5-4s4.9 1.2 5.5 4" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M16 15c1.8.2 3.2 1.2 3.8 3" />
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
  rotate: (
    <Svg>
      <path d="M20 12a8 8 0 11-2.3-5.6" />
      <path d="M20 4v5h-5" />
    </Svg>
  ),
  flip: (
    <Svg>
      <path d="M12 3v18" strokeDasharray="2 3" />
      <path d="M9 7L4 17h5zM15 7l5 10h-5z" />
    </Svg>
  ),
  inputs: (
    <Svg>
      <rect x="3" y="8" width="12" height="8" rx="4" />
      <circle cx="11" cy="12" r="2" />
      <path d="M15 12h6" />
    </Svg>
  ),
  outputs: (
    <Svg>
      <circle cx="15" cy="12" r="6" />
      <path d="M3 12h6M13 13.5l1-3 1 2.5 1-2.5 1 3" />
    </Svg>
  ),
  locate: (
    <Svg>
      <circle cx="12" cy="12" r="6" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </Svg>
  ),
  newTab: (
    <Svg>
      <path d="M14 4h6v6M20 4l-8 8" />
      <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
    </Svg>
  ),
  add: (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </Svg>
  ),
  blank: (
    <Svg>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </Svg>
  ),
  chevron: (
    <Svg>
      <path d="M6 15l6-6 6 6" />
    </Svg>
  ),
};
