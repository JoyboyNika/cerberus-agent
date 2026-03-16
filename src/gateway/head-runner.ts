/**
 * CerberusAgent — Head Runner
 *
 * Runs a single head through an agentic tool_use loop.
 * Each head is physically isolated: only its own MCP tools.
 *
 * Integrates:
 * - Tool loop detection (prevents stuck loops)
 * - Token usage tracking (for cost estimation)
 */

import Anthropic from '@anthropic-ai/sdk';
import { HeadId, HeadReport, TokenUsage } from '../types/index.js';
import { AnthropicClient } from '../llm/anthropic-client.js';
import { ConnectorRegistry } from '../mcp/connector-registry.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
import { createLogger } from '../llm/logger.js';
import { ToolLoopDetector } from './tool-loop-detection.js';

const log = createLogger('head-runner');

const MAX_TOOL_ROUNDS = 8;

export interface HeadRunResult {
  headId: HeadId;
  report: HeadReport;
  rawContent: string;
  totalTokenUsage: TokenUsage;
  durationMs: number;
  toolCallCount: number;
  loopDetected: boolean;
  parsedSectionCount: number;
  missingSections: string[];
}

export async function runHead(
  headId: HeadId,
  query: string,
  model: string,
  client: AnthropicClient,
  registry: ConnectorRegistry,
): Promise<HeadRunResult> {
  const start = Date.now();
  const systemBlocks = buildSystemBlocks(headId);
  const tools = registry.getToolsForHead(headId);
  const loopDetector = new ToolLoopDetector();

  log.info('Head started', {
    head: headId,
    toolCount: tools.length,
    toolNames: tools.map((t) => t.name),
  });

  const totalUsage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };

  let messages: Anthropic.MessageParam[] = [
    { role: 'user', content: query },
  ];

  let toolCallCount = 0;
  let finalContent = '';
  let loopDetected = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.sendRaw({
      model,
      systemBlocks,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    totalUsage.inputTokens += response.tokenUsage.inputTokens;
    totalUsage.outputTokens += response.tokenUsage.outputTokens;
    totalUsage.cacheReadTokens += response.tokenUsage.cacheReadTokens;
    totalUsage.cacheCreationTokens += response.tokenUsage.cacheCreationTokens;

    const toolUseBlocks = response.rawContent.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0 || response.stopReason !== 'tool_use') {
      finalContent = response.rawContent
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      // Check for loops BEFORE executing
      const loopCheck = loopDetector.recordAndCheck(toolUse.name, toolUse.input);
      if (loopCheck.stuck && loopCheck.level === 'critical') {
        log.error('Critical loop detected, stopping head', {
          head: headId,
          detector: loopCheck.detector,
          count: loopCheck.count,
        });
        loopDetected = true;

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `LOOP DETECTED: ${loopCheck.message}. Stop using this tool and write your report with the data you have.`,
          is_error: true,
        });
        continue;
      }

      toolCallCount++;
      log.info('Tool call', { head: headId, round, tool: toolUse.name, toolCallCount });

      const result = await registry.executeTool(
        toolUse.name,
        toolUse.id,
        toolUse.input as Record<string, unknown>,
      );

      // Record result for no-progress detection
      loopDetector.recordResult(toolUse.name, toolUse.input, result.content);

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result.content,
        is_error: result.isError || false,
      });
    }

    messages = [
      ...messages,
      { role: 'assistant', content: response.rawContent },
      { role: 'user', content: toolResults },
    ];

    // If critical loop was detected, force one more response to get the report
    if (loopDetected) {
      continue;
    }
  }

  const { report, parsedSectionCount, missingSections } = parseHeadReport(finalContent, headId);

  log.info('Head completed', {
    head: headId,
    toolCallCount,
    durationMs: Date.now() - start,
    neant: report.neant,
    confidence: report.niveauConfiance,
    loopDetected,
    parsedSectionCount,
    loopStats: loopDetector.getStats(),
  });

  return {
    headId,
    report,
    rawContent: finalContent,
    totalTokenUsage: totalUsage,
    durationMs: Date.now() - start,
    toolCallCount,
    loopDetected,
    parsedSectionCount,
    missingSections,
  };
}

interface ParsedHeadReport {
  report: HeadReport;
  parsedSectionCount: number;
  missingSections: string[];
}

function parseHeadReport(content: string, headId: HeadId): ParsedHeadReport {
  const sectionDefs: Array<{ key: string; label: string }> = [
    { key: 'objectifRecherche', label: 'Objectif de recherche' },
    { key: 'strategieRecherche', label: 'Stratégie de recherche' },
    { key: 'resultats', label: 'Résultats' },
    { key: 'synthese', label: 'Synthèse' },
    { key: 'limitesLacunes', label: 'Limites et lacunes' },
  ];

  const extracted: Record<string, string> = {};
  const missingSections: string[] = [];

  for (const { key, label } of sectionDefs) {
    const value = extractSection(content, label);
    extracted[key] = value;
    if (!value) {
      missingSections.push(label);
    }
  }

  const niveauConfianceRaw = extractSection(content, 'Niveau de confiance');
  const parsedSectionCount = sectionDefs.length - missingSections.length;

  if (parsedSectionCount < 5) {
    log.warn('[head-runner:parse_partial] Report sections missing', {
      headId,
      parsedSectionCount,
      missingSections,
    });
  }

  const confText = niveauConfianceRaw.toLowerCase();
  let niveauConfiance: 'eleve' | 'modere' | 'faible' = 'modere';
  if (confText.includes('élevé') || confText.includes('eleve') || confText.includes('high')) {
    niveauConfiance = 'eleve';
  } else if (confText.includes('faible') || confText.includes('low')) {
    niveauConfiance = 'faible';
  }

  const neant = content.toLowerCase().includes('néant') ||
    content.toLowerCase().includes('aucun résultat') ||
    (extracted.resultats.trim().length < 50 && extracted.resultats.toLowerCase().includes('aucun'));

  // Total parse failure: provide raw content as fallback for the Body
  const rawFallback = parsedSectionCount === 0 ? content : null;

  return {
    report: {
      objectifRecherche: extracted.objectifRecherche || '(Section non trouvée)',
      strategieRecherche: extracted.strategieRecherche || '(Section non trouvée)',
      resultats: extracted.resultats || '(Section non trouvée)',
      synthese: extracted.synthese || '(Section non trouvée)',
      limitesLacunes: extracted.limitesLacunes || '(Section non trouvée)',
      niveauConfiance,
      niveauConfianceJustification: niveauConfianceRaw || '(Non spécifié)',
      neant,
      rawFallback,
    },
    parsedSectionCount,
    missingSections,
  };
}

function extractSection(content: string, sectionName: string): string {
  // Match "### N. Section Name" or "## N. Section Name"
  const regex = new RegExp(`###?\\s*\\d+\\.\\s*${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\n([\\s\\S]*?)(?=###?\\s*\\d+\\.|$)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}
