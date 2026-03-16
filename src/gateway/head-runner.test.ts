import { describe, it, expect } from 'vitest';
import { parseHeadReport, extractSection } from './head-runner.js';

describe('extractSection', () => {
  const content = `### 1. Objectif de recherche
Étudier l'effet du curcuma sur l'inflammation.

### 2. Stratégie de recherche
Recherche PubMed avec MeSH terms.

### 3. Résultats
5 essais cliniques identifiés.

### 4. Synthèse
Le curcuma montre un effet modéré.

### 5. Limites et lacunes
Échantillons faibles.

### 6. Niveau de confiance
Modéré — preuves limitées.`;

  it('extracts a named section', () => {
    const result = extractSection(content, 'Objectif de recherche');
    expect(result).toContain('curcuma');
  });

  it('extracts last section (no trailing header)', () => {
    const result = extractSection(content, 'Niveau de confiance');
    expect(result).toContain('Modéré');
  });

  it('returns empty string for non-existent section', () => {
    const result = extractSection(content, 'Section inexistante');
    expect(result).toBe('');
  });
});

describe('parseHeadReport', () => {
  const wellFormedContent = `### 1. Objectif de recherche
Étudier l'effet du curcuma sur l'inflammation.

### 2. Stratégie de recherche
Recherche PubMed avec MeSH terms.

### 3. Résultats
5 essais cliniques identifiés avec résultats positifs.

### 4. Synthèse
Le curcuma montre un effet anti-inflammatoire modéré.

### 5. Limites et lacunes
Échantillons faibles, biais de publication possible.

### 6. Niveau de confiance
Élevé — méta-analyses concordantes.`;

  it('parses all 5 sections successfully', () => {
    const { report, parsedSectionCount, missingSections } = parseHeadReport(wellFormedContent, 'rigueur');
    expect(parsedSectionCount).toBe(5);
    expect(missingSections).toHaveLength(0);
    expect(report.objectifRecherche).toContain('curcuma');
    expect(report.strategieRecherche).toContain('PubMed');
    expect(report.resultats).toContain('essais cliniques');
    expect(report.synthese).toContain('anti-inflammatoire');
    expect(report.limitesLacunes).toContain('biais');
    expect(report.rawFallback).toBeNull();
  });

  it('detects elevated confidence', () => {
    const { report } = parseHeadReport(wellFormedContent, 'rigueur');
    expect(report.niveauConfiance).toBe('eleve');
  });

  it('returns 0/5 sections and rawFallback for unstructured content', () => {
    const unstructured = `Voici mon analyse complète du curcuma. Les études montrent un effet modéré mais les preuves sont limitées.`;
    const { report, parsedSectionCount, missingSections } = parseHeadReport(unstructured, 'curiosite');
    expect(parsedSectionCount).toBe(0);
    expect(missingSections).toHaveLength(5);
    expect(report.rawFallback).toBe(unstructured);
    expect(report.objectifRecherche).toBe('(Section non trouvée)');
  });

  it('handles partial parsing (3/5 sections)', () => {
    const partial = `### 1. Objectif de recherche
Étudier le zinc.

### 3. Résultats
3 études trouvées.

### 4. Synthèse
Résultats prometteurs.

### 6. Niveau de confiance
Faible.`;

    const { report, parsedSectionCount, missingSections } = parseHeadReport(partial, 'transversalite');
    expect(parsedSectionCount).toBe(3);
    expect(missingSections).toContain('Stratégie de recherche');
    expect(missingSections).toContain('Limites et lacunes');
    expect(report.strategieRecherche).toBe('(Section non trouvée)');
    expect(report.resultats).toContain('3 études');
    expect(report.niveauConfiance).toBe('faible');
    expect(report.rawFallback).toBeNull(); // not total failure
  });

  it('detects néant in content', () => {
    const neantContent = `### 1. Objectif de recherche
Chercher X.

### 3. Résultats
Néant — aucun résultat pertinent.

### 4. Synthèse
Aucun résultat trouvé.

### 6. Niveau de confiance
Faible.`;

    const { report } = parseHeadReport(neantContent, 'rigueur');
    expect(report.neant).toBe(true);
  });

  it('works with ## headers (2 hashes)', () => {
    const twoHashes = `## 1. Objectif de recherche
Test objectif.

## 2. Stratégie de recherche
Test stratégie.

## 3. Résultats
Test résultats avec assez de contenu pour ne pas être néant.

## 4. Synthèse
Test synthèse.

## 5. Limites et lacunes
Test limites.

## 6. Niveau de confiance
Modéré.`;

    const { parsedSectionCount } = parseHeadReport(twoHashes, 'rigueur');
    expect(parsedSectionCount).toBe(5);
  });
});
