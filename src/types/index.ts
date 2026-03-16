/**
 * CerberusAgent — Shared Types
 * Single source of truth for all type definitions.
 */

// === Agent identifiers ===

export type HeadId = 'rigueur' | 'transversalite' | 'curiosite';
export type AgentId = 'body' | HeadId | 'arbitre' | 'greffier';

// === Models — Fallback chain ===

export interface ModelConfig {
  body: string;
  heads: string;
  arbitre: string;
  greffier: string;
}

// === IMRaD/PRISMA 6-section report (FD-7) ===

export interface HeadReport {
  objectifRecherche: string;
  strategieRecherche: string;
  resultats: string;
  synthese: string;
  limitesLacunes: string;
  niveauConfiance: 'eleve' | 'modere' | 'faible';
  niveauConfianceJustification: string;
  neant: boolean;
  /** Raw LLM content used as fallback when parsing fails completely (parsedSectionCount === 0). */
  rawFallback: string | null;
}

// === Token usage tracking ===

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// === Anthropic API — System prompt blocks (for prompt caching) ===

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}
