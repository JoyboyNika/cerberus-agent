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
}
