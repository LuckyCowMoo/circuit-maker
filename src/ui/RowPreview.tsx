import { useEffect, useRef } from 'react';
import type { Editor } from '../editor/Editor';
import { paintCircuitPreview } from '../editor/renderer';
import { useEditor } from './useEditor';

const WIDTH = 320;
const HEIGHT = 214;

/** Popup of the circuit a solution-table row is wired to, in that row's state. */
export function RowPreview({ editor }: { editor: Editor }) {
  useEditor(editor);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hover = editor.rowHover;
  const model = editor.rowPreview;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hover || !model) return;
    paintCircuitPreview(canvas, model, editor.theme, editor.wireStyle);
  }, [editor, hover, model]);
  if (!hover || !model) return null;
  let left = hover.sx + 14;
  let top = hover.sy - HEIGHT / 2;
  if (left + WIDTH > window.innerWidth - 8) left = Math.max(8, hover.sx - WIDTH - 14);
  top = Math.max(8, Math.min(top, window.innerHeight - HEIGHT - 8));
  return (
    <div className="row-preview" style={{ left, top, width: WIDTH }} role="tooltip">
      <div className="ctx-title">{model.title}</div>
      <canvas ref={canvasRef} />
    </div>
  );
}
