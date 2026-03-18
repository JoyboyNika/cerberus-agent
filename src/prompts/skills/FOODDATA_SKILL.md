# Skill de Navigation — USDA FoodData Central (Tête Transversalité)

## Architecture du connecteur

### Ce que tu as
FoodData Central est la base de référence mondiale pour la composition nutritionnelle des aliments. Elle contient des données quantitatives sur les nutriments — c'est la SEULE source qui te donne les concentrations exactes.

| Endpoint FDC | Outil MCP | Ce que ça fait |
|--------------|-----------|---------------|
| **POST /foods/search** | `fdc_search(query, data_types)` | Recherche d'aliments par nom |
| **GET /food/{fdcId}** | `fdc_get_food(fdc_id, nutrients)` | Détails nutritionnels complets d'un aliment |

### Types de données
| Type | Contenu | Couverture |
|------|---------|------------|
| **Foundation** | Analyses approfondies (min/max/médiane, provenance) | ~1 000 aliments, 100+ nutriments |
| **SR Legacy** | Standard Reference classique (gelé depuis 2018) | ~7 900 aliments |
| **Survey (FNDDS)** | Aliments NHANES | ~7 000 aliments |
| **Branded** | Données d'étiquetage (produits commerciaux) | 350K+ produits (~14 nutriments) |

**Priorise Foundation > SR Legacy > Survey > Branded** pour la qualité des données.

### Limites techniques
- **Clé API requise** (gratuite)
- **Rate limit** : 1 000 req/heure
- **PAS de données sur les compléments alimentaires** — les bases DSID/DSLD du NIH sont séparées
- **PAS de flavonoïdes/polyphénols/bioactifs** via l'API — bases USDA téléchargeables séparément
- **PAS de tri par quantité de nutriment** — il faut chercher, récupérer et trier côté client

## Nutriments clés pour la médecine intégrative

| ID Nutriment | Nom | Intérêt médical |
|-------------|-----|----------------|
| 328 | Vitamine D | Immunité, os, dépression |
| 430 | Vitamine K | Coagulation, interaction warfarine |
| 401 | Vitamine C | Antioxydant, immunité |
| 303 | Fer | Anémie, fatigue |
| 301 | Calcium | Os, muscles, nerfs |
| 304 | Magnésium | Muscles, sommeil, stress |
| 309 | Zinc | Immunité, cicatrisation |
| 417 | Folate | Grossesse, neurologie |
| 621 | DHA (oméga-3) | Cerveau, inflammation |
| 629 | EPA (oméga-3) | Cardiovasculaire, inflammation |
| 851 | ALA (oméga-3) | Précurseur DHA/EPA |
| 606 | Acides gras saturés | Cardiovasculaire |
| 291 | Fibres | Microbiome, digestif |

## Stratégie de recherche en 3 étapes

### Étape 1 — Identification de l'aliment
Cherche l'aliment par son nom en anglais :
```
query: "broccoli raw"
data_types: ["Foundation", "SR Legacy"]
```
**Précise toujours la forme** : raw/cooked/dried/canned changent radicalement la composition.

### Étape 2 — Profil nutritionnel ciblé
Appelle `fdc_get_food` avec les nutriments pertinents pour la pathologie :
- **Interaction médicamenteuse** → Vitamine K (430) pour warfarine, calcium (301) pour bisphosphonates
- **Condition inflammatoire** → DHA (621), EPA (629), vitamine D (328)
- **Déficit nutritionnel** → le nutriment concerné + ses cofacteurs d'absorption

### Étape 3 — Comparaison et quantification
Compare plusieurs aliments pour identifier les meilleures sources :
1. Cherche 3-5 aliments riches dans le nutriment cible
2. Récupère les profils nutritionnels
3. Rapporte en **quantité par portion** (pas par 100g — personne ne mange 100g d'épices)

## Cas d'usage pour la tête Transversalité

- **Interactions drug-nutriment** : warfarine + vitamine K, metformine + B12, statines + CoQ10
- **Nutrition thérapeutique** : régime anti-inflammatoire (oméga-3/6 ratio), régime DASH, diète cétogène
- **Complémentation** : identifier les sources alimentaires avant de recommander des suppléments
- **Biodisponibilité** : formes de fer (hème vs non-hème), vitamine D2 vs D3

## Pièges critiques

1. **Les données sont pour des aliments BRUTS** — la cuisson change les concentrations (vitamine C diminue, lycopène augmente)
2. **Portion réaliste ≠ 100g** — rapporte en portions consommables
3. **Foundation > SR Legacy** — les données Foundation sont plus fiables (analyses récentes avec variabilité statistique)
4. **Branded = étiquetage** — seulement ~14 nutriments, pas de données analytiques
5. **JAMAIS de prescription diététique** — tu informes sur la composition, le praticien prescrit
