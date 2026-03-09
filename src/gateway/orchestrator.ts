/**
 * CerberusAgent — Orchestrator
 *
 * Coordinates the full pipeline for a single turn.
 * Now integrates the Sliding Window for multi-turn memory.
 *
 * Pipeline:
 * 1. Check context window (via SlidingWindowManager)
 * 2. Dispatch query to 3 heads in parallel
 * 3. Detect néant → instruct Body to reformulate
 * 4. Body synthesis
 * 5. Body can trigger feedback loops
 * 6. After synthesis, append to window and check if slide needed
 * 7. If slide needed, Greffier distills + Body verifies
 */

import { HeadId, TokenUsage, AgentId } from '../types/index.js';
import { AnthropicClient } from '../llm/anthropic-client.js';
import { CostEstimator, CostBreakdown } from '../llm/cost-estimator.js';
import { ConnectorRegistry } from '../mcp/connector-registry.js';
import { runHead, HeadRunResult } from './head-runner.js';
import { checkContextUsage, estimateTokens } from './context-guard.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
import { SlidingWindowManager } from '../memory/sliding-window.js';
import { SessionManager } from '../session/session-manager.js';
import { createLogger } from '../llm/logger.js';
import { AppConfig } from '../config.js';

const log = createLogger('orchestrator');

export interface TurnResult {
  turn: number;
  headResults: Record<HeadId, HeadRunResult>;
  bodySynthesis: string;
  disagreementDetected: boolean;
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
  private windowManagers: Map<string, SlidingWindowManager> = new Map();

  constructor(config: AppConfig, client: AnthropicClient, registry: ConnectorRegistry) {
    this.config = config;
    this.client = client;
    this.registry = registry;
    this.costEstimator = new CostEstimator();
  }

  /**
   * Get or create a SlidingWindowManager for a session.
   */
  private getWindowManager(sessionId: string): SlidingWindowManager {
    if (!this.windowManagers.has(sessionId)) {
      const { Archive } = require('../memory/archive.js');
      const archive = new Archive(this.config.session.dataDir);
      const manager = new SlidingWindowManager(
        this.client,
        this.config.models.body,
        this.config.models.greffier,
        archive,
        this.costEstimator,
      );
      this.windowManagers.set(sessionId, manager);
    }
    return this.windowManagers.get(sessionId)!;
  }

  /**
   * Execute a single turn.
   */
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

    log.info('Turn started', {
      turn,
      queryLength: query.length,
      historyTokens: estimateTokens(history),
      connectorSummary: this.registry.getSummary(),
    });

    // Step 1: Run 3 heads in parallel
    const headPromises = heads.map((headId) =>
      runHead(headId, query, this.config.models.heads, this.client, this.registry)
        .then((result) => {
          const cost = this.costEstimator.recordCall(
            headId as AgentId, this.config.models.heads, result.totalTokenUsage,
          );
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

    // Step 2: Detect néant
    const neantReformulations: Array<{ head: HeadId; originalNeant: boolean }> = [];
    for (const headId of heads) {
      if (headMap[headId].report.neant) {
        neantReformulations.push({ head: headId, originalNeant: true });
      }
    }

    // Step 3: Body synthesis
    const bodyPrompt = this.buildBodyPrompt(query, headMap, turn, history, neantReformulations);
    const bodySynthesisResponse = await this.client.sendMessage({
      model: this.config.models.body,
      systemBlocks: buildSystemBlocks('body'),
      messages: [{ role: 'user', content: bodyPrompt }],
    });

    const bodyCost = this.costEstimator.recordCall('body', this.config.models.body, bodySynthesisResponse.tokenUsage);
    this.costEstimator.addToCurrentTurn(bodyCost);

    // Step 4: Feedback loops
    const feedbackLoops = this.parseFeedbackDirectives(bodySynthesisResponse.content);
    let finalSynthesis = bodySynthesisResponse.content;

    for (const feedback of feedbackLoops) {
      try {
        const feedbackResult = await runHead(
          feedback.head, feedback.query, this.config.models.heads, this.client, this.registry,
        );
        const fbCost = this.costEstimator.recordCall(
          feedback.head as AgentId, this.config.models.heads, feedbackResult.totalTokenUsage,
        );
        this.costEstimator.addToCurrentTurn(fbCost);
        headMap[feedback.head] = feedbackResult;
      } catch (error) {
        log.error('Feedback loop failed', { head: feedback.head, error: String(error) });
      }
    }

    if (feedbackLoops.length > 0) {
      const updatedPrompt = this.buildBodyPrompt(query, headMap, turn, history, []);
      const updatedResponse = await this.client.sendMessage({
        model: this.config.models.body,
        systemBlocks: buildSystemBlocks('body'),
        messages: [{ role: 'user', content: updatedPrompt + '\n\n## Note\nSynth\u00e8se mise \u00e0 jour apr\u00e8s boucle de r\u00e9troaction.' }],
      });
      const updCost = this.costEstimator.recordCall('body', this.config.models.body, updatedResponse.tokenUsage);
      this.costEstimator.addToCurrentTurn(updCost);
      finalSynthesis = updatedResponse.content;
    }

    // Step 5: Append to window
    windowManager.appendTurn(turn, finalSynthesis);

    // Step 6: Check if window needs to slide
    let windowSlid = false;
    if (windowManager.shouldSlide()) {
      log.info('Window slide triggered', { turn });
      await windowManager.slide(sessionManager, turn);
      windowSlid = true;
    }

    // Step 7: Aggregate
    const totalUsage: TokenUsage = {
      inputTokens: bodySynthesisResponse.tokenUsage.inputTokens,
      outputTokens: bodySynthesisResponse.tokenUsage.outputTokens,
      cacheReadTokens: bodySynthesisResponse.tokenUsage.cacheReadTokens,
      cacheCreationTokens: bodySynthesisResponse.tokenUsage.cacheCreationTokens,
    };
    for (const result of Object.values(headMap)) {
      totalUsage.inputTokens += result.totalTokenUsage.inputTokens;
      totalUsage.outputTokens += result.totalTokenUsage.outputTokens;
      totalUsage.cacheReadTokens += result.totalTokenUsage.cacheReadTokens;
      totalUsage.cacheCreationTokens += result.totalTokenUsage.cacheCreationTokens;
    }

    const disagreement = this.detectDisagreement(headMap);
    const costSummary = this.costEstimator.getSummary();

    log.info('Turn completed', {
      turn,
      durationMs: Date.now() - start,
      disagreement,
      feedbackLoops: feedbackLoops.length,
      windowSlid,
      sessionCostUsd: costSummary.totalCostUsd,
      budgetRemaining: costSummary.budgetRemainingUsd,
    });

    return {
      turn,
      headResults: headMap,
      bodySynthesis: finalSynthesis,
      disagreementDetected: disagreement,
      recommendContinue: turn < this.config.pipeline.visibleTurns,
      totalTokenUsage: totalUsage,
      costBreakdown: costSummary.byTurn[costSummary.byTurn.length - 1] || { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, totalCost: 0 },
      durationMs: Date.now() - start,
      feedbackLoops,
      neantReformulations,
      windowSlid,
    };
  }

  getCostSummary() {
    return this.costEstimator.getSummary();
  }

  private buildBodyPrompt(
    query: string,
    heads: Record<HeadId, HeadRunResult>,
    turn: number,
    history: string,
    neantCases: Array<{ head: HeadId; originalNeant: boolean }>,
  ): string {
    const parts: string[] = [];
    parts.push(`## Requ\u00eate du praticien (Tour ${turn})`);
    parts.push(query);
    parts.push('');

    if (history) {
      parts.push('## Contexte (historique ou m\u00e9moire distill\u00e9e)');
      parts.push(history);
      parts.push('');
    }

    for (const headId of ['rigueur', 'transversalite', 'curiosite'] as HeadId[]) {
      const result = heads[headId];
      parts.push(`## Rapport \u2014 T\u00eate ${headId.charAt(0).toUpperCase() + headId.slice(1)}`);
      parts.push(`Dur\u00e9e: ${result.durationMs}ms | Outils: ${result.toolCallCount} | Confiance: ${result.report.niveauConfiance} | N\u00e9ant: ${result.report.neant}${result.loopDetected ? ' | \u26a0\ufe0f Boucle' : ''}`);
      parts.push('');
      parts.push(result.rawContent);
      parts.push('');
    }

    if (neantCases.length > 0) {
      parts.push('## Cas N\u00e9ant d\u00e9tect\u00e9s');
      parts.push(`T\u00eates sans r\u00e9sultats : ${neantCases.map(n => n.head).join(', ')}.`);
      parts.push('Tu peux envoyer une requ\u00eate cibl\u00e9e : FEEDBACK_LOOP: [head_id] | [nouvelle requ\u00eate]');
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push('Compare les 3 rapports. D\u00e9tecte convergences et d\u00e9saccords. Assemble ta r\u00e9ponse.');
    parts.push('Boucle de r\u00e9troaction possible : FEEDBACK_LOOP: [head_id] | [requ\u00eate cibl\u00e9e]');

    return parts.join('\n');
  }

  private parseFeedbackDirectives(bodyResponse: string): Array<{ head: HeadId; query: string }> {
    const directives: Array<{ head: HeadId; query: string }> = [];
    const regex = /FEEDBACK_LOOP:\s*(rigueur|transversalite|curiosite)\s*\|\s*(.+)/gi;
    let match;
    while ((match = regex.exec(bodyResponse)) !== null) {
      directives.push({ head: match[1].toLowerCase() as HeadId, query: match[2].trim() });
    }
    return directives.slice(0, 2);
  }

  private detectDisagreement(heads: Record<HeadId, HeadRunResult>): boolean {
    const confidences = Object.values(heads).map((h) => h.report.niveauConfiance);
    return confidences.includes('eleve') && confidences.includes('faible');
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
