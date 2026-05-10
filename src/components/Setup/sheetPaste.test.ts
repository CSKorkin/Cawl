import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSheetPaste } from './sheetPaste.js';

// Reference example from the team — the same paste we used to design the
// parser. The expected matrix is the user-confirmed 8x8 of integer scores.
const EXAMPLE_PATH = resolve(process.cwd(), 'reference/example_matrix_paste.txt');
const EXPECTED: readonly (readonly number[])[] = [
  [ 7, 10, 11,  6, 13, 10, 13,  6],
  [ 9, 10, 13, 13, 10, 10, 16,  9],
  [ 9, 11, 11,  8, 11, 10, 13, 13],
  [ 6,  6, 10, 11, 11, 10, 13, 14],
  [ 6,  6,  6, 14, 12,  7, 11, 13],
  [10, 10, 10,  6, 11, 10, 11,  6],
  [ 9, 13, 12, 13, 12, 10, 11,  9],
  [15,  9, 14,  7, 15, 14, 20, 16],
];

describe('parseSheetPaste — reference example', () => {
  it('parses the reference matrix to the user-confirmed 8x8 of scores', () => {
    const raw = readFileSync(EXAMPLE_PATH, 'utf8');
    const r = parseSheetPaste(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.viewA).toEqual(EXPECTED);
  });
});

describe('parseSheetPaste — single-cell scoring rules', () => {
  function score(cell: string): number {
    const row = (Array(8).fill('Y') as string[]);
    row[0] = cell;
    const grid = Array(8).fill(row.join('\t')).join('\n');
    const r = parseSheetPaste(grid);
    if (!r.ok) throw new Error(r.error);
    return r.viewA[0]![0]!;
  }

  it('primary alone → primary value', () => {
    expect(score('RR')).toBe(2);
    expect(score('R')).toBe(6);
    expect(score('Y')).toBe(10);
    expect(score('G')).toBe(13);
    expect(score('GG')).toBe(16);
    expect(score('BOUYA')).toBe(20);
    expect(score('F')).toBe(8);
  });

  it('primary + secondary → round((primary*2 + secondary)/3)', () => {
    expect(score('GG, G')).toBe(15);     // (32+13)/3 = 15
    expect(score('R, Y, +')).toBe(7);    // (12+10)/3 = 7.33 → 7
    expect(score('R, F, +')).toBe(7);    // (12+8)/3 = 6.67 → 7
    expect(score('F, G')).toBe(10);      // (16+13)/3 = 9.67 → 10
    expect(score('R, R, +')).toBe(6);    // (12+6)/3 = 6
  });

  it('table markers (+, -, ++, --, ?, +/-) are ignored', () => {
    expect(score('Y, +')).toBe(10);
    expect(score('Y, -')).toBe(10);
    expect(score('Y, ++')).toBe(10);
    expect(score('Y, --')).toBe(10);
    expect(score('Y, ?')).toBe(10);
    expect(score('Y, +/-')).toBe(10);
    expect(score('Y, +, -, ?, ++, --, +/-')).toBe(10);
  });

  it('case-insensitive on color codes', () => {
    expect(score('bouya')).toBe(20);
    expect(score('gg, g')).toBe(15);
  });
});

describe('parseSheetPaste — error reporting', () => {
  function eight(cell: string): string {
    return Array(8).fill(cell).join('\t');
  }

  it('flags wrong row count', () => {
    const grid = Array(7).fill(eight('Y')).join('\n');
    const r = parseSheetPaste(grid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/8 rows.*found 7/);
  });

  it('flags wrong column count and names the offending row', () => {
    const rows = [
      eight('Y'),
      Array(7).fill('Y').join('\t'), // 7 cols on row 2
      eight('Y'), eight('Y'), eight('Y'),
      eight('Y'), eight('Y'), eight('Y'),
    ];
    const r = parseSheetPaste(rows.join('\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Row 2.*8 tab-separated cells.*found 7/);
  });

  it('flags an unrecognized token with row/column coordinates', () => {
    const rows = [
      eight('Y'),
      eight('Y'),
      ['Y', 'Y', 'Y', 'Y', 'Y', 'XYZ', 'Y', 'Y'].join('\t'),
      eight('Y'), eight('Y'), eight('Y'), eight('Y'), eight('Y'),
    ];
    const r = parseSheetPaste(rows.join('\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/Row 3, column 6/);
      expect(r.error).toMatch(/XYZ/);
    }
  });

  it('rejects cells without comma separation ("RG" or "R G")', () => {
    for (const bad of ['RG', 'R G', 'GG  R']) {
      const rows = [eight('Y'), eight('Y'), eight('Y'),
        ['Y', 'Y', 'Y', bad, 'Y', 'Y', 'Y', 'Y'].join('\t'),
        eight('Y'), eight('Y'), eight('Y'), eight('Y')];
      const r = parseSheetPaste(rows.join('\n'));
      expect(r.ok, `"${bad}" should be rejected`).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Row 4, column 4/);
    }
  });

  it('rejects empty cells', () => {
    const rows = [eight('Y'),
      ['Y', '', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y'].join('\t'),
      eight('Y'), eight('Y'), eight('Y'), eight('Y'), eight('Y'), eight('Y')];
    const r = parseSheetPaste(rows.join('\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Row 2, column 2.*empty/);
  });

  it('rejects cells with no color (markers only)', () => {
    const rows = [
      ['+, -', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y', 'Y'].join('\t'),
      eight('Y'), eight('Y'), eight('Y'), eight('Y'),
      eight('Y'), eight('Y'), eight('Y'),
    ];
    const r = parseSheetPaste(rows.join('\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Row 1, column 1.*no color/i);
  });

  it('tolerates trailing blank lines (Sheets often appends one)', () => {
    const grid = Array(8).fill(eight('Y')).join('\n') + '\n\n';
    const r = parseSheetPaste(grid);
    expect(r.ok).toBe(true);
  });
});
