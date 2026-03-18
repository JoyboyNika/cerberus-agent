/**
 * CerberusAgent — CORE MCP Connector
 *
 * Provides full-text open access article search for the Curiosité head.
 * Uses the CORE API v3 (API key required, free tier).
 *
 * Tools:
 * - core_search: Search CORE for open access articles (full text search)
 * - core_get_work: Get full details including complete text
 * - core_find_fulltext: Find full text by DOI
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpConnector, McpToolResult } from './mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('mcp:core');

const CORE_BASE = 'https://api.core.ac.uk/v3';

export class CoreConnector extends McpConnector {
  readonly name = 'core';
  readonly description = 'Search CORE for open access full-text academic articles';

  private get apiKey(): string {
    return process.env.CORE_API_KEY || '';
  }

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'core_search',
        description:
          'Search CORE for open access academic articles. Unlike OpenAlex, CORE searches the FULL TEXT of articles. ' +
          'Supports Elasticsearch syntax: fullText:(term), title:(term), AND/OR/NOT, yearPublished:[2020 TO 2025].',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Elasticsearch query (e.g., "fullText:(curcumin anti-inflammatory)")' },
            max_results: { type: 'number', description: 'Max results (default: 10, max: 100)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'core_get_work',
        description:
          'Get full details of a CORE article including its complete text. WARNING: Full text can be very large (50KB+).',
        input_schema: {
          type: 'object' as const,
          properties: {
            core_id: { type: 'string', description: 'CORE work ID' },
          },
          required: ['core_id'],
        },
      },
      {
        name: 'core_find_fulltext',
        description:
          'Find the full text of an article by its DOI. Useful when you have a DOI from PubMed or OpenAlex and want to read the complete article.',
        input_schema: {
          type: 'object' as const,
          properties: {
            doi: { type: 'string', description: 'DOI of the article (e.g., "10.1234/example")' },
          },
          required: ['doi'],
        },
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (toolName) {
        case 'core_search':
          return await this.search(input.query as string, (input.max_results as number) || 10);
        case 'core_get_work':
          return await this.getWork(input.core_id as string);
        case 'core_find_fulltext':
          return await this.findFulltext(input.doi as string);
        default:
          return { toolUseId: '', content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (error) {
      log.error('Tool execution failed', { toolName, error: String(error) });
      return { toolUseId: '', content: `Error: ${String(error)}`, isError: true };
    }
  }

  private async search(query: string, maxResults: number): Promise<McpToolResult> {
    const limit = Math.min(maxResults, 100);
    log.info('CORE search', { query, limit });

    const url = `${CORE_BASE}/search/works/${encodeURIComponent(query)}?limit=${limit}&exclude=fullText&apiKey=${this.apiKey}`;
    const res = await this.fetchWithTimeout(url);
    const data = await res.json() as any;

    const works = data.results || [];
    if (works.length === 0) {
      return { toolUseId: '', content: 'No results found.' };
    }

    const results = works.map((w: any) =>
      [
        `CORE ID: ${w.id || 'N/A'}`,
        `Title: ${w.title || 'N/A'}`,
        `DOI: ${w.doi || 'N/A'}`,
        `Year: ${w.yearPublished || 'N/A'}`,
        `Language: ${w.language?.code || 'N/A'}`,
        `Provider: ${w.dataProvider?.name || 'N/A'}`,
        `Download: ${w.downloadUrl || 'N/A'}`,
        `Abstract: ${(w.abstract || 'N/A').slice(0, 300)}`,
      ].join('\n')
    );

    return {
      toolUseId: '',
      content: `Found ${data.totalHits || works.length} results (showing ${works.length}):\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private async getWork(coreId: string): Promise<McpToolResult> {
    log.info('CORE get work', { coreId });

    const url = `${CORE_BASE}/works/${encodeURIComponent(coreId)}?apiKey=${this.apiKey}`;
    const res = await this.fetchWithTimeout(url);
    const w = await res.json() as any;

    if (!w.title) {
      return { toolUseId: '', content: `Work not found: ${coreId}` };
    }

    const authors = (w.authors || [])
      .map((a: any) => a.name || 'Unknown')
      .join(', ');

    return {
      toolUseId: '',
      content: [
        `CORE ID: ${w.id || coreId}`,
        `Title: ${w.title}`,
        `Authors: ${authors || 'N/A'}`,
        `DOI: ${w.doi || 'N/A'}`,
        `Year: ${w.yearPublished || 'N/A'}`,
        `Download: ${w.downloadUrl || 'N/A'}`,
        ``,
        `Abstract:`,
        w.abstract || '(No abstract)',
        ``,
        `Full Text:`,
        w.fullText || '(No full text available)',
      ].join('\n'),
    };
  }

  private async findFulltext(doi: string): Promise<McpToolResult> {
    log.info('CORE find fulltext', { doi });

    const url = `${CORE_BASE}/discover?doi=${encodeURIComponent(doi)}&apiKey=${this.apiKey}`;
    const res = await this.fetchWithTimeout(url);
    const data = await res.json() as any;

    if (!data.id && !data.title) {
      return { toolUseId: '', content: `No full text found for DOI: ${doi}` };
    }

    return {
      toolUseId: '',
      content: [
        `CORE ID: ${data.id || 'N/A'}`,
        `Title: ${data.title || 'N/A'}`,
        `Download URL: ${data.downloadUrl || 'N/A'}`,
        `Full Text Link: ${data.fullTextLink || data.downloadUrl || 'N/A'}`,
      ].join('\n'),
    };
  }
}
