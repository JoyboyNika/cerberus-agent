# Ticket #13 — Connecteur MCP : Semantic Scholar (Tête Curiosité)

## Type
Implémentation / Nouveau connecteur MCP

## Priorité
🟠 Haute — TLDR IA, citations influentes, navigation par citations.

## Fichier à créer : `src/mcp/semantic-scholar-connector.ts`

Extend `McpConnector`.

## Base URL
```
https://api.semanticscholar.org/graph/v1
```
Headers : `x-api-key: ${process.env.S2_API_KEY}` (optionnel mais recommandé)

## Outils MCP à exposer (4)

### 1. `s2_search`
- **Description** : "Search Semantic Scholar for academic papers. Returns titles, TLDR summaries, citation counts, and publication types."
- **Paramètres** :
  - `query` (string, required)
  - `max_results` (number, optional, default 10, max 100)
  - `fields_of_study` (string, optional) — ex: "Medicine", "Biology", "Chemistry"
  - `year` (string, optional) — ex: "2020-2025", "2023-"
  - `publication_types` (string, optional) — ex: "Review,MetaAnalysis,ClinicalTrial"
- **Endpoint** : `GET /paper/search`
- **Query params** :
  - `query` = query
  - `fields` = `paperId,externalIds,title,abstract,tldr,year,citationCount,influentialCitationCount,publicationTypes,openAccessPdf`
  - `limit` = max_results
  - `fieldsOfStudy` = fields_of_study (si fourni)
  - `year` = year (si fourni)
  - `publicationTypes` = publication_types (si fourni)
- **Retourner** : pour chaque paper, un objet avec paperId, doi, pmid (depuis externalIds), title, abstract, tldr (texte d'une phrase), year, citationCount, influentialCitationCount, publicationTypes, openAccessPdf url

### 2. `s2_get_paper`
- **Description** : "Get full details of a paper by its Semantic Scholar ID, DOI (DOI:...), or PMID (PMID:...). Returns abstract, TLDR, authors, citations."
- **Paramètres** :
  - `paper_id` (string, required) — accepte : SHA, `DOI:10.xxx`, `PMID:12345`, `ARXIV:2106.xxx`
- **Endpoint** : `GET /paper/{paper_id}`
- **Query params** :
  - `fields` = `paperId,externalIds,title,abstract,tldr,year,citationCount,influentialCitationCount,publicationTypes,s2FieldsOfStudy,openAccessPdf,authors`

### 3. `s2_citations`
- **Description** : "Get papers that cite a given paper. Useful for forward navigation in the citation graph."
- **Paramètres** :
  - `paper_id` (string, required)
  - `max_results` (number, optional, default 20, max 100)
- **Endpoint** : `GET /paper/{paper_id}/citations`
- **Query params** :
  - `fields` = `paperId,title,year,citationCount,influentialCitationCount`
  - `limit` = max_results
- **Retourner** : liste de {citingPaper: {paperId, title, year, citationCount, influentialCitationCount}}

### 4. `s2_references`
- **Description** : "Get papers referenced by a given paper. Useful for backward navigation in the citation graph."
- **Paramètres** :
  - `paper_id` (string, required)
  - `max_results` (number, optional, default 20, max 100)
- **Endpoint** : `GET /paper/{paper_id}/references`
- **Query params** : mêmes que citations
- **Retourner** : liste de {citedPaper: {paperId, title, year, citationCount, influentialCitationCount}}

## Rate limit
1 RPS avec clé API. Variable env : `S2_API_KEY`. Si pas de clé, pool partagé (~1000 RPS global, instable).

## Câblage
```typescript
import { SemanticScholarConnector } from './mcp/semantic-scholar-connector.js';
registry.registerForHead('curiosite', new SemanticScholarConnector());
```

## Critères d'acceptation
1️⃣ `s2_search` retourne des articles avec TLDR et influentialCitationCount
2️⃣ `s2_get_paper` accepte `PMID:` et `DOI:` comme identifiants
3️⃣ `s2_citations` et `s2_references` retournent le graphe de citations
4️⃣ Tous les outils utilisent `fetchWithTimeout()` avec check `res.ok`
5️⃣ Connecteur enregistré pour `curiosite` dans `initRegistry()`
6️⃣ `npm run build` sans erreur

## Hors scope
- /paper/search/bulk (recherche booléenne Lucene)
- /recommendations (recommandations multi-seeds)
- Embeddings SPECTER
