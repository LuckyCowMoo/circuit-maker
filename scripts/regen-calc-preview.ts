import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { calculatorDoc } from '../src/examples/calculator.ts';
import { boxesPreviewSvg, expandSvgCanvas } from '../src/examples/exampleVisuals.ts';
import { THEMES } from '../src/model/themes.ts';

const doc = calculatorDoc();
for (const theme of THEMES) {
  const dir = join('public/example-previews', theme.id);
  mkdirSync(dir, { recursive: true });
  const body = expandSvgCanvas(boxesPreviewSvg(doc, theme));
  writeFileSync(join(dir, 'calc.svg'), body);
  console.log(theme.id, body.length);
}
