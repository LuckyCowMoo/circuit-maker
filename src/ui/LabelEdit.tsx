import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '../editor/Editor';
import { MARKER_FONT } from '../model/geometry';
import { complementColor, noteCaret, noteLayout, NOTE_BG } from '../model/shapes';
import { useEditor } from './useEditor';

/** Types straight into a selected text box or marker. */
export function LabelEdit({ editor }: { editor: Editor }) {
  useEditor(editor);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [, setFrame] = useState(0);
  const id = editor.editingId;
  const c = id ? editor.doc.components.get(id) : undefined;
  const live = c && (c.kind === 'note' || c.kind === 'marker') ? c : null;

  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const tick = () => {
      setFrame((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !live) return;
    el.focus();
    if (live.kind !== 'note') {
      el.select();
      return;
    }
    const click = editor.editClick;
    const place = () => {
      const fromPoint = click ? caretInField(el, click.x, click.y) : null;
      const hit =
        fromPoint ??
        (click
          ? noteCaret(live.name, live.w, live.h, clickLocal(editor, live, click).x, clickLocal(editor, live, click).y)
          : live.name.length);
      el.setSelectionRange(hit, hit);
    };
    place();
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [id]);

  if (!live) return null;
  const canvas = editor.canvas?.getBoundingClientRect();
  const z = editor.cam.zoom;
  const origin = editor.toScreen({ x: live.x, y: live.y });
  const left0 = (canvas?.left ?? 0) + origin.x;
  const top0 = (canvas?.top ?? 0) + origin.y;
  const note = live.kind === 'note';
  const layout = note ? noteLayout(live.name || 'Text', live.w, live.h) : null;
  const label = live.name || 'Marker';
  const bg = live.color ?? (note ? NOTE_BG : editor.theme.marker);
  const color = note ? complementColor(bg) : bg;
  const markerH = MARKER_FONT * z;
  const block = layout ? layout.lines.length * layout.lineH : 0;
  const style = note && layout
    ? {
        left: left0 + layout.pad * z,
        top: top0 + layout.pad * z,
        width: layout.innerW * z,
        height: layout.innerH * z,
        paddingTop: Math.max(0, (layout.innerH - block) / 2) * z,
        fontSize: layout.size * z,
        lineHeight: `${layout.lineH * z}px`,
        textAlign: 'center' as const,
        color,
      }
    : {
        left: left0 + 38 * z,
        top: top0 + (16 - MARKER_FONT / 2) * z,
        width: Math.max(80, label.length * MARKER_FONT * 0.62 * z + 12),
        height: markerH,
        fontSize: markerH,
        lineHeight: `${markerH}px`,
        textAlign: 'left' as const,
        color,
      };

  const field = note ? (
    <textarea
      ref={ref as RefObject<HTMLTextAreaElement>}
      className="inline-label"
      style={style}
      value={live.name}
      aria-label="Text box"
      onChange={(e) => editor.setName(e.target.value)}
      onBlur={() => editor.stopEditing()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  ) : (
    <input
      ref={ref as RefObject<HTMLInputElement>}
      className="inline-label"
      style={style}
      value={live.name}
      aria-label="Marker"
      onChange={(e) => editor.setName(e.target.value)}
      onBlur={() => editor.stopEditing()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
  return field;
}

function clickLocal(editor: Editor, note: { x: number; y: number }, click: { x: number; y: number }): { x: number; y: number } {
  const canvas = editor.canvas?.getBoundingClientRect();
  const world = editor.toWorld({ x: click.x - (canvas?.left ?? 0), y: click.y - (canvas?.top ?? 0) });
  return { x: world.x - note.x, y: world.y - note.y };
}

function caretInField(el: HTMLElement, x: number, y: number): number | null {
  const pos = document.caretPositionFromPoint?.(x, y);
  if (!pos || (pos.offsetNode !== el && !el.contains(pos.offsetNode))) return null;
  return pos.offset;
}
