/**
 * CerberusAgent — Archive
 *
 * Stores distilled reports from the Greffier.
 * File-based, LLM-native structure:
 *   Executive Summary + Table of Contents + Thematic Chapters
 *
 * Architecture Corail enrichie Blueprint (FD-8):
 * - Executive Summary: état condensed de la consultation
 * - ToC: index navigable des chapitres
 * - Chapitres: thématiques, avec étiquetage [DÉCISION VALIDÉE] / [RISQUE À INSTRUIRE]
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../llm/logger.js';

const log = createLogger('archive');

export interface ArchiveReport {
  sessionId: string;
  lastUpdatedAt: string;
  afterTurn: number;
  executiveSummary: string;
  tableOfContents: string[];
  chapters: ArchiveChapter[];
  openQuestions: string[];
  decisions: string[];
}

export interface ArchiveChapter {
  title: string;
  content: string;
  sources: string[];  // Which heads contributed
  tags: string[];     // [DÉCISION VALIDÉE], [RISQUE À INSTRUIRE], etc.
}

export class Archive {
  private readonly archiveDir: string;

  constructor(dataDir: string) {
    this.archiveDir = join(dataDir, 'archives');
    mkdirSync(this.archiveDir, { recursive: true });
  }

  /**
   * Save a distilled report.
   */
  save(report: ArchiveReport): void {
    const filePath = join(this.archiveDir, `${report.sessionId}.json`);
    writeFileSync(filePath, JSON.stringify(report, null, 2), 'utf-8');
    log.info('Archive saved', {
      sessionId: report.sessionId,
      afterTurn: report.afterTurn,
      chapters: report.chapters.length,
    });
  }

  /**
   * Load a distilled report.
   */
  load(sessionId: string): ArchiveReport | null {
    const filePath = join(this.archiveDir, `${sessionId}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ArchiveReport;
  }

  /**
   * Convert an archive report to a text block that can be
   * injected into the context window as compressed history.
   */
  static toContextBlock(report: ArchiveReport): string {
    const parts: string[] = [];

    parts.push('## Mémoire de la consultation (distillé par le Greffier)');
    parts.push(`Dernière mise à jour : tour ${report.afterTurn}`);
    parts.push('');

    parts.push('### Résumé exécutif');
    parts.push(report.executiveSummary);
    parts.push('');

    if (report.decisions.length > 0) {
      parts.push('### Décisions validées');
      for (const decision of report.decisions) {
        parts.push(`- [DÉCISION VALIDÉE] ${decision}`);
      }
      parts.push('');
    }

    if (report.openQuestions.length > 0) {
      parts.push('### Questions ouvertes');
      for (const q of report.openQuestions) {
        parts.push(`- [RISQUE À INSTRUIRE] ${q}`);
      }
      parts.push('');
    }

    for (const chapter of report.chapters) {
      parts.push(`### ${chapter.title}`);
      if (chapter.tags.length > 0) {
        parts.push(`_Tags: ${chapter.tags.join(', ')}_`);
      }
      parts.push(chapter.content);
      if (chapter.sources.length > 0) {
        parts.push(`_Sources: ${chapter.sources.join(', ')}_`);
      }
      parts.push('');
    }

    return parts.join('\n');
  }
}
