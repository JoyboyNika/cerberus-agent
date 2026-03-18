/**
 * CerberusAgent — Crossref MCP Connector
 *
 * Provides DOI metadata lookup and citation formatting for the Curiosité head.
 * Uses the Crossref API (free, no auth, polite pool via mailto).
 *
 * Tools:
 * - crossref_lookup: Look up article metadata by DOI
 * - crossref_cite: Get formatted citation by DOI
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpConnector, McpToolResult } from './mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('mcp:crossref');

const CROSSREF_BASE = 'https://api.crossref.org';
const DOI_BASE = 'https://doi.org';
const MAILTO = 'cerberus-agent@example.com';

const CITE_ACCEPT: Record<string, string> = {
  bibtex: 'application/x-bibtex',
  ris: 'application/x-research-info-systems',
  apa: 'text/x-bibliography; style=apa',
  vancouver: 'text/x-bibliography; style=vancouver',
  chicago: 'text/x-bibliography; style=chicago-fullnote-bibliography',
};

export class CrossrefConnector extends McpConnector {
  readonly name = 'crossref';
  readonly description = 'Look up article metadata and formatted citations by DOI via Crossref';

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'crossref_lookup',
        description:
          'Look up article metadata by DOI from the canonical Crossref registry. ' +
          'Fresher than OpenAlex (20min vs hours). Checks for retractions and clinical trial numbers.',
        input_schema: {
          type: 'object' as const,
          properties: {
            doi: { type: 'string', description: 'DOI of the article (e.g., "10.1038/s41586-020-2649-2")' },
          },
          required: ['doi'],
        },
      },
      {
        name: 'crossref_cite',
        description:
          'Get a formatted citation for an article by DOI. Supports BibTeX, RIS, APA, Vancouver, and Chicago formats.',
        input_schema: {
          type: 'object' as const,
          properties: {
            doi: { type: 'string', description: 'DOI of the article' },
            format: {
              type: 'string',
              description: 'Citation format: "bibtex", "ris", "apa", "vancouver", "chicago" (default: "bibtex")',
            },
          },
          required: ['doi'],
        },
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (toolName) {
        case 'crossref_lookup':
          return await this.lookup(input.doi as string);
        case 'crossref_cite':
          return await this.cite(input.doi as string, (input.format as string) || 'bibtex');
        default:
          return { toolUseId: '', content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (error) {
      log.error('Tool execution failed', { toolName, error: String(error) });
      return { toolUseId: '', content: `Error: ${String(error)}`, isError: true };
    }
  }

  private async lookup(doi: string): Promise<McpToolResult> {
    log.info('Crossref lookup', { doi });

    const url = `${CROSSREF_BASE}/works/${encodeURIComponent(doi)}?mailto=${MAILTO}`;
    const res = await this.fetchWithTimeout(url);
    const data = await res.json() as any;

    const work = data.message;
    if (!work) {
      return { toolUseId: '', content: `No metadata found for DOI: ${doi}` };
    }

    const title = (work.title || [])[0] || 'N/A';
    const authors = (work.author || [])
      .map((a: any) => `${a.given || ''} ${a.family || ''}`.trim())
      .join(', ');

    const pubDate = work['published-print']?.['date-parts']?.[0]
      || work['published-online']?.['date-parts']?.[0]
      || work['published']?.['date-parts']?.[0];
    const dateStr = pubDate ? pubDate.join('-') : 'N/A';

    const license = (work.license || [])
      .map((l: any) => `${l.URL} (${l['content-version'] || 'N/A'})`)
      .join('; ');

    const clinicalTrial = (work['clinical-trial-number'] || [])
      .map((ct: any) => `${ct.registry}: ${ct['clinical-trial-number']}`)
      .join(', ');

    const updateTo = (work['update-to'] || [])
      .map((u: any) => `${u.type}: ${u.DOI} (${u.label || ''})`)
      .join('; ');

    return {
      toolUseId: '',
      content: [
        `DOI: ${doi}`,
        `Title: ${title}`,
        `Authors: ${authors || 'N/A'}`,
        `Published: ${dateStr}`,
        `Journal: ${(work['container-title'] || [])[0] || 'N/A'}`,
        `Type: ${work.type || 'N/A'}`,
        `Cited by: ${work['is-referenced-by-count'] || 0}`,
        license ? `License: ${license}` : null,
        clinicalTrial ? `Clinical Trial: ${clinicalTrial}` : null,
        updateTo ? `Updates/Retractions: ${updateTo}` : null,
      ].filter(Boolean).join('\n'),
    };
  }

  private async cite(doi: string, format: string): Promise<McpToolResult> {
    log.info('Crossref cite', { doi, format });

    const accept = CITE_ACCEPT[format];
    if (!accept) {
      return {
        toolUseId: '',
        content: `Unsupported format: ${format}. Use one of: ${Object.keys(CITE_ACCEPT).join(', ')}`,
        isError: true,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(`${DOI_BASE}/${encodeURIComponent(doi)}`, {
        headers: { Accept: accept },
        redirect: 'follow',
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '(unreadable)');
        throw new Error(`HTTP ${res.status} from doi.org: ${body.slice(0, 200)}`);
      }

      const citation = await res.text();
      return { toolUseId: '', content: citation.trim() };
    } finally {
      clearTimeout(timer);
    }
  }
}
