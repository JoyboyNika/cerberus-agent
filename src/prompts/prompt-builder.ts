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

// Mapping: head → skill files to inject as additional system blocks
const HEAD_SKILLS: Partial<Record<AgentId, string[]>> = {
  rigueur: ['PUBMED_EBM_SKILL.md'],
  transversalite: ['PUBMED_ALTMED_SKILL.md', 'CLINICALTRIALS_SKILL.md', 'FOODDATA_SKILL.md', 'OPENTARGETS_SKILL.md'],
  curiosite: ['OPENALEX_SKILL.md', 'SEMANTIC_SCHOLAR_SKILL.md', 'CORE_SKILL.md', 'CROSSREF_SKILL.md'],
};

// In-memory cache: prompts are static during runtime
const cache = new Map<AgentId, string>();
const skillCache = new Map<string, string>();

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
 * Load and cache a skill file from disk.
 */
function loadSkillText(skillFile: string): string {
  if (!skillCache.has(skillFile)) {
    const filePath = join(__dirname, 'skills', skillFile);
    const content = readFileSync(filePath, 'utf-8');
    skillCache.set(skillFile, content);
  }
  return skillCache.get(skillFile)!;
}

/**
 * Build Anthropic system message blocks for a given agent.
 *
 * Returns an array of SystemBlock objects compatible with:
 *   anthropic.messages.create({ system: [...blocks] })
 *
 * Heads with skills receive N+1 blocks (prompt + skill blocks).
 * Body, Arbitre, Greffier receive 1 block (prompt only).
 *
 * Each block is marked with cache_control for Anthropic's
 * prompt caching. On cache hit, these tokens don't count toward
 * ITPM rate limits.
 */
export function buildSystemBlocks(agentId: AgentId): SystemBlock[] {
  const promptText = loadPromptText(agentId);

  const blocks: SystemBlock[] = [
    {
      type: 'text',
      text: promptText,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const skills = HEAD_SKILLS[agentId] || [];
  for (const skillFile of skills) {
    const skillText = loadSkillText(skillFile);
    blocks.push({
      type: 'text',
      text: skillText,
      cache_control: { type: 'ephemeral' },
    });
  }

  return blocks;
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
  skillCache.clear();
}
