import { HttpClient, MAX_PAGE_SIZE, type QueryParams } from '../http/client.js';
import { parseItem, personSchema, type Person } from '../schemas/index.js';

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
      limit: MAX_PAGE_SIZE,
      'person.id': filters.personIds,
      attributes: filters.attributes,
    };
    const raw = await this.http.getAll('/v2/persons', params);
    return raw.map((item) => parseItem(personSchema, item, 'person'));
  }
}
