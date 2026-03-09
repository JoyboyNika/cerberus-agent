/**
 * CerberusAgent — System Prompt Builder
 *
 * Loads .md prompt files and returns Anthropic API-compatible
 * system blocks with cache_control markers for prompt caching.
 *
 * Design decision (Audit Cuivre): prompt caching integrated at J1
 * to reduce ITPM consumption when 3 heads share the same model pool.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AgentId, SystemBlock } from '../types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROMPT_FILES: Record<AgentId, string> = {
  body: 'BODY.md',
  rigueur: 'RIGUEUR.md',
  transversalite: 'TRANSVERSALITE.md',
  curiosite: 'CURIOSITE.md',
  arbitre: 'ARBITRE.md',
  greffier: 'GREFFIER.md', // Placeholder — Jalon 4
};

// In-memory cache: prompts are static during runtime
const cache = new Map<AgentId, string>();

/**
 * Load and cache a prompt file from disk.
 */
function loadPromptText(agentId: AgentId): string {
  if (!cache.has(agentId)) {
    const filePath = join(__dirname, PROMPT_FILES[agentId]);
    const content = readFileSync(filePath, 'utf-8');
    cache.set(agentId, content);
  }
  return cache.get(agentId)!;
}

/**
 * Build Anthropic system message blocks for a given agent.
 *
 * Returns an array of SystemBlock objects compatible with:
 *   anthropic.messages.create({ system: [...blocks] })
 *
 * The .md content is marked with cache_control for Anthropic's
 * prompt caching. On cache hit, these tokens don't count toward
 * ITPM rate limits.
 */
export function buildSystemBlocks(agentId: AgentId): SystemBlock[] {
  const promptText = loadPromptText(agentId);

  return [
    {
      type: 'text',
      text: promptText,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/**
 * Get raw prompt text (for logging, debugging, testing).
 */
export function getPromptText(agentId: AgentId): string {
  return loadPromptText(agentId);
}

/**
 * Clear the in-memory cache (for testing or hot-reload).
 */
export function clearPromptCache(): void {
  cache.clear();
}
