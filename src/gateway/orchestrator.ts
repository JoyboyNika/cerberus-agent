/**
 * CerberusAgent — Orchestrator
 *
 * Coordinates the 3 heads in parallel for a single turn.
 * Each head is physically isolated via ConnectorRegistry:
 * it only sees and can use its own MCP tools.
 *
 * Pipeline rules (FD-6):
 * - 3 heads in parallel, complete isolation
 * - Same query for all 3 on turn 1
 * - Body can send targeted feedback queries on subsequent turns
 */

import { HeadId, TokenUsage } from '../types/index.js';
import { AnthropicClient } from '../llm/anthropic-client.js';
import { ConnectorRegistry } from '../mcp/connector-registry.js';
import { runHead, HeadRunResult } from './head-runner.js';
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
  durationMs: number;
}

export class Orchestrator {
  private config: AppConfig;
  private client: AnthropicClient;
  private registry: ConnectorRegistry;

  constructor(config: AppConfig, client: AnthropicClient, registry: ConnectorRegistry) {
    this.config = config;
    this.client = client;
    this.registry = registry;
  }

  /**
   * Execute a single turn of the pipeline.
   *
   * 1. Dispatch query to 3 heads in parallel (each with its own tools)
   * 2. Collect 3 reports
   * 3. Send to Body for synthesis
   * 4. Return unified result
   */
  async executeTurn(query: string, turn: number, history: string = ''): Promise<TurnResult> {
    const start = Date.now();
    const heads: HeadId[] = ['rigueur', 'transversalite', 'curiosite'];

    log.info('Turn started', {
      turn,
      queryLength: query.length,
      connectorSummary: this.registry.getSummary(),
    });

    // Step 1: Run 3 heads in parallel — each with its own isolated tools
    const headPromises = heads.map((headId) =>
      runHead(headId, query, this.config.models.heads, this.client, this.registry)
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

    // Step 2: Build Body prompt with head reports
    const bodyPrompt = this.buildBodyPrompt(query, headMap, turn, history);

    // Step 3: Body synthesis (no tools — Body doesn't search)
    const bodySynthesisResponse = await this.client.sendMessage({
      model: this.config.models.body,
      systemBlocks: buildSystemBlocks('body'),
      messages: [{ role: 'user', content: bodyPrompt }],
    });

    // Step 4: Aggregate token usage
    const totalUsage: TokenUsage = {
      inputTokens: bodySynthesisResponse.tokenUsage.inputTokens,
      outputTokens: bodySynthesisResponse.tokenUsage.outputTokens,
      cacheReadTokens: bodySynthesisResponse.tokenUsage.cacheReadTokens,
      cacheCreationTokens: bodySynthesisResponse.tokenUsage.cacheCreationTokens,
    };

    for (const result of headResults) {
      totalUsage.inputTokens += result.totalTokenUsage.inputTokens;
      totalUsage.outputTokens += result.totalTokenUsage.outputTokens;
      totalUsage.cacheReadTokens += result.totalTokenUsage.cacheReadTokens;
      totalUsage.cacheCreationTokens += result.totalTokenUsage.cacheCreationTokens;
    }

    const disagreement = this.detectDisagreement(headMap);

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
    });

    return {
      turn,
      headResults: headMap,
      bodySynthesis: bodySynthesisResponse.content,
      disagreementDetected: disagreement,
      recommendContinue: turn < this.config.pipeline.visibleTurns,
      totalTokenUsage: totalUsage,
      durationMs: Date.now() - start,
    };
  }

  private buildBodyPrompt(
    query: string,
    heads: Record<HeadId, HeadRunResult>,
    turn: number,
    history: string,
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
      parts.push(`Dur\u00e9e: ${result.durationMs}ms | Outils appel\u00e9s: ${result.toolCallCount} | Confiance: ${result.report.niveauConfiance} | N\u00e9ant: ${result.report.neant}`);
      parts.push('');
      parts.push(result.rawContent);
      parts.push('');
    }

    parts.push('## Instructions');
    parts.push('Compare les 3 rapports. D\u00e9tecte convergences et d\u00e9saccords. Assemble ta r\u00e9ponse au praticien selon ton format de r\u00e9ponse.');

    return parts.join('\n');
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
    };
  }
}
