/**
 * Cell-wise comparison of two .xlsx files (candidate vs. reference).
 *
 * Distinguishes real value differences from format-only differences
 * (same value, different cell type — e.g. "71808" as string vs. 71808 as
 * number, or a date stored as string vs. as date cell).
 *
 * Usage (from the repo root):
 *
 *   npx tsx scripts/compare-xlsx.ts <candidate.xlsx> <reference.xlsx> [maxDiffs]
 *
 * Exit code: 0 = identical (format-only diffs allowed), 1 = value diffs found.
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const [, , candidatePath, referencePath, maxDiffsArg] = process.argv;
if (!candidatePath || !referencePath) {
  console.error('Usage: tsx scripts/compare-xlsx.ts <candidate.xlsx> <reference.xlsx> [maxDiffs]');
  process.exit(2);
}
const maxDiffs = Number(maxDiffsArg ?? 50);
const EPS = 1e-9;

type Cell = string | number | boolean | Date | null;

function toMatrix(ws: XLSX.WorkSheet): Cell[][] {
  return XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null });
}

function norm(v: Cell): Cell {
  if (typeof v === 'string') return v.trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v;
}

function sameValue(a: Cell, b: Cell): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === null && y === null) return true;
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) < EPS;
  return x === y;
}

/** Same content, different representation (string "3.5" vs number 3.5, etc.). */
function formatOnly(a: Cell, b: Cell): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === null || y === null) return false;
  if (typeof x === typeof y) return false;
  const xn = typeof x === 'number' ? x : Number(String(x).replace(',', '.'));
  const yn = typeof y === 'number' ? y : Number(String(y).replace(',', '.'));
  if (Number.isFinite(xn) && Number.isFinite(yn)) return Math.abs(xn - yn) < EPS;
  return String(x) === String(y);
}

// XLSX.read with a buffer instead of XLSX.readFile: the ESM build of SheetJS
// requires explicit fs wiring for readFile; reading via node:fs avoids that.
const cand = XLSX.read(readFileSync(candidatePath), { type: 'buffer' });
const ref = XLSX.read(readFileSync(referencePath), { type: 'buffer' });

let valueDiffs = 0;
let formatDiffs = 0;
let printed = 0;

let sheetIssues = 0;
const candSheets = new Set(cand.SheetNames);
const refSheets = new Set(ref.SheetNames);
for (const s of ref.SheetNames) {
  if (!candSheets.has(s)) {
    console.log(`SHEET MISSING in candidate: "${s}"`);
    sheetIssues++;
  }
}
for (const s of cand.SheetNames) {
  if (!refSheets.has(s)) {
    console.log(`SHEET EXTRA in candidate:   "${s}"`);
    sheetIssues++;
  }
}

for (const sheet of ref.SheetNames.filter((s) => candSheets.has(s))) {
  const a = toMatrix(cand.Sheets[sheet]);
  const b = toMatrix(ref.Sheets[sheet]);
  const headers = (b[0] ?? []).map((h) => String(h ?? ''));
  const rows = Math.max(a.length, b.length);
  if (a.length !== b.length) {
    console.log(`[${sheet}] row count differs: candidate=${a.length} reference=${b.length}`);
  }
  let sheetValue = 0;
  let sheetFormat = 0;
  for (let r = 0; r < rows; r++) {
    const ra = a[r] ?? [];
    const rb = b[r] ?? [];
    const cols = Math.max(ra.length, rb.length);
    for (let c = 0; c < cols; c++) {
      const va = ra[c] ?? null;
      const vb = rb[c] ?? null;
      if (sameValue(va, vb)) continue;
      const label = headers[c] || `col ${c + 1}`;
      if (formatOnly(va, vb)) {
        formatDiffs++;
        sheetFormat++;
        if (printed < maxDiffs) {
          console.log(`[${sheet}] row ${r + 1}, ${label}: FORMAT ${JSON.stringify(va)} vs ${JSON.stringify(vb)}`);
          printed++;
        }
      } else {
        valueDiffs++;
        sheetValue++;
        if (printed < maxDiffs) {
          console.log(`[${sheet}] row ${r + 1}, ${label}: VALUE  candidate=${JSON.stringify(va)} reference=${JSON.stringify(vb)}`);
          printed++;
        }
      }
    }
  }
  console.log(`[${sheet}] done: ${sheetValue} value diff(s), ${sheetFormat} format-only diff(s)`);
}

console.log(
  `\nTOTAL: ${valueDiffs} value diff(s), ${formatDiffs} format-only diff(s), ${sheetIssues} sheet issue(s)` +
    (printed >= maxDiffs ? ` (output capped at ${maxDiffs}, pass a higher maxDiffs to see all)` : ''),
);
process.exit(valueDiffs > 0 || sheetIssues > 0 ? 1 : 0);
