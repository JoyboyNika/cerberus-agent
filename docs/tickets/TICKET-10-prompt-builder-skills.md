# Ticket #10 — Injection des skills de navigation dans le prompt-builder

## Type
Architecture

## Priorité
🟠 Haute

## Contexte
9 fichiers skills ont été créés dans `src/prompts/skills/`. Ils doivent être injectés comme blocs System séparés et cacheables dans `buildSystemBlocks()` de `src/prompts/prompt-builder.ts`.

## Fichiers skills existants

### Tête Rigueur
- `skills/PUBMED_EBM_SKILL.md`

### Tête Transversalité
- `skills/PUBMED_ALTMED_SKILL.md`
- `skills/CLINICALTRIALS_SKILL.md`
- `skills/FOODDATA_SKILL.md`
- `skills/OPENTARGETS_SKILL.md`

### Tête Curiosité
- `skills/OPENALEX_SKILL.md`
- `skills/SEMANTIC_SCHOLAR_SKILL.md`
- `skills/CORE_SKILL.md`
- `skills/CROSSREF_SKILL.md`

### Body, Arbitre, Greffier
- Aucun skill (pas de navigation de base de données)

## Modifications dans `prompt-builder.ts`

### 1️⃣ Mapping tête → skills
```typescript
const HEAD_SKILLS: Record<string, string[]> = {
  rigueur: ['PUBMED_EBM_SKILL.md'],
  transversalite: ['PUBMED_ALTMED_SKILL.md', 'CLINICALTRIALS_SKILL.md', 'FOODDATA_SKILL.md', 'OPENTARGETS_SKILL.md'],
  curiosite: ['OPENALEX_SKILL.md', 'SEMANTIC_SCHOLAR_SKILL.md', 'CORE_SKILL.md', 'CROSSREF_SKILL.md'],
};
```

### 2️⃣ `buildSystemBlocks()` retourne N+1 blocs
```typescript
export function buildSystemBlocks(agentId: AgentId): SystemBlock[] {
  const promptText = loadPromptText(agentId);
  const blocks: SystemBlock[] = [
    { type: 'text', text: promptText, cache_control: { type: 'ephemeral' } },
  ];
  
  const skills = HEAD_SKILLS[agentId] || [];
  for (const skillFile of skills) {
    const skillText = loadSkillText(skillFile);
    blocks.push({ type: 'text', text: skillText, cache_control: { type: 'ephemeral' } });
  }
  
  return blocks;
}
```

### 3️⃣ `loadSkillText()` avec cache in-memory
Même mécanisme que `loadPromptText()` : lecture du fichier .md depuis `src/prompts/skills/`, cache dans une Map.

### 4️⃣ Pas de changement aux prompts existants
Les fichiers .md des têtes restent inchangés.

## Critères d'acceptation
1️⃣ Les têtes avec skills reçoivent N+1 blocs system (prompt + skills)
2️⃣ Body, Arbitre, Greffier reçoivent 1 seul bloc (inchangé)
3️⃣ Chaque bloc skill a `cache_control: { type: 'ephemeral' }`
4️⃣ Les skills sont chargés une seule fois (cache in-memory)
5️⃣ `npm run build` sans erreur
