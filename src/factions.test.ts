import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FACTIONS, findFaction } from './factions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

describe('factions catalog', () => {
  it('contains all 23 V1 factions', () => {
    expect(FACTIONS).toHaveLength(23);
  });

  it('every entry has a unique slug id', () => {
    const ids = FACTIONS.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a non-empty displayName', () => {
    for (const f of FACTIONS) {
      expect(f.displayName.length).toBeGreaterThan(0);
    }
  });

  it('every logoPath points to a real file under /public/logos/', () => {
    for (const f of FACTIONS) {
      // logoPath is a URL-style path (leading slash); resolve against /public.
      const filePath = join(PUBLIC_DIR, f.logoPath);
      expect(existsSync(filePath), `missing logo for ${f.displayName} at ${filePath}`).toBe(true);
    }
  });

  it('ids are kebab-case slugs (no whitespace, lowercase)', () => {
    for (const f of FACTIONS) {
      expect(f.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('is sorted alphabetically by displayName (case-insensitive)', () => {
    const names = FACTIONS.map(f => f.displayName.toLowerCase());
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe('findFaction', () => {
  it('returns the faction for a valid id', () => {
    const f = findFaction('space-marines');
    expect(f?.displayName).toBe('Space Marines');
  });

  it('returns undefined for an unknown id', () => {
    expect(findFaction('not-a-faction')).toBeUndefined();
  });
});
