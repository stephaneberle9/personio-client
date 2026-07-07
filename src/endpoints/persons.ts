import { HttpClient, type QueryParams } from '../http/client.js';
import { parseItem, personSchema, type Person } from '../schemas/index.js';

/**
 * `/v2/persons` caps `limit` at 50 (verified against a live account: `limit=100`
 * returns 400 "Provided value for limit is not valid"), unlike the shared
 * {@link MAX_PAGE_SIZE} of 100 the other list endpoints accept.
 */
const PERSONS_MAX_PAGE_SIZE = 50;

export interface PersonFilters {
  personIds?: string[];
  /** Attribute names/ids to include, where the tenant requires explicit selection. */
  attributes?: string[];
}

export class PersonsEndpoint {
  constructor(private readonly http: HttpClient) {}

  /** List all persons, following pagination. */
  async list(filters: PersonFilters = {}): Promise<Person[]> {
    const params: QueryParams = {
      limit: PERSONS_MAX_PAGE_SIZE,
      'person.id': filters.personIds,
      attributes: filters.attributes,
    };
    const raw = await this.http.getAll('/v2/persons', params);
    return raw.map((item) => parseItem(personSchema, item, 'person'));
  }
}
