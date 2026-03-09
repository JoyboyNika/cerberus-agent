/**
 * CerberusAgent — Head Runner
 *
 * Runs a single head (Rigueur, Transversalité, or Curiosité) through
 * an agentic loop: send query → receive response → execute tools → repeat
 * until the head produces a final text response.
 *
 * Each head is isolated: it only sees its own prompt and tools.
 */

import Anthropic from '@anthropic-ai/sdk';
import { HeadId, HeadReport, SystemBlock, TokenUsage } from '../types/index.js';
import { AnthropicClient, LlmResponse } from '../llm/anthropic-client.js';
import { ToolExecutor } from './tool-executor.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('head-runner');

const MAX_TOOL_ROUNDS = 5;

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
  toolExecutor: ToolExecutor,
): Promise<HeadRunResult> {
  const start = Date.now();
  const systemBlocks = buildSystemBlocks(headId);
  const tools = toolExecutor.getAllTools();

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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.sendMessage({
      model,
      systemBlocks,
      messages,
      tools,
    });

    // Accumulate token usage
    totalUsage.inputTokens += response.tokenUsage.inputTokens;
    totalUsage.outputTokens += response.tokenUsage.outputTokens;
    totalUsage.cacheReadTokens += response.tokenUsage.cacheReadTokens;
    totalUsage.cacheCreationTokens += response.tokenUsage.cacheCreationTokens;

    // Check if the response contains tool_use blocks
    // We need to re-parse the raw response for this
    // For now, if stopReason is 'tool_use', we handle it
    if (response.stopReason === 'tool_use') {
      log.info('Head using tools', { head: headId, round });
      // TODO: In J2 completion, parse tool_use blocks from raw API response
      // For now, treat as final response
      finalContent = response.content;
      break;
    }

    // Final text response
    finalContent = response.content;
    break;
  }

  const report = parseHeadReport(finalContent, headId);

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
 * Extracts the 6 IMRaD/PRISMA sections.
 */
function parseHeadReport(content: string, headId: HeadId): HeadReport {
  const sections = {
    objectifRecherche: extractSection(content, '1. Objectif de recherche', '2.'),
    strategieRecherche: extractSection(content, '2. Strat\u00e9gie de recherche', '3.'),
    resultats: extractSection(content, '3. R\u00e9sultats', '4.'),
    synthese: extractSection(content, '4. Synth\u00e8se', '5.'),
    limitesLacunes: extractSection(content, '5. Limites et lacunes', '6.'),
    niveauConfianceRaw: extractSection(content, '6. Niveau de confiance', ''),
  };

  // Parse confidence level
  const confText = sections.niveauConfianceRaw.toLowerCase();
  let niveauConfiance: 'eleve' | 'modere' | 'faible' = 'modere';
  if (confText.includes('\u00e9lev\u00e9') || confText.includes('eleve') || confText.includes('high')) {
    niveauConfiance = 'eleve';
  } else if (confText.includes('faible') || confText.includes('low')) {
    niveauConfiance = 'faible';
  }

  // Detect n\u00e9ant
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

/**
 * Extract text between two section headers.
 */
function extractSection(content: string, startMarker: string, endMarker: string): string {
  const startIdx = content.indexOf(startMarker);
  if (startIdx === -1) return '';

  const afterStart = startIdx + startMarker.length;
  let endIdx = content.length;

  if (endMarker) {
    // Look for the next section header (### N. or ## N.)
    const searchArea = content.slice(afterStart);
    const nextSection = searchArea.search(/###?\s*\d+\./m);
    if (nextSection !== -1) {
      endIdx = afterStart + nextSection;
    }
  }

  return content.slice(afterStart, endIdx).trim();
}
