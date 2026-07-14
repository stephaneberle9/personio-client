import type { AbsenceRecord } from '../model/absence-record.js';
import type { AbsenceSource, DateRange } from '../sources/types.js';

/**
 * High-level absence service: returns normalized
 * {@link AbsenceRecord}s for a range from whichever {@link AbsenceSource} it was
 * given (granular API or Custom Report).
 */
export class AbsenceService {
  constructor(private readonly source: AbsenceSource) {}

  async getRecords(range: DateRange): Promise<AbsenceRecord[]> {
    return this.source.getAbsence(range);
  }
}
