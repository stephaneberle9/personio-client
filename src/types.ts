/**
 * Raw v2 API interface types ported from the original mcp-server inline client,
 * so the full v2 Personio surface (attendance CRUD, document management,
 * recruiting) is available from this library. The v1 types are intentionally
 * omitted — Personio deprecates the v1 attendance/projects endpoints on
 * 2026-08-30, so this is a v2-only client.
 *
 * The normalized attendance/absence *records* live in `src/model/`; these are
 * the raw API shapes the low-level endpoints return.
 */

/** v2 list envelope using `_data`/`_meta` with cursor links. */
export interface PersonioListEnvelope<T = any> {
  _data: T;
  _meta?: {
    links?: {
      next?: { href: string };
    };
  };
}

// ---- Attendance periods (v2 CRUD) ---------------------------------------

export interface AttendancePeriodV2Raw {
  id: string;
  type: 'WORK' | 'BREAK';
  person: { id: string };
  approval?: { status: string };
  start: { date_time: string };
  end?: { date_time: string };
  attribution_date?: string;
  comment?: string;
  project?: any;
  is_auto_generated?: boolean;
  is_holiday?: boolean;
  is_on_time_off?: boolean;
  created_at: string;
  updated_at: string;
}

export interface AttendancePeriodV2CreateResponse {
  id: string;
  affected_periods: AttendancePeriodV2Raw[];
}

export interface AttendancePeriodV2Request {
  person: { id: string };
  type: 'WORK' | 'BREAK';
  start: { date_time: string };
  end?: { date_time: string };
  comment?: string;
}

// ---- Document Management (v2) -------------------------------------------

export interface DocumentV2 {
  id: string;
  name: string;
  date: string;
  comment: string | null;
  category: { id: string };
  owner: { id: string };
  document_type: string;
  size: number;
  created_at: string;
  virus_scan?: { status: string };
  esignature?: { status: string };
}

// ---- Recruiting (v2) ----------------------------------------------------

export interface RecruitingApplication {
  id: string;
  application_date: string;
  candidate: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    gender?: string;
  };
  job: {
    id: string;
    name: string;
    department?: { id: string; name: string };
    category?: any;
  };
  current_stage: {
    id: string | null;
    kind: string;
    name: string | null;
    type: string;
  };
  channel?: { id: string; name: string };
  hiring_team?: any;
  is_anonymized: boolean;
  created_at: { 'date-time': string; timezone: string };
  updated_at: { 'date-time': string; timezone: string };
  [key: string]: any;
}

export interface RecruitingCandidate {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  gender?: string;
  phone?: string;
  location?: string;
  birthday?: string;
  linkedin_profile?: string;
  available_from?: string;
  applications?: { id: string; application_date: string }[];
  created_at: string;
  updated_at: string;
  [key: string]: any;
}

export interface RecruitingJob {
  id: string;
  name: string;
  department?: { id: string; name: string };
  category?: any;
  hiring_team?: any[];
  company?: { id: string };
  created_at: { 'date-time': string; timezone: string };
  updated_at: { 'date-time': string; timezone: string };
  [key: string]: any;
}

export interface RecruitingStageTransition {
  entered_at: { 'date-time': string; timezone: string };
  stage: { id: string | null; kind: string; name: string | null; type: string };
  [key: string]: any;
}

export interface RecruitingCategory {
  id: string;
  name: string;
  stages?: any[];
  company?: { id: string };
  [key: string]: any;
}
