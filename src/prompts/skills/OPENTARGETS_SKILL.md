# Skill de Navigation — Open Targets (Tête Transversalité)

## Architecture du connecteur

### Ce que tu as
Open Targets est un graphe de connaissances structuré qui mappe les associations **gène ↔ maladie ↔ médicament** avec des scores de confiance. C'est la SEULE source qui te donne un mapping systématique et scoré de ces relations.

| Requête GraphQL | Outil MCP | Ce que ça fait |
|-----------------|-----------|---------------|
| **search** | `ot_search(keyword)` | Recherche globale (gènes, maladies, médicaments) |
| **disease.associatedTargets** | `ot_disease_targets(efo_id)` | Top gènes associés à une maladie |
| **target.associatedDiseases** | `ot_target_diseases(ensembl_id)` | Maladies associées à un gène |
| **drug** | `ot_drug_profile(chembl_id)` | Profil complet d'un médicament (mécanismes, pharmacogénomique, effets indésirables) |

### Identifiants
Open Targets utilise des identifiants spécifiques :
- **Maladies** : EFO IDs (Experimental Factor Ontology) ex: `EFO_0000249` (Alzheimer)
- **Gènes** : Ensembl IDs ex: `ENSG00000169083` (AR)
- **Médicaments** : ChEMBL IDs ex: `CHEMBL25` (Aspirine)

Utilise `ot_search` pour résoudre un nom commun en identifiant.

### Limites techniques
- **API GraphQL** — pas REST, les requêtes sont structurées différemment
- **Pas d'authentification** — API publique
- **Mise à jour trimestrielle** — pas de données en temps réel
- **Principalement humain** — pas de données animales
- **Score ≠ confiance** — le score d'association (0-1) est une somme pondérée, pas une probabilité

## Les 22+ sources de données d'Open Targets

Open Targets agrège des données de sources multiples, chacune avec un score :

| Source | Type de données |
|--------|----------------|
| **ChEMBL** | Médicaments, essais, mécanismes d'action |
| **Europe PMC** | Associations gène-maladie dans la littérature |
| **Expression Atlas** | Expression génique par tissu |
| **OT Genetics Portal** | Associations génétiques (GWAS) |
| **ClinGen** | Validité des associations gène-maladie |
| **Gene2Phenotype** | Relations génotype-phénotype |
| **Orphanet** | Maladies rares |
| **Cancer Gene Census** | Gènes impliqués dans le cancer |
| **IMPC** | Modèles animaux (phénotypes de knockout) |

## Stratégie de recherche en 4 étapes

### Étape 1 — Résolution d'identifiants
Avant toute requête, résous le nom commun en identifiant :
```
ot_search("osteoarthritis") → EFO_0002506
ot_search("curcumin")        → CHEMBL116438
ot_search("TNF")              → ENSG00000232810
```

### Étape 2 — Exploration des associations
Selon ta question :

**"Quels gènes sont impliqués dans [maladie] ?"**
→ `ot_disease_targets(efo_id)` → Top gènes avec scores

**"Quelles maladies sont liées à [gène] ?"**
→ `ot_target_diseases(ensembl_id)` → Maladies avec scores

**"Que sait-on sur [médicament] ?"**
→ `ot_drug_profile(chembl_id)` → Mécanismes, pharmacogénomique, effets indésirables

### Étape 3 — Lecture des scores
Le score d'association (0-1) est une **somme harmonique pondérée** :
- Score élevé (> 0.5) → association bien documentée par plusieurs sources
- Score moyen (0.1-0.5) → association présente mais preuve limitée
- Score faible (< 0.1) → association faible ou basée sur une seule source

**ATTENTION** : les maladies sous-étudiées produisent des scores bas même pour les meilleures cibles. Compare les scores ENTRE cibles pour une même maladie, pas entre maladies.

### Étape 4 — Connexions Transversalité
Open Targets est particulièrement puissant pour la tête Transversalité car il permet :
- **Repositionnement** : un médicament pour la maladie A cible le gène X → le gène X est aussi impliqué dans la maladie B → piste de repositionnement
- **Interactions drug-nutriment** : si un nutriment agit sur le même gène qu'un médicament, il peut interagir
- **Pharmacogénomique** : variants génétiques qui modifient la réponse à un traitement (y compris CAM)

## Cas d'usage pour la tête Transversalité

1. **Mécanisme d'action d'un composé naturel** : cherche le composé dans ChEMBL → quelles cibles moléculaires → quelles maladies ces cibles touchent
2. **Drug-nutrient interactions** : si la warfarine cible VKORC1, et la vitamine K aussi → interaction confirmée au niveau moléculaire
3. **Repositionnement de phytocomposés** : un principe actif de plante cible le même récepteur qu'un médicament approuvé
4. **Effets indésirables** : données FAERS post-marketing — les effets secondaires réels rapportés aux autorités

## Pièges critiques

1. **Score ≠ preuve clinique** — un score élevé = bien documenté, pas forcément cliniquement prouvé
2. **Biais vers les maladies étudiées** — les maladies rares ou négligées ont des scores mécaniquement plus bas
3. **Propagation ontologique** — une preuve sur la maladie de Crohn compte aussi pour les MICI via l'ontologie. C'est voulu mais peut surprendre.
4. **GraphQL ≠ REST** — les requêtes sont structurées. Utilise les outils MCP, ne tente pas de construire des requêtes brutes.
5. **JAMAIS de prescription** — tu mappes les relations moléculaires, le praticien interprète cliniquement
