import { useState } from 'react';
import { parseSheetPaste } from './sheetPaste.js';

interface MatrixPasteEntryProps {
  // Emit a validated 8x8 matrix (numbers 0–20), or null when there's no
  // valid paste loaded. Caller decides what to do with it.
  readonly onMatrixChange: (matrix: readonly (readonly number[])[] | null) => void;
}

// Standard-mode-only paste flow. Atlas mode falls back to the grid since
// the sheet codes are a 0–20 vocabulary.
export function MatrixPasteEntry({ onMatrixChange }: MatrixPasteEntryProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [validated, setValidated] = useState<readonly (readonly number[])[] | null>(null);

  function handleValidate(): void {
    const r = parseSheetPaste(text);
    if (r.ok) {
      setError(null);
      setValidated(r.viewA);
      onMatrixChange(r.viewA);
    } else {
      setError(r.error);
      setValidated(null);
      onMatrixChange(null);
    }
  }

  function handleClear(): void {
    setText('');
    setError(null);
    setValidated(null);
    onMatrixChange(null);
  }

  return (
    <div className="space-y-3" data-testid="matrix-paste-entry">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Paste 8 rows × 8 tab-separated cells from your team sheet.\nExample cell: "R, Y, +"'}
        rows={9}
        className="w-full rounded border border-slate-700 bg-slate-900/60 p-2 font-mono text-xs text-slate-100"
        data-testid="matrix-paste-textarea"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleValidate}
          disabled={text.trim().length === 0}
          className="rounded bg-sky-600 px-3 py-1 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          data-testid="matrix-paste-validate"
        >
          Validate
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
          data-testid="matrix-paste-clear"
        >
          Clear
        </button>
        {validated !== null && (
          <span className="text-xs text-emerald-400" data-testid="matrix-paste-ok">
            ✓ Valid 8×8 matrix
          </span>
        )}
      </div>
      {error !== null && (
        <p
          className="rounded border border-rose-700 bg-rose-900/40 p-2 text-sm text-rose-200"
          data-testid="matrix-paste-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
