/**
 * One-time / occasional generator for static example preview SVGs.
 * Run: npx tsx scripts/generate-example-previews.ts
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXAMPLES } from '../src/examples/catalog.ts';
import { PREVIEW_PARTS_LIMIT, boxesPreviewSvg, expandSvgCanvas } from '../src/examples/exampleVisuals.ts';
import { buildSvg } from '../src/io/export.ts';
import { THEMES } from '../src/model/themes.ts';
import { Simulator } from '../src/sim/simulator.ts';

const OUT = join(process.cwd(), 'public', 'example-previews');
const COUNTS = join(process.cwd(), 'src', 'examples', 'exampleCounts.ts');

function countsSource(counts: Record<string, number>): string {
  const lines = Object.entries(counts).map(([id, n]) => `  ${id}: ${n},`);
  return `/** Component counts shown on example cards. Written by scripts/generate-example-previews.ts. */\nexport const EXAMPLE_PIECES: Record<string, number> = {\n${lines.join('\n')}\n};\n`;
}

async function main(): Promise<void> {
  for (const theme of THEMES) await mkdir(join(OUT, theme.id), { recursive: true });
  const counts: Record<string, number> = {};
  for (const group of EXAMPLES) {
    for (const ex of group.items) {
      process.stdout.write(`${ex.id}… `);
      const doc = ex.build();
      const n = doc.components.size;
      counts[ex.id] = n;
      const boxesOnly = n > PREVIEW_PARTS_LIMIT;
      if (boxesOnly && doc.boxes.size === 0) console.warn('(no boxes) ');
      for (const theme of THEMES) {
        const file = join(OUT, theme.id, `${ex.id}.svg`);
        if (!boxesOnly && existsSync(file)) {
          const prev = await readFile(file, 'utf8');
          const next = expandSvgCanvas(prev);
          if (next !== prev) await writeFile(file, next, 'utf8');
          continue;
        }
        let body: string;
        if (boxesOnly) {
          body = boxesPreviewSvg(doc, theme);
        } else {
          const sim = new Simulator();
          sim.compile(doc);
          if (!sim.settle(5000)) process.stdout.write('(no settle) ');
          body = buildSvg(doc, theme, sim).svg;
        }
        await writeFile(file, expandSvgCanvas(body), 'utf8');
      }
      console.log(boxesOnly ? `${n} pieces, boxes` : `${n} pieces`);
    }
  }
  await writeFile(COUNTS, countsSource(counts), 'utf8');
  console.log(`Wrote previews under ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
