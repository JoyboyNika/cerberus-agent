import { describe, it, expect } from 'vitest';
import { parseDistillationResponse, extractBlock } from './greffier.js';

describe('extractBlock', () => {
  it('extracts content between two markers', () => {
    const content = `EXECUTIVE_SUMMARY:
La consultation porte sur le curcuma.

DECISIONS:
- Suivre la piste EBM.`;

    const result = extractBlock(content, 'EXECUTIVE_SUMMARY:', 'DECISIONS:');
    expect(result).toBe('La consultation porte sur le curcuma.');
  });

  it('returns empty string when marker is not found', () => {
    const result = extractBlock('some content', 'MISSING_MARKER:', 'END:');
    expect(result).toBe('');
  });

  it('extracts to end when end marker is missing', () => {
    const content = `START:
Content goes here until the end.`;

    const result = extractBlock(content, 'START:', 'NONEXISTENT:');
    expect(result).toBe('Content goes here until the end.');
  });
});

describe('parseDistillationResponse', () => {
  const wellFormed = `EXECUTIVE_SUMMARY:
La consultation porte sur les effets du curcuma. Trois tours ont été complétés.

DECISIONS:
- Le curcuma a un effet anti-inflammatoire modéré
- Les preuves EBM sont de niveau modéré

OPEN_QUESTIONS:
- Dosage optimal non déterminé
- Interactions médicamenteuses à explorer

CHAPTER: Effet anti-inflammatoire
SOURCES: rigueur, transversalite
TAGS: EBM, phytothérapie
Le curcuma a montré des effets anti-inflammatoires dans 5 essais cliniques.

CHAPTER: Utilisations traditionnelles
SOURCES: curiosite
TAGS: ethnobotanique
Utilisé depuis 4000 ans en médecine ayurvédique.`;

  it('parses all 4 sections successfully', () => {
    const { report, filledSectionCount } = parseDistillationResponse(wellFormed, 'session-123', 3);
    expect(filledSectionCount).toBe(4);
    expect(report.executiveSummary).toContain('curcuma');
    expect(report.decisions).toHaveLength(2);
    expect(report.openQuestions).toHaveLength(2);
    expect(report.chapters).toHaveLength(2);
    expect(report.chapters[0].title).toBe('Effet anti-inflammatoire');
    expect(report.chapters[0].sources).toContain('rigueur');
    expect(report.chapters[1].tags).toContain('ethnobotanique');
    expect(report.tableOfContents).toEqual(['Effet anti-inflammatoire', 'Utilisations traditionnelles']);
    expect(report.sessionId).toBe('session-123');
    expect(report.afterTurn).toBe(3);
  });

  it('returns filledSectionCount 0 for completely unstructured content', () => {
    const unstructured = `Voici un résumé de la consultation. Le curcuma a été discuté en détail.`;
    const { report, filledSectionCount } = parseDistillationResponse(unstructured, 'session-456', 2);
    expect(filledSectionCount).toBe(0);
    expect(report.executiveSummary).toBe('(Non distillé)');
    expect(report.decisions).toHaveLength(0);
    expect(report.openQuestions).toHaveLength(0);
    expect(report.chapters).toHaveLength(0);
  });

  it('handles partial format (only executive summary)', () => {
    const partial = `EXECUTIVE_SUMMARY:
Résumé partiel de la consultation.

Le reste n'est pas structuré correctement.`;

    const { report, filledSectionCount } = parseDistillationResponse(partial, 'session-789', 1);
    expect(filledSectionCount).toBe(1);
    expect(report.executiveSummary).toContain('Résumé partiel');
    expect(report.decisions).toHaveLength(0);
    expect(report.chapters).toHaveLength(0);
  });

  it('handles decisions without open questions', () => {
    const content = `EXECUTIVE_SUMMARY:
Test summary.

DECISIONS:
- Decision one
- Decision two

OPEN_QUESTIONS:

CHAPTER: Single chapter
SOURCES: rigueur
TAGS: test
Chapter content here.`;

    const { report, filledSectionCount } = parseDistillationResponse(content, 'session-x', 5);
    expect(filledSectionCount).toBe(3); // exec_summary + decisions + chapters (no open_questions)
    expect(report.decisions).toHaveLength(2);
    expect(report.openQuestions).toHaveLength(0);
    expect(report.chapters).toHaveLength(1);
  });
});
