import type { PersonioClient } from '../client.js';
import { ApiSource, type ApiSourceOptions } from './api-source.js';
import { ReportSource, type ReportSourceOptions } from './report-source.js';
import type { AbsenceSource, AttendanceSource } from './types.js';

/** Which data source the high-level services use. */
export type SourceKind = 'api' | 'report';

export interface SourceSelection {
  /**
   * Force a source. When omitted, defaults to `report` if a `reportId` is
   * configured, otherwise `api` (concept §5 default strategy).
   */
  kind?: SourceKind;
  api?: ApiSourceOptions;
  report?: Omit<ReportSourceOptions, 'reportId'> & { reportId?: string };
}

/** Resolve the effective {@link SourceKind} from the selection. */
export function resolveSourceKind(selection: SourceSelection = {}): SourceKind {
  if (selection.kind) return selection.kind;
  return selection.report?.reportId ? 'report' : 'api';
}

/**
 * Build a data source implementing both {@link AttendanceSource} and
 * {@link AbsenceSource}, choosing API vs Report per {@link resolveSourceKind}.
 */
export function createSource(
  client: PersonioClient,
  selection: SourceSelection = {}
): AttendanceSource & AbsenceSource {
  if (resolveSourceKind(selection) === 'report') {
    const reportId = selection.report?.reportId;
    if (!reportId) {
      throw new Error('A reportId is required to use the Custom Report data source');
    }
    return new ReportSource(client, { ...selection.report, reportId });
  }
  return new ApiSource(client, selection.api);
}
