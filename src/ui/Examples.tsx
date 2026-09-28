import { useMemo } from 'react';
import type { Editor } from '../editor/Editor';
import { EXAMPLES } from '../examples/catalog';
import { exampleIconDataUrl } from '../examples/exampleIcons';
import { EXAMPLE_PIECES } from '../examples/exampleCounts';
import { exampleCardColors, exampleComplexity, groupHue, heroAccent, previewPath } from '../examples/exampleVisuals';
import type { Doc } from '../model/types';

const docs = new Map<string, Doc>();

function exampleDoc(id: string, build: () => Doc): Doc {
  let d = docs.get(id);
  if (!d) docs.set(id, (d = build()));
  return d;
}

/** Example circuits in groups. Icons and previews are static assets; heavy examples build on pick. */
export function Examples({ editor, onPicked }: { editor: Editor; onPicked: () => void }) {
  const theme = editor.theme;
  const groups = useMemo(
    () =>
      EXAMPLES.map((g) => ({
        name: g.name,
        hue: groupHue(g.name),
        items: g.items.map((e) => {
          const complex = exampleComplexity(e.id);
          const colors = exampleCardColors(g.name, e.id);
          const hero = complex === 4;
          const iconColor = hero ? heroAccent(theme) : colors.label;
          return {
            ...e,
            doc: e.heavy ? null : exampleDoc(e.id, e.build),
            preview: previewPath(theme.id, e.id),
            icon: exampleIconDataUrl(e.id, iconColor),
            pieces: EXAMPLE_PIECES[e.id] ?? 0,
            colors,
            hero,
          };
        }),
      })),
    [theme],
  );

  return (
    <div className="examples">
      {groups.map((g) => (
        <section key={g.name} className="examples-section" style={{ ['--group-hue' as string]: g.hue }}>
          <div className="examples-group">{g.name}</div>
          <div className="examples-grid">
            {g.items.map((e) => (
              <button
                type="button"
                key={e.id}
                className={`example-card${e.hero ? ' example-card-hero' : ''}`}
                title={e.name}
                style={{
                  ['--ex-bg' as string]: e.colors.bg,
                  ['--ex-border' as string]: e.colors.border,
                  ['--ex-fg' as string]: e.colors.label,
                }}
                onClick={() => {
                  onPicked();
                  const add = () => {
                    try {
                      editor.addExample(e.doc ?? exampleDoc(e.id, e.build));
                    } catch (err) {
                      editor.toast(err instanceof Error ? err.message : 'Could not build that example.');
                    }
                  };
                  if (e.heavy) {
                    editor.toast(`Building ${e.name}…`);
                    window.setTimeout(add, 0);
                  } else add();
                }}
              >
                <div className="example-card-art" aria-hidden>
                  <img className="example-icon" src={e.icon} alt="" draggable={false} />
                  <img className="example-preview" src={e.preview} alt="" draggable={false} loading="lazy" />
                </div>
                <span className="example-name">{e.name}</span>
                <span className="example-pieces">{e.pieces.toLocaleString()} pieces</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
