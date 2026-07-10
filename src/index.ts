// Public API surface of @stephaneberle9/personio-client.

// Client + configuration
export { PersonioClient } from './client.js';
export {
  clientConfigSchema,
  configFromEnv,
  type ClientConfig,
  type ResolvedClientConfig,
} from './config.js';
export { PersonioApiError, toPersonioApiError } from './errors.js';

// Auth + HTTP layer
export { OAuthClient, type OAuthClientOptions } from './auth/oauth-client.js';
export { HttpClient, MAX_PAGE_SIZE, type QueryParams } from './http/client.js';

// Endpoints (filters)
export {
  AttendancePeriodsEndpoint,
  formatAttendancePeriodV2,
  convertV1ToV2Attendance,
  convertV2ToV1Attendance,
  type AttendancePeriodFilters,
  type AttendanceStatus,
} from './endpoints/attendancePeriods.js';
export {
  AbsencePeriodsEndpoint,
  type AbsencePeriodFilters,
} from './endpoints/absencePeriods.js';
export { AbsenceTypesEndpoint } from './endpoints/absenceTypes.js';
export { ProjectsEndpoint, type ProjectFilters } from './endpoints/projects.js';
export { PersonsEndpoint, type PersonFilters } from './endpoints/persons.js';
export { CostCentersEndpoint } from './endpoints/costCenters.js';
export {
  ReportsEndpoint,
  normalizeReport,
  type ReportColumn,
  type ReportData,
  type ReportsEndpointOptions,
} from './endpoints/reports.js';
export { DocumentsEndpoint } from './endpoints/documents.js';
export { RecruitingEndpoint } from './endpoints/recruiting.js';

// Raw v2 API interface types (attendance CRUD, document management, recruiting)
export type * from './types.js';

// Raw v2 schemas/types
export {
  attendancePeriodSchema,
  absencePeriodSchema,
  absenceBreakdownSchema,
  absenceTypeSchema,
  projectSchema,
  personSchema,
  costCenterSchema,
  type AttendancePeriod,
  type AbsencePeriod,
  type AbsenceBreakdown,
  type AbsenceType,
  type Project,
  type Person,
  type CostCenter,
} from './schemas/index.js';

// Normalized models
export type { AttendanceRecord } from './model/attendance-record.js';
export type { AbsenceRecord } from './model/absence-record.js';
export type { DashboardRecord } from './model/dashboard-record.js';
export type { PersonRecord } from './model/person-record.js';
export type {
  ApplicationRecord,
  CandidateRecord,
  JobRecord,
} from './model/recruiting-records.js';

// Field resolution
export {
  slugifyLabel,
  resolveField,
  resolveString,
  resolveBoolean,
  resolveFieldConfig,
  DEFAULT_FIELD_RESOLVER_CONFIG,
  type FieldResolverConfig,
} from './fields/resolvers.js';

// Hours helpers
export { durationHours, parseDateTimeMs, round2 } from './domain/hours.js';

// Sources + services
export type { AttendanceSource, AbsenceSource, DateRange } from './sources/types.js';
export { ApiSource, type ApiSourceOptions } from './sources/api-source.js';
export {
  ReportSource,
  type ReportSourceOptions,
  type ReportColumnMap,
} from './sources/report-source.js';
export {
  createSource,
  resolveSourceKind,
  type SourceKind,
  type SourceSelection,
} from './sources/factory.js';
export {
  AttendanceService,
  type AttendanceQuery,
} from './domain/attendance-service.js';
export { AbsenceService } from './domain/absence-service.js';
export { PersonService, type PersonServiceOptions } from './domain/person-service.js';
export { RecruitingService } from './domain/recruiting-service.js';
