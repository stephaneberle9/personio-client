import { describe, expect, it } from 'vitest';
import { buildSnapshotBlock, injectSnapshot } from '../examples/lib/snapshotInjector.js';
import type { Snapshot } from '../examples/lib/snapshotBuilder.js';

const snapshot: Snapshot = {
  meta: { from: '2026-06-01', to: '2026-06-30', source: 'api', reportId: null, generatedAt: '2026-06-28T00:00:00.000Z', count: 1 },
  records: [
    {
      datum: '2026-06-01', ma: 'Schmidt, Anna', kunde: 'Acme', kst: '1001',
      projekt: 'Website', up: 'Parent', std: 7.5, kommentar: 'x',
      startdatum: '2026-01-01', enddatum: '2026-12-31',
    },
  ],
};

const PAGE = [
  '<!DOCTYPE html><html><head><title>Dashboard</title></head>',
  '<body><input type="file" id="excel-import"><script>',
  'const has = typeof __PRELOADED_DATA__ !== "undefined";',
  '</script></body></html>',
].join('\n');

describe('snapshot HTML injection', () => {
  it('inserts a __PRELOADED_DATA__ block before </head>', () => {
    const out = injectSnapshot(PAGE, snapshot);
    expect(out).toContain('const __PRELOADED_DATA__ =');
    expect(out.indexOf('PERSONIO_SNAPSHOT:START')).toBeLessThan(out.indexOf('</head>'));
    // The page's existing Excel import is untouched.
    expect(out).toContain('<input type="file" id="excel-import">');
  });

  it('round-trips the injected data as valid JSON', () => {
    const out = injectSnapshot(PAGE, snapshot);
    const match = /const __PRELOADED_DATA__ = (\[.*?\]);/s.exec(out);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]!);
    expect(parsed).toEqual(snapshot.records);
  });

  it('is idempotent: re-injecting replaces the block rather than duplicating it', () => {
    const once = injectSnapshot(PAGE, snapshot);
    const twice = injectSnapshot(once, { ...snapshot, meta: { ...snapshot.meta, count: 2 } });
    const occurrences = twice.split('PERSONIO_SNAPSHOT:START').length - 1;
    expect(occurrences).toBe(1);
  });

  it('escapes a </script> sequence in the data so it cannot break out', () => {
    const evil: Snapshot = {
      ...snapshot,
      records: [{ ...snapshot.records[0]!, kommentar: '</script><script>alert(1)</script>' }],
    };
    const block = buildSnapshotBlock(evil);
    expect(block).not.toContain('</script><script>alert(1)');
    expect(block).toContain('<\\/script>');
  });
});
