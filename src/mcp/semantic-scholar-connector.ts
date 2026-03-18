/**
 * CerberusAgent — Semantic Scholar MCP Connector
 *
 * Provides academic paper search with TLDR summaries and citation graph
 * navigation for the Curiosité head.
 * Uses the Semantic Scholar Academic Graph API.
 *
 * Tools:
 * - s2_search: Search for papers
 * - s2_get_paper: Get paper details by ID/DOI/PMID
 * - s2_citations: Get papers citing a given paper
 * - s2_references: Get papers referenced by a given paper
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpConnector, McpToolResult } from './mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('mcp:semantic-scholar');

const S2_BASE = 'https://api.semanticscholar.org/graph/v1';

const PAPER_FIELDS = 'paperId,externalIds,title,abstract,tldr,year,citationCount,influentialCitationCount,publicationTypes,openAccessPdf';
const PAPER_DETAIL_FIELDS = `${PAPER_FIELDS},s2FieldsOfStudy,authors`;
const CITATION_FIELDS = 'paperId,title,year,citationCount,influentialCitationCount';

export class SemanticScholarConnector extends McpConnector {
  readonly name = 'semantic-scholar';
  readonly description = 'Search Semantic Scholar for academic papers with TLDR and citation graphs';

  /**
   * Fetch with timeout and optional S2 API key header.
   * Overrides base class to inject x-api-key header when available.
   */
  private async s2Fetch(url: string): Promise<Response> {
    const apiKey = process.env.S2_API_KEY;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const headers: Record<string, string> = {};
      if (apiKey) headers['x-api-key'] = apiKey;

      const res = await fetch(url, { signal: controller.signal, headers });
      if (!res.ok) {
        const body = await res.text().catch(() => '(unreadable)');
        throw new Error(`HTTP ${res.status} from Semantic Scholar: ${body.slice(0, 200)}`);
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 's2_search',
        description:
          'Search Semantic Scholar for academic papers. Returns titles, TLDR summaries, citation counts, and publication types.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query' },
            max_results: { type: 'number', description: 'Max results (default: 10, max: 100)' },
            fields_of_study: { type: 'string', description: 'Field of study filter (e.g., "Medicine", "Biology")' },
            year: { type: 'string', description: 'Year range (e.g., "2020-2025", "2023-")' },
            publication_types: { type: 'string', description: 'Publication types (e.g., "Review,MetaAnalysis,ClinicalTrial")' },
          },
          required: ['query'],
        },
      },
      {
        name: 's2_get_paper',
        description:
          'Get full details of a paper by its Semantic Scholar ID, DOI (DOI:...), or PMID (PMID:...). Returns abstract, TLDR, authors, citations.',
        input_schema: {
          type: 'object' as const,
          properties: {
            paper_id: { type: 'string', description: 'Paper ID: SHA, DOI:10.xxx, PMID:12345, or ARXIV:2106.xxx' },
          },
          required: ['paper_id'],
        },
      },
      {
        name: 's2_citations',
        description: 'Get papers that cite a given paper. Useful for forward navigation in the citation graph.',
        input_schema: {
          type: 'object' as const,
          properties: {
            paper_id: { type: 'string', description: 'Paper ID' },
            max_results: { type: 'number', description: 'Max results (default: 20, max: 100)' },
          },
          required: ['paper_id'],
        },
      },
      {
        name: 's2_references',
        description: 'Get papers referenced by a given paper. Useful for backward navigation in the citation graph.',
        input_schema: {
          type: 'object' as const,
          properties: {
            paper_id: { type: 'string', description: 'Paper ID' },
            max_results: { type: 'number', description: 'Max results (default: 20, max: 100)' },
          },
          required: ['paper_id'],
        },
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (toolName) {
        case 's2_search':
          return await this.search(input);
        case 's2_get_paper':
          return await this.getPaper(input.paper_id as string);
        case 's2_citations':
          return await this.getCitations(input.paper_id as string, (input.max_results as number) || 20);
        case 's2_references':
          return await this.getReferences(input.paper_id as string, (input.max_results as number) || 20);
        default:
          return { toolUseId: '', content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (error) {
      log.error('Tool execution failed', { toolName, error: String(error) });
      return { toolUseId: '', content: `Error: ${String(error)}`, isError: true };
    }
  }

  private async search(input: Record<string, unknown>): Promise<McpToolResult> {
    const query = input.query as string;
    const maxResults = Math.min((input.max_results as number) || 10, 100);
    const fieldsOfStudy = input.fields_of_study as string | undefined;
    const year = input.year as string | undefined;
    const pubTypes = input.publication_types as string | undefined;

    log.info('Semantic Scholar search', { query, maxResults });

    const params = new URLSearchParams({
      query,
      fields: PAPER_FIELDS,
      limit: String(maxResults),
    });
    if (fieldsOfStudy) params.set('fieldsOfStudy', fieldsOfStudy);
    if (year) params.set('year', year);
    if (pubTypes) params.set('publicationTypes', pubTypes);

    const url = `${S2_BASE}/paper/search?${params.toString()}`;
    const res = await this.s2Fetch(url);
    const data = await res.json() as any;

    const papers = data.data || [];
    if (papers.length === 0) {
      return { toolUseId: '', content: 'No results found.' };
    }

    const results = papers.map((p: any) => this.formatPaperBrief(p));

    return {
      toolUseId: '',
      content: `Found ${data.total || papers.length} results (showing ${papers.length}):\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private async getPaper(paperId: string): Promise<McpToolResult> {
    log.info('Semantic Scholar get paper', { paperId });

    const url = `${S2_BASE}/paper/${encodeURIComponent(paperId)}?fields=${PAPER_DETAIL_FIELDS}`;
    const res = await this.s2Fetch(url);
    const p = await res.json() as any;

    if (!p.paperId) {
      return { toolUseId: '', content: `Paper not found: ${paperId}` };
    }

    const authors = (p.authors || [])
      .map((a: any) => a.name || 'Unknown')
      .join(', ');

    const fields = (p.s2FieldsOfStudy || [])
      .map((f: any) => f.category)
      .join(', ');

    return {
      toolUseId: '',
      content: [
        `Paper ID: ${p.paperId}`,
        `DOI: ${p.externalIds?.DOI || 'N/A'}`,
        `PMID: ${p.externalIds?.PubMed || 'N/A'}`,
        `Title: ${p.title || 'N/A'}`,
        `Authors: ${authors}`,
        `Year: ${p.year || 'N/A'}`,
        `Citations: ${p.citationCount || 0} (influential: ${p.influentialCitationCount || 0})`,
        `Types: ${(p.publicationTypes || []).join(', ') || 'N/A'}`,
        `Fields: ${fields || 'N/A'}`,
        `Open Access: ${p.openAccessPdf?.url || 'N/A'}`,
        ``,
        `TLDR: ${p.tldr?.text || '(No TLDR available)'}`,
        ``,
        `Abstract:`,
        p.abstract || '(No abstract available)',
      ].join('\n'),
    };
  }

  private async getCitations(paperId: string, maxResults: number): Promise<McpToolResult> {
    const limit = Math.min(maxResults, 100);
    log.info('Semantic Scholar citations', { paperId, limit });

    const url = `${S2_BASE}/paper/${encodeURIComponent(paperId)}/citations?fields=${CITATION_FIELDS}&limit=${limit}`;
    const res = await this.s2Fetch(url);
    const data = await res.json() as any;

    const citations = data.data || [];
    if (citations.length === 0) {
      return { toolUseId: '', content: 'No citing papers found.' };
    }

    const results = citations.map((c: any) => {
      const p = c.citingPaper || {};
      return [
        `Paper ID: ${p.paperId || 'N/A'}`,
        `Title: ${p.title || 'N/A'}`,
        `Year: ${p.year || 'N/A'}`,
        `Citations: ${p.citationCount || 0} (influential: ${p.influentialCitationCount || 0})`,
      ].join('\n');
    });

    return {
      toolUseId: '',
      content: `${citations.length} citing papers:\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private async getReferences(paperId: string, maxResults: number): Promise<McpToolResult> {
    const limit = Math.min(maxResults, 100);
    log.info('Semantic Scholar references', { paperId, limit });

    const url = `${S2_BASE}/paper/${encodeURIComponent(paperId)}/references?fields=${CITATION_FIELDS}&limit=${limit}`;
    const res = await this.s2Fetch(url);
    const data = await res.json() as any;

    const references = data.data || [];
    if (references.length === 0) {
      return { toolUseId: '', content: 'No references found.' };
    }

    const results = references.map((r: any) => {
      const p = r.citedPaper || {};
      return [
        `Paper ID: ${p.paperId || 'N/A'}`,
        `Title: ${p.title || 'N/A'}`,
        `Year: ${p.year || 'N/A'}`,
        `Citations: ${p.citationCount || 0} (influential: ${p.influentialCitationCount || 0})`,
      ].join('\n');
    });

    return {
      toolUseId: '',
      content: `${references.length} referenced papers:\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private formatPaperBrief(p: any): string {
    return [
      `Paper ID: ${p.paperId}`,
      `DOI: ${p.externalIds?.DOI || 'N/A'}`,
      `PMID: ${p.externalIds?.PubMed || 'N/A'}`,
      `Title: ${p.title || 'N/A'}`,
      `Year: ${p.year || 'N/A'}`,
      `Citations: ${p.citationCount || 0} (influential: ${p.influentialCitationCount || 0})`,
      `Types: ${(p.publicationTypes || []).join(', ') || 'N/A'}`,
      `TLDR: ${p.tldr?.text || '(No TLDR)'}`,
      `Open Access: ${p.openAccessPdf?.url || 'N/A'}`,
    ].join('\n');
  }
}
