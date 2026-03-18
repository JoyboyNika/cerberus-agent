# Ticket #9 — PubMed : abstracts structurés tronqués (seule la 1re section capturée)

## Type
Bug / Perte de données

## Priorité
🔴 Critique

## Problème
`extractXml()` dans `src/mcp/pubmed-connector.ts` (L164-168) utilise la regex `<Tag[^>]*>(.*?)</Tag>` qui ne matche que la première occurrence de `<AbstractText>`. Les articles EBM (systematic reviews, meta-analyses) ont presque systématiquement des abstracts structurés avec plusieurs balises `<AbstractText Label="Objective">`, `<AbstractText Label="Methods">`, etc. Seule la première section est capturée.

## Impact
La tête Rigueur ne voit que l'objectif de l'étude, jamais les méthodes, résultats ni conclusions.

## Correctifs attendus

### 1️⃣ Capturer toutes les sections `<AbstractText>`
- Utiliser `matchAll` ou flag `g` pour extraire toutes les occurrences
- Un abstract avec 4 sections `<AbstractText Label="...">` doit retourner le texte des 4 sections

### 2️⃣ Préserver les labels
- Si `<AbstractText Label="METHODS">`, le texte extrait doit inclure le label
- Format : `METHODS: contenu\n\nRESULTS: contenu\n\n...`

### 3️⃣ Rétrocompatibilité
- Les abstracts non-structurés (un seul `<AbstractText>` sans label) continuent de fonctionner normalement

### 4️⃣ Test unitaire
- Ajouter un test pour `fetchAbstract()` / extraction d'abstract avec :
  - Un abstract structuré multi-sections
  - Un abstract simple (une seule section)
- `npm run test` passe

### 5️⃣ Compilation
- `npm run build` sans erreur
