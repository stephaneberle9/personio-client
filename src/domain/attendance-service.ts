import type { AttendanceRecord } from '../model/attendance-record.js';
import type { AttendanceSource, DateRange } from '../sources/types.js';

export interface AttendanceQuery extends DateRange {
  /**
   * Optional cost-center pre-filter: keep only records whose `costCenter`
   * contains one of these tokens. Account-specific values are passed in by the
   * caller (never hardcoded). Downstream consumers may filter again.
   */
  costCenters?: string[];
}

/**
 * High-level attendance service (concept §4): returns normalized
 * {@link AttendanceRecord}s for a range from whichever {@link AttendanceSource}
 * it was given (granular API or Custom Report).
 */
export class AttendanceService {
  constructor(private readonly source: AttendanceSource) {}

  async getRecords(query: AttendanceQuery): Promise<AttendanceRecord[]> {
    const records = await this.source.getAttendance({ from: query.from, to: query.to });
    if (!query.costCenters?.length) return records;

    const tokens = query.costCenters.map((c) => c.trim()).filter(Boolean);
    return records.filter((r) => tokens.some((t) => r.costCenter.includes(t)));
  }
}
