import { HttpClient, type QueryParams } from '../http/client.js';
import type { Page } from '../http/paginate.js';
import type { DocumentV2 } from '../types.js';

/**
 * v2 Document Management API (list/download/delete). Ported from the mcp-server
 * client; the v1 document endpoints are intentionally omitted (v2-only client).
 */
export class DocumentsEndpoint {
  constructor(private readonly http: HttpClient) {}

  /** One page of documents for an owner (employee or application). */
  async listForOwner(
    ownerId: string | number,
    params?: { category_id?: string; limit?: number; cursor?: string }
  ): Promise<Page<DocumentV2>> {
    const query: QueryParams = {
      owner_id: String(ownerId),
      category_id: params?.category_id,
      limit: params?.limit,
      cursor: params?.cursor,
    };
    return this.http.getPage<DocumentV2>('/v2/document-management/documents', query);
  }

  /** All documents for an owner, following cursor pagination. */
  async listAllForOwner(
    ownerId: string | number,
    params?: { category_id?: string }
  ): Promise<DocumentV2[]> {
    return this.http.getAll<DocumentV2>('/v2/document-management/documents', {
      owner_id: String(ownerId),
      category_id: params?.category_id,
      limit: 100,
    });
  }

  /** Download a document as a Buffer. */
  async download(documentId: string): Promise<Buffer> {
    const id = encodeURIComponent(documentId);
    return this.http.getBinary(`/v2/document-management/documents/${id}/download`);
  }

  /** Delete a document. Returns 204 No Content on success. */
  async delete(documentId: string): Promise<void> {
    await this.http.delete(`/v2/document-management/documents/${encodeURIComponent(documentId)}`);
  }

  /** Flatten a v2 document for display. */
  format(document: DocumentV2): Record<string, unknown> {
    return {
      id: document.id,
      name: document.name,
      date: document.date,
      comment: document.comment,
      category_id: document.category?.id,
      owner_id: document.owner?.id,
      document_type: document.document_type,
      size: document.size,
      created_at: document.created_at,
      virus_scan_status: document.virus_scan?.status,
    };
  }
}
