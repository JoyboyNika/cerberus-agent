/**
 * CerberusAgent — Sliding Window Manager
 *
 * Manages the context window for multi-turn consultations.
 *
 * Rules (FD-6):
 * - Slide threshold: 60% of context window (~3 tours)
 * - Greffier distills the old turns in parallel
 * - Garde-fou: Body re-reads and corrects the Greffier report
 *   in the remaining 40% before abandoning the old context
 * - After slide: distilled report replaces raw history
 *
 * Flow:
 * 1. After each turn, check context usage
 * 2. If >= 60%, trigger Greffier distillation
 * 3. Body verifies the distilled report
 * 4. Replace raw history with distilled context block
 * 5. Record window_slide event
 */

import { SessionManager } from '../session/session-manager.js';
import { Greffier } from './greffier.js';
import { Archive } from './archive.js';
import { AnthropicClient } from '../llm/anthropic-client.js';
import { CostEstimator } from '../llm/cost-estimator.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
import { estimateTokens, checkContextUsage } from '../gateway/context-guard.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('sliding-window');

export interface WindowState {
  currentHistory: string;           // Active context (raw or distilled)
  distilledContext: string | null;  // Last distilled block from Greffier
  lastSlideTurn: number;            // Turn at which last slide occurred
  slideCount: number;               // Total slides in this session
}

export class SlidingWindowManager {
  private greffier: Greffier;
  private archive: Archive;
  private client: AnthropicClient;
  private bodyModel: string;
  private costEstimator: CostEstimator;
  private state: WindowState;

  // Slide at 60% of context window (FD-6)
  private slideThresholdPercent = 60;
  // Timeout for Body verification of Greffier report
  private bodyVerificationTimeoutMs = 60_000;

  constructor(
    client: AnthropicClient,
    bodyModel: string,
    greffierModel: string,
    archive: Archive,
    costEstimator: CostEstimator,
  ) {
    this.client = client;
    this.bodyModel = bodyModel;
    this.archive = archive;
    this.costEstimator = costEstimator;
    this.greffier = new Greffier(client, greffierModel, archive, costEstimator);

    this.state = {
      currentHistory: '',
      distilledContext: null,
      lastSlideTurn: 0,
      slideCount: 0,
    };
  }

  /**
   * Get the current context to pass to the orchestrator.
   * Returns either raw history or distilled context.
   */
  getContext(): string {
    return this.state.currentHistory;
  }

  /**
   * Append a turn's synthesis to the history.
   */
  appendTurn(turn: number, synthesis: string): void {
    this.state.currentHistory += `\n\n--- Tour ${turn} ---\n${synthesis}`;
  }

  /**
   * Check if the window needs to slide.
   */
  shouldSlide(): boolean {
    const tokens = estimateTokens(this.state.currentHistory);
    const check = checkContextUsage(tokens, { warnAtPercent: this.slideThresholdPercent });
    return !check.ok;
  }

  /**
   * Execute the sliding window protocol.
   *
   * 1. Greffier distills the history
   * 2. Body verifies and corrects
   * 3. Replace history with distilled context
   */
  async slide(
    sessionManager: SessionManager,
    currentTurn: number,
  ): Promise<{ distilledContext: string; verified: boolean }> {
    log.info('Window slide initiated', {
      sessionId: sessionManager.sessionId,
      currentTurn,
      slideCount: this.state.slideCount,
      historyTokens: estimateTokens(this.state.currentHistory),
    });

    // Step 1: Greffier distills
    const report = await this.greffier.distill(sessionManager, currentTurn);
    const distilledBlock = Archive.toContextBlock(report);

    // Step 2: Body verification (garde-fou FD-6) with timeout
    const { content: verified, timedOut } = await this.bodyVerificationWithTimeout(distilledBlock, currentTurn);

    // Step 3: Replace history
    const fromTurn = this.state.lastSlideTurn + 1;
    this.state.currentHistory = verified;
    this.state.distilledContext = verified;
    this.state.lastSlideTurn = currentTurn;
    this.state.slideCount++;

    // Step 4: Record event
    await sessionManager.append({
      type: 'window_slide',
      sessionId: sessionManager.sessionId,
      timestamp: new Date().toISOString(),
      fromTurn,
      toTurn: currentTurn,
      distilledContext: verified.slice(0, 500) + '...',
    });

    // Flush the buffer since it's been distilled
    sessionManager.flushBuffer();

    log.info('Window slide completed', {
      sessionId: sessionManager.sessionId,
      fromTurn,
      toTurn: currentTurn,
      slideCount: this.state.slideCount,
      newHistoryTokens: estimateTokens(this.state.currentHistory),
    });

    return { distilledContext: verified, verified: !timedOut };
  }

  /**
   * Body verification with timeout.
   * On timeout, returns the Greffier's report unverified rather than blocking.
   */
  private async bodyVerificationWithTimeout(
    distilledBlock: string,
    currentTurn: number,
  ): Promise<{ content: string; timedOut: boolean }> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('BODY_VERIFICATION_TIMEOUT')), this.bodyVerificationTimeoutMs),
    );

    try {
      const content = await Promise.race([
        this.bodyVerification(distilledBlock, currentTurn),
        timeoutPromise,
      ]);
      return { content, timedOut: false };
    } catch (error) {
      if (error instanceof Error && error.message === 'BODY_VERIFICATION_TIMEOUT') {
        log.warn('[sliding-window:body_verification_timeout]', {
          currentTurn,
          timeoutMs: this.bodyVerificationTimeoutMs,
          message: 'Body verification timed out, using Greffier report unverified',
        });
        return {
          content: `[NON VÉRIFIÉ PAR LE BODY — timeout]\n\n${distilledBlock}`,
          timedOut: true,
        };
      }
      throw error;
    }
  }

  /**
   * Body re-reads and corrects the Greffier's distilled report.
   * This is the garde-fou from FD-6: the Body verifies before
   * the old context is abandoned.
   */
  private async bodyVerification(
    distilledBlock: string,
    currentTurn: number,
  ): Promise<string> {
    const verificationPrompt = [
      '## Vérification du rapport du Greffier',
      '',
      'Le Greffier a distillé les tours précédents en ce rapport :',
      '',
      distilledBlock,
      '',
      '## Instructions',
      'Vérifie ce rapport. Corrige les erreurs factuelles ou les omissions importantes.',
      'Si le rapport est fidèle, retourne-le tel quel.',
      'Si tu corriges, retourne la version corrigée complète.',
      'Ne retire aucune information — ajoute ou corrige seulement.',
      '',
      'IMPORTANT : Retourne UNIQUEMENT le rapport (pas de commentaires avant/après).',
    ].join('\n');

    const response = await this.client.sendMessage({
      model: this.bodyModel,
      systemBlocks: buildSystemBlocks('body'),
      messages: [{ role: 'user', content: verificationPrompt }],
      maxTokens: 4096,
    });

    this.costEstimator.recordCall('body', this.bodyModel, response.tokenUsage);

    log.info('Body verification completed', {
      currentTurn,
      inputLength: distilledBlock.length,
      outputLength: response.content.length,
      changed: response.content !== distilledBlock,
    });

    return response.content;
  }

  /**
   * Get current window state for monitoring.
   */
  getState(): WindowState {
    return { ...this.state };
  }
}
