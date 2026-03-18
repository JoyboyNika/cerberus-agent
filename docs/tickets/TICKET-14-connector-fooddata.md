# Ticket #14 — Connecteur MCP : USDA FoodData Central (Tête Transversalité)

## Type
Implémentation / Nouveau connecteur MCP

## Priorité
🟠 Haute — Seule source de composition nutritionnelle quantitative.

## Fichier à créer : `src/mcp/fooddata-connector.ts`

Extend `McpConnector`.

## Base URL
```
https://api.nal.usda.gov/fdc/v1/
```
Auth : `?api_key=${process.env.FDC_API_KEY}`

## Outils MCP à exposer (2)

### 1. `fdc_search`
- **Description** : "Search USDA FoodData Central for foods by name. Returns food descriptions, FDC IDs, and data types. Use Foundation and SR Legacy for best data quality."
- **Paramètres** :
  - `query` (string, required) — ex: "broccoli raw", "turmeric"
  - `data_types` (string[], optional, default ["Foundation", "SR Legacy"])
  - `max_results` (number, optional, default 10, max 50)
- **Endpoint** : `POST /foods/search?api_key=...`
- **Body** :
```json
{
  "query": "...",
  "dataType": ["Foundation", "SR Legacy"],
  "pageSize": 10,
  "requireAllWords": true,
  "sortBy": "score",
  "sortOrder": "desc"
}
```
- **Retourner** : pour chaque food, un objet avec fdcId, description, dataType, publishedDate

### 2. `fdc_get_food`
- **Description** : "Get detailed nutritional profile of a food by its FDC ID. Returns nutrient amounts per 100g with optional filtering by nutrient IDs."
- **Paramètres** :
  - `fdc_id` (number, required)
  - `nutrients` (number[], optional) — IDs des nutriments à filtrer.
    - Clés utiles : 328 (Vit D), 430 (Vit K), 401 (Vit C), 303 (Fer), 301 (Ca), 304 (Mg), 309 (Zn), 417 (Folate), 621 (DHA), 629 (EPA), 851 (ALA), 606 (Sat fat), 291 (Fibres), 1003 (Protein), 1008 (Energy kcal)
- **Endpoint** : `GET /food/{fdcId}?api_key=...&format=full`
  - Si `nutrients` fourni : ajouter `&nutrients={ids}` (comma-separated)
- **Retourner** : description, dataType, et pour chaque nutrient : id, name, amount, unitName, min (si dispo), max (si dispo), median (si dispo). Aussi foodPortions si disponible : amount, measureUnit.name, gramWeight.

## Rate limit
1 000 req/heure. Variable env : `FDC_API_KEY` (gratuite, inscription requise).

## Câblage
```typescript
import { FoodDataConnector } from './mcp/fooddata-connector.js';
registry.registerForHead('transversalite', new FoodDataConnector());
```

## Critères d'acceptation
1️⃣ `fdc_search` retourne des aliments avec FDC IDs
2️⃣ `fdc_get_food` retourne le profil nutritionnel complet avec portions
3️⃣ Filtrage par nutrient IDs fonctionne
4️⃣ Tous les outils utilisent `fetchWithTimeout()` avec check `res.ok`
5️⃣ Connecteur enregistré pour `transversalite` dans `initRegistry()`
6️⃣ `npm run build` sans erreur
