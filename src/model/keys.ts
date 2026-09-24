/** Friendly label for a stored `KeyboardEvent.code` binding. */
export function keyBindLabel(code: string): string {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
  if (code.startsWith('Numpad') && code.length > 6) return `Num ${code.slice(6)}`;
  if (code.startsWith('Arrow')) return code.slice(5);
  const names: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Escape: 'Esc',
    Backspace: 'Backspace',
    Tab: 'Tab',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Backquote: '`',
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  return names[code] ?? code;
}

/** True when this key event is only a modifier and shouldn't bind an input. */
export function isModifierOnly(e: KeyboardEvent): boolean {
  return e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta';
}
