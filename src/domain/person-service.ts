import type { PersonioClient } from '../client.js';
import type { PersonRecord } from '../model/person-record.js';
import type { PersonFilters } from '../endpoints/persons.js';
import {
  resolveFieldConfig,
  resolveString,
  type FieldResolverConfig,
} from '../fields/resolvers.js';

export interface PersonServiceOptions {
  /** Field-resolution overrides for account-specific custom person fields. */
  fields?: Partial<FieldResolverConfig>;
}

/**
 * High-level person service: lists v2 persons and normalizes them to
 * {@link PersonRecord}s, resolving account-specific custom fields (personnel
 * number, department, preferred name) via the configurable resolvers.
 */
export class PersonService {
  private readonly fields: FieldResolverConfig;

  constructor(
    private readonly client: PersonioClient,
    options: PersonServiceOptions = {}
  ) {
    this.fields = resolveFieldConfig(options.fields);
  }

  async getRecords(filters: PersonFilters = {}): Promise<PersonRecord[]> {
    const persons = await this.client.persons.list(filters);
    const dyn = this.fields.dynamicFieldMap;

    return persons.map<PersonRecord>((p) => ({
      id: p.id,
      firstName: String(p.first_name ?? ''),
      lastName: String(p.last_name ?? ''),
      preferredName:
        String(p.preferred_name ?? '') ||
        resolveString(p, this.fields.preferredNameFields, dyn),
      email: String(p.email ?? ''),
      department: resolveString(p, this.fields.departmentFields, dyn),
      personnelNumber: resolveString(p, this.fields.personnelNumberFields, dyn),
    }));
  }
}
