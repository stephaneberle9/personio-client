/**
 * Normalize an absence-status value to the raw v2 enum key form used by a
 * `statusLabels` map: uppercased, with runs of whitespace collapsed to single
 * underscores. This lets one label map serve both sources — the `/v2` API's raw
 * enums (`"APPROVED"`) and the Reporting-v2 read's title-case English labels
 * (`"Approved"`, `"Pending approval"`) collapse to the same key
 * (`"APPROVED"`, `"PENDING_APPROVAL"`).
 */
function statusKey(status: string): string {
  return status.trim().toUpperCase().replace(/\s+/g, '_');
}

/**
 * Remap a status value through the caller-supplied label table, matching on the
 * normalized enum key (see {@link statusKey}) so both raw enums and title-case
 * English labels resolve identically. The map is a free relabeling (localization
 * is just the common case), so this is deliberately not named `localize`. Values
 * without an entry pass through **unchanged** — the original string, not the
 * normalized key — so an empty map (option absent) is a byte-for-byte identity.
 */
export function mapStatusLabel(status: string, labels: Record<string, string>): string {
  return labels[statusKey(status)] ?? status;
}
