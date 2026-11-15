import { describe, expect, it, beforeEach } from 'vitest';
import { Editor } from './Editor';

const store = new Map<string, string>();
const mockStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.localStorage = mockStorage as unknown as Storage;

describe('Editor selection style', () => {
  beforeEach(() => {
    mockStorage.clear();
  });

  it('defaults waveSelection to false (blue box selection outline on by default)', () => {
    const editor = new Editor();
    expect(editor.waveSelection).toBe(false);
  });

  it('allows toggling waveSelection and persists the preference', () => {
    const editor = new Editor();
    expect(editor.waveSelection).toBe(false);

    editor.setWaveSelection(true);
    expect(editor.waveSelection).toBe(true);
    expect(mockStorage.getItem('circuit-maker:wave-selection')).toBe('1');

    // A new editor instance should pick up the saved '1'
    const restoredEditor = new Editor();
    expect(restoredEditor.waveSelection).toBe(true);

    editor.setWaveSelection(false);
    expect(editor.waveSelection).toBe(false);
    expect(mockStorage.getItem('circuit-maker:wave-selection')).toBe('0');

    const restoredEditor2 = new Editor();
    expect(restoredEditor2.waveSelection).toBe(false);
  });
});
