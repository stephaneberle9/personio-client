import { writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { Cell } from './model/sheetContent.js';

/**
 * Build a single-sheet workbook from a header row plus data rows (array of
 * arrays). Header strings are written verbatim — including non-breaking spaces
 * and en-dashes — so the output matches the reference format byte-for-byte.
 *
 * Data cells may be plain values, explicit typed cells (`{ t, v, z }` for real
 * date/number cells with a display format), or `null` for a truly empty cell.
 * `aoa_to_sheet` preserves typed cell objects as-is and emits no cell for
 * `null`, so the output reproduces the reference's cell types and formats.
 */
export function buildSheetWorkbook(
  sheetName: string,
  headers: readonly string[],
  rows: Array<Array<Cell>>
): XLSX.WorkBook {
  const aoa: Array<Array<Cell>> = [[...headers], ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });
  const workbook = XLSX.utils.book_new();
  // Excel limits sheet names to 31 characters; the reference names already fit.
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  return workbook;
}

/** Read back the first row (headers) of the first sheet — used by tests. */
export function readHeaderRow(workbook: XLSX.WorkBook): string[] {
  const sheetName = workbook.SheetNames[0]!;
  const sheet = workbook.Sheets[sheetName]!;
  const aoa = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
  return (aoa[0] ?? []).map((cell) => String(cell));
}

export function writeWorkbook(workbook: XLSX.WorkBook, path: string): void {
  // The SheetJS ESM build is browser-safe and does not wire Node's fs, so
  // `XLSX.writeFile` throws "cannot save file". Serialize to a buffer and write
  // it with node:fs instead — the same approach scripts/compare-xlsx.ts uses on
  // the read side (`XLSX.read(readFileSync(...))`).
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(path, buffer);
}
