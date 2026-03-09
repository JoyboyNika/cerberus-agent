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

  const report = parseHeadReport(finalContent, headId);

  log.info('Head completed', {
    head: headId,
    toolCallCount,
    durationMs: Date.now() - start,
    neant: report.neant,
    confidence: report.niveauConfiance,
    loopDetected,
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
  };
}

function parseHeadReport(content: string, headId: HeadId): HeadReport {
  const sections = {
    objectifRecherche: extractSection(content, 'Objectif de recherche'),
    strategieRecherche: extractSection(content, 'Strat\u00e9gie de recherche'),
    resultats: extractSection(content, 'R\u00e9sultats'),
    synthese: extractSection(content, 'Synth\u00e8se'),
    limitesLacunes: extractSection(content, 'Limites et lacunes'),
    niveauConfianceRaw: extractSection(content, 'Niveau de confiance'),
  };

  const confText = sections.niveauConfianceRaw.toLowerCase();
  let niveauConfiance: 'eleve' | 'modere' | 'faible' = 'modere';
  if (confText.includes('\u00e9lev\u00e9') || confText.includes('eleve') || confText.includes('high')) {
    niveauConfiance = 'eleve';
  } else if (confText.includes('faible') || confText.includes('low')) {
    niveauConfiance = 'faible';
  }

  const neant = content.toLowerCase().includes('n\u00e9ant') ||
    content.toLowerCase().includes('aucun r\u00e9sultat') ||
    (sections.resultats.trim().length < 50 && sections.resultats.toLowerCase().includes('aucun'));

  return {
    objectifRecherche: sections.objectifRecherche || '(Section non trouv\u00e9e)',
    strategieRecherche: sections.strategieRecherche || '(Section non trouv\u00e9e)',
    resultats: sections.resultats || '(Section non trouv\u00e9e)',
    synthese: sections.synthese || '(Section non trouv\u00e9e)',
    limitesLacunes: sections.limitesLacunes || '(Section non trouv\u00e9e)',
    niveauConfiance,
    niveauConfianceJustification: sections.niveauConfianceRaw || '(Non sp\u00e9cifi\u00e9)',
    neant,
  };
}

function extractSection(content: string, sectionName: string): string {
  // Match "### N. Section Name" or "## N. Section Name"
  const regex = new RegExp(`###?\\s*\\d+\\.\\s*${sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\n([\\s\\S]*?)(?=###?\\s*\\d+\\.|$)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}
