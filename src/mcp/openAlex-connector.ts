/**
 * CerberusAgent — OpenAlex MCP Connector
 *
 * Provides academic search for the Curiosité head.
 * Uses the OpenAlex API (free, no API key required, polite pool with email).
 *
 * Tools:
 * - openalex_search: Search works across all academic disciplines
 * - openalex_get_work: Get details of a specific work by OpenAlex ID
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpConnector, McpToolResult } from './mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('mcp:openalex');

const OPENALEX_BASE = 'https://api.openalex.org';
// Polite pool: add email to get faster responses
const MAILTO = 'cerberus-agent@example.com';

export class OpenAlexConnector extends McpConnector {
  readonly name = 'openalex';
  readonly description = 'Search OpenAlex for academic works across all disciplines';

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'openalex_search',
        description:
          'Search OpenAlex for academic articles, books, and datasets across ALL disciplines. ' +
          'Use for non-medical academic sources: history, ethnobotany, archaeology, chemistry, physics, etc.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'Search query (semantic search across titles and abstracts)',
            },
            max_results: {
              type: 'number',
              description: 'Maximum results to return (default: 10, max: 25)',
            },
            exclude_medical: {
              type: 'boolean',
              description: 'If true, exclude results tagged with medical/health concepts (default: true for Curiosité)',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'openalex_get_work',
        description: 'Get full details of a specific work by its OpenAlex ID (e.g., "W2741809807").',
        input_schema: {
          type: 'object' as const,
          properties: {
            work_id: {
              type: 'string',
              description: 'OpenAlex work ID (e.g., "W2741809807")',
            },
          },
          required: ['work_id'],
        },
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (toolName) {
        case 'openalex_search':
          return await this.search(
            input.query as string,
            (input.max_results as number) || 10,
            input.exclude_medical !== false, // default true
          );
        case 'openalex_get_work':
          return await this.getWork(input.work_id as string);
        default:
          return { toolUseId: '', content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (error) {
      log.error('Tool execution failed', { toolName, error: String(error) });
      return { toolUseId: '', content: `Error: ${String(error)}`, isError: true };
    }
  }

  private async search(query: string, maxResults: number, excludeMedical: boolean): Promise<McpToolResult> {
    const clampedMax = Math.min(maxResults, 25);
    log.info('OpenAlex search', { query, maxResults: clampedMax, excludeMedical });

    let url = `${OPENALEX_BASE}/works?search=${encodeURIComponent(query)}&per_page=${clampedMax}&mailto=${MAILTO}`;

    // Exclude medical concepts if requested (Curiosité head default)
    if (excludeMedical) {
      // OpenAlex concept IDs for Medicine and Health Sciences
      url += '&filter=concepts.id:!C71924100,concepts.id:!C126322002';
    }

    const res = await fetch(url);
    const data = await res.json() as any;

    const works = data.results || [];
    if (works.length === 0) {
      return { toolUseId: '', content: 'No results found.' };
    }

    const results = works.map((w: any) => {
      const authors = (w.authorships || [])
        .slice(0, 3)
        .map((a: any) => a.author?.display_name || 'Unknown')
        .join(', ');
      const authSuffix = (w.authorships || []).length > 3 ? ' et al.' : '';

      return [
        `ID: ${w.id}`,
        `Title: ${w.title || 'N/A'}`,
        `Authors: ${authors}${authSuffix}`,
        `Year: ${w.publication_year || 'N/A'}`,
        `Type: ${w.type || 'N/A'}`,
        `DOI: ${w.doi || 'N/A'}`,
        `Cited by: ${w.cited_by_count || 0}`,
        `Concepts: ${(w.concepts || []).slice(0, 5).map((c: any) => c.display_name).join(', ')}`,
      ].join('\n');
    });

    return {
      toolUseId: '',
      content: `Found ${works.length} results:\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private async getWork(workId: string): Promise<McpToolResult> {
    log.info('OpenAlex get work', { workId });

    const url = `${OPENALEX_BASE}/works/${workId}?mailto=${MAILTO}`;
    const res = await fetch(url);
    const w = await res.json() as any;

    if (!w.title) {
      return { toolUseId: '', content: `No work found with ID ${workId}` };
    }

    const authors = (w.authorships || [])
      .map((a: any) => `${a.author?.display_name || 'Unknown'} (${a.institutions?.[0]?.display_name || 'N/A'})`)
      .join('; ');

    return {
      toolUseId: '',
      content: [
        `ID: ${w.id}`,
        `Title: ${w.title}`,
        `Authors: ${authors}`,
        `Year: ${w.publication_year || 'N/A'}`,
        `Type: ${w.type || 'N/A'}`,
        `DOI: ${w.doi || 'N/A'}`,
        `Cited by: ${w.cited_by_count || 0}`,
        `Open Access: ${w.open_access?.is_oa ? 'Yes' : 'No'}`,
        `OA URL: ${w.open_access?.oa_url || 'N/A'}`,
        ``,
        `Abstract:`,
        w.abstract_inverted_index
          ? this.invertedIndexToText(w.abstract_inverted_index)
          : '(No abstract available)',
        ``,
        `Concepts: ${(w.concepts || []).map((c: any) => `${c.display_name} (${(c.score * 100).toFixed(0)}%)`).join(', ')}`,
      ].join('\n'),
    };
  }

  /**
   * OpenAlex stores abstracts as inverted indexes.
   * Convert { word: [positions] } back to text.
   */
  private invertedIndexToText(invertedIndex: Record<string, number[]>): string {
    const words: [number, string][] = [];
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const pos of positions) {
        words.push([pos, word]);
      }
    }
    words.sort((a, b) => a[0] - b[0]);
    return words.map(([_, word]) => word).join(' ');
  }
}
