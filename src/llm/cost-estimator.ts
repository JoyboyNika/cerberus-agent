/**
 * CerberusAgent — Cost Estimator
 * Inspired by OpenClaw's usage.ts
 *
 * Tracks API costs per agent, per turn, per session.
 * Critical for staying within the 2k€ budget.
 *
 * Prices as of 2025 (Anthropic public pricing):
 * - Opus:  $15/MTok input, $75/MTok output
 * - Sonnet: $3/MTok input, $15/MTok output
 * - Haiku:  $0.25/MTok input, $1.25/MTok output
 * - Cache read: 10% of input price
 * - Cache write: 25% of input price
 */

import { TokenUsage, AgentId } from '../types/index.js';
import { createLogger } from './logger.js';

const log = createLogger('cost-estimator');

// Prices in $/million tokens
interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadMultiplier: number;  // fraction of input price
  cacheWriteMultiplier: number; // fraction of input price
}

const PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-20250514': {
    inputPerMTok: 15,
    outputPerMTok: 75,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 0.25,
  },
  'claude-sonnet-4-20250514': {
    inputPerMTok: 3,
    outputPerMTok: 15,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 0.25,
  },
  'claude-haiku-4-20250414': {
    inputPerMTok: 0.25,
    outputPerMTok: 1.25,
    cacheReadMultiplier: 0.1,
    cacheWriteMultiplier: 0.25,
  },
};

// Fallback for unknown models
const DEFAULT_PRICING: ModelPricing = {
  inputPerMTok: 3,
  outputPerMTok: 15,
  cacheReadMultiplier: 0.1,
  cacheWriteMultiplier: 0.25,
};

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  totalCost: number;
}

export interface SessionCostSummary {
  totalCostUsd: number;
  byAgent: Record<string, CostBreakdown>;
  byTurn: CostBreakdown[];
  totalTokens: TokenUsage;
  budgetRemainingUsd: number;
  budgetWarning: boolean;
}

export class CostEstimator {
  private budgetUsd: number;
  private sessionTotal: CostBreakdown = { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0 };
  private byAgent: Record<string, CostBreakdown> = {};
  private byTurn: CostBreakdown[] = [];
  private totalTokens: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };

  constructor(budgetUsd: number = 2000) {
    this.budgetUsd = budgetUsd;
  }

  /**
   * Estimate cost for a single API call.
   */
  static estimateCallCost(model: string, usage: TokenUsage): CostBreakdown {
    const pricing = PRICING[model] || DEFAULT_PRICING;
    const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMTok;
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMTok;
    const cacheReadCost = (usage.cacheReadTokens / 1_000_000) * pricing.inputPerMTok * pricing.cacheReadMultiplier;
    const cacheWriteCost = (usage.cacheCreationTokens / 1_000_000) * pricing.inputPerMTok * pricing.cacheWriteMultiplier;
    return {
      inputCost,
      outputCost,
      cacheReadCost,
      cacheWriteCost,
      totalCost: inputCost + outputCost + cacheReadCost + cacheWriteCost,
    };
  }

  /**
   * Record an API call's cost.
   */
  recordCall(agentId: AgentId, model: string, usage: TokenUsage): CostBreakdown {
    const cost = CostEstimator.estimateCallCost(model, usage);

    // Accumulate session total
    this.sessionTotal.inputCost += cost.inputCost;
    this.sessionTotal.outputCost += cost.outputCost;
    this.sessionTotal.cacheReadCost += cost.cacheReadCost;
    this.sessionTotal.cacheWriteCost += cost.cacheWriteCost;
    this.sessionTotal.totalCost += cost.totalCost;

    // Accumulate by agent
    if (!this.byAgent[agentId]) {
      this.byAgent[agentId] = { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0 };
    }
    const agentCost = this.byAgent[agentId];
    agentCost.inputCost += cost.inputCost;
    agentCost.outputCost += cost.outputCost;
    agentCost.cacheReadCost += cost.cacheReadCost;
    agentCost.cacheWriteCost += cost.cacheWriteCost;
    agentCost.totalCost += cost.totalCost;

    // Accumulate tokens
    this.totalTokens.inputTokens += usage.inputTokens;
    this.totalTokens.outputTokens += usage.outputTokens;
    this.totalTokens.cacheReadTokens += usage.cacheReadTokens;
    this.totalTokens.cacheCreationTokens += usage.cacheCreationTokens;

    // Budget warning
    const remaining = this.budgetUsd - this.sessionTotal.totalCost;
    if (remaining < this.budgetUsd * 0.1) {
      log.warn('Budget warning', {
        spent: this.sessionTotal.totalCost.toFixed(4),
        remaining: remaining.toFixed(4),
        budgetUsd: this.budgetUsd,
      });
    }

    return cost;
  }

  /**
   * Start tracking a new turn.
   */
  startTurn(): void {
    this.byTurn.push({ inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0 });
  }

  /**
   * Add cost to the current turn.
   */
  addToCurrentTurn(cost: CostBreakdown): void {
    const current = this.byTurn[this.byTurn.length - 1];
    if (!current) return;
    current.inputCost += cost.inputCost;
    current.outputCost += cost.outputCost;
    current.cacheReadCost += cost.cacheReadCost;
    current.cacheWriteCost += cost.cacheWriteCost;
    current.totalCost += cost.totalCost;
  }

  /**
   * Get session cost summary.
   */
  getSummary(): SessionCostSummary {
    return {
      totalCostUsd: this.sessionTotal.totalCost,
      byAgent: { ...this.byAgent },
      byTurn: [...this.byTurn],
      totalTokens: { ...this.totalTokens },
      budgetRemainingUsd: this.budgetUsd - this.sessionTotal.totalCost,
      budgetWarning: (this.budgetUsd - this.sessionTotal.totalCost) < this.budgetUsd * 0.1,
    };
  }
}
