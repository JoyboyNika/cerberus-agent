# Skill de Navigation — Semantic Scholar (Tête Curiosité)

## Architecture du connecteur

### Ce que tu as
Semantic Scholar est une base de ~220 millions d'articles académiques avec des fonctionnalités IA uniques (résumés TLDR, embeddings, recommandations). Le connecteur implémente :

| Endpoint S2 | Outil MCP | Ce que ça fait |
|-------------|-----------|---------------|
| **GET /paper/search** | `s2_search(query, max_results, fields_of_study)` | Recherche par pertinence → articles avec métadonnées |
| **GET /paper/{id}** | `s2_get_paper(paper_id)` | Détails complets d'un article (abstract, TLDR, citations, types) |
| **GET /paper/{id}/citations** | `s2_citations(paper_id)` | Articles qui citent cet article |
| **GET /paper/{id}/references** | `s2_references(paper_id)` | Références bibliographiques de cet article |

### Ce que tu n'as PAS
- **/paper/search/bulk** (recherche booléenne avancée avec Lucene) — pas implémenté
- **/recommendations** (recommandations multi-seeds) — pas implémenté
- **/author/search** — pas implémenté
- **Embeddings SPECTER** — pas récupérables via le connecteur

### Identifiants acceptés
S2 accepte plusieurs formats d'identifiant pour `/paper/{id}` :
- `PMID:33264437` — pont direct avec PubMed
- `DOI:10.1056/NEJMoa2034577` — identifiant universel
- `ARXIV:2106.15928` — articles arXiv
- `CorpusId:215416146` — ID interne S2
- SHA du papier (ID natif S2)

### Limites techniques
- **Rate limit** : 1 req/sec avec clé API (pool partagé sans clé, instable)
- **max_results** : 100 par page, max 1 000 résultats totaux pour `/search`
- **TLDR disponible** pour ~60M articles (principalement CS, bio, médecine)
- **Abstracts parfois manquants** (restrictions éditeurs)
- **Pas de full text** — titre + abstract seulement

## Fonctionnalités uniques (ce que ni PubMed ni OpenAlex n'ont)

### TLDR — Résumés IA d'une phrase
~60M articles ont un résumé TLDR généré par IA. C'est un condensé d'une phrase de l'article entier. **Utilise-le pour le triage rapide** — lis le TLDR avant de décider si l'article mérite un approfondissement.

### influentialCitationCount
S2 classifie les citations par ML : une citation "influente" signifie que l'article citant utilise significativement le travail cité (pas juste une mention en passant). **Un article avec 50 citations dont 15 influentes est plus important qu'un article avec 200 citations dont 3 influentes.**

### Filtres par type de publication
S2 propose 12 types de publication, dont des types médicaux spécifiques :
- `MetaAnalysis`, `Review`, `ClinicalTrial` — directement utiles pour l'EBM
- `JournalArticle`, `Conference`, `Book` — types généraux
- `CaseReport`, `Editorial`, `Letter` — types secondaires

### Filtres par domaine (fieldsOfStudy)
23 domaines disponibles dont : Medicine, Biology, Chemistry, Physics, Computer Science, Mathematics, Psychology, History, Philosophy, Art, Engineering, Environmental Science, Geography, Geology, Materials Science, Political Science, Sociology, Economics, Business, Linguistics.

## Stratégie de recherche en 4 étapes

### Étape 1 — Recherche textuelle large
Formule ta requête en anglais. Le moteur de S2 est ML-based (pas booléen par défaut) — des requêtes en langage naturel fonctionnent bien :
```
"evolutionary arms race antibiotic resistance"
"biomimicry self-healing materials wound repair"
"ethnobotany traditional antimicrobial plants"
```

### Étape 2 — Filtrage par domaine
Exclus la médecine si tu cherches des articles non-médicaux. Mais S2 est particulièrement utile pour les articles **interdisciplinaires** — ceux qui sont classés dans 2+ domaines.

Pour trouver des articles interdisciplinaires pertinents, cherche AVEC le domaine médecine mais trie par `influentialCitationCount` — les articles les plus cités de manière influente dans un contexte cross-domain sont tes cibles.

### Étape 3 — Navigation par citations
C'est la **force unique** de S2 par rapport à OpenAlex. Quand tu trouves un bon article :
1. Appelle `s2_references(paper_id)` — que cite cet article ? (remonter dans le temps)
2. Appelle `s2_citations(paper_id)` — qui cite cet article ? (avancer dans le temps)
3. Cherche les **citation influentes** dans les résultats — ce sont les vrais héritiers intellectuels

Ce pattern de navigation "en étoile" (un article central → ses références → ses citations) est le moyen le plus efficace de cartographier un domaine de recherche.

### Étape 4 — Pont PMID
Quand tu trouves un article pertinent sur S2 qui a un PMID, tu peux le transmettre au Body pour que la tête Rigueur l'approfondisse via PubMed. C'est le **pont interdisciplinaire** : Curiosité découvre via S2, Rigueur vérifie via PubMed.

## Pièges à éviter

- **Ne confonds pas citation count et qualité** — un article très cité peut être cité pour être critiqué
- **TLDR n'est pas un abstract** — c'est un résumé ML d'une phrase, pas un condensé rédigé par l'auteur
- **Vérifie toujours les détails** via `s2_get_paper` avant de citer
- **Attention au biais CS** — S2 a été créé par Allen AI, il a une meilleure couverture en informatique qu'en humanités
- **JAMAIS de recommandation thérapeutique** — tu fournis des pistes de recherche
