import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PersonioApiError } from '../src/errors.js';
import {
  handleSnapshotRequest,
  writeAuditCopy,
  type SnapshotBuilder,
} from '../examples/lib/snapshotHandler.js';
import type { Snapshot } from '../examples/lib/snapshotBuilder.js';

const snapshot: Snapshot = {
  records: [
    {
      datum: '2026-06-01', ma: 'Schmidt, Anna', kunde: 'Acme', kst: '1001',
      projekt: 'Website', up: '', std: 7.5, kommentar: '', startdatum: '', enddatum: '',
    },
  ],
  meta: {
    from: '2026-06-01', to: '2026-06-30', source: 'api', reportId: null,
    generatedAt: '2026-07-11T12:34:56.789Z', count: 1,
  },
};

const query = (qs: string): URLSearchParams => new URLSearchParams(qs);

describe('handleSnapshotRequest', () => {
  it('returns the snapshot as JSON on success and fires onSuccess', async () => {
    const build: SnapshotBuilder = vi.fn(async () => snapshot);
    const onSuccess = vi.fn();

    const result = await handleSnapshotRequest(
      query('from=2026-06-01&to=2026-06-30&source=api'),
      {},
      { build, onSuccess }
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual(snapshot);
    expect(onSuccess).toHaveBeenCalledWith(snapshot);
    expect(build).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-06-01', to: '2026-06-30', source: 'api' })
    );
  });

  it('rejects a request missing from/to with a 400 and never calls build', async () => {
    const build: SnapshotBuilder = vi.fn(async () => snapshot);
    const result = await handleSnapshotRequest(query('from=2026-06-01'), {}, { build });
    expect(result.status).toBe(400);
    expect(build).not.toHaveBeenCalled();
  });

  it('rejects an invalid source with a 400', async () => {
    const build: SnapshotBuilder = vi.fn(async () => snapshot);
    const result = await handleSnapshotRequest(
      query('from=2026-06-01&to=2026-06-30&source=bogus'),
      {},
      { build }
    );
    expect(result.status).toBe(400);
    expect(build).not.toHaveBeenCalled();
  });

  it('defaults the source to report when a reportId is configured, else api', async () => {
    const build: SnapshotBuilder = vi.fn(async () => snapshot);

    await handleSnapshotRequest(query('from=2026-06-01&to=2026-06-30'), { reportId: 'r1' }, { build });
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'report' }));

    await handleSnapshotRequest(query('from=2026-06-01&to=2026-06-30'), {}, { build });
    expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'api' }));
  });

  it('surfaces a PersonioApiError as JSON with its upstream status and hint', async () => {
    const build: SnapshotBuilder = vi.fn(async () => {
      throw new PersonioApiError('Personio API error (401) on /v2/persons: Unauthorized. …hint…', {
        status: 401,
        path: '/v2/persons',
      });
    });

    const result = await handleSnapshotRequest(
      query('from=2026-06-01&to=2026-06-30&source=api'),
      {},
      { build }
    );

    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({
      error: expect.stringContaining('/v2/persons'),
      status: 401,
      path: '/v2/persons',
    });
  });

  it('maps an unexpected error to a 500 with just the message', async () => {
    const build: SnapshotBuilder = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const result = await handleSnapshotRequest(
      query('from=2026-06-01&to=2026-06-30'),
      {},
      { build }
    );
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'socket hang up' });
  });
});

describe('writeAuditCopy', () => {
  it('writes out/snapshot_<timestamp>.json with a Windows-safe (colon-free) name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'serve-dashboard-'));
    const path = writeAuditCopy(snapshot, dir);

    const name = path.slice(dir.length + 1);
    expect(name).toMatch(/^snapshot_[\w-]+\.json$/);
    expect(name).not.toContain(':');
    expect(readdirSync(dir)).toContain(name);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(snapshot);
  });
});
