/**
 * CerberusAgent — PubMed MCP Connector
 *
 * Provides search capabilities for the Rigueur and Transversalité heads.
 * Uses the NCBI E-utilities API (free, no API key required for low volume).
 *
 * Tools:
 * - pubmed_search: Search PubMed with filters
 * - pubmed_fetch_abstract: Fetch abstract by PMID
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpConnector, McpToolResult } from './mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('mcp:pubmed');

const EUTILS_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export class PubMedConnector extends McpConnector {
  readonly name = 'pubmed';
  readonly description = 'Search PubMed for biomedical literature';

  private readonly filters: string[];

  /**
   * @param filters - PubMed search filters to append (e.g., for EBM vs alternative)
   */
  constructor(filters: string[] = []) {
    super();
    this.filters = filters;
  }

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'pubmed_search',
        description:
          'Search PubMed for biomedical articles. Returns PMIDs and brief info. ' +
          'Use MeSH terms for precision. Results are pre-filtered based on head configuration.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'PubMed search query (supports MeSH terms, Boolean operators)',
            },
            max_results: {
              type: 'number',
              description: 'Maximum results to return (default: 10, max: 20)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'pubmed_fetch_abstract',
        description: 'Fetch the title, abstract, authors, and publication info for a given PMID.',
        input_schema: {
          type: 'object' as const,
          properties: {
            pmid: {
              type: 'string',
              description: 'PubMed ID (e.g., "12345678")',
            },
          },
          required: ['pmid'],
        },
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (toolName) {
        case 'pubmed_search':
          return await this.search(input.query as string, (input.max_results as number) || 10);
        case 'pubmed_fetch_abstract':
          return await this.fetchAbstract(input.pmid as string);
        default:
          return { toolUseId: '', content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (error) {
      log.error('Tool execution failed', { toolName, error: String(error) });
      return { toolUseId: '', content: `Error: ${String(error)}`, isError: true };
    }
  }

  private async search(query: string, maxResults: number): Promise<McpToolResult> {
    const fullQuery = this.filters.length > 0
      ? `(${query}) AND (${this.filters.join(' AND ')})`
      : query;

    const clampedMax = Math.min(maxResults, 20);

    log.info('PubMed search', { query: fullQuery, maxResults: clampedMax });

    // Step 1: ESearch to get PMIDs
    const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(fullQuery)}&retmax=${clampedMax}&retmode=json&sort=relevance`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json() as any;

    const pmids: string[] = searchData.esearchresult?.idlist || [];

    if (pmids.length === 0) {
      return { toolUseId: '', content: 'No results found for this query.' };
    }

    // Step 2: ESummary for brief info
    const summaryUrl = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl);
    const summaryData = await summaryRes.json() as any;

    const results = pmids.map((pmid) => {
      const article = summaryData.result?.[pmid];
      if (!article) return `PMID:${pmid} — (no summary available)`;
      return [
        `PMID: ${pmid}`,
        `Title: ${article.title || 'N/A'}`,
        `Authors: ${(article.authors || []).map((a: any) => a.name).slice(0, 3).join(', ')}${(article.authors || []).length > 3 ? ' et al.' : ''}`,
        `Journal: ${article.fulljournalname || article.source || 'N/A'}`,
        `Date: ${article.pubdate || 'N/A'}`,
        `DOI: ${article.elocationid || 'N/A'}`,
      ].join('\n');
    });

    return {
      toolUseId: '',
      content: `Found ${pmids.length} results:\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private async fetchAbstract(pmid: string): Promise<McpToolResult> {
    log.info('PubMed fetch abstract', { pmid });

    const url = `${EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`;
    const res = await fetch(url);
    const xml = await res.text();

    // Simple XML parsing for abstract (no dependency needed)
    const title = this.extractXml(xml, 'ArticleTitle');
    const abstract = this.extractXml(xml, 'AbstractText');
    const journal = this.extractXml(xml, 'Title');
    const year = this.extractXml(xml, 'Year');

    if (!title && !abstract) {
      return { toolUseId: '', content: `No data found for PMID ${pmid}` };
    }

    return {
      toolUseId: '',
      content: [
        `PMID: ${pmid}`,
        `Title: ${title}`,
        `Journal: ${journal}`,
        `Year: ${year}`,
        ``,
        `Abstract:`,
        abstract || '(No abstract available)',
      ].join('\n'),
    };
  }

  private extractXml(xml: string, tag: string): string {
    const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 's');
    const match = xml.match(regex);
    return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
  }
}
