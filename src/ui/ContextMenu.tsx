import type { Editor } from '../editor/Editor';
import { ComponentIcon } from './icons';
import { useEditor } from './useEditor';

/** The add menu shown when a wire is dropped on empty space, or on right-click. */
export function ContextMenu({ editor }: { editor: Editor }) {
  useEditor(editor);
  const m = editor.menu;
  if (!m) return null;
  const items = editor.menuItems();
  const height = items.length * 34 + 40;
  const left = Math.max(8, Math.min(m.sx, window.innerWidth - 190));
  const top = Math.max(8, Math.min(m.sy, window.innerHeight - height - 8));
  return (
    <div className="ctx" style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} role="menu">
      <div className="ctx-title">{m.from ? 'Connect a new part' : 'Add a part'}</div>
      {items.map((it) => (
        <button
          type="button"
          role="menuitem"
          key={it.label}
          onClick={() => editor.placeFromMenu(it)}
        >
          <ComponentIcon kind={it.kind} theme={editor.theme} negate={it.negate} />
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
