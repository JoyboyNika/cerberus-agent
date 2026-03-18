/**
 * CerberusAgent — Open Targets GraphQL MCP Connector
 *
 * Provides drug-target-disease association data for the Transversalité head.
 * Uses the Open Targets Platform GraphQL API (free, no API key required).
 *
 * Tools:
 * - ot_search: Search for genes, diseases, or drugs by keyword
 * - ot_disease_targets: Get top targets associated with a disease
 * - ot_target_diseases: Get diseases associated with a gene/target
 * - ot_drug_profile: Get drug details (mechanisms, pharmacogenomics, adverse events)
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpConnector, McpToolResult } from './mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('mcp:opentargets');

const OT_GRAPHQL_URL = 'https://api.platform.opentargets.org/api/v4/graphql';

export class OpenTargetsConnector extends McpConnector {
  readonly name = 'opentargets';
  readonly description = 'Search Open Targets for drug-target-disease associations';

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'ot_search',
        description:
          'Search Open Targets for genes, diseases, or drugs by keyword. ' +
          'Returns IDs needed for other Open Targets tools.',
        input_schema: {
          type: 'object' as const,
          properties: {
            keyword: { type: 'string', description: 'Search keyword' },
            entity_type: {
              type: 'string',
              description: 'Filter by entity type: "target", "disease", or "drug" (optional)',
            },
          },
          required: ['keyword'],
        },
      },
      {
        name: 'ot_disease_targets',
        description:
          'Get top genes/targets associated with a disease, ranked by evidence score. ' +
          'Use the EFO ID from ot_search.',
        input_schema: {
          type: 'object' as const,
          properties: {
            efo_id: { type: 'string', description: 'EFO disease ID (e.g., "EFO_0000249")' },
            max_results: { type: 'number', description: 'Max results (default: 25)' },
          },
          required: ['efo_id'],
        },
      },
      {
        name: 'ot_target_diseases',
        description:
          'Get diseases associated with a gene/target, ranked by evidence score. ' +
          'Use the Ensembl ID from ot_search.',
        input_schema: {
          type: 'object' as const,
          properties: {
            ensembl_id: { type: 'string', description: 'Ensembl gene ID (e.g., "ENSG00000169083")' },
            max_results: { type: 'number', description: 'Max results (default: 25)' },
          },
          required: ['ensembl_id'],
        },
      },
      {
        name: 'ot_drug_profile',
        description:
          'Get drug details: mechanisms of action, pharmacogenomics, and adverse events. ' +
          'Use the ChEMBL ID from ot_search.',
        input_schema: {
          type: 'object' as const,
          properties: {
            chembl_id: { type: 'string', description: 'ChEMBL drug ID (e.g., "CHEMBL25")' },
          },
          required: ['chembl_id'],
        },
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (toolName) {
        case 'ot_search':
          return await this.search(input.keyword as string, input.entity_type as string | undefined);
        case 'ot_disease_targets':
          return await this.diseaseTargets(input.efo_id as string, (input.max_results as number) || 25);
        case 'ot_target_diseases':
          return await this.targetDiseases(input.ensembl_id as string, (input.max_results as number) || 25);
        case 'ot_drug_profile':
          return await this.drugProfile(input.chembl_id as string);
        default:
          return { toolUseId: '', content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (error) {
      log.error('Tool execution failed', { toolName, error: String(error) });
      return { toolUseId: '', content: `Error: ${String(error)}`, isError: true };
    }
  }

  private async graphqlQuery(query: string, variables: Record<string, unknown>): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(OT_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '(unreadable)');
        throw new Error(`HTTP ${response.status} from Open Targets: ${body.slice(0, 200)}`);
      }

      const json = await response.json() as any;
      if (json.errors && json.errors.length > 0) {
        throw new Error(`GraphQL errors: ${json.errors.map((e: any) => e.message).join('; ')}`);
      }

      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }

  private async search(keyword: string, entityType?: string): Promise<McpToolResult> {
    log.info('Open Targets search', { keyword, entityType });

    const query = `
      query ($q: String!, $types: [String!]) {
        search(queryString: $q, entityNames: $types, page: { index: 0, size: 10 }) {
          total
          hits { id entity name description score }
        }
      }
    `;

    const variables: Record<string, unknown> = { q: keyword };
    if (entityType) variables.types = [entityType];

    const data = await this.graphqlQuery(query, variables);
    const hits = data.search?.hits || [];

    if (hits.length === 0) {
      return { toolUseId: '', content: 'No results found.' };
    }

    const results = hits.map((h: any) =>
      [
        `ID: ${h.id}`,
        `Type: ${h.entity}`,
        `Name: ${h.name}`,
        `Description: ${(h.description || 'N/A').slice(0, 200)}`,
        `Score: ${h.score?.toFixed(3) || 'N/A'}`,
      ].join('\n')
    );

    return {
      toolUseId: '',
      content: `Found ${data.search.total} results (showing ${hits.length}):\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private async diseaseTargets(efoId: string, maxResults: number): Promise<McpToolResult> {
    log.info('Open Targets disease targets', { efoId, maxResults });

    const query = `
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
    `;

    const data = await this.graphqlQuery(query, { efoId, size: maxResults });
    const disease = data.disease;

    if (!disease) {
      return { toolUseId: '', content: `Disease not found: ${efoId}` };
    }

    const assoc = disease.associatedTargets;
    const rows = assoc?.rows || [];

    const results = rows.map((r: any) => {
      const dtScores = (r.datatypeScores || [])
        .filter((d: any) => d.score > 0)
        .map((d: any) => `${d.id}: ${d.score.toFixed(3)}`)
        .join(', ');

      return [
        `Target: ${r.target.approvedSymbol} (${r.target.approvedName})`,
        `Ensembl ID: ${r.target.id}`,
        `Overall Score: ${r.score.toFixed(3)}`,
        `Datatype Scores: ${dtScores || 'N/A'}`,
      ].join('\n');
    });

    return {
      toolUseId: '',
      content: `Disease: ${disease.name}\nTotal associated targets: ${assoc?.count || 0}\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private async targetDiseases(ensemblId: string, maxResults: number): Promise<McpToolResult> {
    log.info('Open Targets target diseases', { ensemblId, maxResults });

    const query = `
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
    `;

    const data = await this.graphqlQuery(query, { ensemblId, size: maxResults });
    const target = data.target;

    if (!target) {
      return { toolUseId: '', content: `Target not found: ${ensemblId}` };
    }

    const assoc = target.associatedDiseases;
    const rows = assoc?.rows || [];

    const results = rows.map((r: any) => {
      const dtScores = (r.datatypeScores || [])
        .filter((d: any) => d.score > 0)
        .map((d: any) => `${d.id}: ${d.score.toFixed(3)}`)
        .join(', ');

      return [
        `Disease: ${r.disease.name}`,
        `EFO ID: ${r.disease.id}`,
        `Overall Score: ${r.score.toFixed(3)}`,
        `Datatype Scores: ${dtScores || 'N/A'}`,
      ].join('\n');
    });

    return {
      toolUseId: '',
      content: `Target: ${target.approvedSymbol} (${target.approvedName})\nTotal associated diseases: ${assoc?.count || 0}\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private async drugProfile(chemblId: string): Promise<McpToolResult> {
    log.info('Open Targets drug profile', { chemblId });

    const query = `
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
    `;

    const data = await this.graphqlQuery(query, { id: chemblId });
    const drug = data.drug;

    if (!drug) {
      return { toolUseId: '', content: `Drug not found: ${chemblId}` };
    }

    const moa = (drug.mechanismsOfAction?.rows || [])
      .map((m: any) => `- ${m.mechanismOfAction} (${m.actionType || 'N/A'}) → ${m.targetName || 'N/A'}`)
      .join('\n');

    const pgx = (drug.pharmacogenomics || [])
      .map((p: any) => `- ${p.variantRsId} [${p.genotype}]: ${p.phenotypeText} (${p.pgxCategory})`)
      .join('\n');

    const ae = (drug.adverseEvents?.rows || [])
      .map((e: any) => `- ${e.name} (MedDRA: ${e.meddraCode}, count: ${e.count}, LLR: ${e.llr?.toFixed(2) || 'N/A'})`)
      .join('\n');

    return {
      toolUseId: '',
      content: [
        `Drug: ${drug.name}`,
        `Approved: ${drug.isApproved ? 'Yes' : 'No'}`,
        `Type: ${drug.drugType || 'N/A'}`,
        `Max Clinical Trial Phase: ${drug.maximumClinicalTrialPhase ?? 'N/A'}`,
        ``,
        `Mechanisms of Action:`,
        moa || '(None listed)',
        ``,
        `Pharmacogenomics:`,
        pgx || '(None listed)',
        ``,
        `Adverse Events (${drug.adverseEvents?.count || 0} total):`,
        ae || '(None listed)',
      ].join('\n'),
    };
  }
}
