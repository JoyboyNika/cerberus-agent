# Ticket #16 — Connecteur MCP : Crossref (Tête Curiosité)

## Type
Implémentation / Connecteur MCP minimal

## Priorité
🟢 Basse — OpenAlex ingère déjà Crossref. Valeur résiduelle : content negotiation.

## Fichier à créer : `src/mcp/crossref-connector.ts`

Extend `McpConnector`.

## Base URLs
```
https://api.crossref.org/     (métadonnées)
https://doi.org/               (content negotiation)
```
Pas d'authentification. Polite pool via `?mailto=cerberus-agent@example.com`.

## Outils MCP à exposer (2)

### 1. `crossref_lookup`
- **Description** : "Look up article metadata by DOI from the canonical Crossref registry. Fresher than OpenAlex (20min vs hours). Checks for retractions and clinical trial numbers."
- **Paramètres** :
  - `doi` (string, required)
- **Endpoint** : `GET https://api.crossref.org/works/{doi}?mailto=cerberus-agent@example.com`
- **Retourner** : title (premier élément du tableau title), authors (liste de {given, family}), published-date-parts, container-title, type, is-referenced-by-count, license (url + content-version), clinical-trial-number (si présent), update-to (rétractations/corrections si présent)

### 2. `crossref_cite`
- **Description** : "Get a formatted citation for an article by DOI. Supports BibTeX, RIS, APA, Vancouver, and other citation formats."
- **Paramètres** :
  - `doi` (string, required)
  - `format` (string, optional, default "bibtex")
    - Valeurs acceptées : "bibtex", "ris", "apa", "vancouver", "chicago"
- **Endpoint** : `GET https://doi.org/{doi}`
- **Headers Accept** selon le format :
  - bibtex → `application/x-bibtex`
  - ris → `application/x-research-info-systems`
  - apa → `text/x-bibliography; style=apa`
  - vancouver → `text/x-bibliography; style=vancouver`
  - chicago → `text/x-bibliography; style=chicago-fullnote-bibliography`
- **Important** : suivre les redirects (`redirect: 'follow'`)
- **Retourner** : la citation formatée en texte brut

## Rate limit
10 req/s avec polite pool (mailto).

## Câblage
```typescript
import { CrossrefConnector } from './mcp/crossref-connector.js';
registry.registerForHead('curiosite', new CrossrefConnector());
```

## Critères d'acceptation
1️⃣ `crossref_lookup` retourne les métadonnées par DOI
2️⃣ `crossref_cite` retourne une citation formatée (BibTeX par défaut)
3️⃣ Tous les outils utilisent `fetchWithTimeout()` avec check `res.ok`
4️⃣ Connecteur enregistré pour `curiosite` dans `initRegistry()`
5️⃣ `npm run build` sans erreur
