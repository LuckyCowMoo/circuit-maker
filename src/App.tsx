import { useEffect, useRef, useState } from 'react';
import { Editor } from './editor/Editor';
import { LabelEdit } from './ui/LabelEdit';
import { Toolbar } from './ui/Toolbar';
import { ContextMenu } from './ui/ContextMenu';
import { useEditor } from './ui/useEditor';

let shared: Editor | null = null;

/** One editor per page: loading consumes new-tab handoffs, so it must not run twice. */
function sharedEditor(): Editor {
  if (!shared) {
    shared = new Editor();
    shared.loadInitial();
  }
  return shared;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [editor] = useState(sharedEditor);
  useEditor(editor);

  useEffect(() => {
    editor.attach(canvasRef.current!);
    if (import.meta.env.DEV) (window as unknown as { editor: Editor }).editor = editor;
    return () => editor.detach();
  }, [editor]);

  const theme = editor.theme;
  useEffect(() => {
    const s = document.documentElement.style;
    s.setProperty('--ui-bg', theme.ui.bg);
    s.setProperty('--ui-fg', theme.ui.fg);
    s.setProperty('--ui-muted', theme.ui.muted);
    s.setProperty('--ui-border', theme.ui.border);
    s.setProperty('--ui-hover', theme.ui.hover);
    s.setProperty('--ui-active', theme.ui.active);
    s.setProperty('--ui-active-fg', theme.ui.activeFg);
    s.setProperty('--ui-shadow', theme.ui.shadow);
    s.setProperty('--ui-accent', theme.selection);
    s.setProperty('--canvas-bg', theme.bg);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg);
  }, [theme]);

  return (
    <>
      <canvas ref={canvasRef} className="stage" tabIndex={0} aria-label="Circuit canvas" />
      <LabelEdit editor={editor} />
      <ContextMenu editor={editor} />
      <Toolbar editor={editor} />
    </>
  );
}
