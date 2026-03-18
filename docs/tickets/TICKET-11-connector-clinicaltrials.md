# Ticket #11 — Connecteur MCP : ClinicalTrials.gov (Tête Transversalité)

## Type
Implémentation / Nouveau connecteur MCP

## Priorité
🔴 Critique — Seule source d'essais cliniques en cours et de résultats non publiés. Irremplaçable.

## Fichier à créer : `src/mcp/clinicaltrials-connector.ts`

Extend `McpConnector` (classe de base dans `mcp-connector.ts`). Utiliser `this.fetchWithTimeout()` pour tous les appels HTTP.

## Base URL
```
https://clinicaltrials.gov/api/v2/
```
Pas d'authentification requise.

## Outils MCP à exposer (2)

### 1. `ct_search`
- **Description** : "Search ClinicalTrials.gov for clinical trials by condition and/or intervention. Returns trial ID (NCT), title, status, phase, and enrollment."
- **Paramètres** :
  - `condition` (string, required) — Maladie/condition
  - `intervention` (string, optional) — Traitement/intervention
  - `status` (string, optional, default "RECRUITING,NOT_YET_RECRUITING") — Statut des essais
  - `phase` (string, optional) — Phase(s) : PHASE1, PHASE2, PHASE3, PHASE4
  - `max_results` (number, optional, default 20, max 50)
- **Endpoint** : `GET /studies`
- **Paramètres API** :
  - `query.cond` = condition
  - `query.intr` = intervention (si fourni)
  - `filter.overallStatus` = status
  - `filter.phase` = phase (si fourni)
  - `pageSize` = max_results
  - `sort` = `LastUpdatePostDate:desc`
  - `format` = `json`
  - `countTotal` = `true`
  - `fields` = `NCTId|BriefTitle|OverallStatus|Phase|EnrollmentCount|StartDate|CompletionDate|LeadSponsorName|BriefSummary|HasResults`
- **Retourner** : pour chaque étude, un objet structuré avec nctId, title, status, phase, enrollment, sponsor, summary, hasResults

### 2. `ct_get_study`
- **Description** : "Get full details of a clinical trial by its NCT ID. Returns protocol, eligibility criteria, interventions, outcomes, and results if available."
- **Paramètres** :
  - `nct_id` (string, required) — ex: NCT04381936
- **Endpoint** : `GET /studies/{nctId}`
- **Pas de filtre fields** — retourner tous les champs
- **Structurer la réponse** :
  - `title` (BriefTitle)
  - `status` (OverallStatus)
  - `phase` (Phase)
  - `design` (StudyType, InterventionModel, Masking, etc.)
  - `interventions` (bras + interventions)
  - `eligibility` (critères d'inclusion/exclusion)
  - `outcomes` (primaires + secondaires)
  - `hasResults` (boolean)
  - `results` (si hasResults=true, résumé des résultats)

## Câblage dans `src/index.ts` (initRegistry)
```typescript
import { ClinicalTrialsConnector } from './mcp/clinicaltrials-connector.js';
// ...
registry.registerForHead('transversalite', new ClinicalTrialsConnector());
```

## Rate limit
~50 req/min par IP. Pas d'authentification.

## Critères d'acceptation
1️⃣ `ct_search` retourne des essais avec NCT ID, titre, statut, phase
2️⃣ `ct_get_study` retourne les détails complets d'un essai par NCT ID
3️⃣ Les deux outils utilisent `this.fetchWithTimeout()` avec check `res.ok`
4️⃣ Connecteur enregistré pour la tête `transversalite` dans `initRegistry()`
5️⃣ `npm run build` sans erreur

## Hors scope
- Recherche géographique (`filter.geo`)
- Endpoint `/stats/`
