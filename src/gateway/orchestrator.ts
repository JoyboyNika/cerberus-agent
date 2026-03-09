/**
 * CerberusAgent — Orchestrator
 *
 * Coordinates the full pipeline for a single turn:
 * 1. Dispatch query to 3 heads in parallel (isolated tools)
 * 2. Collect 3 IMRaD/PRISMA reports
 * 3. Detect néant cases → reformulate and retry
 * 4. Send reports to Body for synthesis
 * 5. Body can trigger feedback loop (targeted query to one head)
 * 6. Track costs and context usage
 *
 * Pipeline rules (FD-6):
 * - 3 heads in parallel, complete isolation
 * - Same query for all 3 on turn 1
 * - Body can send targeted feedback queries
 * - 5 visible turns, then Body recommends continuation
 */

import { HeadId, TokenUsage, AgentId } from '../types/index.js';
import { AnthropicClient } from '../llm/anthropic-client.js';
import { CostEstimator, CostBreakdown } from '../llm/cost-estimator.js';
import { ConnectorRegistry } from '../mcp/connector-registry.js';
import { runHead, HeadRunResult } from './head-runner.js';
import { checkContextUsage, estimateTokens } from './context-guard.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
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
}

export class Orchestrator {
  private config: AppConfig;
  private client: AnthropicClient;
  private registry: ConnectorRegistry;
  private costEstimator: CostEstimator;

  constructor(config: AppConfig, client: AnthropicClient, registry: ConnectorRegistry) {
    this.config = config;
    this.client = client;
    this.registry = registry;
    this.costEstimator = new CostEstimator();
  }

  /**
   * Execute a single turn of the pipeline.
   */
  async executeTurn(query: string, turn: number, history: string = ''): Promise<TurnResult> {
    const start = Date.now();
    const heads: HeadId[] = ['rigueur', 'transversalite', 'curiosite'];
    this.costEstimator.startTurn();

    log.info('Turn started', {
      turn,
      queryLength: query.length,
      connectorSummary: this.registry.getSummary(),
    });

    // Context guard: check if we're running low on context
    const estimatedContextTokens = estimateTokens(query + history);
    const contextCheck = checkContextUsage(estimatedContextTokens);
    if (!contextCheck.ok && contextCheck.action === 'block') {
      log.error('Context window full', { message: contextCheck.message });
      // At this point, the Greffier (J4) should have distilled.
      // For now, we proceed with a warning.
    }

    // Step 1: Run 3 heads in parallel
    const headPromises = heads.map((headId) =>
      runHead(headId, query, this.config.models.heads, this.client, this.registry)
        .then((result) => {
          // Track cost per head
          const cost = this.costEstimator.recordCall(
            headId as AgentId,
            this.config.models.heads,
            result.totalTokenUsage,
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
    for (const result of headResults) {
      headMap[result.headId] = result;
    }

    // Step 2: Detect néant cases and attempt reformulation
    const neantReformulations: Array<{ head: HeadId; originalNeant: boolean }> = [];
    for (const headId of heads) {
      if (headMap[headId].report.neant) {
        neantReformulations.push({ head: headId, originalNeant: true });
        log.info('N\u00e9ant detected, requesting Body reformulation', { head: headId });
      }
    }

    // Step 3: Body synthesis
    const bodyPrompt = this.buildBodyPrompt(query, headMap, turn, history, neantReformulations);

    const bodySynthesisResponse = await this.client.sendMessage({
      model: this.config.models.body,
      systemBlocks: buildSystemBlocks('body'),
      messages: [{ role: 'user', content: bodyPrompt }],
    });

    // Track Body cost
    const bodyCost = this.costEstimator.recordCall(
      'body',
      this.config.models.body,
      bodySynthesisResponse.tokenUsage,
    );
    this.costEstimator.addToCurrentTurn(bodyCost);

    // Step 4: Parse Body response for feedback directives
    const feedbackLoops = this.parseFeedbackDirectives(bodySynthesisResponse.content);

    // Step 5: Execute feedback loops if Body requested them
    for (const feedback of feedbackLoops) {
      log.info('Executing feedback loop', { head: feedback.head, query: feedback.query.slice(0, 80) });

      try {
        const feedbackResult = await runHead(
          feedback.head,
          feedback.query,
          this.config.models.heads,
          this.client,
          this.registry,
        );

        // Track feedback cost
        const fbCost = this.costEstimator.recordCall(
          feedback.head as AgentId,
          this.config.models.heads,
          feedbackResult.totalTokenUsage,
        );
        this.costEstimator.addToCurrentTurn(fbCost);

        // Update head result with enriched data
        headMap[feedback.head] = feedbackResult;
      } catch (error) {
        log.error('Feedback loop failed', { head: feedback.head, error: String(error) });
      }
    }

    // Step 6: If feedback loops ran, do a second Body synthesis
    let finalSynthesis = bodySynthesisResponse.content;
    if (feedbackLoops.length > 0) {
      const updatedBodyPrompt = this.buildBodyPrompt(query, headMap, turn, history, []);
      const updatedResponse = await this.client.sendMessage({
        model: this.config.models.body,
        systemBlocks: buildSystemBlocks('body'),
        messages: [{ role: 'user', content: updatedBodyPrompt + '\n\n## Note\nCeci est une synth\u00e8se mise \u00e0 jour apr\u00e8s boucle de r\u00e9troaction. Int\u00e8gre les nouveaux r\u00e9sultats.' }],
      });

      const updatedCost = this.costEstimator.recordCall(
        'body',
        this.config.models.body,
        updatedResponse.tokenUsage,
      );
      this.costEstimator.addToCurrentTurn(updatedCost);
      finalSynthesis = updatedResponse.content;
    }

    // Step 7: Aggregate token usage
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
      headDurations: Object.fromEntries(
        Object.entries(headMap).map(([k, v]) => [k, v.durationMs])
      ),
      toolCalls: Object.fromEntries(
        Object.entries(headMap).map(([k, v]) => [k, v.toolCallCount])
      ),
      disagreement,
      feedbackLoops: feedbackLoops.length,
      neantCount: neantReformulations.length,
      turnCostUsd: costSummary.byTurn[costSummary.byTurn.length - 1]?.totalCost || 0,
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
    };
  }

  /**
   * Get the cumulative cost summary for this session.
   */
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
      parts.push('## Historique des tours pr\u00e9c\u00e9dents');
      parts.push(history);
      parts.push('');
    }

    for (const headId of ['rigueur', 'transversalite', 'curiosite'] as HeadId[]) {
      const result = heads[headId];
      parts.push(`## Rapport \u2014 T\u00eate ${headId.charAt(0).toUpperCase() + headId.slice(1)}`);
      parts.push(`Dur\u00e9e: ${result.durationMs}ms | Outils appel\u00e9s: ${result.toolCallCount} | Confiance: ${result.report.niveauConfiance} | N\u00e9ant: ${result.report.neant}${result.loopDetected ? ' | \u26a0\ufe0f Boucle d\u00e9tect\u00e9e' : ''}`);
      parts.push('');
      parts.push(result.rawContent);
      parts.push('');
    }

    // N\u00e9ant handling instructions
    if (neantCases.length > 0) {
      const neantHeads = neantCases.map(n => n.head).join(', ');
      parts.push('## Cas N\u00e9ant d\u00e9tect\u00e9s');
      parts.push(`Les t\u00eates suivantes n'ont trouv\u00e9 aucun r\u00e9sultat pertinent : ${neantHeads}.`);
      parts.push('Si tu estimes qu\'un recadrage pourrait aider, tu peux envoyer une requ\u00eate cibl\u00e9e en utilisant le format :');
      parts.push('FEEDBACK_LOOP: [head_id] | [nouvelle requ\u00eate reformul\u00e9e]');
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push('Compare les 3 rapports. D\u00e9tecte convergences et d\u00e9saccords. Assemble ta r\u00e9ponse au praticien selon ton format de r\u00e9ponse.');
    parts.push('Si une t\u00eate a trouv\u00e9 un point important que les autres devraient approfondir, tu peux d\u00e9clencher une boucle de r\u00e9troaction avec :');
    parts.push('FEEDBACK_LOOP: [head_id] | [requ\u00eate cibl\u00e9e pour cette t\u00eate]');

    return parts.join('\n');
  }

  /**
   * Parse FEEDBACK_LOOP directives from Body's response.
   * Format: FEEDBACK_LOOP: [head_id] | [query]
   */
  private parseFeedbackDirectives(bodyResponse: string): Array<{ head: HeadId; query: string }> {
    const directives: Array<{ head: HeadId; query: string }> = [];
    const regex = /FEEDBACK_LOOP:\s*(rigueur|transversalite|curiosite)\s*\|\s*(.+)/gi;
    let match;

    while ((match = regex.exec(bodyResponse)) !== null) {
      const headId = match[1].toLowerCase() as HeadId;
      const query = match[2].trim();
      if (query.length > 0) {
        directives.push({ head: headId, query });
      }
    }

    // Limit to 2 feedback loops per turn to control costs
    if (directives.length > 2) {
      log.warn('Too many feedback directives, limiting to 2', { found: directives.length });
      return directives.slice(0, 2);
    }

    return directives;
  }

  private detectDisagreement(heads: Record<HeadId, HeadRunResult>): boolean {
    const confidences = Object.values(heads).map((h) => h.report.niveauConfiance);
    const hasHigh = confidences.includes('eleve');
    const hasLow = confidences.includes('faible');
    return hasHigh && hasLow;
  }

  private createFailedHeadResult(headId: HeadId, error: unknown): HeadRunResult {
    return {
      headId,
      report: {
        objectifRecherche: '(Erreur)',
        strategieRecherche: '(Erreur)',
        resultats: '(Erreur)',
        synthese: `La t\u00eate ${headId} a rencontr\u00e9 une erreur: ${String(error)}`,
        limitesLacunes: '(Erreur)',
        niveauConfiance: 'faible',
        niveauConfianceJustification: 'Erreur technique',
        neant: true,
      },
      rawContent: `[ERROR] ${String(error)}`,
      totalTokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      durationMs: 0,
      toolCallCount: 0,
      loopDetected: false,
    };
  }
}
