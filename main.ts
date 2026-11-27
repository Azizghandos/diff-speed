// Driver for the diff program. Reads every case from the input directory,
// answers each one with the patch from solve.js, and writes the answers as
// JSON into the output directory.
//
// Input:  $MAKEFUN_INPUT_DIR/cases.json  (defaults to /input/cases.json)
// Output: $MAKEFUN_OUTPUT_DIR/answers.json (defaults to /output/answers.json)
//
// The driver turns V8's incremental marking off before importing solve.js,
// matching the house baseline's timing setup, and it does nothing else on
// top: all of the work is in solve.js, and the answers are deterministic.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking');

const { run } = await import(new URL('./solve.js', import.meta.url).href);

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
if (!Array.isArray(cases)) throw new Error('cases.json is not an array of cases');
const answers = [];
for (const c of cases) {
  if (c === null || typeof c !== 'object' || !('input' in c)) throw new Error('a case has no input');
  answers.push(run(c.input));
}
if (answers.length !== cases.length) throw new Error('the answers are fewer than the cases');
mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'answers.json'), JSON.stringify(answers));
