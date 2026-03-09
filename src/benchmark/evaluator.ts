/**
 * CerberusAgent — Benchmark Evaluator
 *
 * Uses Claude to evaluate benchmark responses.
 * Compares panoptic vs monolithic results on multiple dimensions.
 */

import { AnthropicClient } from '../llm/anthropic-client.js';
import { CostEstimator } from '../llm/cost-estimator.js';
import {
  BenchmarkCase,
  BenchmarkRunResult,
  EvaluationMetrics,
  BenchmarkComparison,
  BenchmarkReport,
} from './types.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('benchmark-evaluator');

export class BenchmarkEvaluator {
  private client: AnthropicClient;
  private model: string;
  private costEstimator: CostEstimator;

  constructor(client: AnthropicClient, model: string, costEstimator: CostEstimator) {
    this.client = client;
    this.model = model;
    this.costEstimator = costEstimator;
  }

  /**
   * Evaluate a single response against a benchmark case.
   */
  async evaluate(testCase: BenchmarkCase, result: BenchmarkRunResult): Promise<EvaluationMetrics> {
    const prompt = this.buildEvaluationPrompt(testCase, result);

    const response = await this.client.sendMessage({
      model: this.model,
      systemBlocks: [{
        type: 'text',
        text: 'Tu es un évaluateur de qualité pour un système de recherche médicale. Évalue la réponse selon les critères fournis. Réponds UNIQUEMENT au format JSON demandé.',
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2048,
    });

    this.costEstimator.recordCall('body', this.model, response.tokenUsage);

    return this.parseEvaluation(response.content, testCase);
  }

  /**
   * Compare panoptic vs monolithic results for a single case.
   */
  compare(
    testCase: BenchmarkCase,
    panopticResult: BenchmarkRunResult,
    panopticMetrics: EvaluationMetrics,
    monolithicResult: BenchmarkRunResult,
    monolithicMetrics: EvaluationMetrics,
  ): BenchmarkComparison {
    const panopticAdvantage: string[] = [];
    const monolithicAdvantage: string[] = [];

    if (panopticMetrics.topicCoverage > monolithicMetrics.topicCoverage) panopticAdvantage.push('topic_coverage');
    else if (monolithicMetrics.topicCoverage > panopticMetrics.topicCoverage) monolithicAdvantage.push('topic_coverage');

    if (panopticMetrics.sourcesCount > monolithicMetrics.sourcesCount) panopticAdvantage.push('sources_count');
    else if (monolithicMetrics.sourcesCount > panopticMetrics.sourcesCount) monolithicAdvantage.push('sources_count');

    if (panopticMetrics.novelInsights > monolithicMetrics.novelInsights) panopticAdvantage.push('novel_insights');
    else if (monolithicMetrics.novelInsights > panopticMetrics.novelInsights) monolithicAdvantage.push('novel_insights');

    if (panopticResult.costBreakdown.totalCost < monolithicResult.costBreakdown.totalCost) panopticAdvantage.push('cost_efficiency');
    else if (monolithicResult.costBreakdown.totalCost < panopticResult.costBreakdown.totalCost) monolithicAdvantage.push('cost_efficiency');

    return {
      caseId: testCase.id,
      category: testCase.category,
      difficulty: testCase.difficultyLevel,
      panoptic: { result: panopticResult, metrics: panopticMetrics },
      monolithic: { result: monolithicResult, metrics: monolithicMetrics },
      delta: {
        topicCoverageDelta: panopticMetrics.topicCoverage - monolithicMetrics.topicCoverage,
        sourcesCountDelta: panopticMetrics.sourcesCount - monolithicMetrics.sourcesCount,
        novelInsightsDelta: panopticMetrics.novelInsights - monolithicMetrics.novelInsights,
        costDelta: panopticResult.costBreakdown.totalCost - monolithicResult.costBreakdown.totalCost,
        durationDelta: panopticResult.durationMs - monolithicResult.durationMs,
        panopticAdvantage,
        monolithicAdvantage,
      },
    };
  }

  /**
   * Generate the aggregate report for the paper.
   */
  generateReport(comparisons: BenchmarkComparison[]): BenchmarkReport {
    const n = comparisons.length;

    const avgMetric = (fn: (c: BenchmarkComparison) => number) =>
      comparisons.reduce((sum, c) => sum + fn(c), 0) / n;

    const curiosityRate = comparisons.filter(c => c.panoptic.metrics.curiosityContribution).length / n;
    const transversalityRate = comparisons.filter(c => c.panoptic.metrics.transversalityContribution).length / n;
    const panopticWins = comparisons.filter(c =>
      c.panoptic.metrics.topicCoverage >= c.monolithic.metrics.topicCoverage &&
      c.panoptic.metrics.novelInsights >= c.monolithic.metrics.novelInsights
    ).length;

    const aggregate = {
      avgTopicCoveragePanoptic: avgMetric(c => c.panoptic.metrics.topicCoverage),
      avgTopicCoverageMonolithic: avgMetric(c => c.monolithic.metrics.topicCoverage),
      avgCostPanoptic: avgMetric(c => c.panoptic.result.costBreakdown.totalCost),
      avgCostMonolithic: avgMetric(c => c.monolithic.result.costBreakdown.totalCost),
      avgDurationPanoptic: avgMetric(c => c.panoptic.result.durationMs),
      avgDurationMonolithic: avgMetric(c => c.monolithic.result.durationMs),
      totalNovelInsightsPanoptic: comparisons.reduce((s, c) => s + c.panoptic.metrics.novelInsights, 0),
      totalNovelInsightsMonolithic: comparisons.reduce((s, c) => s + c.monolithic.metrics.novelInsights, 0),
      curiosityContributionRate: curiosityRate,
      transversalityContributionRate: transversalityRate,
      panopticWinRate: panopticWins / n,
    };

    const conclusion = this.generateConclusion(aggregate, n);

    return {
      runDate: new Date().toISOString(),
      totalCases: n,
      comparisons,
      aggregate,
      conclusion,
    };
  }

  private buildEvaluationPrompt(testCase: BenchmarkCase, result: BenchmarkRunResult): string {
    return [
      '## Cas de test',
      `ID: ${testCase.id}`,
      `Catégorie: ${testCase.category}`,
      `Difficulté: ${testCase.difficultyLevel}`,
      `Requête: ${testCase.query}`,
      '',
      '## Topics attendus',
      testCase.expectedTopics.map(t => `- ${t}`).join('\n'),
      '',
      '## Réponse à évaluer',
      result.response.slice(0, 4000),
      '',
      '## Format JSON attendu',
      'Réponds UNIQUEMENT avec ce JSON (pas de texte avant/après) :',
      '{',
      '  "topicCoverage": 0.0-1.0,',
      '  "topicsCovered": ["topic1", ...],',
      '  "topicsMissed": ["topic1", ...],',
      '  "sourcesCount": number,',
      '  "uniqueSourceTypes": ["PubMed", "OpenAlex", ...],',
      '  "goldStandardHits": number,',
      '  "novelInsights": number,',
      '  "curiosityContribution": boolean,',
      '  "transversalityContribution": boolean,',
      '  "disagreementsDetected": number,',
      '  "disagreementsResolved": number,',
      '  "statedConfidence": "eleve"|"modere"|"faible",',
      '  "appropriateConfidence": boolean',
      '}',
    ].join('\n');
  }

  private parseEvaluation(content: string, testCase: BenchmarkCase): EvaluationMetrics {
    try {
      const cleaned = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        topicCoverage: Number(parsed.topicCoverage) || 0,
        topicsCovered: parsed.topicsCovered || [],
        topicsMissed: parsed.topicsMissed || testCase.expectedTopics,
        sourcesCount: Number(parsed.sourcesCount) || 0,
        uniqueSourceTypes: parsed.uniqueSourceTypes || [],
        goldStandardHits: Number(parsed.goldStandardHits) || 0,
        novelInsights: Number(parsed.novelInsights) || 0,
        curiosityContribution: Boolean(parsed.curiosityContribution),
        transversalityContribution: Boolean(parsed.transversalityContribution),
        disagreementsDetected: Number(parsed.disagreementsDetected) || 0,
        disagreementsResolved: Number(parsed.disagreementsResolved) || 0,
        statedConfidence: parsed.statedConfidence || 'modere',
        appropriateConfidence: Boolean(parsed.appropriateConfidence),
      };
    } catch {
      log.error('Failed to parse evaluation response', { content: content.slice(0, 200) });
      return {
        topicCoverage: 0, topicsCovered: [], topicsMissed: testCase.expectedTopics,
        sourcesCount: 0, uniqueSourceTypes: [], goldStandardHits: 0,
        novelInsights: 0, curiosityContribution: false, transversalityContribution: false,
        disagreementsDetected: 0, disagreementsResolved: 0,
        statedConfidence: 'faible', appropriateConfidence: false,
      };
    }
  }

  private generateConclusion(aggregate: BenchmarkReport['aggregate'], n: number): string {
    const coverageDelta = ((aggregate.avgTopicCoveragePanoptic - aggregate.avgTopicCoverageMonolithic) * 100).toFixed(1);
    const costRatio = (aggregate.avgCostPanoptic / aggregate.avgCostMonolithic).toFixed(2);

    return [
      `Sur ${n} cas de test médicaux, l'architecture panoptique CerberusAgent (3 têtes isolées + Body) `,
      `a atteint un taux de couverture thématique moyen de ${(aggregate.avgTopicCoveragePanoptic * 100).toFixed(1)}% `,
      `contre ${(aggregate.avgTopicCoverageMonolithic * 100).toFixed(1)}% pour l'approche monolithique `,
      `(delta: ${coverageDelta > '0' ? '+' : ''}${coverageDelta}pp). `,
      `La Tête Curiosité a apporté des insights uniques dans ${(aggregate.curiosityContributionRate * 100).toFixed(0)}% des cas. `,
      `La Tête Transversalité a contribué dans ${(aggregate.transversalityContributionRate * 100).toFixed(0)}% des cas. `,
      `Le ratio de coût panoptique/monolithique est de ${costRatio}x. `,
      `L'approche panoptique a obtenu un score supérieur ou égal dans ${(aggregate.panopticWinRate * 100).toFixed(0)}% des cas.`,
    ].join('');
  }
}
