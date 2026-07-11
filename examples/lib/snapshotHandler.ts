/**
 * Request-handling core for `serve-dashboard.ts`, kept separate from the HTTP
 * wiring so it can be unit-tested without a socket. `handleSnapshotRequest`
 * turns a parsed query into a `{ status, body }` pair; the entry script maps
 * that onto a Node `http` response.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PersonioApiError,
  resolveSourceKind,
  type PersonioClient,
  type SourceKind,
} from '../../src/index.js';
import {
  buildSnapshot,
  type BuildSnapshotOptions,
  type Snapshot,
} from './snapshotBuilder.js';

/**
 * Account-scoped values resolved once at startup and reused for every request
 * (the CLI has no per-request account config — only `from`/`to`/`source` vary).
 */
export interface SnapshotHandlerContext {
  reportId?: string | null;
  personnelFieldIds?: string[];
  costCenters?: string[];
  /** Client built once at startup and shared across requests (token cache reuse). */
  client?: PersonioClient;
}

export interface SnapshotRequestResult {
  status: number;
  body: unknown;
}

/** The snapshot builder — the real one in production, a stub in tests. */
export type SnapshotBuilder = (options: BuildSnapshotOptions) => Promise<Snapshot>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Handle a `GET /api/snapshot` request. Validates `from`/`to`/`source`, resolves
 * the effective source (defaulting to `report` when a reportId is configured,
 * else `api`, matching {@link resolveSourceKind}), then builds the snapshot. Any
 * failure is turned into a JSON error body with an appropriate status — the
 * library's scope-aware hint (src/errors.ts) is preserved in the message rather
 * than collapsed into a generic 500.
 *
 * `deps.build` and `deps.onSuccess` are injectable so tests can drive it without
 * touching Personio or the filesystem.
 */
export async function handleSnapshotRequest(
  query: URLSearchParams,
  context: SnapshotHandlerContext,
  deps: {
    build?: SnapshotBuilder;
    onSuccess?: (snapshot: Snapshot) => void | Promise<void>;
  } = {}
): Promise<SnapshotRequestResult> {
  const build = deps.build ?? buildSnapshot;

  const from = query.get('from');
  const to = query.get('to');
  if (!from || !to || !ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return {
      status: 400,
      body: { error: "Query parameters 'from' and 'to' are required and must be YYYY-MM-DD." },
    };
  }

  const sourceParam = query.get('source');
  if (sourceParam && sourceParam !== 'api' && sourceParam !== 'report') {
    return {
      status: 400,
      body: { error: `Invalid source '${sourceParam}'. Use 'api' or 'report'.` },
    };
  }
  const source: SourceKind = resolveSourceKind({
    kind: (sourceParam as SourceKind | null) ?? undefined,
    report: context.reportId ? { reportId: context.reportId } : undefined,
  });

  try {
    const snapshot = await build({
      from,
      to,
      source,
      costCenters: context.costCenters,
      reportId: context.reportId,
      personnelFieldIds: context.personnelFieldIds,
      client: context.client,
    });
    if (deps.onSuccess) await deps.onSuccess(snapshot);
    return { status: 200, body: snapshot };
  } catch (error) {
    return toErrorResult(error);
  }
}

/**
 * Map a thrown error to a JSON error result. A {@link PersonioApiError} forwards
 * its upstream HTTP status (when a real 4xx/5xx) so a credential problem shows as
 * 401, a missing report as 400, etc.; its message already carries the scope-aware
 * hint. Anything else is a 500 with just the message — never a raw stack trace.
 */
function toErrorResult(error: unknown): SnapshotRequestResult {
  if (error instanceof PersonioApiError) {
    const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;
    return {
      status,
      body: { error: error.message, status: error.status ?? null, path: error.path ?? null },
    };
  }
  return {
    status: 500,
    body: { error: error instanceof Error ? error.message : String(error) },
  };
}

/**
 * Write an audit copy of the snapshot to `out/snapshot_<timestamp>.json`,
 * mirroring the file trail `generate-snapshot.ts` leaves. The ISO timestamp's
 * `:` and `.` are replaced with `-` so the name is valid on Windows too. Returns
 * the path written.
 */
export function writeAuditCopy(snapshot: Snapshot, outDir = 'out'): string {
  const stamp = snapshot.meta.generatedAt.replace(/[:.]/g, '-');
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `snapshot_${stamp}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return path;
}
