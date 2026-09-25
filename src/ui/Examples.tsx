import { useMemo } from 'react';
import type { Editor } from '../editor/Editor';
import { EXAMPLES } from '../examples/catalog';
import { buildSvg } from '../io/export';
import type { Theme } from '../model/themes';
import type { Doc } from '../model/types';
import { Simulator } from '../sim/simulator';

const docs = new Map<string, Doc>();
const thumbs = new Map<string, string>();

function exampleDoc(id: string, build: () => Doc): Doc {
  let d = docs.get(id);
  if (!d) docs.set(id, (d = build()));
  return d;
}

function thumbnail(id: string, doc: Doc, theme: Theme): string {
  const key = `${theme.id}:${id}`;
  let url = thumbs.get(key);
  if (!url) {
    // Large stress circuits skip a full SVG settle; a blank card is enough to pick them.
    if (doc.components.size > 120) {
      url =
        'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="${theme.bg}"/><text x="80" y="54" text-anchor="middle" fill="${theme.text}" font-size="14" font-family="system-ui">${doc.components.size} parts</text></svg>`,
        );
    } else {
      const sim = new Simulator();
      sim.compile(doc);
      sim.settle(2000);
      url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(buildSvg(doc, theme, sim).svg);
    }
    thumbs.set(key, url);
  }
  return url;
}

/** Example circuits in groups, each with a picture. Clicking one adds it to the project. */
export function Examples({ editor, onPicked }: { editor: Editor; onPicked: () => void }) {
  const theme = editor.theme;
  const groups = useMemo(
    () =>
      EXAMPLES.map((g) => ({
        name: g.name,
        items: g.items.map((e) => {
          const doc = exampleDoc(e.id, e.build);
          return { ...e, doc, url: thumbnail(e.id, doc, theme) };
        }),
      })),
    [theme],
  );
  return (
    <div className="examples">
      {groups.map((g) => (
        <section key={g.name}>
          <div className="examples-group">{g.name}</div>
          <div className="examples-grid">
            {g.items.map((e) => (
              <button
                type="button"
                key={e.id}
                className="example-card"
                title={e.name}
                onClick={() => {
                  editor.addExample(e.doc);
                  onPicked();
                }}
              >
                <img src={e.url} alt="" draggable={false} />
                <span>{e.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
