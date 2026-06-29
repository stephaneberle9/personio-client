/**
 * Minimal CLI argument parser for the example scripts: turns `--key value` and
 * `--flag` into a map. No dependency, English flag names only. Unknown keys are
 * preserved so each script validates its own required set.
 */
export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** Require a string-valued argument, exiting with a clear message if missing. */
export function requireString(
  args: Record<string, string | boolean>,
  key: string
): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required --${key} argument`);
  }
  return value;
}

/** Parse a comma-separated list argument into trimmed, non-empty tokens. */
export function parseList(value: string | boolean | undefined): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
