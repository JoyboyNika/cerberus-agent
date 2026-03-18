# Skill de Navigation — PubMed Evidence-Based Medicine

## Tes outils

Tu disposes de 2 outils PubMed :
- `pubmed_search(query, max_results)` — recherche dans PubMed. Tes résultats sont **automatiquement filtrés** sur les publications EBM (systematic reviews, meta-analyses, RCT, practice guidelines). Tu n'as pas besoin d'ajouter ces filtres toi-même.
- `pubmed_fetch_abstract(pmid)` — récupère le titre, abstract, auteurs, journal et année d'un article par son PMID.

## Stratégie de recherche en 4 étapes

### Étape 1 — Cadre PICO
Avant toute recherche, décompose la question médicale :
- **P** (Patient/Population) : qui est concerné ?
- **I** (Intervention) : quel traitement, exposition, test ?
- **C** (Comparateur) : par rapport à quoi ?
- **O** (Outcome) : quel résultat mesurable ?

Exemple : "La curcumine aide-t-elle contre l'arthrose ?"
→ P: patients arthrose, I: curcumine, C: placebo/AINS, O: douleur/fonction

### Étape 2 — Requête initiale avec termes MeSH
Formule ta requête PubMed en utilisant les termes MeSH (Medical Subject Headings) quand possible :
- Termes MeSH = vocabulaire contrôlé de PubMed, plus précis que le texte libre
- Combine avec AND/OR : `curcumin AND osteoarthritis`
- Utilise les qualificateurs MeSH si pertinent : `curcumin/therapeutic use AND osteoarthritis/drug therapy`

**Règles de formulation :**
- Commence TOUJOURS en anglais (PubMed est anglophone)
- Préfère les termes MeSH aux synonymes courants (`neoplasms` plutôt que `cancer` pour plus de précision)
- Utilise les opérateurs booléens : AND (restreint), OR (élargit), NOT (exclut)
- Les guillemets forcent l'expression exacte : `"randomized controlled trial"`

### Étape 3 — Itération
Après le premier appel `pubmed_search` :
- **Trop peu de résultats (< 3)** → Élargis : retire un terme, utilise des synonymes, enlève un filtre PICO
- **Trop de résultats (> 15 pertinents)** → Restreins : ajoute un qualificateur, précise la population, ajoute un terme PICO
- **Résultats non pertinents** → Reformule : change les termes MeSH, essaie des synonymes

**Tu DOIS faire au minimum 2 appels `pubmed_search` avec des formulations différentes** pour être sûr de couvrir le sujet. Ne te contente jamais d'un seul appel.

### Étape 4 — Approfondissement
Pour les articles les plus pertinents (3-5 max), appelle `pubmed_fetch_abstract(pmid)` pour obtenir le résumé complet. Priorise :
1. Les méta-analyses et revues systématiques récentes (< 5 ans)
2. Les RCT avec échantillon large
3. Les guidelines de pratique clinique

## Hiérarchie des niveaux de preuve

Quand tu rapportes des résultats, classe-les selon cette hiérarchie :

| Niveau | Type d'étude | Fiabilité |
|--------|-------------|----------|
| I-a | Méta-analyse de RCT | Très élevée |
| I-b | RCT individuel de bonne qualité | Élevée |
| II-a | Étude de cohorte bien conçue | Modérée |
| II-b | Étude de cohorte de moindre qualité / étude cas-témoins | Modérée-Faible |
| III | Études non analytiques (séries de cas, rapports de cas) | Faible |
| IV | Avis d'experts, consensus sans preuve | Très faible |

## Pièges à éviter

- **Ne pas confondre corrélation et causalité** dans les études observationnelles
- **Vérifier la taille d'échantillon** — un RCT sur 12 patients n'a pas le même poids qu'un RCT sur 1200
- **Attention aux dates** — une méta-analyse de 2010 peut être obsolète si de nouveaux RCT sont sortis depuis
- **Biais de publication** — les études positives sont plus publiées que les négatives
- **Ne JAMAIS citer un article sans avoir lu son abstract** via `pubmed_fetch_abstract`
