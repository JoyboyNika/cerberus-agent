# Skill de Navigation — CORE (Tête Curiosité)

## Architecture du connecteur

### Ce que tu as
CORE est la plus grande collection d'articles académiques en accès libre au monde (~46M articles avec full text sur 431M de métadonnées). Sa différence fondamentale : **la recherche porte sur le texte intégral des articles**, pas seulement titre + abstract.

| Endpoint CORE | Outil MCP | Ce que ça fait |
|---------------|-----------|---------------|
| **GET /search/works/{query}** | `core_search(query, max_results)` | Recherche full text dans les articles |
| **GET /works/{id}** | `core_get_work(core_id)` | Détails complets avec full text |
| **GET /discover** | `core_find_fulltext(doi)` | Trouver le full text à partir d'un DOI |

### Ce que tu n'as PAS
- **/outputs/{id}/download** (téléchargement PDF) — pas implémenté
- **/search/data-providers** — pas implémenté
- **Batch /works** — pas implémenté

### Limites techniques
- **Clé API requise** (gratuite, inscription sur core.ac.uk)
- **Rate limit** : 5 requêtes / 10 secondes (free tier)
- **Full text volumineux** — un article peut faire 50KB+. Le connecteur exclut le full text par défaut dans les résultats de recherche
- **Pas de données de citations** — CORE ne track pas les citations (utilise S2 ou OpenAlex pour ça)
- **Qualité variable** — les articles viennent de 14 000+ dépôts institutionnels avec des standards différents
- **Pas de taxonomie structurée** — pas de concepts/topics comme OpenAlex

## Syntaxe de recherche — Elasticsearch

CORE utilise une syntaxe Elasticsearch. C'est plus puissant que la recherche simple d'OpenAlex :

### Recherche par champ
```
fullText:(CRISPR gene therapy)           — dans le texte intégral
title:(randomized controlled trial)       — dans le titre seulement
abstract:(inflammation biomarkers)        — dans l'abstract seulement
authors:(Smith)                           — par auteur
doi:"10.1234/example"                     — par DOI exact
```

### Opérateurs booléens
```
diabetes AND treatment AND (metformin OR insulin)
"placebo-controlled trial"                — phrase exacte
neuro*                                    — wildcard
cancer -prostate                          — exclusion
```

### Filtres
```
yearPublished:2024                        — année exacte
yearPublished:[2020 TO 2025]              — plage d'années
language.code:en                          — langue
```

### Combinaison (le plus puissant)
```
fullText:("gut microbiome" AND "immunotherapy") AND yearPublished:[2023 TO 2026] AND language.code:en
```

## Quand utiliser CORE plutôt qu'OpenAlex

| Situation | Utilise CORE | Utilise OpenAlex |
|-----------|-------------|------------------|
| Tu cherches un passage précis dans le corps d'un article | ✅ | ❌ (titre+abstract seulement) |
| Tu as un DOI et tu veux le full text | ✅ `core_find_fulltext(doi)` | ❌ |
| Tu cherches dans la littérature grise (thèses, rapports) | ✅ | ⚠️ Limité |
| Tu veux explorer par concepts/topics | ❌ | ✅ |
| Tu veux les citations d'un article | ❌ | ✅ |
| Tu veux trier par nombre de citations | ❌ | ✅ |

## Stratégie de recherche

### Étape 1 — Recherche full text ciblée
La force de CORE est la recherche dans le **corps** des articles. Utilise ça quand :
- Un concept est mentionné dans le texte mais pas dans le titre/abstract
- Tu cherches des données spécifiques (concentrations, doses, résultats chiffrés)
- Tu cherches des mentions de substances/composés dans des articles non-spécialisés

### Étape 2 — Combinaison avec OpenAlex
CORE et OpenAlex sont complémentaires :
1. **Découvre** un article pertinent via OpenAlex (par concepts, citations)
2. **Récupère le full text** via CORE (`core_find_fulltext(doi)`)
3. **Recherche dans le full text** des mentions spécifiques

### Étape 3 — Littérature grise
CORE excelle pour les sources que PubMed et OpenAlex ne couvrent pas bien :
- Thèses de doctorat (souvent des données originales non publiées ailleurs)
- Working papers et rapports techniques
- Articles de dépôts institutionnels non indexés par les grands éditeurs

## Pièges à éviter

- **Le full text peut être un scan sans OCR** — certains PDFs sont des images, pas du texte cherchable
- **Pas de peer review garanti** — la littérature grise n'est pas toujours validée par les pairs
- **Qualité des métadonnées variable** — certains dépôts ont des métadonnées incomplètes
- **Ne confonds pas volume et qualité** — 46M articles en accès libre ≠ 46M articles de qualité
- **Toujours vérifier la source** — regarde le `dataProvider` pour évaluer la fiabilité
