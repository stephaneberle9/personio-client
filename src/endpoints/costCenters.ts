import { HttpClient, MAX_PAGE_SIZE } from '../http/client.js';
import { costCenterSchema, parseItem, type CostCenter } from '../schemas/index.js';

export class CostCentersEndpoint {
  constructor(private readonly http: HttpClient) {}

  /**
   * List all cost centers (`GET /v2/cost-centers`, beta). Verified against a
   * live account: the endpoint returns 404 without the `Beta: true` header and
   * works with it, so the header is always sent.
   */
  async list(): Promise<CostCenter[]> {
    const raw = await this.http.getAll(
      '/v2/cost-centers',
      { limit: MAX_PAGE_SIZE },
      { headers: { Beta: 'true' } }
    );
    return raw.map((item) => parseItem(costCenterSchema, item, 'cost center'));
  }
}
