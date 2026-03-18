# Tickets CerberusAgent — Audit Cuivre

Tickets d'implémentation pour Claude Code. Chaque ticket est auto-portant.

## Ordre d'implémentation recommandé

### Batch 1 — Corrections code existant
| # | Fichier | Priorité |
|---|---------|----------|
| 9 | [TICKET-09](TICKET-09-pubmed-structured-abstracts.md) | 🔴 Critique |
| 10 | [TICKET-10](TICKET-10-prompt-builder-skills.md) | 🟠 Haute |

### Batch 2 — Connecteurs critiques
| # | Fichier | Priorité |
|---|---------|----------|
| 11 | [TICKET-11](TICKET-11-connector-clinicaltrials.md) | 🔴 Critique |
| 12 | [TICKET-12](TICKET-12-connector-opentargets.md) | 🔴 Critique |

### Batch 3 — Connecteurs haute priorité
| # | Fichier | Priorité |
|---|---------|----------|
| 13 | [TICKET-13](TICKET-13-connector-semantic-scholar.md) | 🟠 Haute |
| 14 | [TICKET-14](TICKET-14-connector-fooddata.md) | 🟠 Haute |

### Batch 4 — Connecteurs secondaires
| # | Fichier | Priorité |
|---|---------|----------|
| 15 | [TICKET-15](TICKET-15-connector-core.md) | 🟡 Moyenne |
| 16 | [TICKET-16](TICKET-16-connector-crossref.md) | 🟢 Basse |

## Conventions
- Tous les connecteurs extend `McpConnector` (classe de base dans `src/mcp/mcp-connector.ts`)
- Tous les appels HTTP utilisent `this.fetchWithTimeout()` (30s timeout, check `res.ok`)
- Tous les connecteurs sont câblés dans `initRegistry()` de `src/index.ts`
- Variables d'environnement pour les clés API : `S2_API_KEY`, `FDC_API_KEY`, `CORE_API_KEY`
- `npm run build` doit compiler sans erreur après chaque ticket
