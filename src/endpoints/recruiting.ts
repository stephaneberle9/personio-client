import { HttpClient, type QueryParams, type RequestOptions } from '../http/client.js';
import type {
  RecruitingApplication,
  RecruitingCandidate,
  RecruitingCategory,
  RecruitingJob,
  RecruitingStageTransition,
} from '../types.js';

/** All recruiting requests carry the Beta header (ported from mcp-server). */
const BETA: RequestOptions = { headers: { Beta: 'true' } };

/**
 * v2 Recruiting API endpoints (applications, candidates, jobs, categories,
 * stage transitions) plus formatters. List methods auto-paginate over the
 * `_data`/`_meta` cursor; single gets unwrap the `_data`/`data` envelope.
 * Ported from the mcp-server client.
 */
export class RecruitingEndpoint {
  constructor(private readonly http: HttpClient) {}

  private async getOne<T>(path: string): Promise<T> {
    const body = await this.http.get<any>(path, undefined, BETA);
    return (body?._data ?? body?.data ?? body) as T;
  }

  private async listAll<T>(path: string, params?: QueryParams): Promise<T[]> {
    return this.http.getAll<T>(path, params, BETA);
  }

  /** List recruiting applications (auto-paginated). */
  async applications(params?: {
    limit?: number;
    updatedAtAfter?: string;
    updatedAtBefore?: string;
    candidateEmail?: string;
  }): Promise<RecruitingApplication[]> {
    return this.listAll<RecruitingApplication>('/v2/recruiting/applications', {
      limit: params?.limit ?? 100,
      'updated_at.gt': params?.updatedAtAfter,
      'updated_at.lt': params?.updatedAtBefore,
      'candidate.email': params?.candidateEmail,
    });
  }

  /** Get a single recruiting application. */
  async application(id: string): Promise<RecruitingApplication> {
    return this.getOne<RecruitingApplication>(`/v2/recruiting/applications/${id}`);
  }

  /** Stage transitions for an application (auto-paginated). */
  async stageTransitions(applicationId: string): Promise<RecruitingStageTransition[]> {
    return this.listAll<RecruitingStageTransition>(
      `/v2/recruiting/applications/${applicationId}/stage-transitions`
    );
  }

  /** List recruiting candidates (auto-paginated). */
  async candidates(params?: { limit?: number }): Promise<RecruitingCandidate[]> {
    return this.listAll<RecruitingCandidate>('/v2/recruiting/candidates', {
      limit: params?.limit ?? 100,
    });
  }

  /** Get a single recruiting candidate. */
  async candidate(id: string): Promise<RecruitingCandidate> {
    return this.getOne<RecruitingCandidate>(`/v2/recruiting/candidates/${id}`);
  }

  /** List recruiting jobs (auto-paginated). */
  async jobs(params?: { limit?: number }): Promise<RecruitingJob[]> {
    return this.listAll<RecruitingJob>('/v2/recruiting/jobs', { limit: params?.limit ?? 100 });
  }

  /** Get a single recruiting job. */
  async job(id: string): Promise<RecruitingJob> {
    return this.getOne<RecruitingJob>(`/v2/recruiting/jobs/${id}`);
  }

  /** List recruiting categories (auto-paginated). */
  async categories(): Promise<RecruitingCategory[]> {
    return this.listAll<RecruitingCategory>('/v2/recruiting/categories');
  }

  // ---- Formatters (ported verbatim) -------------------------------------

  formatApplication(app: any): any {
    if (!app) return app;
    return {
      id: app.id,
      application_date: app.application_date,
      candidate: app.candidate
        ? {
            id: app.candidate.id,
            name: `${app.candidate.first_name || ''} ${app.candidate.last_name || ''}`.trim(),
            email: app.candidate.email,
            gender: app.candidate.gender,
          }
        : null,
      job: app.job
        ? { id: app.job.id, name: app.job.name, department: app.job.department?.name }
        : null,
      current_stage: app.current_stage
        ? { name: app.current_stage.name, type: app.current_stage.type }
        : null,
      channel: app.channel?.name,
      is_anonymized: app.is_anonymized,
      created_at: app.created_at?.['date-time'] || app.created_at,
      updated_at: app.updated_at?.['date-time'] || app.updated_at,
    };
  }

  formatCandidate(candidate: any): any {
    if (!candidate) return candidate;
    return {
      id: candidate.id,
      first_name: candidate.first_name,
      last_name: candidate.last_name,
      name: `${candidate.first_name || ''} ${candidate.last_name || ''}`.trim(),
      email: candidate.email,
      gender: candidate.gender,
      phone: candidate.phone,
      location: candidate.location,
      linkedin_profile: candidate.linkedin_profile,
      applications: candidate.applications?.map((a: any) => ({
        id: a.id,
        application_date: a.application_date,
      })),
      created_at: candidate.created_at,
      updated_at: candidate.updated_at,
    };
  }

  formatJob(job: any): any {
    if (!job) return job;
    return {
      id: job.id,
      name: job.name,
      department: job.department?.name,
      category: job.category?.name || job.category,
      hiring_team: job.hiring_team?.map((h: any) => ({
        person_id: h.person?.id,
        role: h.role?.name,
      })),
      created_at: job.created_at?.['date-time'] || job.created_at,
      updated_at: job.updated_at?.['date-time'] || job.updated_at,
    };
  }

  formatStageTransition(transition: any): any {
    if (!transition) return transition;
    return {
      stage_name: transition.stage?.name,
      stage_type: transition.stage?.type,
      stage_kind: transition.stage?.kind,
      entered_at: transition.entered_at?.['date-time'] || transition.entered_at,
    };
  }

  formatCategory(category: any): any {
    if (!category) return category;
    return {
      id: category.id,
      name: category.name,
      stages: category.stages?.map((s: any) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        kind: s.kind,
      })),
    };
  }
}
