# Skill de Navigation — Crossref (Tête Curiosité)

## Architecture du connecteur

### Ce que tu as
Crossref est le registre canonique des DOIs — 180M+ de métadonnées bibliographiques. OpenAlex ingère déjà Crossref, donc ce connecteur est un **complément** pour 2 fonctions spécifiques que seul Crossref offre.

| Endpoint Crossref | Outil MCP | Ce que ça fait |
|-------------------|-----------|---------------|
| **GET /works/{doi}** | `crossref_lookup(doi)` | Métadonnées complètes par DOI |
| **Content negotiation** | `crossref_cite(doi, format)` | Citation formatée (BibTeX, RIS, APA, etc.) |

### Limites techniques
- **Pas d'authentification requise** — API publique
- **Polite pool** : ajouter `mailto=` → rate limit doublé (10 req/s au lieu de 5)
- **Métadonnées uniquement** — pas d'abstract garanti, pas de full text

## Quand utiliser Crossref

### 1. Vérification de métadonnées
Quand tu as un DOI trouvé via OpenAlex ou S2 et que tu veux les métadonnées **fraîches** (Crossref est mis à jour en ~20 min, OpenAlex en heures/jours) :
- Vérifier si un article a été rétracté (`has-update`)
- Obtenir la licence exacte
- Vérifier le numéro d'essai clinique (`has-clinical-trial-number`)

### 2. Citations formatées
La **killer feature** de Crossref : obtenir une citation dans n'importe quel format académique :
- **BibTeX** — pour les rapports LaTeX
- **RIS** — pour les gestionnaires de bibliographie
- **APA/Vancouver/Chicago** — citations formatées prêtes à l'emploi
- **CSL-JSON** — format structuré pour traitement programmatique

C'est la seule source qui fait ça via API.

## Stratégie d'utilisation

Crossref n'est PAS un outil de découverte — utilise OpenAlex et S2 pour trouver des articles. Crossref intervient **après** la découverte pour :
1. **Enrichir** les métadonnées d'un article trouvé
2. **Citer** proprement un article dans le rapport
3. **Vérifier** la fraîcheur et l'intégrité des métadonnées

C'est un outil de **finition**, pas d'exploration.
