/**
 * CerberusAgent — Benchmark Runner
 *
 * Runs the benchmark suite: for each test case,
 * executes both panoptic and monolithic modes,
 * evaluates results, and generates the comparison report.
 */

import { AnthropicClient } from '../llm/anthropic-client.js';
import { CostEstimator } from '../llm/cost-estimator.js';
import { ConnectorRegistry } from '../mcp/connector-registry.js';
import { PubMedConnector } from '../mcp/pubmed-connector.js';
import { OpenAlexConnector } from '../mcp/openAlex-connector.js';
import { Orchestrator } from '../gateway/orchestrator.js';
import { SessionManager } from '../session/session-manager.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
import { BenchmarkEvaluator } from './evaluator.js';
import { BENCHMARK_CORPUS } from './corpus.js';
import {
  BenchmarkCase,
  BenchmarkRunResult,
  BenchmarkComparison,
  BenchmarkReport,
} from './types.js';
import { AppConfig } from '../config.js';
import { createLogger } from '../llm/logger.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const log = createLogger('benchmark-runner');

export class BenchmarkRunner {
  private config: AppConfig;
  private client: AnthropicClient;
  private costEstimator: CostEstimator;
  private evaluator: BenchmarkEvaluator;

  constructor(config: AppConfig, client: AnthropicClient) {
    this.config = config;
    this.client = client;
    this.costEstimator = new CostEstimator();
    this.evaluator = new BenchmarkEvaluator(client, config.models.body, this.costEstimator);
  }

  /**
   * Run the full benchmark suite.
   */
  async runAll(cases?: BenchmarkCase[]): Promise<BenchmarkReport> {
    const corpus = cases || BENCHMARK_CORPUS;
    const comparisons: BenchmarkComparison[] = [];

    log.info('Benchmark started', { totalCases: corpus.length });

    for (let i = 0; i < corpus.length; i++) {
      const testCase = corpus[i];
      log.info('Running case', { id: testCase.id, index: i + 1, total: corpus.length });

      try {
        // Run panoptic mode (full CerberusAgent)
        const panopticResult = await this.runPanoptic(testCase);

        // Run monolithic mode (single agent, all tools)
        const monolithicResult = await this.runMonolithic(testCase);

        // Evaluate both
        const panopticMetrics = await this.evaluator.evaluate(testCase, panopticResult);
        const monolithicMetrics = await this.evaluator.evaluate(testCase, monolithicResult);

        // Compare
        const comparison = this.evaluator.compare(
          testCase, panopticResult, panopticMetrics, monolithicResult, monolithicMetrics,
        );
        comparisons.push(comparison);

        log.info('Case completed', {
          id: testCase.id,
          panopticCoverage: panopticMetrics.topicCoverage,
          monolithicCoverage: monolithicMetrics.topicCoverage,
          panopticCost: panopticResult.costBreakdown.totalCost,
          monolithicCost: monolithicResult.costBreakdown.totalCost,
        });
      } catch (error) {
        log.error('Case failed', { id: testCase.id, error: String(error) });
      }
    }

    const report = this.evaluator.generateReport(comparisons);

    // Save report
    this.saveReport(report);

    log.info('Benchmark completed', {
      totalCases: report.totalCases,
      panopticWinRate: report.aggregate.panopticWinRate,
      avgCostPanoptic: report.aggregate.avgCostPanoptic,
      avgCostMonolithic: report.aggregate.avgCostMonolithic,
    });

    return report;
  }

  /**
   * Run a single case in panoptic mode (3 heads + Body).
   */
  private async runPanoptic(testCase: BenchmarkCase): Promise<BenchmarkRunResult> {
    const registry = this.createRegistry();
    const orchestrator = new Orchestrator(this.config, this.client, registry);
    const session = SessionManager.create(this.config.session.dataDir);
    await session.startSession(testCase.query);

    const start = Date.now();
    const result = await orchestrator.executeTurn(testCase.query, 1, session);
    await session.close();

    return {
      caseId: testCase.id,
      mode: 'panoptic',
      response: result.bodySynthesis,
      durationMs: Date.now() - start,
      tokenUsage: result.totalTokenUsage,
      costBreakdown: result.costBreakdown,
      headResults: Object.fromEntries(
        Object.entries(result.headResults).map(([k, v]) => [k, {
          confidence: v.report.niveauConfiance,
          neant: v.report.neant,
          toolCalls: v.toolCallCount,
          durationMs: v.durationMs,
        }])
      ) as any,
      feedbackLoops: result.feedbackLoops.length,
      arbitreInvoked: result.arbitreInvoked,
      windowSlid: result.windowSlid,
    };
  }

  /**
   * Run a single case in monolithic mode (single agent with all tools).
   */
  private async runMonolithic(testCase: BenchmarkCase): Promise<BenchmarkRunResult> {
    const start = Date.now();

    // Single agent with ALL tools available (no isolation)
    const allTools = [
      ...new PubMedConnector([]).getTools(),
      ...new OpenAlexConnector().getTools(),
    ];

    const response = await this.client.sendMessage({
      model: this.config.models.body,
      systemBlocks: [{
        type: 'text',
        text: [
          'Tu es un assistant de recherche médicale. Pour chaque requête :',
          '1. Utilise TOUS les outils de recherche disponibles',
          '2. Synthétise les résultats en un rapport structuré',
          '3. Cite tes sources (PMID, DOI)',
          '4. Évalue ton niveau de confiance (Élevé / Modéré / Faible)',
          '5. Signale les limites et zones grises',
        ].join('\n'),
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content: testCase.query }],
      tools: allTools,
      maxTokens: 4096,
    });

    return {
      caseId: testCase.id,
      mode: 'monolithic',
      response: response.content,
      durationMs: Date.now() - start,
      tokenUsage: response.tokenUsage,
      costBreakdown: CostEstimator.estimateCallCost(this.config.models.body, response.tokenUsage),
      feedbackLoops: 0,
      arbitreInvoked: false,
      windowSlid: false,
    };
  }

  private createRegistry(): ConnectorRegistry {
    const registry = new ConnectorRegistry();
    registry.registerForHead('rigueur', new PubMedConnector([
      '"systematic review"[pt] OR "meta-analysis"[pt] OR "randomized controlled trial"[pt] OR "practice guideline"[pt]',
    ]));
    registry.registerForHead('transversalite', new PubMedConnector([
      '"complementary therapies"[mesh] OR "phytotherapy"[mesh] OR "diet therapy"[mesh]',
    ]));
    registry.registerForHead('curiosite', new OpenAlexConnector());
    return registry;
  }

  private saveReport(report: BenchmarkReport): void {
    const dir = join(this.config.session.dataDir, 'benchmarks');
    mkdirSync(dir, { recursive: true });
    const filename = `benchmark-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    log.info('Report saved', { path: filePath });
  }
}
