import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// Resolve from process.cwd() rather than import.meta.url because jsdom
// reports import.meta.url as an http URL (fileURLToPath rejects non-file
// schemes). Vitest always runs from the project root.
const ENGINE_DIR = join(process.cwd(), 'src/engine');

function listEngineSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__fixtures__') continue;
      out.push(...listEngineSources(join(dir, entry.name)));
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.test.ts')) continue;
    out.push(join(dir, entry.name));
  }
  return out;
}

describe('engine invariants', () => {
  it('no engine source uses Math.random or Date.now', () => {
    const offenders: string[] = [];
    for (const path of listEngineSources(ENGINE_DIR)) {
      const src = readFileSync(path, 'utf8');
      if (src.includes('Math.random')) offenders.push(`${path}: Math.random`);
      if (src.includes('Date.now')) offenders.push(`${path}: Date.now`);
    }
    expect(offenders).toEqual([]);
  });
});
