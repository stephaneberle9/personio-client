/**
 * Configurable field resolution for the values Personio does not expose under a
 * single, account-stable key. Concept doc 1 §8 lists these as "to be verified
 * against the real account": the personnel number, the project's customer, the
 * billable flag, the cost center, the certificate status. Rather than hardcode
 * any of them, the library resolves each from a configurable list of candidate
 * field names/labels, with sensible generic defaults.
 *
 * The `slugifyLabel` / dynamic-field handling is carried over from the
 * `personio-mcp-server` client this library was extracted from: Personio
 * surfaces custom fields under opaque `dynamic_<id>` keys, which we match by
 * their human-readable label.
 */

/**
 * Turn a human-readable Personio attribute label into an identifier-friendly
 * key, e.g. `"Kostenstelle kurz"` → `kostenstelle_kurz`. German umlauts are
 * transliterated (ä→ae, ö→oe, ü→ue, ß→ss) before remaining diacritics are
 * stripped, so the result stays ASCII. Returns `''` for a missing/blank label.
 *
 * Carried over verbatim (behavior-preserving) from the mcp-server client.
 */
export function slugifyLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  return label
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'ae')
    .replace(/Ö/g, 'oe')
    .replace(/Ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Field-name candidates per logical field. Each list is tried in order; the
 * first key/label that resolves to a non-empty value wins. All entries are
 * generic defaults — no account-specific values — and can be overridden at
 * runtime. The slugged forms are matched, so `"Cost center"`, `"cost_center"`
 * and a `dynamic_<id>` field labelled "Cost center" all match `cost_center`.
 */
export interface FieldResolverConfig {
  /** Person → personnel number ("Kostenträger Nummer"). */
  personnelNumberFields: string[];
  /** Person → department. */
  departmentFields: string[];
  /** Person → preferred display name. */
  preferredNameFields: string[];
  /** Project → customer ("Anwesenheit Projekt Kunde"). */
  customerFields: string[];
  /** Project → cost center. */
  costCenterFields: string[];
  /** Project → billable flag. */
  billableFields: string[];
  /** Absence period → certificate status ("Status Attest"). */
  certificateStatusFields: string[];
  /** Optional `dynamic_<id>` → readable-name overrides. */
  dynamicFieldMap: Record<string, string>;
}

// VERIFY: the default candidate names below are best-effort guesses for a
// generic Personio account. Confirm the real field keys/labels against the
// target account and override via the client config where they differ
// (see OPEN_QUESTIONS.md).
export const DEFAULT_FIELD_RESOLVER_CONFIG: FieldResolverConfig = {
  personnelNumberFields: ['personnel_number', 'kostentraeger_nummer', 'employee_number', 'staff_number'],
  departmentFields: ['department', 'abteilung'],
  preferredNameFields: ['preferred_name', 'display_name', 'name_bevorzugt'],
  customerFields: ['customer', 'kunde', 'customer_name', 'kunde_name'],
  costCenterFields: ['cost_center', 'kostenstelle', 'cost_centers'],
  billableFields: ['billable', 'abrechenbar', 'is_billable'],
  certificateStatusFields: ['certificate_status', 'status_attest', 'attest'],
  dynamicFieldMap: {},
};

/** Merge a partial override onto the defaults. */
export function resolveFieldConfig(
  overrides?: Partial<FieldResolverConfig>
): FieldResolverConfig {
  return { ...DEFAULT_FIELD_RESOLVER_CONFIG, ...overrides };
}

/**
 * Reduce a Personio attribute value to a scalar. Handles the shapes seen across
 * v2 objects: a bare primitive, a `{ value }` wrapper, and a nested reference
 * `{ attributes: { name } }` (e.g. department/office). Returns `undefined` when
 * nothing usable is present.
 */
function scalarOf(value: unknown): string | number | boolean | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, any>;
    if ('value' in obj) return scalarOf(obj.value);
    if (obj.attributes?.name !== undefined) return scalarOf(obj.attributes.name);
    if (obj.name !== undefined) return scalarOf(obj.name);
    if (Array.isArray(value) && value.length > 0) return scalarOf(value[0]);
  }
  return undefined;
}

/**
 * Look up the first candidate field on a raw object and return its scalar value.
 * Matching is slug-based and covers three layouts:
 *   1. a direct key on the object (slugged),
 *   2. a key inside a nested `attributes` object (v1-style `{label,value}` too),
 *   3. a `dynamic_<id>` key whose mapped/slugified label matches.
 */
export function resolveField(
  raw: Record<string, any> | null | undefined,
  candidates: string[],
  dynamicFieldMap: Record<string, string> = {}
): string | number | boolean | undefined {
  if (!raw) return undefined;
  const wanted = new Set(candidates.map((c) => slugifyLabel(c)));

  const buckets: Array<Record<string, any>> = [raw];
  if (raw.attributes && typeof raw.attributes === 'object') buckets.push(raw.attributes);

  for (const bucket of buckets) {
    for (const [key, value] of Object.entries(bucket)) {
      // dynamic_<id>: match by configured name or by the value's own label.
      if (key.startsWith('dynamic_')) {
        const mapped = dynamicFieldMap[key];
        const label = (value as any)?.label;
        const slug = slugifyLabel(mapped) || slugifyLabel(label);
        if (slug && wanted.has(slug)) {
          const scalar = scalarOf(value);
          if (scalar !== undefined && scalar !== '') return scalar;
        }
        continue;
      }
      if (wanted.has(slugifyLabel(key))) {
        const scalar = scalarOf(value);
        if (scalar !== undefined && scalar !== '') return scalar;
      }
      // Also honor a {label,value} pair whose label matches a candidate.
      const label = (value as any)?.label;
      if (label && wanted.has(slugifyLabel(label))) {
        const scalar = scalarOf(value);
        if (scalar !== undefined && scalar !== '') return scalar;
      }
    }
  }
  return undefined;
}

/** Resolve to a string, defaulting to `''`. */
export function resolveString(
  raw: Record<string, any> | null | undefined,
  candidates: string[],
  dynamicFieldMap?: Record<string, string>
): string {
  const value = resolveField(raw, candidates, dynamicFieldMap);
  return value === undefined ? '' : String(value);
}

/** Resolve to a boolean, interpreting common truthy strings (Ja/Yes/true/1). */
export function resolveBoolean(
  raw: Record<string, any> | null | undefined,
  candidates: string[],
  dynamicFieldMap?: Record<string, string>
): boolean {
  const value = resolveField(raw, candidates, dynamicFieldMap);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['ja', 'yes', 'true', '1', 'y'].includes(value.trim().toLowerCase());
  }
  return false;
}
