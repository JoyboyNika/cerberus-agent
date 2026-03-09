/**
 * CerberusAgent — Tool Loop Detection
 * Inspired by OpenClaw's tool-loop-detection.ts
 *
 * Detects 3 types of stuck loops in head tool calls:
 * 1. Generic repeat: same tool+params called N+ times
 * 2. No-progress: same tool+params returning same results
 * 3. Ping-pong: alternating between two tool calls
 *
 * Uses hash-based tracking with a sliding window.
 */

import { createHash } from 'crypto';
import { createLogger } from '../llm/logger.js';

const log = createLogger('loop-detection');

export interface LoopDetectionConfig {
  historySize: number;
  warningThreshold: number;
  criticalThreshold: number;
}

const DEFAULT_CONFIG: LoopDetectionConfig = {
  historySize: 30,
  warningThreshold: 4,   // Tighter than OpenClaw (10) because our heads have fewer rounds
  criticalThreshold: 6,
};

export type LoopDetectionResult =
  | { stuck: false }
  | { stuck: true; level: 'warning' | 'critical'; detector: string; count: number; message: string };

interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  resultHash?: string;
  timestamp: number;
}

function stableHash(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value, Object.keys(value as any).sort());
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

export class ToolLoopDetector {
  private history: ToolCallRecord[] = [];
  private config: LoopDetectionConfig;

  constructor(config?: Partial<LoopDetectionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a tool call and check for loops BEFORE executing.
   * Returns a detection result. If stuck=true at critical level,
   * the caller should stop the agentic loop.
   */
  recordAndCheck(toolName: string, params: unknown): LoopDetectionResult {
    const argsHash = `${toolName}:${stableHash(params)}`;

    // Check before adding
    const result = this.detect(toolName, argsHash);

    // Record the call
    this.history.push({ toolName, argsHash, timestamp: Date.now() });
    if (this.history.length > this.config.historySize) {
      this.history.shift();
    }

    if (result.stuck) {
      log.warn('Loop detected', { detector: result.detector, count: result.count, toolName });
    }

    return result;
  }

  /**
   * Record the result of a tool call for no-progress detection.
   */
  recordResult(toolName: string, params: unknown, result: unknown): void {
    const argsHash = `${toolName}:${stableHash(params)}`;
    const resultHash = stableHash(result);

    // Find the most recent matching call without a result
    for (let i = this.history.length - 1; i >= 0; i--) {
      const record = this.history[i];
      if (record.argsHash === argsHash && !record.resultHash) {
        record.resultHash = resultHash;
        break;
      }
    }
  }

  private detect(toolName: string, argsHash: string): LoopDetectionResult {
    // 1. Generic repeat: same tool+params
    const repeatCount = this.history.filter(h => h.argsHash === argsHash).length;
    if (repeatCount >= this.config.criticalThreshold) {
      return {
        stuck: true,
        level: 'critical',
        detector: 'generic_repeat',
        count: repeatCount,
        message: `CRITICAL: ${toolName} called ${repeatCount} times with identical arguments. Stopping to prevent resource waste.`,
      };
    }
    if (repeatCount >= this.config.warningThreshold) {
      return {
        stuck: true,
        level: 'warning',
        detector: 'generic_repeat',
        count: repeatCount,
        message: `WARNING: ${toolName} called ${repeatCount} times with identical arguments. Consider reformulating the search.`,
      };
    }

    // 2. No-progress: same results
    const noProgressCount = this.getNoProgressStreak(argsHash);
    if (noProgressCount >= this.config.warningThreshold) {
      return {
        stuck: true,
        level: noProgressCount >= this.config.criticalThreshold ? 'critical' : 'warning',
        detector: 'no_progress',
        count: noProgressCount,
        message: `${noProgressCount >= this.config.criticalThreshold ? 'CRITICAL' : 'WARNING'}: ${toolName} returning identical results ${noProgressCount} times. No progress being made.`,
      };
    }

    // 3. Ping-pong: alternating between two calls
    const pingPongCount = this.getPingPongStreak(argsHash);
    if (pingPongCount >= this.config.warningThreshold) {
      return {
        stuck: true,
        level: pingPongCount >= this.config.criticalThreshold ? 'critical' : 'warning',
        detector: 'ping_pong',
        count: pingPongCount,
        message: `${pingPongCount >= this.config.criticalThreshold ? 'CRITICAL' : 'WARNING'}: Alternating tool call pattern detected (${pingPongCount} calls). Stuck in a ping-pong loop.`,
      };
    }

    return { stuck: false };
  }

  private getNoProgressStreak(argsHash: string): number {
    let streak = 0;
    let lastResultHash: string | undefined;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const record = this.history[i];
      if (record.argsHash !== argsHash || !record.resultHash) continue;

      if (!lastResultHash) {
        lastResultHash = record.resultHash;
        streak = 1;
      } else if (record.resultHash === lastResultHash) {
        streak++;
      } else {
        break;
      }
    }

    return streak;
  }

  private getPingPongStreak(currentArgsHash: string): number {
    if (this.history.length < 2) return 0;

    const last = this.history[this.history.length - 1];
    if (last.argsHash === currentArgsHash) return 0; // Same as current, not ping-pong

    const otherHash = last.argsHash;
    let alternating = 0;

    for (let i = this.history.length - 1; i >= 0; i--) {
      const expected = alternating % 2 === 0 ? otherHash : currentArgsHash;
      if (this.history[i].argsHash !== expected) break;
      alternating++;
    }

    return alternating >= 2 ? alternating + 1 : 0;
  }

  /** Get stats for monitoring */
  getStats(): { totalCalls: number; uniquePatterns: number } {
    const unique = new Set(this.history.map(h => h.argsHash));
    return { totalCalls: this.history.length, uniquePatterns: unique.size };
  }
}
