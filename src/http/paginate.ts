/**
 * Normalized shape of a Personio v2 list response. The v2 APIs return data
 * under `_data` with cursor links under `_meta.links.next.href`; a few
 * endpoints use the un-prefixed `data`/`meta` spelling. {@link normalizePage}
 * collapses both into this shape.
 */
export interface Page<T> {
  data: T[];
  /** Absolute URL of the next page, or `undefined` on the last page. */
  nextHref?: string;
}

/** Coerce any v2 list payload into a {@link Page}, tolerating both spellings. */
export function normalizePage<T>(body: any): Page<T> {
  const data: T[] = body?._data ?? body?.data ?? (Array.isArray(body) ? body : []);
  const meta = body?._meta ?? body?.meta;
  const nextHref: string | undefined = meta?.links?.next?.href ?? undefined;
  return { data, nextHref };
}
