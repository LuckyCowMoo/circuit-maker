/**
 * Operation marks are the Lucide plus, minus, divide, x, and percent icons (ISC).
 * Bits sit underneath: one dot with a 1, a row of four with a 4, or two rows of four with an 8.
 */
function bitDots(bits: number): string {
  const rows = bits === 8 ? 2 : 1;
  const cols = bits === 1 ? 1 : 4;
  const r = 2.6;
  const sx = 8;
  const sy = 8.2;
  const yMid = 50;
  const y0 = yMid - ((rows - 1) * sy) / 2;
  const rowSpan = (cols - 1) * sx;
  const gap = 7.5;
  const digit = 8;
  const x0 = 32 - (rowSpan + gap + digit) / 2;
  const circles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = (x0 + col * sx).toFixed(2);
      const y = (y0 + row * sy).toFixed(2);
      circles.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor"/>`);
    }
  }
  const lx = (x0 + rowSpan + gap + digit / 2).toFixed(2);
  const ly = (yMid + 3.8).toFixed(2);
  const label = `<text x="${lx}" y="${ly}" fill="currentColor" font-size="12" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif" text-anchor="middle">${bits}</text>`;
  return circles.join('') + label;
}

function opIcon(mark: string, bits: number): string {
  const symbol = `<g transform="translate(14 0.5) scale(1.5)" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none">${mark}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">${symbol}${bitDots(bits)}</svg>`;
}

const PLUS = `<path d="M5 12h14"/><path d="M12 5v14"/>`;
const MINUS = `<path d="M5 12h14"/>`;
const DIVIDE = `<circle cx="12" cy="6" r="1.7" fill="currentColor" stroke="none"/><line x1="5" x2="19" y1="12" y2="12"/><circle cx="12" cy="18" r="1.7" fill="currentColor" stroke="none"/>`;
const TIMES = `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`;
const PERCENT = `<line x1="19" x2="5" y1="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>`;

/** Static SVG logos for the examples list (viewBox 0 0 64 64). */
const ICONS: Record<string, string> = {
  half: opIcon(PLUS, 1),
  full: opIcon(PLUS, 1),
  adder4: opIcon(PLUS, 4),
  adder8: opIcon(PLUS, 8),
  sub4: opIcon(MINUS, 4),
  sub8: opIcon(MINUS, 8),
  mul4: opIcon(TIMES, 4),
  div4: opIcon(DIVIDE, 4),
  mod4: opIcon(PERCENT, 4),
  cmp4: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><path d="M18 24l10 8-10 8V24z" fill="currentColor"/><path d="M46 24l-10 8 10 8V24z" fill="currentColor" opacity="0.35"/><rect x="28" y="18" width="8" height="28" rx="2" stroke="currentColor" stroke-width="2.5"/></svg>`,
  calc: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="10" y="8" width="44" height="48" rx="8" stroke="currentColor" stroke-width="2.5"/><rect x="16" y="14" width="32" height="10" rx="2" fill="currentColor" opacity="0.25"/><circle cx="22" cy="36" r="3" fill="currentColor"/><circle cx="32" cy="36" r="3" fill="currentColor"/><circle cx="42" cy="36" r="3" fill="currentColor"/><circle cx="22" cy="46" r="3" fill="currentColor"/><circle cx="32" cy="46" r="3" fill="currentColor"/><circle cx="42" cy="46" r="3" fill="currentColor"/></svg>`,
  sr: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="14" y="20" width="36" height="24" rx="6" stroke="currentColor" stroke-width="2.5"/><path d="M8 32h6M50 32h6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="32" cy="32" r="5" fill="currentColor"/></svg>`,
  mem: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="12" y="18" width="40" height="28" rx="4" stroke="currentColor" stroke-width="2.5"/><path d="M20 18v-6M32 18v-6M44 18v-6" stroke="currentColor" stroke-width="2.2"/><rect x="20" y="26" width="24" height="12" rx="2" fill="currentColor" opacity="0.3"/></svg>`,
  dff: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="16" y="16" width="32" height="32" rx="6" stroke="currentColor" stroke-width="2.5"/><path d="M8 28h8M48 28h8" stroke="currentColor" stroke-width="2.5"/><path d="M8 36h8" stroke="currentColor" stroke-width="2.5"/><circle cx="32" cy="32" r="7" stroke="currentColor" stroke-width="2.5"/></svg>`,
  reg8: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="10" y="14" width="44" height="36" rx="6" stroke="currentColor" stroke-width="2.5"/><path d="M18 24h28M18 32h28M18 40h28" stroke="currentColor" stroke-width="1.6"/><text x="32" y="35" text-anchor="middle" fill="currentColor" font-size="11" font-weight="800" font-family="system-ui">8</text></svg>`,
  count8: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="20" stroke="currentColor" stroke-width="2.5"/><path d="M32 18v16l10 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><text x="32" y="58" text-anchor="middle" fill="currentColor" font-size="10" font-weight="700" font-family="system-ui">8</text></svg>`,
  seg7: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="16" y="14" width="32" height="36" rx="4" stroke="currentColor" stroke-width="2.5"/><path d="M20 20h24M20 32h24M20 44h24" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  seg3: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="8" y="18" width="14" height="28" rx="3" stroke="currentColor" stroke-width="2"/><rect x="25" y="18" width="14" height="28" rx="3" stroke="currentColor" stroke-width="2"/><rect x="42" y="18" width="14" height="28" rx="3" stroke="currentColor" stroke-width="2"/></svg>`,
  mux4: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><path d="M12 16h28l12 16-12 16H12z" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M8 22h4M8 32h4M8 42h4" stroke="currentColor" stroke-width="2.2"/></svg>`,
  dec2: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><path d="M44 16H16L28 32 16 48h28z" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M52 20v6M52 38v6" stroke="currentColor" stroke-width="2.2"/></svg>`,
  alu: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><path d="M12 14h26l14 18-14 18H12z" stroke="currentColor" stroke-width="2.5"/><path d="M22 32h12M28 26v12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  parity: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><path d="M14 18c10 8 10 20 0 28" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M24 18c10 8 10 20 0 28" stroke="currentColor" stroke-width="2.5" fill="none"/><circle cx="46" cy="32" r="8" stroke="currentColor" stroke-width="2.5"/></svg>`,
  lock: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="16" y="28" width="32" height="24" rx="4" stroke="currentColor" stroke-width="2.5"/><path d="M22 28v-6a10 10 0 0 1 20 0v6" stroke="currentColor" stroke-width="2.5" fill="none"/><circle cx="32" cy="40" r="3" fill="currentColor"/></svg>`,
  shift: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="8" y="26" width="10" height="16" rx="2" stroke="currentColor" stroke-width="2.2"/><rect x="22" y="26" width="10" height="16" rx="2" stroke="currentColor" stroke-width="2.2"/><rect x="36" y="26" width="10" height="16" rx="2" stroke="currentColor" stroke-width="2.2"/><path d="M14 16h28M42 12l6 4-6 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ram: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="12" y="12" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2.3"/><rect x="34" y="12" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2.3"/><rect x="12" y="34" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2.3"/><rect x="34" y="34" width="18" height="18" rx="3" stroke="currentColor" stroke-width="2.3" fill="currentColor" opacity="0.35"/></svg>`,
  ring: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="14" r="4.2" fill="currentColor"/><circle cx="44.7" cy="19.3" r="4.2" fill="currentColor" opacity="0.55"/><circle cx="49.7" cy="32" r="4.2" fill="currentColor" opacity="0.4"/><circle cx="44.7" cy="44.7" r="4.2" fill="currentColor" opacity="0.4"/><circle cx="32" cy="50" r="4.2" fill="currentColor" opacity="0.4"/><circle cx="19.3" cy="44.7" r="4.2" fill="currentColor" opacity="0.4"/><circle cx="14.3" cy="32" r="4.2" fill="currentColor" opacity="0.55"/><circle cx="19.3" cy="19.3" r="4.2" fill="currentColor" opacity="0.75"/></svg>`,
  snake: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="10" y="10" width="12" height="12" rx="2" fill="currentColor"/><rect x="22" y="10" width="12" height="12" rx="2" fill="currentColor" opacity="0.7"/><rect x="34" y="10" width="12" height="12" rx="2" fill="currentColor" opacity="0.5"/><rect x="34" y="22" width="12" height="12" rx="2" fill="currentColor" opacity="0.35"/><circle cx="16" cy="16" r="2" fill="#0c0c0e"/></svg>`,
  stress: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><path d="M8 32c8-12 16-12 24 0s16 12 24 0" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M8 44c8-12 16-12 24 0s16 12 24 0" stroke="currentColor" stroke-width="2.5" fill="none" opacity="0.5"/><circle cx="32" cy="20" r="6" stroke="currentColor" stroke-width="2.5"/></svg>`,
};

const DEFAULT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect x="12" y="12" width="40" height="40" rx="8" stroke="currentColor" stroke-width="2.5"/><path d="M24 32h16M32 24v16" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;

export function exampleIconSvg(id: string): string {
  return ICONS[id] ?? DEFAULT_ICON;
}

export function exampleIconDataUrl(id: string, color: string): string {
  const svg = exampleIconSvg(id).replace(/currentColor/g, color);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
