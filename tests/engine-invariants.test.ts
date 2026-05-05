import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const ENGINE_DIR = fileURLToPath(new URL('../src/engine/', import.meta.url));

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
