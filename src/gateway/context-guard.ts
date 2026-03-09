/**
 * CerberusAgent — Context Window Guard
 * Inspired by OpenClaw's context-window-guard.ts
 *
 * Estimates context usage and warns/blocks before overflow.
 * Critical for multi-turn consultations where context grows.
 *
 * Context windows (Anthropic, as of 2025):
 * - Opus/Sonnet: 200K tokens (default), 1M (beta, Tier 4)
 * - Haiku: 200K tokens
 */

import { createLogger } from '../llm/logger.js';

const log = createLogger('context-guard');

export interface ContextGuardConfig {
  maxContextTokens: number;   // Model's context window
  warnAtPercent: number;       // Warn when usage exceeds this %
  blockAtPercent: number;      // Block when usage exceeds this %
  hardMinFreeTokens: number;   // Minimum free tokens for a response
}

const DEFAULT_CONFIG: ContextGuardConfig = {
  maxContextTokens: 200_000,
  warnAtPercent: 70,
  blockAtPercent: 90,
  hardMinFreeTokens: 8_000,
};

export type ContextGuardResult =
  | { ok: true; usagePercent: number; freeTokens: number }
  | { ok: false; action: 'warn' | 'block'; usagePercent: number; freeTokens: number; message: string };

/**
 * Estimate the token count of a string.
 * Rough approximation: ~4 chars per token for English, ~2 for French.
 * Good enough for guard rails, not for billing.
 */
export function estimateTokens(text: string): number {
  // Average between English and French estimation
  return Math.ceil(text.length / 3);
}

/**
 * Check if the estimated context usage is within safe bounds.
 */
export function checkContextUsage(
  estimatedInputTokens: number,
  config?: Partial<ContextGuardConfig>,
): ContextGuardResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const usagePercent = (estimatedInputTokens / cfg.maxContextTokens) * 100;
  const freeTokens = cfg.maxContextTokens - estimatedInputTokens;

  if (freeTokens < cfg.hardMinFreeTokens || usagePercent >= cfg.blockAtPercent) {
    const msg = `Context window critically full: ${usagePercent.toFixed(1)}% used (${estimatedInputTokens}/${cfg.maxContextTokens} tokens). Only ${freeTokens} tokens free. Need to trigger window sliding.`;
    log.error(msg);
    return { ok: false, action: 'block', usagePercent, freeTokens, message: msg };
  }

  if (usagePercent >= cfg.warnAtPercent) {
    const msg = `Context window filling: ${usagePercent.toFixed(1)}% used. ${freeTokens} tokens remaining. Consider triggering Greffier distillation soon.`;
    log.warn(msg);
    return { ok: false, action: 'warn', usagePercent, freeTokens, message: msg };
  }

  return { ok: true, usagePercent, freeTokens };
}
