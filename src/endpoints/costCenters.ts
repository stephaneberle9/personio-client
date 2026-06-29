import { HttpClient, MAX_PAGE_SIZE } from '../http/client.js';
import { costCenterSchema, parseItem, type CostCenter } from '../schemas/index.js';

export class CostCentersEndpoint {
  constructor(private readonly http: HttpClient) {}

  /**
   * List all cost centers (`GET /v2/cost-centers`, beta). Personio marks this
   * endpoint as beta, so it may require the `Beta: true` header on some plans —
   * verify against your account (see OPEN_QUESTIONS.md).
   */
  async list(): Promise<CostCenter[]> {
    const raw = await this.http.getAll('/v2/cost-centers', { limit: MAX_PAGE_SIZE });
    return raw.map((item) => parseItem(costCenterSchema, item, 'cost center'));
  }
}
