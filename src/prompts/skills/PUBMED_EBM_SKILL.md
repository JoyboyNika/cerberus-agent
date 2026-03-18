# Skill de Navigation — PubMed Evidence-Based Medicine

## Architecture du connecteur

### Ce que tu as
Tu accèdes à PubMed via les E-utilities du NCBI (National Center for Biotechnology Information). Le connecteur implémente 3 des 9 E-utilities :

| E-utility | Outil MCP | Ce que ça fait |
|-----------|-----------|---------------|
| **ESearch** | `pubmed_search(query, max_results)` | Recherche texte → retourne liste de PMIDs + résumés courts |
| **ESummary** | *(appelé en interne par pubmed_search)* | PMIDs → titre, journal, date, auteurs |
| **EFetch** | `pubmed_fetch_abstract(pmid)` | PMID → abstract complet, titre, auteurs, journal, année |

### Ce que tu n'as PAS
Les E-utilities suivantes ne sont **pas** implémentées dans le connecteur. Ne tente pas de les appeler :
- **ELink** (articles liés/citations) — tu ne peux pas naviguer de proche en proche
- **ESpell** (correction orthographique) — vérifie toi-même l'orthographe des termes MeSH
- **EInfo** (statistiques de la base) — pas nécessaire pour la recherche
- **EPost/EGQuery/ECitMatch** — pas pertinents pour ton usage

### Filtres automatiques
Tes résultats sont **automatiquement filtrés** par le connecteur sur les types de publication EBM :
```
"systematic review"[pt] OR "meta-analysis"[pt] OR "randomized controlled trial"[pt] OR "practice guideline"[pt]
```
Tu n'as PAS besoin d'ajouter ces filtres dans ta requête — ils sont injectés systématiquement. Ta requête est combinée avec eux : `(ta_requête) AND (filtres_EBM)`.

### Limites techniques
- **max_results** : capé à 20 résultats par recherche
- **Pas de filtre de date** dans les paramètres de l'outil — mais tu PEUX utiliser les field tags PubMed dans ta query (voir ci-dessous)
- **Pas de tri paramétrable** — les résultats sont triés par relevance (défaut PubMed)
- **Pas de retry automatique** — si PubMed retourne une erreur, l'appel échoue (timeout 30s)
- **Abstracts structurés** — les articles EBM ont souvent des abstracts en 4 sections (Objective/Methods/Results/Conclusion). Le connecteur capture toutes les sections.

## Syntaxe PubMed — Field Tags

PubMed utilise des **field tags** entre crochets pour cibler ta recherche. Tu peux les utiliser directement dans ta query `pubmed_search`. C'est ta principale technique de navigation avancée.

### Tags essentiels

| Tag | Signification | Exemple |
|-----|--------------|---------|
| `[mesh]` | Terme MeSH (vocabulaire contrôlé, avec explosion hiérarchique) | `osteoarthritis[mesh]` |
| `[mesh:noexp]` | Terme MeSH SANS explosion (pas de sous-catégories) | `osteoarthritis, knee[mesh:noexp]` |
| `[tiab]` | Titre + Abstract (mots-clés libres) | `curcumin[tiab]` |
| `[ti]` | Titre seulement (très ciblé) | `systematic review[ti]` |
| `[tw]` | Textwords (titre + abstract + MeSH + substances) | `inflammation[tw]` |
| `[pt]` | Type de publication | `meta-analysis[pt]` |
| `[pdat]` | Date de publication (YYYY ou YYYY/MM ou YYYY/MM/DD) | `2020:2025[pdat]` |
| `[dp]` | Date de publication (format alternatif) | `2023[dp]` |
| `[la]` | Langue | `english[la]` |
| `[sb]` | Subset (medline, free full text, preprint) | `medline[sb]` |
| `[au]` | Auteur | `smith j[au]` |

### Opérateurs booléens
- **AND** — restreint (les deux termes doivent être présents)
- **OR** — élargit (l'un ou l'autre)
- **NOT** — exclut (attention : peut éliminer des résultats pertinents)
- Les **guillemets** forcent l'expression exacte : `"rheumatoid arthritis"`
- Les **parenthèses** groupent : `(curcumin OR turmeric) AND osteoarthritis`

### Qualificateurs MeSH (subheadings)
Tu peux affiner un terme MeSH avec un qualificateur séparé par `/` :
- `osteoarthritis/drug therapy` — seulement le traitement médicamenteux
- `curcumin/therapeutic use` — seulement l'usage thérapeutique
- `diabetes mellitus/diet therapy` — seulement la diétothérapie

Qualificateurs fréquents en EBM : `/therapy`, `/drug therapy`, `/prevention and control`, `/diagnosis`, `/epidemiology`, `/adverse effects`, `/mortality`.

## Stratégie de recherche en 5 étapes

### Étape 1 — Cadre PICO
Avant toute recherche, décompose la question médicale :
- **P** (Patient/Population) : qui est concerné ? (âge, sexe, condition)
- **I** (Intervention) : quel traitement, exposition, test diagnostique ?
- **C** (Comparateur) : par rapport à quoi ? (placebo, traitement standard, autre intervention)
- **O** (Outcome) : quel résultat mesurable ? (mortalité, douleur, qualité de vie, biomarqueur)

Exemple : "La curcumine aide-t-elle contre l'arthrose du genou ?"
→ P: patients arthrose du genou, I: curcumine/curcuma, C: placebo ou AINS, O: douleur (VAS/WOMAC), fonction

### Étape 2 — Première requête avec MeSH
Formule ta requête en combinant termes MeSH et field tags :

**Bonne requête :**
```
curcumin[mesh] AND osteoarthritis, knee[mesh]
```

**Requête enrichie avec date :**
```
curcumin[mesh] AND osteoarthritis[mesh] AND 2019:2025[pdat]
```

**Requête avec qualificateur :**
```
curcumin/therapeutic use[mesh] AND osteoarthritis/drug therapy[mesh]
```

**Règles de formulation :**
- TOUJOURS en anglais (PubMed est anglophone)
- Préfère `[mesh]` pour les concepts médicaux connus (plus précis que texte libre)
- Utilise `[tiab]` pour les termes récents pas encore dans MeSH ou les noms de molécules spécifiques
- Combine MeSH et texte libre avec OR pour couvrir large : `(curcumin[mesh] OR curcumin[tiab] OR turmeric[tiab])`

### Étape 3 — Itération obligatoire
Tu DOIS faire **au minimum 2 appels `pubmed_search`** avec des formulations différentes. Après le premier appel :

- **0-2 résultats** → Élargis :
  - Retire un terme PICO (garde seulement I + P)
  - Utilise `[tiab]` au lieu de `[mesh]`
  - Ajoute des synonymes avec OR
  - Retire le filtre de date si tu en avais un
  
- **3-10 résultats** → Bon volume. Passe à l'étape 4.

- **> 10 résultats** → Affine :
  - Ajoute un qualificateur MeSH
  - Restreins avec `AND 2020:2025[pdat]`
  - Ajoute le comparateur PICO
  - Utilise `[mesh:noexp]` au lieu de `[mesh]` pour éviter l'explosion hiérarchique

- **Résultats non pertinents** → Reformule :
  - Change les termes MeSH (consulte mentalement l'arbre MeSH)
  - Essaie une formulation PICO différente
  - Ajoute NOT pour exclure les hors-sujet évidents

### Étape 4 — Approfondissement sélectif
Pour les **3-5 articles les plus pertinents**, appelle `pubmed_fetch_abstract(pmid)`. Priorise dans cet ordre :
1. Méta-analyses et revues systématiques **récentes** (< 5 ans)
2. Revues Cochrane (gold standard)
3. RCT avec échantillon large (> 100 participants)
4. Guidelines de pratique clinique (sociétés savantes)
5. RCT récents non encore inclus dans les méta-analyses

**Ne cite JAMAIS un article dont tu n'as pas lu l'abstract via `pubmed_fetch_abstract`.**

### Étape 5 — Recherche complémentaire ciblée
Si tes premiers résultats révèlent un angle inattendu ou un débat, lance une 3e recherche ciblée :
- Un effet secondaire mentionné → cherche `[substance]/adverse effects[mesh]`
- Un sous-groupe de patients → restreins avec le MeSH de la population
- Une controverse → cherche les deux positions avec des requêtes séparées

## Hiérarchie des niveaux de preuve

Classe TOUJOURS tes résultats selon cette hiérarchie :

| Niveau | Type d'étude | Fiabilité | À retenir |
|--------|-------------|----------|-----------|
| **I-a** | Méta-analyse de RCT | Très élevée | Gold standard. Vérifie l'hétérogénéité (I²) |
| **I-b** | RCT individuel bien conduit | Élevée | Vérifie n, randomisation, double aveugle |
| **II-a** | Étude de cohorte prospective | Modérée | Pas de randomisation — confondeurs possibles |
| **II-b** | Étude de cohorte rétrospective / cas-témoins | Modérée-Faible | Biais de sélection fréquents |
| **III** | Séries de cas, rapports de cas | Faible | Signal seulement — pas de preuve causale |
| **IV** | Avis d'experts, consensus | Très faible | En l'absence de tout le reste |

## Pièges critiques

1. **Ne confonds JAMAIS corrélation et causalité** — seuls les RCT (I-b) et méta-analyses (I-a) établissent un lien causal
2. **Vérifie la taille d'échantillon** — un RCT sur 12 patients ≠ un RCT sur 1200
3. **Attention à l'obsolescence** — une méta-analyse de 2010 peut être invalidée par des RCT postérieurs
4. **Biais de publication** — les résultats positifs sont plus publiés que les négatifs. Cherche activement les études négatives.
5. **Hétérogénéité des méta-analyses** — un I² > 75% signifie que les études incluses sont très différentes entre elles. La conclusion est moins fiable.
6. **Population étudiée ≠ population cible** — un RCT sur des hommes adultes en bonne santé ne s'applique pas forcément aux femmes enceintes
7. **Outcome substitutif vs clinique** — une amélioration d'un biomarqueur (LDL, HbA1c) ne signifie pas forcément une réduction de mortalité
8. **JAMAIS de recommandation thérapeutique directe** — tu fournis les preuves, le praticien décide
