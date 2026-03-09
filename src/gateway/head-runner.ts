/**
 * CerberusAgent — Head Runner
 *
 * Runs a single head (Rigueur, Transversalité, or Curiosité) through
 * an agentic loop: send query → receive response → execute tools → repeat
 * until the head produces a final text response.
 *
 * Each head is physically isolated: it only receives tools from
 * its registered MCP connectors (enforced by ConnectorRegistry).
 */

import Anthropic from '@anthropic-ai/sdk';
import { HeadId, HeadReport, TokenUsage } from '../types/index.js';
import { AnthropicClient } from '../llm/anthropic-client.js';
import { ConnectorRegistry } from '../mcp/connector-registry.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('head-runner');

const MAX_TOOL_ROUNDS = 8;

export interface HeadRunResult {
  headId: HeadId;
  report: HeadReport;
  rawContent: string;
  totalTokenUsage: TokenUsage;
  durationMs: number;
  toolCallCount: number;
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

  // Physical isolation: each head only gets its own tools
  const tools = registry.getToolsForHead(headId);

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

  // Agentic loop: query → tool_use → tool_result → repeat
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.sendRaw({
      model,
      systemBlocks,
      messages,
      tools: tools.length > 0 ? tools : undefined,
    });

    // Accumulate token usage
    totalUsage.inputTokens += response.tokenUsage.inputTokens;
    totalUsage.outputTokens += response.tokenUsage.outputTokens;
    totalUsage.cacheReadTokens += response.tokenUsage.cacheReadTokens;
    totalUsage.cacheCreationTokens += response.tokenUsage.cacheCreationTokens;

    // Check for tool_use blocks
    const toolUseBlocks = response.rawContent.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (toolUseBlocks.length === 0 || response.stopReason !== 'tool_use') {
      // Final text response — extract text
      finalContent = response.rawContent
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      break;
    }

    // Execute tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      toolCallCount++;
      log.info('Tool call', {
        head: headId,
        round,
        tool: toolUse.name,
        toolCallCount,
      });

      const result = await registry.executeTool(
        toolUse.name,
        toolUse.id,
        toolUse.input as Record<string, unknown>,
      );

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result.content,
        is_error: result.isError || false,
      });
    }

    // Append assistant response + tool results to conversation
    messages = [
      ...messages,
      { role: 'assistant', content: response.rawContent },
      { role: 'user', content: toolResults },
    ];
  }

  const report = parseHeadReport(finalContent, headId);

  log.info('Head completed', {
    head: headId,
    toolCallCount,
    durationMs: Date.now() - start,
    neant: report.neant,
    confidence: report.niveauConfiance,
  });

  return {
    headId,
    report,
    rawContent: finalContent,
    totalTokenUsage: totalUsage,
    durationMs: Date.now() - start,
    toolCallCount,
  };
}

/**
 * Parse the head's text response into a structured HeadReport.
 */
function parseHeadReport(content: string, headId: HeadId): HeadReport {
  const sections = {
    objectifRecherche: extractSection(content, '1. Objectif de recherche', '2.'),
    strategieRecherche: extractSection(content, '2. Strat\'egie de recherche', '3.'),
    resultats: extractSection(content, '3. R\'esultats', '4.'),
    synthese: extractSection(content, '4. Synth\`ese', '5.'),
    limitesLacunes: extractSection(content, '5. Limites et lacunes', '6.'),
    niveauConfianceRaw: extractSection(content, '6. Niveau de confiance', ''),
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

function extractSection(content: string, startMarker: string, endMarker: string): string {
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return '';
  const afterStart = startIdx + startMarker.length;
  let endIdx = content.length;
  if (endMarker) {
    const searchArea = content.slice(afterStart);
    const nextSection = searchArea.search(/###?\s*\d+\./m);
    if (nextSection !== -1) {
      endIdx = afterStart + nextSection;
    }
  }
  return content.slice(afterStart, endIdx).trim();
}
