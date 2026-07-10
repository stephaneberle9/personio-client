import { OAuthClient } from './auth/oauth-client.js';
import { clientConfigSchema, type ClientConfig, type ResolvedClientConfig } from './config.js';
import { HttpClient } from './http/client.js';
import { AttendancePeriodsEndpoint } from './endpoints/attendancePeriods.js';
import { AbsencePeriodsEndpoint } from './endpoints/absencePeriods.js';
import { AbsenceTypesEndpoint } from './endpoints/absenceTypes.js';
import { ProjectsEndpoint } from './endpoints/projects.js';
import { PersonsEndpoint } from './endpoints/persons.js';
import { CostCentersEndpoint } from './endpoints/costCenters.js';
import { ReportsEndpoint } from './endpoints/reports.js';
import { DocumentsEndpoint } from './endpoints/documents.js';
import { RecruitingEndpoint } from './endpoints/recruiting.js';

/**
 * Typed client for the Personio v2 API. Owns the OAuth2 token lifecycle and the
 * shared axios layer (auth interceptor, cursor pagination, per-endpoint rate
 * limiting, transient-error retry) and exposes one low-level endpoint object per
 * resource.
 *
 * High-level, normalized records come from the domain services
 * (`AttendanceService` / `AbsenceService`), which consume this client.
 */
export class PersonioClient {
  readonly config: ResolvedClientConfig;
  readonly auth: OAuthClient;
  readonly http: HttpClient;

  readonly attendancePeriods: AttendancePeriodsEndpoint;
  readonly absencePeriods: AbsencePeriodsEndpoint;
  readonly absenceTypes: AbsenceTypesEndpoint;
  readonly projects: ProjectsEndpoint;
  readonly persons: PersonsEndpoint;
  readonly costCenters: CostCentersEndpoint;
  readonly reports: ReportsEndpoint;

  // Further v2 resources carried over from the original inline client, so this
  // is a general v2 client (not attendance/absence-only).
  readonly documents: DocumentsEndpoint;
  readonly recruiting: RecruitingEndpoint;

  constructor(config: ClientConfig) {
    this.config = clientConfigSchema.parse(config);

    this.auth = new OAuthClient({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      baseUrl: this.config.baseUrl,
      scopes: this.config.scopes,
      timeoutMs: this.config.timeoutMs,
    });

    this.http = new HttpClient({
      baseUrl: this.config.baseUrl,
      timeoutMs: this.config.timeoutMs,
      auth: this.auth,
      maxRetries: this.config.maxRetries,
      retryBaseMs: this.config.retryBaseMs,
      minRequestIntervalMs: this.config.minRequestIntervalMs,
    });

    this.attendancePeriods = new AttendancePeriodsEndpoint(this.http);
    this.absencePeriods = new AbsencePeriodsEndpoint(this.http);
    this.absenceTypes = new AbsenceTypesEndpoint(this.http);
    this.projects = new ProjectsEndpoint(this.http);
    this.persons = new PersonsEndpoint(this.http);
    this.costCenters = new CostCentersEndpoint(this.http);
    this.reports = new ReportsEndpoint(this.http);
    this.documents = new DocumentsEndpoint(this.http);
    this.recruiting = new RecruitingEndpoint(this.http);
  }

  /** Verify connectivity/auth by acquiring a token. */
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    await this.auth.getAccessToken();
    return { status: 'healthy', timestamp: new Date().toISOString() };
  }
}
