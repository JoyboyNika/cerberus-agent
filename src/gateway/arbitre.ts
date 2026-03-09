/**
 * CerberusAgent — Arbitre (Disjoncteur)
 *
 * Agent séparé (Opus) invoqué UNIQUEMENT sur désaccord structurel
 * irréconciliable entre les têtes.
 *
 * Saisine par le Body uniquement.
 * Décision binaire : SUIVRE ou ABANDONNER.
 * Rapport motivé obligatoire.
 *
 * Coût élevé (Opus) — protection budgétaire nécessaire.
 */

import { HeadId, HeadReport, TokenUsage } from '../types/index.js';
import { AnthropicClient } from '../llm/anthropic-client.js';
import { CostEstimator } from '../llm/cost-estimator.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('arbitre');

export type ArbitreDecision = 'follow' | 'abandon';

export interface ArbitreResult {
  decision: ArbitreDecision;
  targetHead: HeadId;
  motivatedReport: string;
  tokenUsage: TokenUsage;
  costUsd: number;
  durationMs: number;
}

export interface ArbitreSaisineRequest {
  turn: number;
  reason: string;
  headReports: Record<HeadId, HeadReport>;
  bodyContext: string;  // What the Body observed that triggered the saisine
}

export class Arbitre {
  private client: AnthropicClient;
  private model: string;
  private costEstimator: CostEstimator;
  private saisineCount = 0;
  private maxSaisinesPerSession: number;

  constructor(
    client: AnthropicClient,
    model: string,
    costEstimator: CostEstimator,
    maxSaisinesPerSession: number = 3,
  ) {
    this.client = client;
    this.model = model;
    this.costEstimator = costEstimator;
    this.maxSaisinesPerSession = maxSaisinesPerSession;
  }

  /**
   * Can we still invoke the Arbitre in this session?
   */
  canInvoke(): boolean {
    return this.saisineCount < this.maxSaisinesPerSession;
  }

  /**
   * Invoke the Arbitre on a structural disagreement.
   */
  async invoke(request: ArbitreSaisineRequest): Promise<ArbitreResult> {
    if (!this.canInvoke()) {
      log.warn('Arbitre saisine limit reached', {
        count: this.saisineCount,
        max: this.maxSaisinesPerSession,
      });
      throw new Error(`Arbitre saisine limit reached (${this.maxSaisinesPerSession} per session). Cannot invoke.`);
    }

    this.saisineCount++;
    const start = Date.now();

    log.info('Arbitre saisine', {
      turn: request.turn,
      reason: request.reason.slice(0, 100),
      saisineNumber: this.saisineCount,
    });

    const prompt = this.buildSaisinePrompt(request);

    const response = await this.client.sendMessage({
      model: this.model,
      systemBlocks: buildSystemBlocks('arbitre'),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4096,
    });

    const cost = this.costEstimator.recordCall('arbitre', this.model, response.tokenUsage);

    const result = this.parseDecision(response.content, request);

    log.info('Arbitre decision rendered', {
      turn: request.turn,
      decision: result.decision,
      targetHead: result.targetHead,
      costUsd: cost.totalCost,
      durationMs: Date.now() - start,
      saisineNumber: this.saisineCount,
    });

    return {
      ...result,
      tokenUsage: response.tokenUsage,
      costUsd: cost.totalCost,
      durationMs: Date.now() - start,
    };
  }

  private buildSaisinePrompt(request: ArbitreSaisineRequest): string {
    const parts: string[] = [];

    parts.push('## Saisine de l\'Arbitre');
    parts.push(`Tour : ${request.turn}`);
    parts.push(`Raison de la saisine : ${request.reason}`);
    parts.push('');
    parts.push('## Contexte du Body');
    parts.push(request.bodyContext);
    parts.push('');

    for (const headId of ['rigueur', 'transversalite', 'curiosite'] as HeadId[]) {
      const report = request.headReports[headId];
      if (!report) continue;

      parts.push(`## Rapport \u2014 T\u00eate ${headId}`);
      parts.push(`Confiance : ${report.niveauConfiance}`);
      parts.push('');
      parts.push(`### Synth\u00e8se`);
      parts.push(report.synthese);
      parts.push('');
      parts.push(`### R\u00e9sultats`);
      parts.push(report.resultats);
      parts.push('');
      parts.push(`### Limites`);
      parts.push(report.limitesLacunes);
      parts.push('');
    }

    parts.push('## Format de décision attendu');
    parts.push('R\u00e9ponds avec exactement ce format :');
    parts.push('');
    parts.push('DECISION: SUIVRE ou ABANDONNER');
    parts.push('TARGET: [head_id de la piste concern\u00e9e]');
    parts.push('');
    parts.push('RAPPORT_MOTIVE:');
    parts.push('1. R\u00e9sum\u00e9 du d\u00e9saccord');
    parts.push('2. Analyse des preuves');
    parts.push('3. Raisonnement');
    parts.push('4. Risques r\u00e9siduels');

    return parts.join('\n');
  }

  private parseDecision(content: string, request: ArbitreSaisineRequest): {
    decision: ArbitreDecision;
    targetHead: HeadId;
    motivatedReport: string;
  } {
    // Parse DECISION
    const decisionMatch = content.match(/DECISION:\s*(SUIVRE|ABANDONNER)/i);
    const decision: ArbitreDecision = decisionMatch?.[1]?.toLowerCase() === 'abandonner'
      ? 'abandon'
      : 'follow';

    // Parse TARGET
    const targetMatch = content.match(/TARGET:\s*(rigueur|transversalite|curiosite)/i);
    const targetHead: HeadId = (targetMatch?.[1]?.toLowerCase() as HeadId) || 'curiosite';

    // Parse RAPPORT_MOTIVE
    const reportIdx = content.indexOf('RAPPORT_MOTIVE:');
    const motivatedReport = reportIdx !== -1
      ? content.slice(reportIdx + 'RAPPORT_MOTIVE:'.length).trim()
      : content;

    return { decision, targetHead, motivatedReport };
  }

  /**
   * Get saisine stats.
   */
  getStats() {
    return {
      saisineCount: this.saisineCount,
      maxPerSession: this.maxSaisinesPerSession,
      remaining: this.maxSaisinesPerSession - this.saisineCount,
    };
  }
}
