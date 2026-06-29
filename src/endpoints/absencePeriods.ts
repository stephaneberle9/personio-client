import { HttpClient, MAX_PAGE_SIZE, type QueryParams } from '../http/client.js';
import { absencePeriodSchema, parseItem, type AbsencePeriod } from '../schemas/index.js';

/** Filters for `GET /v2/absence-periods` (concept §4.2). */
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
}
