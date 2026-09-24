import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Editor, ExportScope, PlaceKind } from '../editor/Editor';
import { KIND_LABEL } from '../editor/Editor';
import { INPUT_WARN, MAX_INPUTS } from '../model/geometry';
import { THEMES, toHex6, wireColors } from '../model/themes';
import { isGate } from '../model/types';
import { downloadText, pickFile } from '../io/download';
import { FILE_EXTENSION } from '../io/format';
import halfAdder from '../../examples/half-adder.cmk.json?raw';
import fullAdder from '../../examples/full-adder.cmk.json?raw';
import formatGuide from '../../docs/CIRCUIT_FORMAT.md?raw';
import { ComponentIcon, Icons } from './icons';
import { useEditor } from './useEditor';

type Panel = 'save' | 'open' | 'theme' | 'help' | null;

const PLACE_GROUPS: PlaceKind[][] = [
  ['and', 'or', 'xor', 'buffer'],
  ['switch', 'button', 'bulb'],
  ['marker', 'box'],
];

const HINTS: Partial<Record<PlaceKind, string>> = {
  box: 'Box - click to place, or select items first to wrap them',
};

function Btn(props: {
  title: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`tb-btn ${props.active ? 'active' : ''} ${props.className ?? ''}`}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

const Sep = () => <div className="tb-sep" />;

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <label className="color-field" title={`${label} colour`}>
      <span className="swatch" style={{ background: value }} />
      <input type="color" value={toHex6(value)} onChange={(e) => onChange(e.target.value)} />
      <span>{label}</span>
    </label>
  );
}

function Stepper({ value, mixed, onChange }: { value: number; mixed: boolean; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(mixed ? '' : String(value)), [value, mixed]);
  const commit = (s: string) => {
    const n = parseInt(s, 10);
    if (Number.isFinite(n)) onChange(n);
    else setText(String(value));
  };
  return (
    <div className="stepper">
      <button type="button" title="Fewer inputs (-)" onClick={() => onChange(value - 1)} disabled={value <= 1}>
        -
      </button>
      <input
        type="number"
        min={1}
        max={MAX_INPUTS}
        value={text}
        placeholder="mixed"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <button type="button" title="More inputs (+)" onClick={() => onChange(value + 1)} disabled={value >= MAX_INPUTS}>
        +
      </button>
    </div>
  );
}

function PropsBar({ editor }: { editor: Editor }) {
  const theme = editor.theme;
  const comps = editor.selectedComponents();
  const boxes = editor.selectedBoxes();
  const wires = editor.selectedWires();
  const total = comps.length + boxes.length + wires.length;
  if (!total) return null;
  const gates = comps.filter((c) => isGate(c.kind));
  const colourable = comps.filter((c) => c.kind !== 'marker');
  const markers = comps.filter((c) => c.kind === 'marker');
  const bulbs = comps.filter((c) => c.kind === 'bulb');
  const named = total === 1 ? (markers[0] ?? boxes[0] ?? null) : null;
  const tinted = [...markers, ...boxes];
  const title =
    total === 1
      ? comps[0]
        ? gates[0]
          ? `${gates[0].kind === 'buffer' ? (gates[0].negate ? 'NOT' : 'Buffer') : (gates[0].negate ? 'N' : '') + gates[0].kind.toUpperCase()}`
          : KIND_LABEL[comps[0].kind]
        : boxes[0]
          ? 'Box'
          : 'Wire'
      : `${total} selected`;

  return (
    <div className="props" onPointerDown={(e) => e.stopPropagation()}>
      <span className="props-title">{title}</span>
      {gates.length > 0 && (
        <div className="props-group">
          <span className="props-label">Inputs</span>
          <Stepper
            value={gates[0].inputs}
            mixed={!gates.every((g) => g.inputs === gates[0].inputs)}
            onChange={(n) => editor.setInputs(n)}
          />
          {gates.some((g) => g.inputs > INPUT_WARN) && (
            <span className="warn" title="Very large gates are fine to simulate but hard to wire and read.">
              large
            </span>
          )}
          <button
            type="button"
            className={`chip ${gates.every((g) => g.negate) ? 'active' : ''}`}
            title="Toggle the NOT bubble on the output (N)"
            onClick={() => editor.setNegate(!gates.every((g) => g.negate))}
          >
            NOT
          </button>
        </div>
      )}
      {colourable.length > 0 && (
        <div className="props-group">
          <ColorField label="Outline" value={colourable[0].stroke ?? theme.stroke} onChange={(c) => editor.setStroke(c)} />
          <ColorField label="Fill" value={colourable[0].fill ?? theme.fill} onChange={(c) => editor.setFill(c)} />
          {bulbs.length > 0 && (
            <ColorField label="Light" value={bulbs[0].color ?? theme.bulb} onChange={(c) => editor.setColor(c)} />
          )}
          {colourable.some((c) => c.stroke || c.fill || (c.kind === 'bulb' && c.color)) && (
            <button
              type="button"
              className="chip"
              title="Use the theme colours again"
              onClick={() => {
                editor.setStroke(null);
                editor.setFill(null);
                if (bulbs.length) editor.setColor(null);
              }}
            >
              Reset
            </button>
          )}
        </div>
      )}
      {(named || tinted.length > 0) && (
        <div className="props-group">
          {named && (
            <input
              className="name-input"
              value={named.name}
              placeholder="Name"
              aria-label="Name"
              onChange={(e) => editor.setName(e.target.value)}
            />
          )}
          {tinted.length > 0 && (
            <ColorField
              label="Colour"
              value={tinted[0].color ?? ('kind' in tinted[0] ? theme.marker : theme.box)}
              onChange={(c) => editor.setColor(c)}
            />
          )}
        </div>
      )}
      <div className="props-group">
        {(comps.length > 0 || boxes.length > 0) && (
          <button type="button" className="chip" title="Duplicate into the nearest free space (Ctrl+D)" onClick={() => editor.duplicateSelection()}>
            Duplicate
          </button>
        )}
        {boxes.length > 0 && (
          <button type="button" className="chip" title="Remove the box but keep its contents" onClick={() => editor.unboxSelection()}>
            Unbox
          </button>
        )}
        <button type="button" className="chip danger" title="Delete (Del)" onClick={() => editor.deleteSelection()}>
          {Icons.trash}
        </button>
      </div>
    </div>
  );
}

export function Toolbar({ editor }: { editor: Editor }) {
  useEditor(editor);
  const [panel, setPanel] = useState<Panel>(null);
  const [scope, setScope] = useState<ExportScope>('all');
  const dockRef = useRef<HTMLDivElement>(null);
  const theme = editor.theme;
  const hasSelection = editor.selection.size > 0;

  useEffect(() => {
    if (!panel) return;
    const close = (e: PointerEvent) => {
      if (!dockRef.current?.contains(e.target as Node)) setPanel(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [panel]);

  useEffect(() => {
    if (!hasSelection && scope === 'selection') setScope('all');
  }, [hasSelection, scope]);

  const toggle = (p: Panel) => setPanel((cur) => (cur === p ? null : p));

  const openFile = async (mode: 'replace' | 'merge') => {
    const file = await pickFile(`${FILE_EXTENSION},.json,application/json`);
    if (!file) return;
    if (editor.loadText(await file.text(), mode)) setPanel(null);
  };

  const placeButton = (kind: PlaceKind) => (
    <button
      key={kind}
      type="button"
      className={`tb-btn place ${editor.placing === kind ? 'active' : ''}`}
      title={`${HINTS[kind] ?? KIND_LABEL[kind]} - click then click the canvas, or drag it in`}
      aria-label={KIND_LABEL[kind]}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        if (editor.placing === kind) editor.cancelPlacing();
        else editor.beginPlace(kind, e.nativeEvent);
      }}
    >
      <ComponentIcon kind={kind} theme={theme} />
    </button>
  );

  return (
    <div className="dock" ref={dockRef}>
      {editor.toastMessage && (
        <div className="toast" role="status">
          {editor.toastMessage}
        </div>
      )}

      {panel === 'save' && (
        <div className="panel">
          <div className="panel-title">Save</div>
          <label className="field">
            <span>Name</span>
            <input value={editor.doc.name} onChange={(e) => editor.setDocName(e.target.value)} />
          </label>
          <div className="seg">
            <button type="button" className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
              Whole project
            </button>
            <button
              type="button"
              className={scope === 'selection' ? 'active' : ''}
              disabled={!hasSelection}
              onClick={() => setScope('selection')}
            >
              Selection only
            </button>
          </div>
          <div className="panel-actions">
            <button type="button" className="primary" onClick={() => editor.exportAs('project', scope)}>
              Project file ({FILE_EXTENSION})
            </button>
            <button type="button" onClick={() => editor.exportAs('svg', scope)}>
              SVG image
            </button>
            <button type="button" onClick={() => editor.exportAs('png', scope)}>
              PNG image
            </button>
          </div>
          <p className="hint">
            Project files are plain text: reopen them later, add them into other projects, or edit them in any text editor.
          </p>
        </div>
      )}

      {panel === 'open' && (
        <div className="panel">
          <div className="panel-title">Open</div>
          <div className="panel-actions column">
            <button type="button" className="primary" onClick={() => openFile('replace')}>
              Open project...
            </button>
            <button type="button" onClick={() => openFile('merge')}>
              Add a project into this one...
            </button>
            <button
              type="button"
              onClick={() => {
                editor.newDocument();
                setPanel(null);
              }}
            >
              New empty project
            </button>
          </div>
          <div className="panel-sub">Examples</div>
          <div className="panel-actions">
            <button type="button" onClick={() => (editor.loadExample(halfAdder), setPanel(null))}>
              Half adder
            </button>
            <button type="button" onClick={() => (editor.loadExample(fullAdder), setPanel(null))}>
              Full adder (nested boxes)
            </button>
          </div>
          <p className="hint">
            You can also drop a {FILE_EXTENSION} file onto the canvas, or paste circuit text with Ctrl+V. Opening replaces the
            current project (Ctrl+Z to undo).
          </p>
        </div>
      )}

      {panel === 'theme' && (
        <div className="panel">
          <div className="panel-title">Theme</div>
          <div className="themes">
            {THEMES.map((t) => {
              const cols = wireColors('preview', t);
              return (
                <button
                  type="button"
                  key={t.id}
                  className={`theme-card ${t.id === theme.id ? 'active' : ''}`}
                  onClick={() => editor.setTheme(t.id)}
                >
                  <svg viewBox="-24 -4 110 48" style={{ background: t.bg }} aria-hidden="true">
                    <path d="M-20 10C-10 10 -10 10 0 10" stroke={cols.glow} strokeWidth="8" fill="none" />
                    <path d="M-20 10C-10 10 -10 10 0 10" stroke={cols.on} strokeWidth="3" fill="none" />
                    <path d="M-20 30H0" stroke={wireColors('other', t).off} strokeWidth="3" />
                    <path d="M0 0H30A20 20 0 0 1 30 40H0Z" fill={t.fill} stroke={t.stroke} strokeWidth="3" />
                    <path d="M50 20H80" stroke={t.stroke} strokeWidth="3" />
                  </svg>
                  <span>{t.name}</span>
                </button>
              );
            })}
          </div>
          <p className="hint">Themes change the default colours. Colours you set yourself are kept.</p>
        </div>
      )}

      {panel === 'help' && (
        <div className="panel help">
          <div className="panel-title">Controls</div>
          <ul className="keys">
            <li><b>Drag</b> a part from the toolbar, or click it then click the canvas</li>
            <li><b>Drag from a pin</b> to wire it; drop on empty space to add a connected part</li>
            <li><b>Drag from a wired input</b> to move or remove that wire</li>
            <li><b>Click</b> switches to toggle; hold buttons to press</li>
            <li><b>Right-drag</b>, middle-drag or <b>Space</b>+drag to pan; <b>wheel</b> to zoom</li>
            <li><b>Right-click</b> empty space for the add menu</li>
            <li><b>Shift</b>+click / drag to add to the selection</li>
            <li><b>Box</b> with items selected wraps them in a box</li>
            <li><kbd>+</kbd>/<kbd>-</kbd> inputs, <kbd>N</kbd> NOT, <kbd>F</kbd> fit view</li>
            <li><kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo/redo, <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd>/<kbd>D</kbd> copy/paste/duplicate</li>
          </ul>
          <div className="panel-sub">Build circuits with an AI</div>
          <p className="hint">
            Give this guide to an LLM as its system prompt, then paste the circuit it writes straight into the canvas
            (Ctrl+V). Copying a selection puts its text on the clipboard too.
          </p>
          <div className="panel-actions">
            <button type="button" onClick={() => downloadText(formatGuide, 'CIRCUIT_FORMAT.md', 'text/markdown')}>
              Download format guide
            </button>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(formatGuide);
                editor.toast('Format guide copied to the clipboard.');
              }}
            >
              {Icons.copy} Copy guide
            </button>
          </div>
        </div>
      )}

      <PropsBar editor={editor} />

      <div className="toolbar" role="toolbar" aria-label="Circuit Maker tools">
        <Btn title="Select (V)" active={editor.tool === 'select'} onClick={() => editor.setTool('select')}>
          {Icons.select}
        </Btn>
        <Btn title="Pan (H)" active={editor.tool === 'pan'} onClick={() => editor.setTool('pan')}>
          {Icons.pan}
        </Btn>
        {PLACE_GROUPS.map((group, i) => (
          <div className="tb-group" key={i}>
            <Sep />
            {group.map(placeButton)}
          </div>
        ))}
        <Sep />
        <Btn title="Undo (Ctrl+Z)" disabled={!editor.canUndo} onClick={() => editor.undo()}>
          {Icons.undo}
        </Btn>
        <Btn title="Redo (Ctrl+Y)" disabled={!editor.canRedo} onClick={() => editor.redo()}>
          {Icons.redo}
        </Btn>
        <Btn title="Fit to view (F)" onClick={() => editor.fitView()}>
          {Icons.fit}
        </Btn>
        <Sep />
        <Btn title="Open" active={panel === 'open'} onClick={() => toggle('open')}>
          {Icons.open}
        </Btn>
        <Btn title="Save / export" active={panel === 'save'} onClick={() => toggle('save')}>
          {Icons.save}
        </Btn>
        <Btn title="Theme" active={panel === 'theme'} onClick={() => toggle('theme')}>
          {Icons.theme}
        </Btn>
        <Btn title="Help" active={panel === 'help'} onClick={() => toggle('help')}>
          {Icons.help}
        </Btn>
      </div>
    </div>
  );
}
