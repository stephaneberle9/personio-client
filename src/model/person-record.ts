/**
 * Normalized person record — a flat, typed view of a Personio v2 person with
 * account-specific custom fields (personnel number, department, preferred name)
 * resolved via the configurable field resolvers. The raw v2 object remains
 * available on the endpoint group for callers that need everything.
 */
export interface PersonRecord {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: string;
  email: string;
  department: string;
  /** "Kostenträger Nummer" / personnel number (a custom field per account). */
  personnelNumber: string;
}
