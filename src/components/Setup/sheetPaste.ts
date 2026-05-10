// Parses the sheet-paste format used by competitive 40k WTC teams.
//
// Cells are tab-separated (one row per line). Within each cell, comma-
// separated tokens describe the matchup:
//   Color codes (single token, case-insensitive): RR=2, R=6, Y=10, G=13,
//   GG=16, BOUYA=20, F=8.
//   First color encountered = primary, second = secondary, anything else =
//   table marker (ignored: +, -, ++, --, ?, +/-).
//
// Score rule: primary alone → primary value; primary + secondary →
// round((primary*2 + secondary) / 3).
//
// Validation is strict and stops at the first error so the message is
// unambiguous: "Row 4, cell 3: ...". Errors flag the bad row/column with
// a 1-indexed coordinate and the offending text.

const COLOR_VALUES: Record<string, number> = {
  RR: 2,
  R: 6,
  Y: 10,
  G: 13,
  GG: 16,
  BOUYA: 20,
  F: 8,
};

const TABLE_MARKERS: ReadonlySet<string> = new Set([
  '+', '-', '++', '--', '?', '+/-',
]);

const REQUIRED_ROWS = 8;
const REQUIRED_COLS = 8;

export interface SheetParseSuccess {
  readonly ok: true;
  // 8×8 of integer scores in [0, 20], indexed [row][col].
  readonly viewA: readonly (readonly number[])[];
}

export interface SheetParseFailure {
  readonly ok: false;
  // Human-readable message naming exactly which row/column is wrong.
  readonly error: string;
}

export type SheetParseResult = SheetParseSuccess | SheetParseFailure;

export function parseSheetPaste(input: string): SheetParseResult {
  // Normalize: split on \n, drop trailing whitespace per line, drop empty
  // trailing lines (Sheets often appends one).
  const rawLines = input.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  for (const l of rawLines) {
    const trimmed = l.replace(/\s+$/, '');
    if (trimmed.length > 0) lines.push(trimmed);
  }

  if (lines.length !== REQUIRED_ROWS) {
    return failure(
      `Expected ${REQUIRED_ROWS} rows, found ${lines.length}.`,
    );
  }

  const viewA: number[][] = [];
  for (let r = 0; r < REQUIRED_ROWS; r++) {
    const cells = lines[r]!.split('\t');
    if (cells.length !== REQUIRED_COLS) {
      return failure(
        `Row ${r + 1}: expected ${REQUIRED_COLS} tab-separated cells, found ${cells.length}.`,
      );
    }
    const row: number[] = [];
    for (let c = 0; c < REQUIRED_COLS; c++) {
      const cellResult = parseCell(cells[c]!, r + 1, c + 1);
      if (!cellResult.ok) return cellResult;
      row.push(cellResult.value);
    }
    viewA.push(row);
  }

  return { ok: true, viewA };
}

interface CellOk {
  readonly ok: true;
  readonly value: number;
}
interface CellErr {
  readonly ok: false;
  readonly error: string;
}
type CellResult = CellOk | CellErr;

function parseCell(raw: string, row: number, col: number): CellResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return cellFailure(row, col, raw, 'cell is empty');
  }

  // Comma-split. Reject cells that pack multiple tokens without commas
  // (e.g. "RG", "R Y") — comma separation is enforced.
  const tokens = trimmed.split(',').map((t) => t.trim());
  for (const tok of tokens) {
    if (tok.length === 0) {
      return cellFailure(row, col, raw, 'empty token (stray comma?)');
    }
    if (!isSingleToken(tok)) {
      return cellFailure(
        row,
        col,
        raw,
        `"${tok}" is not a recognized code; comma-separate codes (e.g. "R, G")`,
      );
    }
  }

  // First color encountered = primary; second = secondary. Everything else
  // must be a known table marker.
  let primary: number | null = null;
  let secondary: number | null = null;
  for (const tok of tokens) {
    const upper = tok.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(COLOR_VALUES, upper)) {
      const value = COLOR_VALUES[upper]!;
      if (primary === null) primary = value;
      else if (secondary === null) secondary = value;
      // Third+ color is silently treated as ignored — sheets occasionally
      // duplicate; tightening this would surface false positives.
    } else if (TABLE_MARKERS.has(tok)) {
      // ignore table markers
    } else {
      return cellFailure(
        row,
        col,
        raw,
        `"${tok}" is not a recognized color or table marker`,
      );
    }
  }

  if (primary === null) {
    return cellFailure(row, col, raw, 'no color code found');
  }

  const score = secondary === null
    ? primary
    : Math.round((primary * 2 + secondary) / 3);
  return { ok: true, value: score };
}

// A "single token" is a whitespace-free string. We reject "R G" or "RG" as
// combined-without-comma. Note: marker "+/-" contains a slash and is
// treated as a single token by our split-on-comma path.
function isSingleToken(tok: string): boolean {
  return !/\s/.test(tok);
}

function cellFailure(row: number, col: number, raw: string, why: string): CellErr {
  return {
    ok: false,
    error: `Row ${row}, column ${col} ("${raw.trim()}"): ${why}.`,
  };
}

function failure(error: string): SheetParseFailure {
  return { ok: false, error };
}
