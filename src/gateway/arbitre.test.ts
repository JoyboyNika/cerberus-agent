import { describe, it, expect } from 'vitest';
import { parseArbitreDecision } from './arbitre.js';

describe('parseArbitreDecision', () => {
  it('parses well-formed SUIVRE decision', () => {
    const content = `DECISION: SUIVRE
TARGET: rigueur

RAPPORT_MOTIVE:
1. Résumé du désaccord
La tête Rigueur a trouvé des preuves solides.`;

    const result = parseArbitreDecision(content);
    expect(result.decision).toBe('follow');
    expect(result.targetHead).toBe('rigueur');
    expect(result.motivatedReport).toContain('Résumé du désaccord');
  });

  it('parses well-formed ABANDONNER decision', () => {
    const content = `DECISION: ABANDONNER
TARGET: transversalite

RAPPORT_MOTIVE:
1. La piste est insuffisamment documentée.`;

    const result = parseArbitreDecision(content);
    expect(result.decision).toBe('abandon');
    expect(result.targetHead).toBe('transversalite');
  });

  it('parses case-insensitive', () => {
    const content = `DECISION: abandonner
TARGET: Curiosite

RAPPORT_MOTIVE:
Analyse complète.`;

    const result = parseArbitreDecision(content);
    expect(result.decision).toBe('abandon');
    expect(result.targetHead).toBe('curiosite');
  });

  it('returns parse_error when DECISION field is missing', () => {
    const content = `Décision : abandonner cette piste
Tête concernée : Rigueur

Mon analyse montre que la piste est faible.`;

    const result = parseArbitreDecision(content);
    expect(result.decision).toBe('parse_error');
  });

  it('returns null targetHead when TARGET field is missing', () => {
    const content = `DECISION: SUIVRE
Tête concernée : Rigueur

RAPPORT_MOTIVE:
Analyse complète.`;

    const result = parseArbitreDecision(content);
    expect(result.decision).toBe('follow');
    expect(result.targetHead).toBeNull();
  });

  it('returns parse_error and null for completely unstructured response', () => {
    const content = `Je pense qu'il faudrait abandonner la piste de la tête curiosité car les preuves sont insuffisantes.`;

    const result = parseArbitreDecision(content);
    expect(result.decision).toBe('parse_error');
    expect(result.targetHead).toBeNull();
    // motivatedReport falls back to full content
    expect(result.motivatedReport).toContain('abandonner la piste');
  });

  it('returns full content as motivatedReport when RAPPORT_MOTIVE is missing', () => {
    const content = `DECISION: SUIVRE
TARGET: rigueur

Mon analyse détaillée sans marqueur de rapport.`;

    const result = parseArbitreDecision(content);
    expect(result.decision).toBe('follow');
    expect(result.targetHead).toBe('rigueur');
    expect(result.motivatedReport).toContain('Mon analyse détaillée');
  });
});
