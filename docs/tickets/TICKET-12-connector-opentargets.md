# Ticket #12 — Connecteur MCP : Open Targets GraphQL (Tête Transversalité)

## Type
Implémentation / Nouveau connecteur MCP

## Priorité
🔴 Critique — Seule source de mapping systématique drug-target-disease avec scores.

## Fichier à créer : `src/mcp/opentargets-connector.ts`

Extend `McpConnector`. **Attention : API GraphQL**, pas REST. Tous les appels sont `POST` vers un seul endpoint.

## Endpoint
```
POST https://api.platform.opentargets.org/api/v4/graphql
```
Headers : `Content-Type: application/json`
Body : `{ "query": "...", "variables": {...} }`
Pas d'authentification.

## Helper interne
Créer une méthode privée :
```typescript
private async graphqlQuery(query: string, variables: Record<string, any>): Promise<any>
```
Qui gère le POST, le check `res.ok`, le parsing JSON, et retourne `data` (ou throw si `errors`).

## Outils MCP à exposer (4)

### 1. `ot_search`
- **Description** : "Search Open Targets for genes, diseases, or drugs by keyword. Returns IDs needed for other Open Targets tools."
- **Paramètres** :
  - `keyword` (string, required)
  - `entity_type` (string, optional: "target", "disease", "drug")
- **GraphQL** :
```graphql
query ($q: String!, $types: [String!]) {
  search(queryString: $q, entityNames: $types, page: { index: 0, size: 10 }) {
    total
    hits { id entity name description score }
  }
}
```
- **Retourner** : liste de hits avec id, entity type, name, description, score

### 2. `ot_disease_targets`
- **Description** : "Get top genes/targets associated with a disease, ranked by evidence score. Use the EFO ID from ot_search."
- **Paramètres** :
  - `efo_id` (string, required) — ex: EFO_0000249
  - `max_results` (number, optional, default 25)
- **GraphQL** :
```graphql
query ($efoId: String!, $size: Int!) {
  disease(efoId: $efoId) {
    name
    associatedTargets(page: { index: 0, size: $size }, orderByScore: "score desc", enableIndirect: true) {
      count
      rows {
        score
        target { id approvedSymbol approvedName }
        datatypeScores { id score }
      }
    }
  }
}
```
- **Retourner** : disease name, total count, et pour chaque target : score, symbol, name, datatype scores

### 3. `ot_target_diseases`
- **Description** : "Get diseases associated with a gene/target, ranked by evidence score. Use the Ensembl ID from ot_search."
- **Paramètres** :
  - `ensembl_id` (string, required) — ex: ENSG00000169083
  - `max_results` (number, optional, default 25)
- **GraphQL** :
```graphql
query ($ensemblId: String!, $size: Int!) {
  target(ensemblId: $ensemblId) {
    approvedSymbol
    approvedName
    associatedDiseases(page: { index: 0, size: $size }, orderByScore: "score desc") {
      count
      rows {
        score
        disease { id name }
        datatypeScores { id score }
      }
    }
  }
}
```

### 4. `ot_drug_profile`
- **Description** : "Get drug details: mechanisms of action, pharmacogenomics, and adverse events. Use the ChEMBL ID from ot_search."
- **Paramètres** :
  - `chembl_id` (string, required) — ex: CHEMBL25
- **GraphQL** :
```graphql
query ($id: String!) {
  drug(chemblId: $id) {
    name
    isApproved
    drugType
    maximumClinicalTrialPhase
    mechanismsOfAction {
      rows { mechanismOfAction actionType targetName }
    }
    pharmacogenomics {
      variantRsId genotype phenotypeText pgxCategory
    }
    adverseEvents(page: { index: 0, size: 10 }) {
      count
      rows { name meddraCode count llr }
    }
  }
}
```

## Câblage
```typescript
import { OpenTargetsConnector } from './mcp/opentargets-connector.js';
registry.registerForHead('transversalite', new OpenTargetsConnector());
```

## Critères d'acceptation
1️⃣ `ot_search` résout un nom en ID (EFO, Ensembl, ChEMBL)
2️⃣ `ot_disease_targets` retourne les top gènes avec scores
3️⃣ `ot_target_diseases` retourne les maladies associées à un gène
4️⃣ `ot_drug_profile` retourne mécanismes, pharmacogénomique, effets indésirables
5️⃣ Toutes les requêtes passent par `fetchWithTimeout()` avec check `res.ok`
6️⃣ Connecteur enregistré pour `transversalite` dans `initRegistry()`
7️⃣ `npm run build` sans erreur
