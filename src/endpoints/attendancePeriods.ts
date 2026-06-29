import { HttpClient, MAX_PAGE_SIZE, type QueryParams } from '../http/client.js';
import { attendancePeriodSchema, parseItem, type AttendancePeriod } from '../schemas/index.js';
import type {
  AttendancePeriodV2CreateResponse,
  AttendancePeriodV2Raw,
  AttendancePeriodV2Request,
} from '../types.js';

export type AttendanceStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

/** Filters for `GET /v2/attendance-periods` (concept §4.1). */
export interface AttendancePeriodFilters {
  /** One or more `person.id` values. */
  personIds?: string[];
  /** `start.date_time.gte` / `.lte` (e.g. `2026-06-01T00:00:00`, no timezone). */
  startGte?: string;
  startLte?: string;
  /** `end.date_time.gte` / `.lte`. */
  endGte?: string;
  endLte?: string;
  /**
   * `attribution_date.gte` / `.lte` (plain `YYYY-MM-DD`). Preferred for range
   * queries because it is insensitive to periods crossing midnight.
   */
  attributionDateGte?: string;
  attributionDateLte?: string;
  /** One or more `project.id` values. */
  projectIds?: string[];
  status?: AttendanceStatus;
  /** e.g. `person.id,start.date_time`. */
  sort?: string;
}

export class AttendancePeriodsEndpoint {
  constructor(private readonly http: HttpClient) {}

  /** List all attendance periods matching the filters, following pagination. */
  async list(filters: AttendancePeriodFilters = {}): Promise<AttendancePeriod[]> {
    const params: QueryParams = {
      limit: MAX_PAGE_SIZE,
      'person.id': filters.personIds,
      'project.id': filters.projectIds,
      'start.date_time.gte': filters.startGte,
      'start.date_time.lte': filters.startLte,
      'end.date_time.gte': filters.endGte,
      'end.date_time.lte': filters.endLte,
      'attribution_date.gte': filters.attributionDateGte,
      'attribution_date.lte': filters.attributionDateLte,
      status: filters.status,
      sort: filters.sort,
    };
    const raw = await this.http.getAll('/v2/attendance-periods', params);
    return raw.map((item) => parseItem(attendancePeriodSchema, item, 'attendance period'));
  }

  /** Get a single attendance period by id (v2). */
  async get(id: string | number): Promise<{ data: AttendancePeriodV2Raw }> {
    return this.http.get(`/v2/attendance-periods/${encodeURIComponent(String(id))}`);
  }

  /** Create an attendance period (v2). Requires a write scope. */
  async create(body: AttendancePeriodV2Request): Promise<AttendancePeriodV2CreateResponse> {
    return this.http.post('/v2/attendance-periods', body);
  }

  /** Update an attendance period (v2). */
  async update(
    id: string | number,
    body: Partial<AttendancePeriodV2Request>
  ): Promise<{ data: AttendancePeriodV2Raw }> {
    return this.http.patch(`/v2/attendance-periods/${encodeURIComponent(String(id))}`, body);
  }

  /** Delete an attendance period (v2). */
  async delete(id: string | number): Promise<unknown> {
    return this.http.delete(`/v2/attendance-periods/${encodeURIComponent(String(id))}`);
  }
}

/** Flatten a raw v2 attendance period for display. Ported from mcp-server. */
export function formatAttendancePeriodV2(attendance: AttendancePeriodV2Raw): Record<string, unknown> {
  return {
    id: attendance.id,
    type: attendance.type,
    person_id: attendance.person.id,
    approval_status: attendance.approval?.status,
    start_date_time: attendance.start.date_time,
    end_date_time: attendance.end?.date_time,
    attribution_date: attendance.attribution_date,
    comment: attendance.comment,
    is_holiday: attendance.is_holiday,
    is_on_time_off: attendance.is_on_time_off,
    is_auto_generated: attendance.is_auto_generated,
    created_at: attendance.created_at,
    updated_at: attendance.updated_at,
  };
}

/** Convert a v1-style attendance into a v2 create request. Ported. */
export function convertV1ToV2Attendance(v1Attendance: any): AttendancePeriodV2Request {
  const startDateTime = `${v1Attendance.date}T${v1Attendance.start_time}:00`;
  const endDateTime = v1Attendance.end_time
    ? `${v1Attendance.date}T${v1Attendance.end_time}:00`
    : undefined;
  return {
    person: { id: String(v1Attendance.employee_id) },
    type: 'WORK',
    start: { date_time: startDateTime },
    end: endDateTime ? { date_time: endDateTime } : undefined,
    comment: v1Attendance.comment,
  };
}

/** Convert a raw v2 attendance period back to the v1 flat shape. Ported. */
export function convertV2ToV1Attendance(v2Attendance: AttendancePeriodV2Raw): Record<string, unknown> {
  const startParts = v2Attendance.start.date_time.split('T');
  const endParts = v2Attendance.end?.date_time?.split('T');
  return {
    id: v2Attendance.id,
    employee_id: v2Attendance.person.id,
    date: startParts[0],
    start_time: startParts[1]?.substring(0, 5),
    end_time: endParts ? endParts[1]?.substring(0, 5) : null,
    break_minutes: 0,
    comment: v2Attendance.comment || '',
    is_holiday: v2Attendance.is_holiday,
    is_on_time_off: v2Attendance.is_on_time_off,
    updated_at: v2Attendance.updated_at,
  };
}
