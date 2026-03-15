/**
 * CerberusAgent — Orchestrator
 *
 * Full pipeline coordination:
 * 1. Context check (SlidingWindow)
 * 2. 3 heads in parallel (isolated tools)
 * 3. Néant detection → feedback loop
 * 4. Body synthesis
 * 5. Disagreement detection → Arbitre saisine if structural
 * 6. Feedback loops from Body
 * 7. Window slide if needed (Greffier + Body verification)
 * 8. Cost tracking throughout
 */

import { HeadId, TokenUsage, AgentId } from '../types/index.js';
import { AnthropicClient } from '../llm/anthropic-client.js';
import { CostEstimator, CostBreakdown } from '../llm/cost-estimator.js';
import { ConnectorRegistry } from '../mcp/connector-registry.js';
import { runHead, HeadRunResult } from './head-runner.js';
import { estimateTokens } from './context-guard.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
import { SlidingWindowManager } from '../memory/sliding-window.js';
import { Archive } from '../memory/archive.js';
import { Arbitre, ArbitreResult, ArbitreSaisineRequest } from './arbitre.js';
import { SessionManager } from '../session/session-manager.js';
import { createLogger } from '../llm/logger.js';
import { AppConfig } from '../config.js';

const log = createLogger('orchestrator');

export interface TurnResult {
  turn: number;
  headResults: Record<HeadId, HeadRunResult>;
  bodySynthesis: string;
  disagreementDetected: boolean;
  arbitreInvoked: boolean;
  arbitreResult?: ArbitreResult;
  recommendContinue: boolean;
  totalTokenUsage: TokenUsage;
  costBreakdown: CostBreakdown;
  durationMs: number;
  feedbackLoops: Array<{ head: HeadId; query: string }>;
  neantReformulations: Array<{ head: HeadId; originalNeant: boolean }>;
  windowSlid: boolean;
}

export class Orchestrator {
  private config: AppConfig;
  private client: AnthropicClient;
  private registry: ConnectorRegistry;
  private costEstimator: CostEstimator;
  private arbitre: Arbitre;
  private windowManagers: Map<string, SlidingWindowManager> = new Map();

  constructor(config: AppConfig, client: AnthropicClient, registry: ConnectorRegistry) {
    this.config = config;
    this.client = client;
    this.registry = registry;
    this.costEstimator = new CostEstimator();
    this.arbitre = new Arbitre(client, config.models.arbitre, this.costEstimator);
  }

  private getWindowManager(sessionId: string): SlidingWindowManager {
    if (!this.windowManagers.has(sessionId)) {
      const archive = new Archive(this.config.session.dataDir);
      this.windowManagers.set(sessionId, new SlidingWindowManager(
        this.client, this.config.models.body, this.config.models.greffier,
        archive, this.costEstimator,
      ));
    }
    return this.windowManagers.get(sessionId)!;
  }

  async executeTurn(
    query: string,
    turn: number,
    sessionManager: SessionManager,
  ): Promise<TurnResult> {
    const start = Date.now();
    const heads: HeadId[] = ['rigueur', 'transversalite', 'curiosite'];
    const windowManager = this.getWindowManager(sessionManager.sessionId);
    this.costEstimator.startTurn();
    const history = windowManager.getContext();

    log.info('Turn started', { turn, historyTokens: estimateTokens(history) });

    // Step 1: 3 heads in parallel
    const headPromises = heads.map((headId) =>
      runHead(headId, query, this.config.models.heads, this.client, this.registry)
        .then((result) => {
          const cost = this.costEstimator.recordCall(headId as AgentId, this.config.models.heads, result.totalTokenUsage);
          this.costEstimator.addToCurrentTurn(cost);
          return result;
        })
        .catch((error) => {
          log.error('Head failed', { head: headId, error: String(error) });
          return this.createFailedHeadResult(headId, error);
        })
    );

    const headResults = await Promise.all(headPromises);
    const headMap = {} as Record<HeadId, HeadRunResult>;
    for (const result of headResults) headMap[result.headId] = result;

    // Step 2: Néant detection
    const neantReformulations: Array<{ head: HeadId; originalNeant: boolean }> = [];
    for (const headId of heads) {
      if (headMap[headId].report.neant) neantReformulations.push({ head: headId, originalNeant: true });
    }

    // Step 3: Body synthesis
    const bodyPrompt = this.buildBodyPrompt(query, headMap, turn, history, neantReformulations);
    const bodyResponse = await this.client.sendMessage({
      model: this.config.models.body,
      systemBlocks: buildSystemBlocks('body'),
      messages: [{ role: 'user', content: bodyPrompt }],
    });
    const bodyCost = this.costEstimator.recordCall('body', this.config.models.body, bodyResponse.tokenUsage);
    this.costEstimator.addToCurrentTurn(bodyCost);

    // Step 4: Disagreement → Arbitre
    const disagreement = this.detectDisagreement(headMap);
    let arbitreInvoked = false;
    let arbitreResult: ArbitreResult | undefined;

    if (disagreement && this.isStructuralDisagreement(headMap) && this.arbitre.canInvoke()) {
      log.info('Structural disagreement detected, invoking Arbitre', { turn });

      const saisineRequest: ArbitreSaisineRequest = {
        turn,
        reason: this.describeDisagreement(headMap),
        headReports: Object.fromEntries(
          Object.entries(headMap).map(([k, v]) => [k, v.report])
        ) as Record<HeadId, any>,
        bodyContext: bodyResponse.content.slice(0, 2000),
      };

      try {
        arbitreResult = await this.arbitre.invoke(saisineRequest);
        arbitreInvoked = true;
        this.costEstimator.addToCurrentTurn({
          inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0,
          totalCost: arbitreResult.costUsd,
        });

        // Record arbitre saisine event
        await sessionManager.append({
          type: 'arbitre_saisine', sessionId: sessionManager.sessionId,
          timestamp: new Date().toISOString(), turn,
          reason: saisineRequest.reason,
          headReports: saisineRequest.headReports,
        });

        // Check for parse failures
        const failedFields: Array<'decision' | 'target'> = [];
        if (arbitreResult.decision === 'parse_error') failedFields.push('decision');
        if (arbitreResult.targetHead === null) failedFields.push('target');

        if (failedFields.length > 0) {
          await sessionManager.append({
            type: 'arbitre_parse_failure', sessionId: sessionManager.sessionId,
            timestamp: new Date().toISOString(), turn,
            failedFields,
            contentPreview: arbitreResult.motivatedReport.slice(0, 200),
          });
        } else {
          await sessionManager.append({
            type: 'arbitre_decision', sessionId: sessionManager.sessionId,
            timestamp: new Date().toISOString(), turn,
            decision: arbitreResult.decision as 'follow' | 'abandon',
            motivatedReport: arbitreResult.motivatedReport,
            targetHead: arbitreResult.targetHead as HeadId,
            tokenUsage: arbitreResult.tokenUsage,
          });
        }
      } catch (error) {
        log.error('Arbitre invocation failed', { error: String(error) });
      }
    }

    // Step 5: Feedback loops
    const feedbackLoops = this.parseFeedbackDirectives(bodyResponse.content);
    let finalSynthesis = bodyResponse.content;

    for (const feedback of feedbackLoops) {
      try {
        const fbResult = await runHead(feedback.head, feedback.query, this.config.models.heads, this.client, this.registry);
        const fbCost = this.costEstimator.recordCall(feedback.head as AgentId, this.config.models.heads, fbResult.totalTokenUsage);
        this.costEstimator.addToCurrentTurn(fbCost);
        headMap[feedback.head] = fbResult;
      } catch (error) {
        log.error('Feedback failed', { head: feedback.head, error: String(error) });
      }
    }

    // Re-synthesize if feedback or usable arbitre decision
    const arbitreUsable = arbitreResult
      && arbitreResult.decision !== 'parse_error'
      && arbitreResult.targetHead !== null;

    if (feedbackLoops.length > 0 || arbitreUsable) {
      let updatedPrompt = this.buildBodyPrompt(query, headMap, turn, history, []);
      if (arbitreUsable && arbitreResult) {
        updatedPrompt += `\n\n## Décision de l'Arbitre\nDécision : ${arbitreResult.decision.toUpperCase()}\nTête concernée : ${arbitreResult.targetHead}\n\n${arbitreResult.motivatedReport}`;
      }
      const updatedResponse = await this.client.sendMessage({
        model: this.config.models.body,
        systemBlocks: buildSystemBlocks('body'),
        messages: [{ role: 'user', content: updatedPrompt }],
      });
      const updCost = this.costEstimator.recordCall('body', this.config.models.body, updatedResponse.tokenUsage);
      this.costEstimator.addToCurrentTurn(updCost);
      finalSynthesis = updatedResponse.content;
    }

    // Step 6: Window management
    windowManager.appendTurn(turn, finalSynthesis);
    let windowSlid = false;
    if (windowManager.shouldSlide()) {
      await windowManager.slide(sessionManager, turn);
      windowSlid = true;
    }

    // Step 7: Aggregate
    const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    for (const result of Object.values(headMap)) {
      totalUsage.inputTokens += result.totalTokenUsage.inputTokens;
      totalUsage.outputTokens += result.totalTokenUsage.outputTokens;
      totalUsage.cacheReadTokens += result.totalTokenUsage.cacheReadTokens;
      totalUsage.cacheCreationTokens += result.totalTokenUsage.cacheCreationTokens;
    }
    totalUsage.inputTokens += bodyResponse.tokenUsage.inputTokens;
    totalUsage.outputTokens += bodyResponse.tokenUsage.outputTokens;

    const costSummary = this.costEstimator.getSummary();

    log.info('Turn completed', {
      turn, durationMs: Date.now() - start, disagreement, arbitreInvoked,
      feedbackLoops: feedbackLoops.length, windowSlid,
      sessionCostUsd: costSummary.totalCostUsd,
      arbitreStats: this.arbitre.getStats(),
    });

    return {
      turn, headResults: headMap, bodySynthesis: finalSynthesis,
      disagreementDetected: disagreement, arbitreInvoked, arbitreResult,
      recommendContinue: turn < this.config.pipeline.visibleTurns,
      totalTokenUsage: totalUsage,
      costBreakdown: costSummary.byTurn[costSummary.byTurn.length - 1] || { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0 },
      durationMs: Date.now() - start, feedbackLoops, neantReformulations, windowSlid,
    };
  }

  getCostSummary() { return this.costEstimator.getSummary(); }
  getArbitreStats() { return this.arbitre.getStats(); }

  /**
   * Detect if disagreement is structural (not just confidence divergence).
   * Structural = one head contradicts another on factual claims.
   */
  private isStructuralDisagreement(heads: Record<HeadId, HeadRunResult>): boolean {
    const confidences = Object.values(heads).map(h => h.report.niveauConfiance);
    const hasHigh = confidences.includes('eleve');
    const hasLow = confidences.includes('faible');

    // Simple heuristic: structural if high confidence conflicts with low confidence
    // AND neither is néant (néant = no data, not a contradiction)
    const nonNeantHeads = Object.values(heads).filter(h => !h.report.neant);
    if (nonNeantHeads.length < 2) return false;

    return hasHigh && hasLow;
  }

  private describeDisagreement(heads: Record<HeadId, HeadRunResult>): string {
    const descriptions: string[] = [];
    for (const [headId, result] of Object.entries(heads)) {
      descriptions.push(`${headId}: confiance ${result.report.niveauConfiance}, néant=${result.report.neant}`);
    }
    return `Désaccord structurel entre têtes: ${descriptions.join(' | ')}`;
  }

  private detectDisagreement(heads: Record<HeadId, HeadRunResult>): boolean {
    const confidences = Object.values(heads).map(h => h.report.niveauConfiance);
    return confidences.includes('eleve') && confidences.includes('faible');
  }

  private buildBodyPrompt(
    query: string, heads: Record<HeadId, HeadRunResult>,
    turn: number, history: string,
    neantCases: Array<{ head: HeadId; originalNeant: boolean }>,
  ): string {
    const parts: string[] = [];
    parts.push(`## Requête du praticien (Tour ${turn})`);
    parts.push(query);
    parts.push('');
    if (history) { parts.push('## Contexte'); parts.push(history); parts.push(''); }

    for (const headId of ['rigueur', 'transversalite', 'curiosite'] as HeadId[]) {
      const r = heads[headId];
      parts.push(`## Rapport — ${headId}`);
      parts.push(`Outils: ${r.toolCallCount} | Confiance: ${r.report.niveauConfiance} | Néant: ${r.report.neant}${r.loopDetected ? ' | \u26a0 Boucle' : ''}`);
      parts.push(r.rawContent);
      parts.push('');
    }

    if (neantCases.length > 0) {
      parts.push(`## Néant: ${neantCases.map(n => n.head).join(', ')}`);
      parts.push('FEEDBACK_LOOP: [head_id] | [nouvelle requête]');
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push('Compare. Convergences et désaccords. Synthèse au praticien.');
    parts.push('Boucle possible : FEEDBACK_LOOP: [head_id] | [requête]');
    return parts.join('\n');
  }

  private parseFeedbackDirectives(body: string): Array<{ head: HeadId; query: string }> {
    const directives: Array<{ head: HeadId; query: string }> = [];
    const regex = /FEEDBACK_LOOP:\s*(rigueur|transversalite|curiosite)\s*\|\s*(.+)/gi;
    let match;
    while ((match = regex.exec(body)) !== null) {
      directives.push({ head: match[1].toLowerCase() as HeadId, query: match[2].trim() });
    }
    return directives.slice(0, 2);
  }

  private createFailedHeadResult(headId: HeadId, error: unknown): HeadRunResult {
    return {
      headId,
      report: {
        objectifRecherche: '(Erreur)', strategieRecherche: '(Erreur)',
        resultats: '(Erreur)', synthese: `Erreur: ${String(error)}`,
        limitesLacunes: '(Erreur)', niveauConfiance: 'faible',
        niveauConfianceJustification: 'Erreur technique', neant: true,
      },
      rawContent: `[ERROR] ${String(error)}`,
      totalTokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      durationMs: 0, toolCallCount: 0, loopDetected: false,
    };
  }
}
