import { useSyncExternalStore } from 'react';
import type { Editor } from '../editor/Editor';

/** Re-renders the calling component whenever the editor emits a UI-relevant change. */
export function useEditor(editor: Editor): number {
  return useSyncExternalStore(editor.subscribe, editor.getVersion);
}
