import * as XLSX from 'xlsx';

/**
 * Build a single-sheet workbook from a header row plus data rows (array of
 * arrays). Header strings are written verbatim — including non-breaking spaces
 * and en-dashes — so the output matches the reference format byte-for-byte.
 */
export function buildSheetWorkbook(
  sheetName: string,
  headers: readonly string[],
  rows: Array<Array<string | number>>
): XLSX.WorkBook {
  const aoa: Array<Array<string | number>> = [[...headers], ...rows];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
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
  XLSX.writeFile(workbook, path);
}
