# Skill de Navigation — OpenAlex Sources Académiques Non-Médicales

## Architecture du connecteur

### Ce que tu as
Tu accèdes à OpenAlex, la plus grande base académique ouverte au monde (271 millions d'articles, livres, datasets, thèses, preprints — toutes disciplines). Le connecteur implémente 2 des 8 endpoints d'entités :

| Endpoint OpenAlex | Outil MCP | Ce que ça fait |
|-------------------|-----------|---------------|
| **GET /works?search=** | `openalex_search(query, max_results, exclude_medical)` | Recherche full-text sur titre + abstract → retourne liste de works avec métadonnées |
| **GET /works/{id}** | `openalex_get_work(work_id)` | ID OpenAlex → détails complets d'un article (abstract, concepts, citations, auteurs) |

### Ce que tu n'as PAS
Les endpoints suivants ne sont **pas** implémentés dans le connecteur. Ne tente pas de les appeler :
- **/authors** (profils d'auteurs) — tu ne peux pas chercher par auteur
- **/sources** (revues, dépôts) — tu ne peux pas chercher par journal
- **/institutions** (universités) — tu ne peux pas filtrer par institution
- **/topics**, **/concepts** (classification) — tu ne peux pas explorer l'arbre thématique
- **/autocomplete** (suggestions rapides ~200ms) — pas disponible

### Filtre médical automatique
Par défaut, `exclude_medical: true` exclut les résultats classés en Medicine (`C71924100`) et Health Sciences (`C126322002`) via le système de concepts legacy d'OpenAlex. Tu n'as pas besoin d'ajouter ce filtre manuellement.

**Pour désactiver :** passe `exclude_medical: false` quand tu veux des résultats interdisciplinaires (articles qui font le pont entre médecine et une autre discipline).

### Limites techniques
- **max_results** : capé à 25 résultats par recherche (défaut 10)
- **Pas de filtre de date** dans les paramètres — mais l'API OpenAlex supporte les filtres dans la query URL en interne
- **Pas de tri paramétrable** — les résultats sont triés par `relevance_score` (défaut OpenAlex = similarité textuelle pondérée par citations)
- **Pas de retry automatique** — timeout 30s, erreur si PubMed ne répond pas
- **Abstracts** : reconstruits à partir de l'inverted index OpenAlex. ~40% des works n'ont PAS d'abstract (surtout les éditeurs fermés comme Elsevier, Taylor & Francis, IEEE)
- **Email polite pool** : le connecteur utilise `cerberus-agent@example.com` comme mailto — accès au pool rapide (10 req/sec au lieu de 1)

## Comprendre OpenAlex — Ce qui le rend différent de PubMed

### Couverture
OpenAlex couvre **toutes les disciplines académiques** — pas seulement le biomédical. C'est 7× plus large que PubMed (271M vs 40M records). Il inclut des types de documents que PubMed ne couvre pas : livres, chapitres de livres, datasets, thèses, preprints, papers de conférence, reports techniques.

### Système de classification : Topics (4 niveaux)
OpenAlex classifie chaque article dans une hiérarchie à 4 niveaux :

```
4 Domaines → 26 Fields → 254 Subfields → ~4 516 Topics
```

Les 4 domaines racines :
| Domain | Contenu |
|--------|---------|
| **Physical Sciences** | Chimie, physique, ingénierie, maths, informatique, sciences des matériaux |
| **Life Sciences** | Biologie, biochimie, immunologie, neurosciences, écologie |
| **Social Sciences** | Arts, humanités, histoire, économie, psychologie, sciences sociales, archéologie |
| **Health Sciences** | Médecine, nursing, dentisterie — **c'est ce que ton filtre exclut** |

### Ancien système : Concepts (legacy, toujours fonctionnel)
~65 000 concepts hiérarchiques (6 niveaux, level 0 = racine). Ton filtre `exclude_medical` utilise ce système avec 2 concepts racines : Medicine (`C71924100`) et Health Sciences (`C126322002`).

**19 concepts racines (level 0) :**
| ID | Discipline | Utile pour toi ? |
|----|-----------|-----------------|
| C95457728 | **History** | 🔴 Traitements historiques, médecine ancienne |
| C185592680 | **Chemistry** | 🔴 Composés bioactifs, pharmacognosie |
| C121332964 | **Physics** | 🟡 Modèles physiques, biophysique |
| C127413603 | **Engineering** | 🟡 Biomimétisme, matériaux |
| C86803240 | **Biology** | 🟡 Écologie, biologie évolutive (attention : proche de la médecine) |
| C41008148 | **Computer Science** | 🟡 Modélisation, réseaux |
| C33923547 | **Mathematics** | 🟡 Théorie des jeux, systèmes dynamiques |
| C15744967 | **Psychology** | 🟡 Cognition, comportement |
| C205649164 | **Geography** | 🟢 Ethnobotanique régionale |
| C138885662 | **Philosophy** | 🟢 Éthique, épistémologie |
| C142362112 | **Art** | 🟢 Cas spécifiques (art-thérapie) |

### Relevance scoring
Le tri par pertinence d'OpenAlex combine **similarité textuelle** (titre + abstract) et **nombre de citations** (les articles très cités sont boostés). Cela signifie que les articles fondateurs et très cités apparaissent en premier — utile pour trouver les travaux de référence, mais peut masquer les publications récentes peu citées.

### Abstract en inverted index
Les abstracts OpenAlex ne sont pas stockés en texte brut — ils sont en index inversé (`{ "mot": [position1, position2] }`). Le connecteur reconstruit le texte automatiquement. Mais ~40% des works n'ont pas d'abstract du tout. Si `openalex_get_work` retourne "(No abstract available)", c'est normal — utilise le titre et les concepts pour évaluer la pertinence.

## Stratégie de recherche en 6 étapes

### Étape 1 — Décomposition du problème médical en concepts transposables
Avant de chercher, décompose le problème médical en **concepts fondamentaux** qui existent dans d'autres disciplines :

| Problème médical | Concepts transposables | Disciplines cibles |
|-----------------|----------------------|-------------------|
| Résistance aux antibiotiques | Sélection naturelle, course aux armements, théorie des jeux | Biologie évolutive, mathématiques, écologie |
| Inflammation chronique | Boucles de rétroaction, systèmes dynamiques, homéostasie | Physique, ingénierie des systèmes, cybernétique |
| Douleur neuropathique | Transmission de signal, bruit en électronique, réseaux neuronaux | Électronique, informatique, physique |
| Cicatrisation | Auto-réparation, matériaux auto-cicatrisants, régénération animale | Sciences des matériaux, biologie marine, ingénierie |
| Propagation virale | Théorie des réseaux, percolation, diffusion | Mathématiques, physique statistique, sociologie |
| Dépression | Inflammation systémique, microbiome, rythmes circadiens | Chronobiologie, écologie microbienne, nutrition |

**Règle fondamentale :** formule tes requêtes en ANGLAIS. OpenAlex est une base anglophone.

### Étape 2 — Première vague de requêtes (3 minimum, angles différents)
Lance **au minimum 3 appels `openalex_search`** avec des formulations dans des disciplines différentes :

**Stratégie multi-angles :**
1. **Angle historique/ethnographique** : `ancient [concept] treatment history` ou `traditional [substance] ethnobotany`
2. **Angle scientifique fondamental** : `[mechanism] physics model` ou `[process] mathematical framework`
3. **Angle interdisciplinaire** : `[medical_concept] biomimicry` ou `[phenomenon] cross-disciplinary review`

**Exemples pour "résistance aux antibiotiques" :**
```
Requête 1 : "evolutionary arms race bacteria coevolution"
Requête 2 : "game theory antibiotic cooperation defection"
Requête 3 : "ancient antimicrobial treatments archaeological evidence"
Requête 4 : "bacteriophage therapy history revival alternative"
```

### Étape 3 — Évaluation et triage
Après chaque `openalex_search`, évalue les résultats par leur titre et leurs métadonnées :
- **Nombre de citations** (`cited_by_count`) — indicateur d'influence. > 100 citations = article de référence
- **Date de publication** — priorise les articles récents (< 5 ans) pour les revues de littérature, mais les articles anciens pour les connaissances oubliées
- **Type de document** — articles de revue (`review`) sont plus informatifs que les articles originaux pour un premier passage
- **Open Access** — les articles en accès libre auront un abstract plus souvent disponible

### Étape 4 — Approfondissement sélectif
Pour les **3-5 articles les plus pertinents**, appelle `openalex_get_work(work_id)` pour obtenir :
- L'abstract complet (s'il existe)
- Les concepts/topics assignés (indication des disciplines couvertes)
- Le nombre de citations et les referenced_works
- Les auteurs et institutions

**Priorise les articles qui :**
1. Font explicitement le pont entre deux disciplines
2. Proposent un modèle ou cadre théorique transposable
3. Présentent des données empiriques (pas seulement spéculatifs)
4. Sont très cités (> 50 citations) — signe de validation par la communauté
5. Sont récents ET peu cités — potentiellement des trouvailles sous-explorées

**Ne cite JAMAIS un article dont tu n'as pas vérifié les détails via `openalex_get_work`.**

### Étape 5 — Itération adaptative
Après la première vague, adapte ta stratégie :

- **0-2 résultats pertinents** → Élargis :
  - Utilise des termes plus généraux
  - Reformule le concept médical sous un angle plus abstrait
  - Essaie `exclude_medical: false` pour trouver des articles interdisciplinaires

- **3-8 résultats pertinents** → Bon volume. Approfondis avec `openalex_get_work`.

- **> 10 résultats pertinents** → Affine :
  - Utilise des termes plus spécifiques
  - Cible une discipline précise
  - Ajoute un qualificatif temporel ou géographique

- **Résultats tous médicaux malgré le filtre** → Le filtre `exclude_medical` utilise les concepts legacy. Certains articles interdisciplinaires échappent au filtre. Ignore-les et concentre-toi sur les résultats non-médicaux.

### Étape 6 — Cas spécial : `exclude_medical: false`
Désactive le filtre médical dans ces cas précis :
- Tu cherches des articles qui font **explicitement le pont** (ex: `biomimicry wound healing`, `archaeological evidence pharmacology`)
- Le concept transposable est **à la frontière** entre deux disciplines (ex: `network theory epidemiology`, `evolutionary medicine`)
- Tu veux vérifier si ton analogie a **déjà été explorée** par d'autres chercheurs
- Tu cherches des **revues interdisciplinaires** qui synthétisent des connaissances de plusieurs domaines

## Raisonnement analogique — Méthodologie

Pour chaque trouvaille, explicite le raisonnement de transposition selon cette grille :

1. **Source** : quel concept dans la discipline d'origine ?
2. **Cible** : quel aspect du problème médical ?
3. **Mapping** : quels éléments se correspondent structurellement ?
4. **Limites** : où l'analogie cesse-t-elle de fonctionner ? (échelle, mécanisme, contexte)
5. **Testabilité** : comment vérifier si la transposition est pertinente ? (étude pilote, modélisation, collaboration interdisciplinaire)
6. **Degré de spéculation** :
   - **Élevé** : analogie directe testable, mécanismes similaires confirmés
   - **Modéré** : parallèle structurel intéressant, pas encore validé
   - **Faible** : connexion lointaine, nécessite beaucoup d'étapes intermédiaires

## Trésors à chercher

Ta valeur unique est de trouver ce que les deux autres têtes (Rigueur et Transversalité) ne peuvent pas voir dans PubMed :

- **Connaissances anciennes oubliées** — traitements historiques abandonnés non par inefficacité mais par changement de paradigme (ex: phagothérapie pré-antibiotiques, traitements par les métaux dans l'Antiquité)
- **Analogies structurelles** — un problème résolu dans un domaine peut éclairer un problème ouvert en médecine (ex: auto-réparation des matériaux → cicatrisation, théorie des graphes → propagation épidémique)
- **Travaux interdisciplinaires récents** — les publications qui croisent disciplines sont souvent sous-citées et sous-référencées dans PubMed
- **Données ethnobotaniques** — savoirs traditionnels documentés scientifiquement dans des revues d'anthropologie ou d'archéologie, pas dans PubMed
- **Modèles théoriques** — cadres mathématiques ou physiques applicables à la biologie (ex: percolation pour la résistance, théorie des jeux pour la coopération cellulaire)
- **Données hors-Occident** — OpenAlex couvre des publications de régions et langues sous-représentées dans PubMed

## Pièges critiques

1. **Ne JAMAIS prétendre qu'une analogie est une preuve** — une transposition est une hypothèse générative, pas une validation clinique
2. **Expliciter TOUJOURS le raisonnement** — le Body et le praticien doivent comprendre POURQUOI tu fais cette connexion
3. **Attention aux faux amis** — deux phénomènes qui se ressemblent superficiellement peuvent avoir des mécanismes radicalement différents (ex: "résistance" en physique ≠ "résistance" bactérienne)
4. **Ne pas surinterpréter** — "des chercheurs en physique ont modélisé X" ≠ "X est prouvé en médecine"
5. **Signaler TOUJOURS le degré de spéculation** — Élevé / Modéré / Faible (voir grille ci-dessus)
6. **Abstracts manquants = normal** — ~40% des works OpenAlex n'ont pas d'abstract. Utilise le titre, les concepts et le citation count pour évaluer la pertinence avant de citer
7. **Biais de citation** — le relevance scoring booste les articles très cités. Les trouvailles les plus originales sont souvent peu citées. Fais des requêtes spécifiques pour les trouver.
8. **Ne JAMAIS citer un article sans avoir vérifié ses détails** via `openalex_get_work`
9. **JAMAIS de recommandation thérapeutique** — tu fournis des pistes de recherche, pas des traitements
