import { z } from 'zod';

/**
 * Zod schemas for the raw Personio v2 objects this client depends on. They
 * validate the fields the domain layer reads and `.passthrough()` everything
 * else, so a tenant's extra/custom fields never cause a hard validation
 * failure — they remain available to the configurable field resolvers.
 *
 * Where the exact v2 shape is not fully documented, fields are modelled as
 * optional/nullable and verified against a real account (see OPEN_QUESTIONS.md).
 */

/** `{ date_time: "2026-06-01T08:00:00" }` wrapper used throughout v2. */
const dateTime = z
  .object({ date_time: z.string().nullable().optional() })
  .passthrough();

const idRef = z.object({ id: z.string() }).passthrough();

// ---- Attendance periods (GET /v2/attendance-periods) --------------------

export const attendancePeriodSchema = z
  .object({
    id: z.string(),
    type: z.enum(['WORK', 'BREAK']),
    person: idRef,
    approval: z.object({ status: z.string() }).passthrough().optional(),
    start: dateTime,
    end: dateTime.nullable().optional(),
    attribution_date: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
    project: idRef.nullable().optional(),
    is_auto_generated: z.boolean().optional(),
  })
  .passthrough();

export type AttendancePeriod = z.infer<typeof attendancePeriodSchema>;

// ---- Absence periods (GET /v2/absence-periods) --------------------------

export const absencePeriodSchema = z
  .object({
    id: z.string(),
    person: idRef,
    starts_from: dateTime.and(
      z.object({ type: z.enum(['FIRST_HALF', 'SECOND_HALF']).nullable().optional() }).partial()
    ),
    ends_at: dateTime.nullable().optional(),
    timezone_id: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
    absence_type: idRef,
    approval: z.object({ status: z.string() }).passthrough().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough();

export type AbsencePeriod = z.infer<typeof absencePeriodSchema>;

// ---- Absence types (GET /v2/absence-types) ------------------------------

export const absenceTypeSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    /** DAILY | HOURLY, where exposed. */
    unit: z.string().nullable().optional(),
  })
  .passthrough();

export type AbsenceType = z.infer<typeof absenceTypeSchema>;

// ---- Projects (GET /v2/projects) ----------------------------------------

export const projectSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
    parent_project: idRef.nullable().optional(),
    status: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
  })
  .passthrough();

export type Project = z.infer<typeof projectSchema>;

// ---- Persons (GET /v2/persons) ------------------------------------------

export const personSchema = z
  .object({
    id: z.string(),
    first_name: z.string().nullable().optional(),
    last_name: z.string().nullable().optional(),
    preferred_name: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
  })
  .passthrough();

export type Person = z.infer<typeof personSchema>;

// ---- Cost centers (GET /v2/cost-centers, beta) --------------------------

export const costCenterSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
  })
  .passthrough();

export type CostCenter = z.infer<typeof costCenterSchema>;

/**
 * Validate one item from a list response, attaching context to the path on
 * failure. Returns the parsed item; throws a `ZodError` the caller surfaces.
 */
export function parseItem<T>(schema: z.ZodType<T>, value: unknown, context: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${context} from Personio: ${result.error.message}`);
  }
  return result.data;
}
