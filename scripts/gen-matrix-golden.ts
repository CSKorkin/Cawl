// Run once to generate matrix-golden.json. Execute with:
//   node --loader ts-node/esm scripts/gen-matrix-golden.ts
// Or use the inline approach below via vitest's own runner.
import { generateMatrix } from '../src/engine/matrix.js';
import { seed } from '../src/engine/rng.js';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN_SEED = 0x4040;
const { matrix } = generateMatrix(seed(GOLDEN_SEED), 'standard');
const fixture = { seed: GOLDEN_SEED, matrix };
const outPath = join(__dirname, '../src/engine/__fixtures__/matrix-golden.json');
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
console.log('Written to', outPath);
