import { describe, expect, it } from 'vitest';
import { keyBindLabel } from './keys';

describe('key bindings', () => {
  it('labels common KeyboardEvent codes for the props UI', () => {
    expect(keyBindLabel('KeyA')).toBe('A');
    expect(keyBindLabel('Digit3')).toBe('3');
    expect(keyBindLabel('Space')).toBe('Space');
    expect(keyBindLabel('ArrowLeft')).toBe('Left');
    expect(keyBindLabel('NumpadEnter')).toBe('Num Enter');
  });
});
