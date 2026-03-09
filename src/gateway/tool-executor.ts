/**
 * @deprecated — Replaced by ConnectorRegistry in src/mcp/connector-registry.ts
 * 
 * This file is kept as a pointer. Do not import from here.
 * Use ConnectorRegistry instead, which provides physical tool isolation per head.
 * 
 * Migration: ToolExecutor.register() → ConnectorRegistry.registerForHead(headId, connector)
 */

export { ConnectorRegistry } from '../mcp/connector-registry.js';
