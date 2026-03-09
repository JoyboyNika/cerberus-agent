/**
 * CerberusAgent — Connector Registry
 *
 * Maps each head to its own set of MCP connectors.
 * Enforces physical isolation: a head can only see and use
 * the tools from its registered connectors.
 *
 * Design decision (Audit Cuivre): isolation at the code level,
 * not just prompt level. Each head receives ONLY its own tools.
 * Inside its sources, the prompt instructs the head to exhaust
 * all available tools before concluding.
 */

import Anthropic from '@anthropic-ai/sdk';
import { HeadId } from '../types/index.js';
import { McpConnector, McpToolResult } from './mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('connector-registry');

export class ConnectorRegistry {
  private headConnectors: Map<HeadId, McpConnector[]> = new Map();
  private toolToConnector: Map<string, McpConnector> = new Map();

  constructor() {
    // Initialize empty connector lists for each head
    this.headConnectors.set('rigueur', []);
    this.headConnectors.set('transversalite', []);
    this.headConnectors.set('curiosite', []);
  }

  /**
   * Register a connector for a specific head.
   * The connector's tools will ONLY be visible to this head.
   */
  registerForHead(headId: HeadId, connector: McpConnector): void {
    const connectors = this.headConnectors.get(headId)!;
    connectors.push(connector);

    for (const tool of connector.getTools()) {
      this.toolToConnector.set(tool.name, connector);
    }

    log.info('Connector registered', {
      head: headId,
      connector: connector.name,
      tools: connector.getTools().map((t) => t.name),
    });
  }

  /**
   * Get Anthropic Tool definitions for a specific head.
   * Returns ONLY the tools this head is allowed to use.
   */
  getToolsForHead(headId: HeadId): Anthropic.Tool[] {
    const connectors = this.headConnectors.get(headId) || [];
    return connectors.flatMap((c) => c.getTools());
  }

  /**
   * Execute a tool call. The tool must belong to a registered connector.
   */
  async executeTool(toolName: string, toolUseId: string, input: Record<string, unknown>): Promise<McpToolResult> {
    const connector = this.toolToConnector.get(toolName);
    if (!connector) {
      log.warn('Unknown tool called', { toolName });
      return { toolUseId, content: `Unknown tool: ${toolName}`, isError: true };
    }

    log.info('Executing tool', { tool: toolName, connector: connector.name });
    const result = await connector.executeTool(toolName, input);
    return { ...result, toolUseId };
  }

  /**
   * Get a summary of what's connected where (for logging/debug).
   */
  getSummary(): Record<HeadId, string[]> {
    const summary: Record<string, string[]> = {};
    for (const [headId, connectors] of this.headConnectors.entries()) {
      summary[headId] = connectors.map((c) => c.name);
    }
    return summary as Record<HeadId, string[]>;
  }
}
