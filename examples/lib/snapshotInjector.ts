import type { Snapshot } from './snapshotBuilder.js';

const START = '<!-- PERSONIO_SNAPSHOT:START (generated block — safe to replace) -->';
const END = '<!-- PERSONIO_SNAPSHOT:END -->';

/** Escape a string so it is safe to embed inside a `<script>` element. */
function escapeForScript(json: string): string {
  return json.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
}

/**
 * Build the marker-delimited `<script>` block that defines `__PRELOADED_DATA__`
 * (the array a dashboard reads on startup) plus a metadata comment for audit.
 * A top-level `const` in this block is visible as a bare global to the page's
 * later scripts, exactly as the dashboard's `typeof __PRELOADED_DATA__` check
 * expects — and it leaves the page's manual Excel import untouched.
 */
export function buildSnapshotBlock(snapshot: Snapshot): string {
  const dataJson = escapeForScript(JSON.stringify(snapshot.records));
  const metaJson = escapeForScript(JSON.stringify(snapshot.meta));
  return [
    START,
    `<script>/* Personio snapshot — ${metaJson} */`,
    `const __PRELOADED_DATA__ = ${dataJson};`,
    `const __PRELOADED_SNAPSHOT_META__ = ${metaJson};`,
    `</script>`,
    END,
  ].join('\n');
}

/**
 * Inject (or re-inject) the snapshot block into `html`. Idempotent: if a
 * previously generated block is present (between the markers), it is replaced;
 * otherwise the block is inserted before `</head>`, falling back to `</body>`
 * or appending. No other part of the HTML is modified, so the page's existing
 * Excel-import path keeps working as a manual fallback (concept §8).
 */
export function injectSnapshot(html: string, snapshot: Snapshot): string {
  const block = buildSnapshotBlock(snapshot);

  const startIdx = html.indexOf(START);
  const endIdx = html.indexOf(END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return html.slice(0, startIdx) + block + html.slice(endIdx + END.length);
  }

  const headClose = html.search(/<\/head>/i);
  if (headClose !== -1) {
    return html.slice(0, headClose) + block + '\n' + html.slice(headClose);
  }
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + block + '\n' + html.slice(bodyClose);
  }
  return html + '\n' + block + '\n';
}
