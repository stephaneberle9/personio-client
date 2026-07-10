/**
 * Cell-wise comparison of two .xlsx files (candidate vs. reference).
 *
 * - Sheets are paired by position. Differing sheet names are reported as a
 *   note, not a failure (report exports carry the truncated report title as
 *   sheet name, the exporter uses a generic one).
 * - Data rows are matched by a composite key, not by position, so files with
 *   different sort orders compare cleanly. The key is auto-detected for
 *   attendance and absence sheets and can be overridden via --key. When a key
 *   occurs more than once (e.g. several bookings per person/day/project), the
 *   most similar rows are paired greedily. Rows without a partner are
 *   reported as candidate-only / reference-only (data drift), separate from
 *   cell diffs.
 * - Distinguishes real value differences from format-only differences (same
 *   value, different representation - e.g. "71808" as string vs. 71808 as
 *   number, or an Excel date serial vs. an ISO date string). Empty string and
 *   empty cell are treated as equal; the report placeholder "Nicht
 *   zugewiesen" vs. an empty cell counts as format-only.
 *
 * Usage (from the repo root):
 *
 *   npx tsx scripts/compare-xlsx.ts <candidate.xlsx> <reference.xlsx> [options]
 *
 * Options:
 *   --max-diffs <n>     cap on printed diff lines (default 50; a bare numeric
 *                       third argument is accepted for backwards compatibility)
 *   --key <cols>        comma-separated header names to use as the row key
 *                       (overrides auto-detection)
 *   --ignore <cols>     comma-separated header names to exclude from the cell
 *                       comparison (e.g. columns the api source is known not
 *                       to deliver: "Abteilung,Status Attest")
 *   --allow-unmatched   do not fail on unmatched rows (expected data drift)
 *
 * Header names in --key/--ignore can be typed with plain spaces; the Personio
 * report headers contain non-breaking spaces, which are normalized for
 * matching (byte-level header parity is still checked separately).
 *
 * Exit code: 0 = parity (format-only diffs allowed), 1 = value diffs, header
 * mismatches, unpaired sheets, or unmatched rows (unless --allow-unmatched).
 */
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

type Cell = string | number | boolean | Date | null;

// ---------- CLI ----------

const rawArgs = process.argv.slice(2);
const positional: string[] = [];
let maxDiffs = 50;
let keyOverride: string[] | null = null;
let ignoreCols = new Set<string>();
let allowUnmatched = false;

for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--max-diffs') maxDiffs = Number(rawArgs[++i]);
  else if (a === '--key') keyOverride = String(rawArgs[++i]).split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--ignore') ignoreCols = new Set(String(rawArgs[++i]).split(',').map((s) => normHeader(s)).filter(Boolean));
  else if (a === '--allow-unmatched') allowUnmatched = true;
  else positional.push(a);
}

const [candidatePath, referencePath, legacyMaxDiffs] = positional;
if (!candidatePath || !referencePath) {
  console.error(
    'Usage: tsx scripts/compare-xlsx.ts <candidate.xlsx> <reference.xlsx> ' +
      '[--max-diffs <n>] [--key <cols>] [--ignore <cols>] [--allow-unmatched]',
  );
  process.exit(2);
}
if (legacyMaxDiffs !== undefined && Number.isFinite(Number(legacyMaxDiffs))) {
  maxDiffs = Number(legacyMaxDiffs);
}

const EPS = 1e-9;

// Joins the parts of a composite row key; a control character (U+0001)
// guarantees the separator never occurs inside a cell value. Built via
// fromCharCode so the source file stays free of invisible characters.
const KEY_SEP = String.fromCharCode(0x01);

// Non-breaking space (U+00A0): Personio report headers contain it before the
// dash (e.g. in "Anwesenheitsprojekt - Code" the space before "-" is U+00A0).
const NBSP_RE = new RegExp(String.fromCharCode(0xa0), 'g');

// ---------- date handling ----------

// ISO date or date-time string, e.g. "2026-04-01" or "2026-04-02T00:00:00".
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

// Plausible Excel date serial range (1900 date system): ~1954 to ~2119.
// Guards against treating 5-digit personnel numbers as dates; the string
// side must additionally match ISO_DATE_RE before a serial is converted.
const SERIAL_MIN = 20000;
const SERIAL_MAX = 80000;

/** Excel 1900-system serial to "yyyy-mm-ddThh:mm:ss" (UTC math, no DST). */
function serialToIso(n: number): string {
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 19);
}

/** Canonical ISO form: date only if midnight, else date + time. */
function isoNorm(s: string): string {
  const t = s.trim().replace(' ', 'T').replace(/Z$/, '');
  const [date, time] = t.split('T');
  if (!time || /^00:00(?::00(?:\.0+)?)?$/.test(time)) return date;
  return `${date}T${time.slice(0, 8)}`;
}

/** True if an Excel date serial and an ISO date(-time) string denote the same moment. */
function dateEquivalent(num: number, str: string): boolean {
  if (num < SERIAL_MIN || num > SERIAL_MAX) return false;
  const t = str.trim();
  if (!ISO_DATE_RE.test(t)) return false;
  return isoNorm(serialToIso(num)) === isoNorm(t);
}

// ---------- cell comparison ----------

/** Trims strings, maps "" to null, dates to canonical ISO. */
function norm(v: Cell): Cell {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (v instanceof Date) return isoNorm(v.toISOString());
  return v;
}

function sameValue(a: Cell, b: Cell): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x === null && y === null) return true;
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) < EPS;
  return x === y;
}

// The Personio report renders unassigned values as this placeholder where
// the v2 API delivers nothing; treat placeholder vs. empty as format-only.
const UNASSIGNED = 'Nicht zugewiesen';

/** Same content, different representation (string "3.5" vs number 3.5, serial vs ISO string, etc.). */
function formatOnly(a: Cell, b: Cell): boolean {
  const x = norm(a);
  const y = norm(b);
  if ((x === UNASSIGNED && y === null) || (y === UNASSIGNED && x === null)) return true;
  if (x === null || y === null) return false;
  if (typeof x === typeof y) return false;
  if (typeof x === 'number' && typeof y === 'string' && dateEquivalent(x, y)) return true;
  if (typeof y === 'number' && typeof x === 'string' && dateEquivalent(y, x)) return true;
  const xn = typeof x === 'number' ? x : Number(String(x).replace(',', '.'));
  const yn = typeof y === 'number' ? y : Number(String(y).replace(',', '.'));
  if (Number.isFinite(xn) && Number.isFinite(yn)) return Math.abs(xn - yn) < EPS;
  return String(x) === String(y);
}

// ---------- row keys ----------

const ATTENDANCE_KEY = ['Kostenträger Nummer', 'Anwesenheitsdatum', 'Anwesenheitsprojekt – Code'];
const ABSENCE_KEY = ['Kostenträger Nummer', 'Abwesenheitsart', 'Startdatum der Abwesenheit'];

/**
 * Header matching form: normalizes the non-breaking spaces contained in
 * Personio report headers to plain spaces, so key/ignore names can be given
 * the way the headers read.
 */
function normHeader(s: string): string {
  return s.replace(NBSP_RE, ' ').trim();
}

function detectKey(headers: string[]): string[] | null {
  const h = new Set(headers.map(normHeader));
  if (ATTENDANCE_KEY.every((k) => h.has(k))) return ATTENDANCE_KEY;
  if (ABSENCE_KEY.every((k) => h.has(k))) return ABSENCE_KEY;
  return null;
}

/** Canonical string form of a cell for key building. */
function canonCell(v: Cell, dateCol: boolean): string {
  const n = norm(v);
  if (n === null) return '';
  if (typeof n === 'number') {
    if (dateCol && n >= SERIAL_MIN && n <= SERIAL_MAX) return isoNorm(serialToIso(n));
    return Math.abs(n - Math.round(n)) < EPS ? String(Math.round(n)) : String(n);
  }
  if (typeof n === 'string' && dateCol && ISO_DATE_RE.test(n)) return isoNorm(n);
  return String(n);
}

// ---------- workbook loading ----------

function toMatrix(ws: XLSX.WorkSheet): Cell[][] {
  return XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: null });
}

// XLSX.read with a buffer instead of XLSX.readFile: the ESM build of SheetJS
// requires explicit fs wiring for readFile; reading via node:fs avoids that.
const cand = XLSX.read(readFileSync(candidatePath), { type: 'buffer' });
const ref = XLSX.read(readFileSync(referencePath), { type: 'buffer' });

// ---------- comparison ----------

let valueDiffs = 0;
let formatDiffs = 0;
let headerIssues = 0;
let sheetIssues = 0;
let candOnlyTotal = 0;
let refOnlyTotal = 0;
let printed = 0;

function log(line: string): void {
  if (printed < maxDiffs) {
    console.log(line);
    printed++;
  }
}

function compareSheet(label: string, wsCand: XLSX.WorkSheet, wsRef: XLSX.WorkSheet): void {
  const a = toMatrix(wsCand);
  const b = toMatrix(wsRef);
  const headers = (b[0] ?? []).map((h) => String(h ?? ''));
  const headersA = (a[0] ?? []).map((h) => String(h ?? ''));

  // Header row: compare positionally, must be byte-identical.
  const headerCols = Math.max(headers.length, headersA.length);
  for (let c = 0; c < headerCols; c++) {
    if ((headersA[c] ?? '') !== (headers[c] ?? '')) {
      log(`[${label}] HEADER col ${c + 1}: candidate=${JSON.stringify(headersA[c] ?? null)} reference=${JSON.stringify(headers[c] ?? null)}`);
      headerIssues++;
    }
  }

  // Per-column date detection (a column is a date column if either side
  // holds ISO date strings or Date objects in it).
  const colCount = headerCols;
  const dateFlags: boolean[] = new Array(colCount).fill(false);
  for (const mat of [a, b]) {
    for (let r = 1; r < mat.length; r++) {
      const row = mat[r] ?? [];
      for (let c = 0; c < colCount; c++) {
        if (dateFlags[c]) continue;
        const v = row[c];
        if (v instanceof Date || (typeof v === 'string' && v.trim() !== '' && ISO_DATE_RE.test(v.trim()))) {
          dateFlags[c] = true;
        }
      }
    }
  }

  // Resolve key columns (lookups on normalized headers, see normHeader).
  const headersNorm = headers.map(normHeader);
  const keyHeaders = keyOverride ?? detectKey(headers);
  let keyIdx: number[] | null = null;
  if (keyHeaders) {
    keyIdx = keyHeaders.map((k) => headersNorm.indexOf(normHeader(k)));
    const missing = keyHeaders.filter((_, i) => keyIdx![i] < 0);
    if (missing.length > 0) {
      console.error(`[${label}] key column(s) not found in reference headers: ${missing.join(', ')}`);
      process.exit(2);
    }
    console.log(`[${label}] matching rows by key: ${keyHeaders.join(' + ')}`);
  } else {
    console.log(`[${label}] no key detected (unknown sheet type), falling back to positional row comparison`);
  }

  const rowKey = (mat: Cell[][], r: number): string => {
    if (!keyIdx) return String(r);
    const row = mat[r] ?? [];
    return keyIdx.map((c) => canonCell(row[c] ?? null, dateFlags[c] ?? false)).join(KEY_SEP);
  };

  const buildIndex = (mat: Cell[][]): Map<string, number[]> => {
    const m = new Map<string, number[]>();
    for (let r = 1; r < mat.length; r++) {
      const key = rowKey(mat, r);
      const list = m.get(key);
      if (list) list.push(r);
      else m.set(key, [r]);
    }
    return m;
  };

  const idxA = buildIndex(a);
  const idxB = buildIndex(b);

  // Number of value-level cell differences between two rows (format-only
  // differences do not count); used to pair the most similar rows when a
  // key occurs more than once (e.g. several bookings per person/day/project).
  const rowDiffCount = (rowA: Cell[], rowB: Cell[]): number => {
    const cols = Math.max(rowA.length, rowB.length);
    let d = 0;
    for (let c = 0; c < cols; c++) {
      const va = rowA[c] ?? null;
      const vb = rowB[c] ?? null;
      if (!sameValue(va, vb) && !formatOnly(va, vb)) d++;
    }
    return d;
  };

  const pairs: Array<[number, number]> = [];
  const candOnly: Array<{ r: number; key: string }> = [];
  const refOnly: Array<{ r: number; key: string }> = [];
  const allKeys = new Set([...idxA.keys(), ...idxB.keys()]);
  for (const key of allKeys) {
    const la = idxA.get(key) ?? [];
    const lb = idxB.get(key) ?? [];
    if (la.length === 1 && lb.length === 1) {
      pairs.push([la[0], lb[0]]);
      continue;
    }
    // Greedy best-match pairing within the key group.
    const costs: Array<{ i: number; j: number; cost: number }> = [];
    for (let i = 0; i < la.length; i++) {
      for (let j = 0; j < lb.length; j++) {
        costs.push({ i, j, cost: rowDiffCount(a[la[i]] ?? [], b[lb[j]] ?? []) });
      }
    }
    costs.sort((p, q) => p.cost - q.cost);
    const usedA = new Set<number>();
    const usedB = new Set<number>();
    for (const { i, j } of costs) {
      if (usedA.has(i) || usedB.has(j)) continue;
      usedA.add(i);
      usedB.add(j);
      pairs.push([la[i], lb[j]]);
    }
    for (let i = 0; i < la.length; i++) if (!usedA.has(i)) candOnly.push({ r: la[i], key });
    for (let j = 0; j < lb.length; j++) if (!usedB.has(j)) refOnly.push({ r: lb[j], key });
  }
  pairs.sort((p, q) => p[1] - q[1]);

  if (a.length !== b.length) {
    console.log(`[${label}] row count differs: candidate=${a.length} reference=${b.length}`);
  }

  // Cell comparison on matched pairs.
  let sheetValue = 0;
  let sheetFormat = 0;
  for (const [ra, rb] of pairs) {
    const rowA = a[ra] ?? [];
    const rowB = b[rb] ?? [];
    const cols = Math.max(rowA.length, rowB.length);
    for (let c = 0; c < cols; c++) {
      const labelCol = headers[c] || `col ${c + 1}`;
      if (ignoreCols.has(normHeader(labelCol))) continue;
      const va = rowA[c] ?? null;
      const vb = rowB[c] ?? null;
      if (sameValue(va, vb)) continue;
      const where = `cand row ${ra + 1} / ref row ${rb + 1}`;
      if (formatOnly(va, vb)) {
        formatDiffs++;
        sheetFormat++;
        log(`[${label}] ${where}, ${labelCol}: FORMAT ${JSON.stringify(va)} vs ${JSON.stringify(vb)}`);
      } else {
        valueDiffs++;
        sheetValue++;
        log(`[${label}] ${where}, ${labelCol}: VALUE  candidate=${JSON.stringify(va)} reference=${JSON.stringify(vb)}`);
      }
    }
  }

  // Unmatched rows (data drift or genuine gaps).
  const fmtKey = (k: string) => k.split(KEY_SEP).join(' | ');
  for (const u of candOnly) log(`[${label}] only in candidate: row ${u.r + 1}, key = ${fmtKey(u.key)}`);
  for (const u of refOnly) log(`[${label}] only in reference: row ${u.r + 1}, key = ${fmtKey(u.key)}`);
  candOnlyTotal += candOnly.length;
  refOnlyTotal += refOnly.length;

  console.log(
    `[${label}] done: ${pairs.length} matched row pair(s), ${sheetValue} value diff(s), ` +
      `${sheetFormat} format-only diff(s), ${candOnly.length} candidate-only row(s), ${refOnly.length} reference-only row(s)`,
  );
}

// Pair sheets by position; differing names are a note, not a failure.
const sheetPairs = Math.min(cand.SheetNames.length, ref.SheetNames.length);
for (let i = 0; i < sheetPairs; i++) {
  const nameCand = cand.SheetNames[i];
  const nameRef = ref.SheetNames[i];
  if (nameCand !== nameRef) {
    console.log(`SHEET NAME differs (paired by position ${i + 1}): candidate="${nameCand}" reference="${nameRef}"`);
  }
  compareSheet(nameRef, cand.Sheets[nameCand], ref.Sheets[nameRef]);
}
for (let i = sheetPairs; i < ref.SheetNames.length; i++) {
  console.log(`SHEET MISSING in candidate: "${ref.SheetNames[i]}"`);
  sheetIssues++;
}
for (let i = sheetPairs; i < cand.SheetNames.length; i++) {
  console.log(`SHEET EXTRA in candidate:   "${cand.SheetNames[i]}"`);
  sheetIssues++;
}

console.log(
  `\nTOTAL: ${valueDiffs} value diff(s), ${formatDiffs} format-only diff(s), ${headerIssues} header issue(s), ` +
    `${sheetIssues} sheet issue(s), ${candOnlyTotal} candidate-only row(s), ${refOnlyTotal} reference-only row(s)` +
    (printed >= maxDiffs ? ` (output capped at ${maxDiffs}, raise --max-diffs to see all)` : ''),
);

const unmatchedFail = !allowUnmatched && candOnlyTotal + refOnlyTotal > 0;
process.exit(valueDiffs > 0 || headerIssues > 0 || sheetIssues > 0 || unmatchedFail ? 1 : 0);
