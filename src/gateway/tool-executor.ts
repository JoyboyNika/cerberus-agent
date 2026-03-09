/**
 * CerberusAgent — Tool Executor
 *
 * Handles tool_use blocks from Claude responses.
 * Routes tool calls to the appropriate MCP connector.
 */

import { McpConnector, McpToolResult } from '../mcp/mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('tool-executor');

export class ToolExecutor {
  private connectors: Map<string, McpConnector> = new Map();
  private toolToConnector: Map<string, string> = new Map();

  /**
   * Register an MCP connector and index its tools.
   */
  register(connector: McpConnector): void {
    this.connectors.set(connector.name, connector);
    for (const tool of connector.getTools()) {
      this.toolToConnector.set(tool.name, connector.name);
    }
    log.info('Connector registered', {
      connector: connector.name,
      tools: connector.getTools().map((t) => t.name),
    });
  }

  /**
   * Execute a tool call by name.
   */
  async execute(toolName: string, toolUseId: string, input: Record<string, unknown>): Promise<McpToolResult> {
    const connectorName = this.toolToConnector.get(toolName);
    if (!connectorName) {
      log.warn('Unknown tool', { toolName });
      return { toolUseId, content: `Unknown tool: ${toolName}`, isError: true };
    }

    const connector = this.connectors.get(connectorName)!;
    log.info('Executing tool', { tool: toolName, connector: connectorName });

    const result = await connector.executeTool(toolName, input);
    return { ...result, toolUseId };
  }

  /**
   * Get all Anthropic Tool definitions from all registered connectors.
   */
  getAllTools(): import('@anthropic-ai/sdk').Tool[] {
    const tools: import('@anthropic-ai/sdk').Tool[] = [];
    for (const connector of this.connectors.values()) {
      tools.push(...connector.getTools());
    }
    return tools;
  }

  /**
   * Get tools for a specific connector.
   */
  getToolsFor(connectorName: string): import('@anthropic-ai/sdk').Tool[] {
    const connector = this.connectors.get(connectorName);
    return connector ? connector.getTools() : [];
  }
}
