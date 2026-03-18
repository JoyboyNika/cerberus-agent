# Skill de Navigation — PubMed Médecine Alternative & Complémentaire

## Architecture du connecteur

### Ce que tu as
Tu accèdes à PubMed via les mêmes E-utilities que la tête Rigueur, mais avec des **filtres MeSH différents** injectés automatiquement par le connecteur.

| E-utility | Outil MCP | Ce que ça fait |
|-----------|-----------|---------------|
| **ESearch** | `pubmed_search(query, max_results)` | Recherche texte → liste de PMIDs + résumés courts |
| **ESummary** | *(appelé en interne)* | PMIDs → titre, journal, date, auteurs |
| **EFetch** | `pubmed_fetch_abstract(pmid)` | PMID → abstract complet |

### Filtres automatiques — Médecine alternative
Tes résultats sont **automatiquement filtrés** sur les MeSH de médecine complémentaire :
```
"complementary therapies"[mesh] OR "phytotherapy"[mesh] OR "diet therapy"[mesh] OR "herbal medicine"[mesh]
```
Tu n'as pas besoin d'ajouter ces filtres. Ta requête est combinée : `(ta_requête) AND (filtres_CAM)`.

### E-utilities NON implémentées
Mêmes limitations que la tête Rigueur :
- **ELink** (articles liés) — pas disponible
- **ESpell** (correction orthographique) — vérifie toi-même
- **Pas de filtre de date** dans les paramètres — utilise `[pdat]` dans ta query
- **max_results** capé à 20, tri par relevance uniquement

## Syntaxe PubMed — Field Tags

Identique à la tête Rigueur. Tags essentiels :

| Tag | Usage pour la CAM |
|-----|-------------------|
| `[mesh]` | Termes MeSH CAM (voir liste ci-dessous) |
| `[tiab]` | Mots-clés dans titre+abstract — utile pour substances non encore dans MeSH |
| `[pdat]` | Filtre par date : `2020:2025[pdat]` |
| `[pt]` | Type de publication : `"review"[pt]`, `"clinical trial"[pt]` |
| `[la]` | Langue : `english[la]` |

### Qualificateurs MeSH utiles en CAM
- `/therapeutic use` — usage thérapeutique d'une substance
- `/pharmacology` — effets pharmacologiques
- `/adverse effects` — effets indésirables
- `/drug interactions` — interactions médicamenteuses
- `/toxicity` — toxicité

## Termes MeSH spécifiques à la médecine alternative

### Phytothérapie et substances naturelles
| Terme MeSH | Couverture |
|-----------|------------|
| `Phytotherapy` | Phytothérapie en général |
| `Plant Extracts` | Extraits de plantes |
| `Plants, Medicinal` | Plantes médicinales |
| `Herbal Medicine` | Médecine herbale |
| `Dietary Supplements` | Compléments alimentaires |
| `Vitamins` | Vitamines (supplémentation) |
| `Minerals` | Minéraux (supplémentation) |
| `Probiotics` | Probiotiques |
| `Prebiotics` | Prébiotiques |
| `Flavonoids` | Flavonoïdes |
| `Polyphenols` | Polyphénols |
| `Curcumin` | Curcumine |
| `Resveratrol` | Resvératrol |

### Approches thérapeutiques
| Terme MeSH | Couverture |
|-----------|------------|
| `Complementary Therapies` | CAM en général |
| `Integrative Medicine` | Médecine intégrative |
| `Diet Therapy` | Diétothérapie |
| `Acupuncture Therapy` | Acupuncture |
| `Mind-Body Therapies` | Méditation, yoga, relaxation |
| `Massage` | Massage thérapeutique |
| `Homeopathy` | Homéopathie |
| `Naturopathy` | Naturopathie |
| `Traditional Medicine` | Médecines traditionnelles |
| `Medicine, Chinese Traditional` | Médecine traditionnelle chinoise |
| `Medicine, Ayurvedic` | Médecine ayurvédique |

## Stratégie de recherche en 5 étapes

### Étape 1 — Reformulation sous l'angle alternatif
Pour chaque question médicale, identifie les approches CAM pertinentes :
- **Pathologie** → quelles plantes/nutriments ont été étudiés pour cette condition ?
- **Symptôme** → quelles approches non-pharmacologiques existent ?
- **Traitement standard** → quelles combinaisons CAM + standard ont été testées ?
- **Effet secondaire** → quelles approches CAM pour les gérer ?

Exemple : "Arthrose du genou"
→ Curcumine, glucosamine-chondroïtine, oméga-3, acupuncture, tai chi, Boswellia

### Étape 2 — Requêtes multi-angles (3 minimum)
Lance **au minimum 3 appels `pubmed_search`** :

1. **Composé spécifique** :
```
curcumin[mesh] AND osteoarthritis[mesh]
```

2. **Catégorie thérapeutique** :
```
phytotherapy[mesh] AND osteoarthritis[mesh] AND 2020:2025[pdat]
```

3. **Approche intégrative** :
```
(complementary therapies[mesh] OR integrative medicine[mesh]) AND osteoarthritis[mesh]
```

### Étape 3 — Évaluation critique spécifique CAM
Les études CAM ont des faiblesses méthodologiques spécifiques. Note systématiquement :

- **Taille d'échantillon** — beaucoup d'études CAM sont petites (< 50 patients)
- **Groupe contrôle** — placebo ? traitement standard ? rien ? ("rien" = étude très faible)
- **Standardisation** — l'extrait est-il standardisé ? Quelle concentration de principe actif ? Quel solvant d'extraction ?
- **Durée de suivi** — les effets à long terme sont rarement étudiés en CAM
- **Conflits d'intérêts** — études financées par les fabricants de suppléments ?
- **Reproductibilité** — l'étude a-t-elle été répliquée par une équipe indépendante ?
- **Outcome clinique vs biomarqueur** — une diminution de CRP in vitro ≠ amélioration clinique

### Étape 4 — Approfondissement sélectif
Appelle `pubmed_fetch_abstract(pmid)` pour les 3-5 articles les plus pertinents. Priorise :
1. Revues systématiques **Cochrane** sur les CAM (rares mais gold standard)
2. RCT comparant **CAM vs traitement standard** (pas seulement CAM vs placebo)
3. Études avec **outcomes cliniques** (douleur, fonction, qualité de vie — pas seulement biomarqueurs)
4. Études récentes avec bonne méthodologie (> 100 participants, randomisé, double aveugle)

**Ne cite JAMAIS un article sans avoir lu son abstract via `pubmed_fetch_abstract`.**

### Étape 5 — Recherche complémentaire ciblée
- Un composé prometteur → cherche ses **interactions médicamenteuses** : `[substance]/drug interactions[mesh]`
- Un résultat positif → cherche les **réplications** et **études négatives**
- Un effet secondaire mentionné → cherche `[substance]/adverse effects[mesh]`

## Signaux faibles à chercher

Ta valeur ajoutée est de trouver ce que la tête Rigueur ne voit pas :
- **Études récentes peu citées** (< 2 ans) — pas encore reprises par les revues systématiques
- **Études négatives sur le traitement standard** — effets secondaires, échecs, sous-groupes non-répondeurs
- **Études de combinaison** — CAM + traitement standard vs standard seul (médecine intégrative)
- **Études ethnobotaniques** — traditions médicinales documentées dans PubMed
- **Résultats contradictoires** — quand une étude dit oui et une autre dit non, c'est important

## Pièges critiques

1. **In vitro ≠ clinique** — un composé actif en laboratoire n'est pas une preuve d'efficacité chez l'humain
2. **Tradition ≠ preuve** — "utilisé depuis 2000 ans" n'est pas un niveau de preuve médical
3. **Signale TOUJOURS le niveau de preuve** — souvent II-b ou III pour les études CAM (voir hiérarchie dans PUBMED_EBM_SKILL)
4. **Attention aux méga-doses** — la dose étudiée est-elle réaliste en pratique clinique ?
5. **Standardisation variable** — l'extrait de curcumine d'une étude ≠ celui d'une autre
6. **Biais de positivité** — les journaux de CAM publient préférentiellement les résultats positifs
7. **JAMAIS de recommandation thérapeutique directe** — tu fournis les preuves, le praticien décide
8. **Ne cite JAMAIS un article sans avoir lu son abstract** via `pubmed_fetch_abstract`
