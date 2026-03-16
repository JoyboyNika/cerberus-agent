/**
 * CerberusAgent — MCP Connector Base
 *
 * Abstract base class for MCP tool connectors.
 * Each connector wraps an external API (PubMed, OpenAlex, etc.)
 * and exposes it as Anthropic-compatible tools.
 *
 * Design: connectors return Anthropic Tool definitions that
 * the heads can use via tool_use in their responses.
 */

import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../llm/logger.js';

const log = createLogger('mcp:http');

const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export interface McpToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export abstract class McpConnector {
  abstract readonly name: string;
  abstract readonly description: string;

  /**
   * Return the Anthropic Tool definitions this connector provides.
   */
  abstract getTools(): Anthropic.Tool[];

  /**
   * Execute a tool call and return the result.
   */
  abstract executeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult>;

  /**
   * Fetch with timeout and res.ok check.
   * Strips query params from URL in logs to avoid leaking sensitive data.
   */
  protected async fetchWithTimeout(url: string, timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const logUrl = url.split('?')[0];

    try {
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        const bodyPreview = await res.text().catch(() => '(unreadable)');
        log.warn('[connector:http_error]', {
          connector: this.name,
          url: logUrl,
          status: res.status,
          bodyPreview: bodyPreview.slice(0, 200),
        });
        throw new Error(`HTTP ${res.status} from ${logUrl}: ${bodyPreview.slice(0, 200)}`);
      }

      return res;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        log.warn('[connector:http_error]', {
          connector: this.name,
          url: logUrl,
          status: 'TIMEOUT',
          message: `Request timed out after ${timeoutMs}ms`,
        });
        throw new Error(`Timeout after ${timeoutMs}ms fetching ${logUrl}`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
