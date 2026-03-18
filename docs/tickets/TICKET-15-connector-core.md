# Ticket #15 — Connecteur MCP : CORE (Tête Curiosité)

## Type
Implémentation / Nouveau connecteur MCP

## Priorité
🟡 Moyenne — Seule source de full text via API.

## Fichier à créer : `src/mcp/core-connector.ts`

Extend `McpConnector`.

## Base URL
```
https://api.core.ac.uk/v3/
```
Auth : `?apiKey=${process.env.CORE_API_KEY}`

## Outils MCP à exposer (3)

### 1. `core_search`
- **Description** : "Search CORE for open access academic articles. Unlike OpenAlex, CORE searches the FULL TEXT of articles, not just titles and abstracts. Supports Elasticsearch syntax."
- **Paramètres** :
  - `query` (string, required) — syntaxe Elasticsearch :
    - `fullText:(term)` — dans le texte intégral
    - `title:(term)` — dans le titre
    - Opérateurs AND/OR/NOT
    - `yearPublished:[2020 TO 2025]` — plage d'années
    - `language.code:en` — langue
  - `max_results` (number, optional, default 10, max 100)
- **Endpoint** : `GET /search/works/{encodedQuery}?limit=...&exclude=fullText&apiKey=...`
- ⚠️ **TOUJOURS** ajouter `&exclude=fullText` dans les résultats de recherche (trop volumineux)
- **Retourner** : pour chaque work, un objet avec id, title, abstract, doi, yearPublished, language.code, downloadUrl, dataProvider.name

### 2. `core_get_work`
- **Description** : "Get full details of a CORE article including its complete text. WARNING: Full text can be very large (50KB+)."
- **Paramètres** :
  - `core_id` (string, required)
- **Endpoint** : `GET /works/{id}?apiKey=...`
- **Retourner** : title, abstract, fullText (complet cette fois), doi, yearPublished, authors, downloadUrl

### 3. `core_find_fulltext`
- **Description** : "Find the full text of an article by its DOI. Useful when you have a DOI from PubMed or OpenAlex and want to read the complete article."
- **Paramètres** :
  - `doi` (string, required)
- **Endpoint** : `GET /discover?doi={encodedDoi}&apiKey=...`
- **Retourner** : id, title, downloadUrl, fullTextLink

## Rate limit
5 requêtes / 10 secondes (free tier). Variable env : `CORE_API_KEY` (gratuite, inscription requise).

## Câblage
```typescript
import { CoreConnector } from './mcp/core-connector.js';
registry.registerForHead('curiosite', new CoreConnector());
```

## Critères d'acceptation
1️⃣ `core_search` retourne des articles avec exclusion du fullText dans les résultats
2️⃣ `core_get_work` retourne le texte intégral complet
3️⃣ `core_find_fulltext` résout un DOI en full text
4️⃣ Tous les outils utilisent `fetchWithTimeout()` avec check `res.ok`
5️⃣ Connecteur enregistré pour `curiosite` dans `initRegistry()`
6️⃣ `npm run build` sans erreur
