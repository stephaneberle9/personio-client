import { HttpClient, MAX_PAGE_SIZE, type QueryParams } from '../http/client.js';
import {
  absenceBreakdownSchema,
  absencePeriodSchema,
  parseItem,
  type AbsenceBreakdown,
  type AbsencePeriod,
} from '../schemas/index.js';

/** Filters for `GET /v2/absence-periods`. */
export interface AbsencePeriodFilters {
  personIds?: string[];
  absenceTypeIds?: string[];
  /** `starts_from.date_time.gte` / `.lte` (with timezone, e.g. `...T00:00:00Z`). */
  startsFromGte?: string;
  startsFromLte?: string;
  /** `ends_at.date_time.gte` / `.lte`. */
  endsAtGte?: string;
  endsAtLte?: string;
  /** `updated_at.gte` / `.lte`. */
  updatedAtGte?: string;
  updatedAtLte?: string;
}

export class AbsencePeriodsEndpoint {
  constructor(private readonly http: HttpClient) {}

  /** List all absence periods matching the filters, following pagination. */
  async list(filters: AbsencePeriodFilters = {}): Promise<AbsencePeriod[]> {
    const params: QueryParams = {
      limit: MAX_PAGE_SIZE,
      'person.id': filters.personIds,
      'absence_type.id': filters.absenceTypeIds,
      'starts_from.date_time.gte': filters.startsFromGte,
      'starts_from.date_time.lte': filters.startsFromLte,
      'ends_at.date_time.gte': filters.endsAtGte,
      'ends_at.date_time.lte': filters.endsAtLte,
      'updated_at.gte': filters.updatedAtGte,
      'updated_at.lte': filters.updatedAtLte,
    };
    const raw = await this.http.getAll('/v2/absence-periods', params);
    return raw.map((item) => parseItem(absencePeriodSchema, item, 'absence period'));
  }

  /**
   * List the per-day breakdown for one absence period
   * (`GET /v2/absence-periods/{id}/breakdowns`), following pagination. Each
   * entry carries a `date` and an `effective_duration` of `{ unit, value }`
   * (`unit` is `DAY` or `HOUR`). The base absence period does not carry any
   * amounts, so this is the way to derive them.
   */
  async breakdowns(absencePeriodId: string): Promise<AbsenceBreakdown[]> {
    const path = `/v2/absence-periods/${encodeURIComponent(absencePeriodId)}/breakdowns`;
    const raw = await this.http.getAll(path);
    return raw.map((item) => parseItem(absenceBreakdownSchema, item, 'absence breakdown'));
  }
}
