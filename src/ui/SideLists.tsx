import { useSyncExternalStore } from 'react';
import type { Editor } from '../editor/Editor';
import { colorsFor } from '../editor/renderer';
import type { Component } from '../model/types';
import { Icons } from './icons';
import { useEditor } from './useEditor';

function Row({ editor, c }: { editor: Editor; c: Component }) {
  const theme = editor.theme;
  const active = editor.isActive(c);
  const color =
    c.kind === 'bulb' ? (c.color ?? theme.bulb) : colorsFor(editor.parts.roots.get(c.id) ?? c.id, theme).on;
  const control =
    c.kind === 'switch' ? (
      <button
        type="button"
        className={`io-switch ${active ? 'on' : ''}`}
        style={active ? { background: color } : undefined}
        title={active ? 'On' : 'Off'}
        aria-pressed={active}
        onClick={() => editor.toggleSwitch(c.id)}
      >
        <span />
      </button>
    ) : c.kind === 'button' ? (
      <button
        type="button"
        className={`io-button ${active ? 'on' : ''}`}
        style={active ? { background: color } : undefined}
        title="Hold to press"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          editor.setPressed(c.id, true);
        }}
        onPointerUp={() => editor.setPressed(c.id, false)}
        onPointerCancel={() => editor.setPressed(c.id, false)}
      />
    ) : (
      <span className={`io-lamp ${active ? 'on' : ''}`} style={active ? { background: color, boxShadow: `0 0 8px ${color}` } : undefined} />
    );
  return (
    <li className={editor.selection.has(c.id) ? 'selected' : ''}>
      {control}
      <input
        value={c.name}
        placeholder="No label"
        aria-label="Label"
        onChange={(e) => editor.renameComponent(c.id, e.target.value)}
      />
      <button type="button" className="io-locate" title="Show" onClick={() => editor.locate(c.id)}>
        {Icons.locate}
      </button>
    </li>
  );
}

/** Collapsible list of the circuit's inputs (switches, buttons) or outputs (bulbs). */
export function SideList({
  editor,
  which,
  open,
  onToggle,
}: {
  editor: Editor;
  which: 'inputs' | 'outputs';
  open: boolean;
  onToggle: () => void;
}) {
  useEditor(editor);
  useSyncExternalStore(editor.subscribeSim, editor.getSimVersion);
  const items = editor.ioList(which);
  const title = which === 'inputs' ? 'Inputs' : 'Outputs';
  return (
    <div className={`io-wrap ${which}`}>
      {open && (
        <div className="io-list" onPointerDown={(e) => e.stopPropagation()}>
          <div className="panel-title">{title}</div>
          {items.length ? (
            <ul>
              {items.map((c) => (
                <Row key={c.id} editor={editor} c={c} />
              ))}
            </ul>
          ) : (
            <p className="hint">{which === 'inputs' ? 'No switches or buttons yet.' : 'No light bulbs yet.'}</p>
          )}
        </div>
      )}
      <button
        type="button"
        className={`io-toggle ${open ? 'active' : ''}`}
        title={title}
        aria-expanded={open}
        onClick={onToggle}
      >
        {which === 'inputs' ? Icons.inputs : Icons.outputs}
        <span>{items.length}</span>
        <span className={`io-chevron ${open ? 'open' : ''}`}>{Icons.chevron}</span>
      </button>
    </div>
  );
}
