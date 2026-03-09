/**
 * CerberusAgent — Benchmark Types
 *
 * Defines the structure of benchmark test cases, results,
 * and comparison metrics for the research paper.
 */

import { HeadId, TokenUsage } from '../types/index.js';
import { CostBreakdown } from '../llm/cost-estimator.js';

// === Test Cases ===

export interface BenchmarkCase {
  id: string;
  category: BenchmarkCategory;
  query: string;
  expectedTopics: string[];           // Key topics the answer should cover
  difficultyLevel: 'simple' | 'moderate' | 'complex';
  requiresTransversality: boolean;    // Would alt-medicine add value?
  requiresCuriosity: boolean;         // Would non-medical sources add value?
  goldStandardSources?: string[];     // PMIDs or DOIs of expected references
}

export type BenchmarkCategory =
  | 'pharmacology'      // Drug interactions, mechanisms
  | 'nutrition'          // Dietary interventions
  | 'rare_disease'       // Uncommon conditions
  | 'traditional_medicine' // Historical/ethnobotanical remedies
  | 'multi_system'       // Cross-disciplinary conditions
  | 'controversial'      // Debated treatments
  | 'emerging_research'; // Recent discoveries

// === Run Results ===

export interface BenchmarkRunResult {
  caseId: string;
  mode: 'panoptic' | 'monolithic';
  response: string;
  durationMs: number;
  tokenUsage: TokenUsage;
  costBreakdown: CostBreakdown;
  headResults?: Record<HeadId, {
    confidence: string;
    neant: boolean;
    toolCalls: number;
    durationMs: number;
  }>;
  feedbackLoops: number;
  arbitreInvoked: boolean;
  windowSlid: boolean;
}

// === Evaluation Metrics ===

export interface EvaluationMetrics {
  // Coverage: how many expected topics were addressed
  topicCoverage: number;              // 0-1
  topicsCovered: string[];
  topicsMissed: string[];

  // Source quality
  sourcesCount: number;
  uniqueSourceTypes: string[];        // PubMed, OpenAlex, etc.
  goldStandardHits: number;           // How many expected sources were found

  // Novelty: information from non-obvious sources
  novelInsights: number;              // Count of non-trivial cross-domain connections
  curiosityContribution: boolean;     // Did Curiosité add unique value?
  transversalityContribution: boolean; // Did Transversalité add unique value?

  // Disagreement handling
  disagreementsDetected: number;
  disagreementsResolved: number;

  // Confidence calibration
  statedConfidence: 'eleve' | 'modere' | 'faible';
  appropriateConfidence: boolean;     // Was the confidence level justified?
}

// === Comparison ===

export interface BenchmarkComparison {
  caseId: string;
  category: BenchmarkCategory;
  difficulty: string;

  panoptic: {
    result: BenchmarkRunResult;
    metrics: EvaluationMetrics;
  };
  monolithic: {
    result: BenchmarkRunResult;
    metrics: EvaluationMetrics;
  };

  // Delta metrics
  delta: {
    topicCoverageDelta: number;       // panoptic - monolithic
    sourcesCountDelta: number;
    novelInsightsDelta: number;
    costDelta: number;                // USD difference
    durationDelta: number;            // ms difference
    panopticAdvantage: string[];      // Areas where panoptic was better
    monolithicAdvantage: string[];    // Areas where monolithic was better
  };
}

// === Aggregate Report ===

export interface BenchmarkReport {
  runDate: string;
  totalCases: number;
  comparisons: BenchmarkComparison[];

  aggregate: {
    avgTopicCoveragePanoptic: number;
    avgTopicCoverageMonolithic: number;
    avgCostPanoptic: number;
    avgCostMonolithic: number;
    avgDurationPanoptic: number;
    avgDurationMonolithic: number;
    totalNovelInsightsPanoptic: number;
    totalNovelInsightsMonolithic: number;
    curiosityContributionRate: number;  // % of cases where Curiosité added value
    transversalityContributionRate: number;
    panopticWinRate: number;            // % of cases where panoptic scored higher
  };

  // For the paper
  conclusion: string;
}
