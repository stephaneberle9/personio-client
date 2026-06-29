import type { PersonioClient } from '../client.js';
import type {
  ApplicationRecord,
  CandidateRecord,
  JobRecord,
} from '../model/recruiting-records.js';
import type {
  RecruitingApplication,
  RecruitingCandidate,
  RecruitingJob,
} from '../types.js';

/** Extract an ISO timestamp from the v2 `{ 'date-time' }` shape or a plain string. */
function ts(value: unknown): string {
  if (value && typeof value === 'object' && 'date-time' in (value as any)) {
    return String((value as any)['date-time'] ?? '');
  }
  return value ? String(value) : '';
}

/**
 * High-level recruiting service: lists v2 recruiting objects (auto-paginated)
 * and normalizes them to flat, typed records, smoothing over the API's nested
 * timestamp shapes.
 */
export class RecruitingService {
  constructor(private readonly client: PersonioClient) {}

  async getApplications(params?: {
    limit?: number;
    updatedAtAfter?: string;
    updatedAtBefore?: string;
    candidateEmail?: string;
  }): Promise<ApplicationRecord[]> {
    const apps = await this.client.recruiting.applications(params);
    return apps.map((a) => this.toApplicationRecord(a));
  }

  async getCandidates(params?: { limit?: number }): Promise<CandidateRecord[]> {
    const candidates = await this.client.recruiting.candidates(params);
    return candidates.map((c) => this.toCandidateRecord(c));
  }

  async getJobs(params?: { limit?: number }): Promise<JobRecord[]> {
    const jobs = await this.client.recruiting.jobs(params);
    return jobs.map((j) => this.toJobRecord(j));
  }

  private toApplicationRecord(a: RecruitingApplication): ApplicationRecord {
    const first = a.candidate?.first_name ?? '';
    const last = a.candidate?.last_name ?? '';
    return {
      id: a.id,
      applicationDate: a.application_date ?? '',
      candidateId: a.candidate?.id ?? '',
      candidateName: `${first} ${last}`.trim(),
      candidateEmail: a.candidate?.email ?? '',
      jobId: a.job?.id ?? '',
      jobName: a.job?.name ?? '',
      department: a.job?.department?.name ?? '',
      stageName: a.current_stage?.name ?? '',
      stageType: a.current_stage?.type ?? '',
      channel: a.channel?.name ?? '',
      isAnonymized: Boolean(a.is_anonymized),
      createdAt: ts(a.created_at),
      updatedAt: ts(a.updated_at),
    };
  }

  private toCandidateRecord(c: RecruitingCandidate): CandidateRecord {
    const first = c.first_name ?? '';
    const last = c.last_name ?? '';
    return {
      id: c.id,
      firstName: first,
      lastName: last,
      name: `${first} ${last}`.trim(),
      email: c.email ?? '',
      phone: c.phone ?? '',
      location: c.location ?? '',
      linkedinProfile: c.linkedin_profile ?? '',
      createdAt: ts(c.created_at),
      updatedAt: ts(c.updated_at),
    };
  }

  private toJobRecord(j: RecruitingJob): JobRecord {
    return {
      id: j.id,
      name: j.name ?? '',
      department: j.department?.name ?? '',
      category: typeof j.category === 'string' ? j.category : j.category?.name ?? '',
      createdAt: ts(j.created_at),
      updatedAt: ts(j.updated_at),
    };
  }
}
