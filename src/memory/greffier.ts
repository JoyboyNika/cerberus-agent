/**
 * CerberusAgent — Greffier (Archiviste Asynchrone)
 *
 * Distills past turns into a structured report using Haiku.
 * Consumes events from the Session Manager buffer.
 *
 * The Greffier runs asynchronously — it doesn't block the main pipeline.
 * The Body reads and verifies the distilled report before
 * the window slides (garde-fou FD-6).
 *
 * Output format: Corail + Blueprint (FD-8)
 */

import { AnthropicClient } from '../llm/anthropic-client.js';
import { CostEstimator } from '../llm/cost-estimator.js';
import { buildSystemBlocks } from '../prompts/prompt-builder.js';
import { SessionManager } from '../session/session-manager.js';
import { SessionEvent } from '../session/types.js';
import { Archive, ArchiveReport, ArchiveChapter } from './archive.js';
import { createLogger } from '../llm/logger.js';
import { TokenUsage } from '../types/index.js';

const log = createLogger('greffier');

export class Greffier {
  private client: AnthropicClient;
  private model: string;
  private archive: Archive;
  private costEstimator: CostEstimator;

  constructor(client: AnthropicClient, model: string, archive: Archive, costEstimator: CostEstimator) {
    this.client = client;
    this.model = model;
    this.archive = archive;
    this.costEstimator = costEstimator;
  }

  /**
   * Distill the buffered events into a structured report.
   * Called when the context window is filling up.
   */
  async distill(sessionManager: SessionManager, afterTurn: number): Promise<ArchiveReport> {
    const events = sessionManager.getBuffer();
    const existingReport = this.archive.load(sessionManager.sessionId);

    log.info('Distillation started', {
      sessionId: sessionManager.sessionId,
      afterTurn,
      eventCount: events.length,
      hasExisting: !!existingReport,
    });

    // Build the distillation prompt
    const prompt = this.buildDistillationPrompt(events, existingReport, afterTurn);

    const response = await this.client.sendMessage({
      model: this.model,
      systemBlocks: buildSystemBlocks('greffier'),
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4096,
    });

    // Track cost
    this.costEstimator.recordCall('greffier', this.model, response.tokenUsage);

    // Parse the response into an ArchiveReport
    const { report, filledSectionCount } = this.parseDistillationResponse(
      response.content,
      sessionManager.sessionId,
      afterTurn,
    );

    // Guard: do not overwrite archive with an empty report
    if (filledSectionCount === 0) {
      log.warn('[greffier:parse_failure] Distillation produced empty report, archive preserved', {
        sessionId: sessionManager.sessionId,
        afterTurn,
        filledSectionCount,
        contentPreview: response.content.slice(0, 200),
      });

      await sessionManager.append({
        type: 'greffier_parse_failure',
        sessionId: sessionManager.sessionId,
        timestamp: new Date().toISOString(),
        afterTurn,
        filledSectionCount,
        contentPreview: response.content.slice(0, 200),
      });

      // Return existing report if available, otherwise the empty one
      const existing = this.archive.load(sessionManager.sessionId);
      return existing || report;
    }

    if (filledSectionCount <= 1) {
      log.warn('[greffier:parse_failure] Distillation produced near-empty report', {
        sessionId: sessionManager.sessionId,
        afterTurn,
        filledSectionCount,
        contentPreview: response.content.slice(0, 200),
      });

      await sessionManager.append({
        type: 'greffier_parse_failure',
        sessionId: sessionManager.sessionId,
        timestamp: new Date().toISOString(),
        afterTurn,
        filledSectionCount,
        contentPreview: response.content.slice(0, 200),
      });
    }

    // Save to archive (only reached when filledSectionCount > 0)
    this.archive.save(report);

    // Record event in session
    await sessionManager.append({
      type: 'greffier_distillation',
      sessionId: sessionManager.sessionId,
      timestamp: new Date().toISOString(),
      afterTurn,
      distilledReport: response.content,
      tokenUsage: response.tokenUsage,
    });

    log.info('Distillation completed', {
      sessionId: sessionManager.sessionId,
      afterTurn,
      filledSectionCount,
      chapters: report.chapters.length,
      decisions: report.decisions.length,
      openQuestions: report.openQuestions.length,
      tokens: response.tokenUsage,
    });

    return report;
  }

  private buildDistillationPrompt(
    events: ReadonlyArray<SessionEvent>,
    existingReport: ArchiveReport | null,
    afterTurn: number,
  ): string {
    const parts: string[] = [];

    parts.push('## Mission de distillation');
    parts.push(`Tu dois distiller les événements de la consultation (tours 1 à ${afterTurn}) en un rapport structuré.`);
    parts.push('');

    if (existingReport) {
      parts.push('## Rapport précédent (\u00e0 mettre \u00e0 jour)');
      parts.push(`Derni\u00e8re mise \u00e0 jour au tour ${existingReport.afterTurn}.`);
      parts.push('');
      parts.push('### Résumé exécutif précédent');
      parts.push(existingReport.executiveSummary);
      parts.push('');
      parts.push('### Décisions précédentes');
      for (const d of existingReport.decisions) {
        parts.push(`- ${d}`);
      }
      parts.push('');
    }

    parts.push('## Événements \u00e0 distiller');
    parts.push('');

    // Format events as readable text
    for (const event of events) {
      switch (event.type) {
        case 'turn_start':
          parts.push(`### Tour ${event.turn}`);
          parts.push(`Requ\u00eate : ${event.query}`);
          parts.push('');
          break;
        case 'head_report':
          parts.push(`#### Rapport T\u00eate ${event.head} (Tour ${event.turn})`);
          parts.push(`Confiance : ${event.report.niveauConfiance} | N\u00e9ant : ${event.report.neant}`);
          parts.push(`Synth\u00e8se : ${event.report.synthese}`);
          parts.push(`R\u00e9sultats : ${event.report.resultats.slice(0, 500)}...`);
          parts.push('');
          break;
        case 'body_synthesis':
          parts.push(`#### Synth\u00e8se Body (Tour ${event.turn})`);
          parts.push(event.response.slice(0, 1000));
          parts.push('');
          break;
        case 'arbitre_decision':
          parts.push(`#### D\u00e9cision Arbitre (Tour ${event.turn})`);
          parts.push(`D\u00e9cision : ${event.decision} | T\u00eate : ${event.targetHead}`);
          parts.push(event.motivatedReport.slice(0, 500));
          parts.push('');
          break;
      }
    }

    parts.push('## Format de sortie attendu');
    parts.push('R\u00e9ponds avec exactement ce format :');
    parts.push('');
    parts.push('EXECUTIVE_SUMMARY:');
    parts.push('[R\u00e9sum\u00e9 en 3-5 phrases de l\'\u00e9tat actuel de la consultation]');
    parts.push('');
    parts.push('DECISIONS:');
    parts.push('- [chaque d\u00e9cision valid\u00e9e, une par ligne]');
    parts.push('');
    parts.push('OPEN_QUESTIONS:');
    parts.push('- [chaque question ouverte ou risque, une par ligne]');
    parts.push('');
    parts.push('CHAPTER: [Titre du chapitre]');
    parts.push('SOURCES: [t\u00eates qui ont contribu\u00e9]');
    parts.push('TAGS: [\u00e9tiquettes pertinentes]');
    parts.push('[contenu du chapitre]');
    parts.push('');
    parts.push('CHAPTER: [Titre suivant]');
    parts.push('...');

    return parts.join('\n');
  }

  private parseDistillationResponse(
    content: string,
    sessionId: string,
    afterTurn: number,
  ): { report: ArchiveReport; filledSectionCount: number } {
    // Parse EXECUTIVE_SUMMARY
    const execSummaryRaw = this.extractBlock(content, 'EXECUTIVE_SUMMARY:', 'DECISIONS:');
    const execSummary = execSummaryRaw || '(Non distillé)';

    // Parse DECISIONS
    const decisionsBlock = this.extractBlock(content, 'DECISIONS:', 'OPEN_QUESTIONS:') || '';
    const decisions = decisionsBlock
      .split('\n')
      .map(l => l.replace(/^-\s*/, '').trim())
      .filter(l => l.length > 0);

    // Parse OPEN_QUESTIONS
    const questionsBlock = this.extractBlock(content, 'OPEN_QUESTIONS:', 'CHAPTER:') || '';
    const openQuestions = questionsBlock
      .split('\n')
      .map(l => l.replace(/^-\s*/, '').trim())
      .filter(l => l.length > 0);

    // Parse CHAPTERS
    const chapters: ArchiveChapter[] = [];
    const chapterRegex = /CHAPTER:\s*(.+?)\nSOURCES:\s*(.+?)\nTAGS:\s*(.+?)\n([\s\S]*?)(?=CHAPTER:|$)/gi;
    let match;
    while ((match = chapterRegex.exec(content)) !== null) {
      chapters.push({
        title: match[1].trim(),
        sources: match[2].split(',').map(s => s.trim()),
        tags: match[3].split(',').map(t => t.trim()),
        content: match[4].trim(),
      });
    }

    // Count filled sections
    let filledSectionCount = 0;
    if (execSummaryRaw) filledSectionCount++;
    if (decisions.length > 0) filledSectionCount++;
    if (openQuestions.length > 0) filledSectionCount++;
    if (chapters.length > 0) filledSectionCount++;

    return {
      report: {
        sessionId,
        lastUpdatedAt: new Date().toISOString(),
        afterTurn,
        executiveSummary: execSummary,
        tableOfContents: chapters.map(c => c.title),
        chapters,
        openQuestions,
        decisions,
      },
      filledSectionCount,
    };
  }

  private extractBlock(content: string, startMarker: string, endMarker: string): string {
    const startIdx = content.indexOf(startMarker);
    if (startIdx === -1) return '';
    const afterStart = startIdx + startMarker.length;
    const endIdx = endMarker ? content.indexOf(endMarker, afterStart) : content.length;
    return content.slice(afterStart, endIdx === -1 ? content.length : endIdx).trim();
  }
}
