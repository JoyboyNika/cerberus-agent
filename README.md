# CerberusAgent

Panoptic medical AI agent — 3 Cerberus heads (Rigor, Transversality, Curiosity) + Body + Arbiter.

TypeScript/Node.js full-stack. Research project on AI alignment applied to high-rigor medical domains.

## Architecture

```
                    ┌─────────────┐
                    │  Practitioner │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Body     │ ← Tour Centrale
                    │ (Orchestrator)│
                    └──┬───┬───┬──┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Rigueur  │ │Transvers.│ │ Curiosité│
        │ (EBM)   │ │ (Silos)  │ │ (Histo.) │
        └──────────┘ └──────────┘ └──────────┘
              │            │            │
        PubMed (EBM)  PubMed (Alt)  OpenAlex
                       FoodData     Semantic Scholar
                       ClinTrials   CORE
                       Open Targets Crossref
```

## Stack

- **Runtime:** TypeScript / Node.js 20 LTS
- **LLM:** Anthropic Claude (exclusive)
- **Research backbone:** MCP connectors
- **Deploy:** Docker Compose on OVH VPS

## Status

🚧 Under active development — Jalon 1 (Foundations)

## License

Open source research project.
