import { HttpClient, MAX_PAGE_SIZE, type QueryParams } from '../http/client.js';
import { parseItem, projectSchema, type Project } from '../schemas/index.js';

export interface ProjectFilters {
  /**
   * Expensive fields to expand via the `includes` parameter (e.g.
   * `['tracked_minutes']`). Omitted by default to keep responses cheap.
   */
  includes?: string[];
  status?: string;
}

export class ProjectsEndpoint {
  constructor(private readonly http: HttpClient) {}

  /** List all projects, following pagination. */
  async list(filters: ProjectFilters = {}): Promise<Project[]> {
    const params: QueryParams = {
      limit: MAX_PAGE_SIZE,
      includes: filters.includes,
      status: filters.status,
    };
    const raw = await this.http.getAll('/v2/projects', params);
    return raw.map((item) => parseItem(projectSchema, item, 'project'));
  }

  /** List the members of a single project (`GET /v2/projects/{id}/members`). */
  async members(projectId: string): Promise<unknown[]> {
    return this.http.getAll(`/v2/projects/${encodeURIComponent(projectId)}/members`, {
      limit: MAX_PAGE_SIZE,
    });
  }
}
