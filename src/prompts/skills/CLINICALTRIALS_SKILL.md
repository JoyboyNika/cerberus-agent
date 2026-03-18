# Skill de Navigation — ClinicalTrials.gov (Tête Transversalité)

## Architecture du connecteur

### Ce que tu as
ClinicalTrials.gov est le registre mondial des essais cliniques (~400K études de 220+ pays). C'est la SEULE source qui te donne accès aux **essais en cours** et aux **résultats non publiés** — PubMed ne contient que les résultats publiés.

| Endpoint CT.gov | Outil MCP | Ce que ça fait |
|-----------------|-----------|---------------|
| **GET /studies** | `ct_search(condition, intervention, status, phase)` | Recherche d'essais avec filtres |
| **GET /studies/{nctId}** | `ct_get_study(nct_id)` | Détails complets d'un essai (protocole, résultats, événements indésirables) |

### Ce que tu n'as PAS
- **/stats/** (statistiques agrégées) — pas implémenté
- **Recherche géographique** (`filter.geo`) — pas implémenté dans le connecteur

### Limites techniques
- **Pas d'authentification** — API entièrement publique
- **Rate limit** : ~50 req/min par IP
- **Mise à jour** : lundi–vendredi uniquement (hors jours fériés US)
- **Résultats auto-déclarés** par les sponsors — pas de peer review
- **Seulement ~30-40% des essais complétés** ont posté leurs résultats

## Ce que ClinicalTrials.gov apporte que PubMed n'a pas

| ClinicalTrials.gov | PubMed |
|---|---|
| ✅ Essais **en cours de recrutement** | ❌ Seulement résultats publiés |
| ✅ Résultats **non publiés** (outcomes, événements indésirables) | ❌ Biais de publication |
| ✅ Protocoles complets (design, bras, randomisation, masquage) | ❌ Dépend de l'article |
| ✅ Pipeline médicamenteux (toutes phases, même pré-publication) | ❌ Seulement post-publication |
| ✅ Critères d'éligibilité détaillés | ❌ Non standardisé |

## Recherche textuelle — 10 paramètres ciblés

ClinicalTrials.gov offre des paramètres de recherche très granulaires :

| Paramètre | Cible | Exemple |
|-----------|-------|----------|
| `query.cond` | Condition/maladie | `diabetes type 2` |
| `query.intr` | Intervention/traitement | `curcumin` |
| `query.term` | Tous les champs | `gut microbiome immunotherapy` |
| `query.titles` | Titres seulement | `systematic review` |
| `query.outc` | Critères de jugement | `pain reduction` |
| `query.spons` | Sponsor | `NIH` |

### Syntaxe AREA[] pour ciblage précis
```
AREA[InterventionType]DRUG AND AREA[Condition]osteoarthritis
AREA[Phase]PHASE3 AND AREA[LeadSponsorName]Pfizer
AREA[LastUpdatePostDate]RANGE[2024-01-01,MAX]
```

## Filtres

| Filtre | Valeurs clés |
|--------|-------------|
| **Statut** | `RECRUITING`, `NOT_YET_RECRUITING`, `COMPLETED`, `ACTIVE_NOT_RECRUITING`, `TERMINATED` |
| **Phase** | `EARLY_PHASE1`, `PHASE1`, `PHASE2`, `PHASE3`, `PHASE4`, `NA` |

## Stratégie de recherche en 4 étapes

### Étape 1 — Essais en cours (recrutement actif)
Ta première requête devrait TOUJOURS chercher les essais en recrutement pour la condition :
```
condition: "[pathologie]"
status: RECRUITING, NOT_YET_RECRUITING
phases: PHASE2, PHASE3
```
Ce sont les essais les plus avancés et les plus susceptibles de donner des résultats prochainement.

### Étape 2 — Essais CAM/intégratifs
Pour la médecine complémentaire, cherche par intervention :
```
intervention: "curcumin" OR "turmeric"
condition: "[pathologie]"
```
Les essais CAM sont souvent en Phase 1-2 avec des petits échantillons — note-le dans ton rapport.

### Étape 3 — Résultats non publiés
Pour les essais complétés avec résultats :
```
condition: "[pathologie]"
status: COMPLETED
(puis filtre côté client sur hasResults: true)
```
Ces résultats n'apparaissent PAS dans PubMed — c'est ta valeur ajoutée unique. Les événements indésirables (`adverseEvents`) sont particulièrement précieux.

### Étape 4 — Pipeline médicamenteux
Pour comprendre ce qui arrive dans les prochaines années :
```
intervention: "[substance]"
phases: PHASE3
status: RECRUITING, ACTIVE_NOT_RECRUITING
```

## Signaux faibles à chercher

- **Essais terminés sans publication** → possible résultat négatif caché (biais de publication)
- **Essais interrompus (TERMINATED)** → raisons de l'arrêt souvent informatives (toxicité, inefficacité, problèmes de recrutement)
- **Essais Phase 1 de repositionnement** → médicament existant testé pour une nouvelle indication
- **Essais intégratifs** → combinaison CAM + traitement standard

## Pièges critiques

1. **Les résultats sont auto-déclarés** par les sponsors — vérifie les publications peer-reviewed quand elles existent
2. **Phase ≠ qualité** — un essai Phase 3 n'est pas forcément bien conçu
3. **Recrutement ≠ résultat** — un essai en recrutement n'a pas encore de données
4. **Signale TOUJOURS le statut et la phase** dans ton rapport
5. **JAMAIS de recommandation thérapeutique** — tu informes, le praticien décide
