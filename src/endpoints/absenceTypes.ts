import { HttpClient, MAX_PAGE_SIZE } from '../http/client.js';
import { absenceTypeSchema, parseItem, type AbsenceType } from '../schemas/index.js';

export class AbsenceTypesEndpoint {
  constructor(private readonly http: HttpClient) {}

  /** List all absence types (name + category per `absence_type.id`). */
  async list(): Promise<AbsenceType[]> {
    const raw = await this.http.getAll('/v2/absence-types', { limit: MAX_PAGE_SIZE });
    return raw.map((item) => parseItem(absenceTypeSchema, item, 'absence type'));
  }
}
