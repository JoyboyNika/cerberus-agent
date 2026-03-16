import { describe, it, expect } from 'vitest';
import { CostEstimator } from './cost-estimator.js';

describe('CostEstimator.estimateCallCost', () => {
  it('calculates Opus pricing correctly', () => {
    const cost = CostEstimator.estimateCallCost('claude-opus-4-20250514', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(cost.inputCost).toBe(15);    // $15/MTok
    expect(cost.outputCost).toBe(75);   // $75/MTok
    expect(cost.totalCost).toBe(90);
  });

  it('calculates Sonnet pricing correctly', () => {
    const cost = CostEstimator.estimateCallCost('claude-sonnet-4-20250514', {
      inputTokens: 500_000,
      outputTokens: 200_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(cost.inputCost).toBeCloseTo(1.5);   // 0.5 * $3
    expect(cost.outputCost).toBeCloseTo(3.0);  // 0.2 * $15
    expect(cost.totalCost).toBeCloseTo(4.5);
  });

  it('calculates Haiku pricing correctly', () => {
    const cost = CostEstimator.estimateCallCost('claude-haiku-4-20250414', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(cost.inputCost).toBeCloseTo(0.25);
    expect(cost.outputCost).toBeCloseTo(1.25);
    expect(cost.totalCost).toBeCloseTo(1.5);
  });

  it('calculates cache costs correctly', () => {
    const cost = CostEstimator.estimateCallCost('claude-sonnet-4-20250514', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheCreationTokens: 1_000_000,
    });
    // cacheRead: 1M * ($3/MTok * 0.1) = $0.30
    expect(cost.cacheReadCost).toBeCloseTo(0.3);
    // cacheWrite: 1M * ($3/MTok * 0.25) = $0.75
    expect(cost.cacheWriteCost).toBeCloseTo(0.75);
    expect(cost.totalCost).toBeCloseTo(1.05);
  });

  it('uses default pricing for unknown models', () => {
    const cost = CostEstimator.estimateCallCost('unknown-model-v99', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    // Default: $3/MTok input, $15/MTok output (same as Sonnet)
    expect(cost.inputCost).toBe(3);
    expect(cost.outputCost).toBe(15);
    expect(cost.totalCost).toBe(18);
  });
});

describe('CostEstimator instance', () => {
  it('accumulates costs across multiple recordCall invocations', () => {
    const estimator = new CostEstimator(2000);
    const usage = {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };

    estimator.recordCall('body', 'claude-sonnet-4-20250514', usage);
    estimator.recordCall('body', 'claude-sonnet-4-20250514', usage);

    const summary = estimator.getSummary();
    // 2 calls: each = (0.1 * $3) + (0.05 * $15) = $0.30 + $0.75 = $1.05
    expect(summary.totalCostUsd).toBeCloseTo(2.1);
    expect(summary.byAgent['body'].totalCost).toBeCloseTo(2.1);
  });

  it('tracks costs per agent separately', () => {
    const estimator = new CostEstimator(2000);
    const usage = {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };

    estimator.recordCall('body', 'claude-sonnet-4-20250514', usage);
    estimator.recordCall('arbitre', 'claude-opus-4-20250514', usage);

    const summary = estimator.getSummary();
    expect(summary.byAgent['body']).toBeDefined();
    expect(summary.byAgent['arbitre']).toBeDefined();
    // Opus is more expensive: (0.1 * $15) + (0.05 * $75) = $1.50 + $3.75 = $5.25
    expect(summary.byAgent['arbitre'].totalCost).toBeCloseTo(5.25);
  });

  it('accumulates total tokens', () => {
    const estimator = new CostEstimator(2000);
    estimator.recordCall('body', 'claude-sonnet-4-20250514', {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
    });
    estimator.recordCall('greffier', 'claude-haiku-4-20250414', {
      inputTokens: 2000,
      outputTokens: 300,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });

    const summary = estimator.getSummary();
    expect(summary.totalTokens.inputTokens).toBe(3000);
    expect(summary.totalTokens.outputTokens).toBe(800);
    expect(summary.totalTokens.cacheReadTokens).toBe(200);
    expect(summary.totalTokens.cacheCreationTokens).toBe(100);
  });

  it('triggers budget warning when remaining < 10%', () => {
    const estimator = new CostEstimator(100); // $100 budget

    // Spend $91+ to trigger warning (remaining < $10 = 10%)
    estimator.recordCall('body', 'claude-opus-4-20250514', {
      inputTokens: 1_000_000,  // $15
      outputTokens: 1_000_000, // $75
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    // Total spent: $90, remaining: $10 — exactly 10%, NOT below

    const summary = estimator.getSummary();
    expect(summary.budgetWarning).toBe(false);

    // One more small call pushes past the threshold
    estimator.recordCall('body', 'claude-sonnet-4-20250514', {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });

    const summary2 = estimator.getSummary();
    expect(summary2.budgetWarning).toBe(true);
    expect(summary2.budgetRemainingUsd).toBeLessThan(10);
  });

  it('tracks turn-level costs', () => {
    const estimator = new CostEstimator(2000);
    const usage = {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };

    estimator.startTurn();
    const cost = estimator.recordCall('body', 'claude-sonnet-4-20250514', usage);
    estimator.addToCurrentTurn(cost);

    estimator.startTurn();
    const cost2 = estimator.recordCall('body', 'claude-opus-4-20250514', usage);
    estimator.addToCurrentTurn(cost2);

    const summary = estimator.getSummary();
    expect(summary.byTurn).toHaveLength(2);
    expect(summary.byTurn[0].totalCost).toBeCloseTo(1.05);   // Sonnet
    expect(summary.byTurn[1].totalCost).toBeCloseTo(5.25);   // Opus
  });
});
