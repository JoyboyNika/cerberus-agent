/**
 * CerberusAgent — ClinicalTrials.gov MCP Connector
 *
 * Provides clinical trial search for the Transversalité head.
 * Uses the ClinicalTrials.gov API v2 (free, no API key required).
 *
 * Tools:
 * - ct_search: Search ClinicalTrials.gov for clinical trials
 * - ct_get_study: Get full details of a clinical trial by NCT ID
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpConnector, McpToolResult } from './mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('mcp:clinicaltrials');

const CT_BASE = 'https://clinicaltrials.gov/api/v2';

export class ClinicalTrialsConnector extends McpConnector {
  readonly name = 'clinicaltrials';
  readonly description = 'Search ClinicalTrials.gov for clinical trials';

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'ct_search',
        description:
          'Search ClinicalTrials.gov for clinical trials by condition and/or intervention. ' +
          'Returns trial ID (NCT), title, status, phase, and enrollment.',
        input_schema: {
          type: 'object' as const,
          properties: {
            condition: {
              type: 'string',
              description: 'Disease or condition to search for',
            },
            intervention: {
              type: 'string',
              description: 'Treatment or intervention (optional)',
            },
            status: {
              type: 'string',
              description: 'Trial status filter (default: "RECRUITING,NOT_YET_RECRUITING")',
            },
            phase: {
              type: 'string',
              description: 'Phase filter: PHASE1, PHASE2, PHASE3, PHASE4',
            },
            max_results: {
              type: 'number',
              description: 'Maximum results to return (default: 20, max: 50)',
            },
          },
          required: ['condition'],
        },
      },
      {
        name: 'ct_get_study',
        description:
          'Get full details of a clinical trial by its NCT ID. ' +
          'Returns protocol, eligibility criteria, interventions, outcomes, and results if available.',
        input_schema: {
          type: 'object' as const,
          properties: {
            nct_id: {
              type: 'string',
              description: 'ClinicalTrials.gov NCT ID (e.g., "NCT04381936")',
            },
          },
          required: ['nct_id'],
        },
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (toolName) {
        case 'ct_search':
          return await this.search(input);
        case 'ct_get_study':
          return await this.getStudy(input.nct_id as string);
        default:
          return { toolUseId: '', content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (error) {
      log.error('Tool execution failed', { toolName, error: String(error) });
      return { toolUseId: '', content: `Error: ${String(error)}`, isError: true };
    }
  }

  private async search(input: Record<string, unknown>): Promise<McpToolResult> {
    const condition = input.condition as string;
    const intervention = input.intervention as string | undefined;
    const status = (input.status as string) || 'RECRUITING,NOT_YET_RECRUITING';
    const phase = input.phase as string | undefined;
    const maxResults = Math.min((input.max_results as number) || 20, 50);

    log.info('ClinicalTrials search', { condition, intervention, status, phase, maxResults });

    const params = new URLSearchParams({
      'query.cond': condition,
      'filter.overallStatus': status,
      pageSize: String(maxResults),
      sort: 'LastUpdatePostDate:desc',
      format: 'json',
      countTotal: 'true',
      fields: 'NCTId|BriefTitle|OverallStatus|Phase|EnrollmentCount|StartDate|CompletionDate|LeadSponsorName|BriefSummary|HasResults',
    });

    if (intervention) params.set('query.intr', intervention);
    if (phase) params.set('filter.phase', phase);

    const url = `${CT_BASE}/studies?${params.toString()}`;
    const res = await this.fetchWithTimeout(url);
    const data = await res.json() as any;

    const studies = data.studies || [];
    if (studies.length === 0) {
      return { toolUseId: '', content: 'No clinical trials found for this query.' };
    }

    const totalCount = data.totalCount || studies.length;

    const results = studies.map((s: any) => {
      const proto = s.protocolSection || {};
      const id = proto.identificationModule || {};
      const status = proto.statusModule || {};
      const design = proto.designModule || {};
      const sponsor = proto.sponsorCollaboratorsModule || {};
      const desc = proto.descriptionModule || {};

      return [
        `NCT ID: ${id.nctId || 'N/A'}`,
        `Title: ${id.briefTitle || 'N/A'}`,
        `Status: ${status.overallStatus || 'N/A'}`,
        `Phase: ${(design.phases || []).join(', ') || 'N/A'}`,
        `Enrollment: ${design.enrollmentInfo?.count || 'N/A'}`,
        `Start: ${status.startDateStruct?.date || 'N/A'}`,
        `Completion: ${status.completionDateStruct?.date || 'N/A'}`,
        `Sponsor: ${sponsor.leadSponsor?.name || 'N/A'}`,
        `Has Results: ${s.hasResults || false}`,
        `Summary: ${(desc.briefSummary || 'N/A').slice(0, 300)}`,
      ].join('\n');
    });

    return {
      toolUseId: '',
      content: `Found ${totalCount} trials (showing ${studies.length}):\n\n${results.join('\n\n---\n\n')}`,
    };
  }

  private async getStudy(nctId: string): Promise<McpToolResult> {
    log.info('ClinicalTrials get study', { nctId });

    const url = `${CT_BASE}/studies/${encodeURIComponent(nctId)}?format=json`;
    const res = await this.fetchWithTimeout(url);
    const data = await res.json() as any;

    const proto = data.protocolSection || {};
    const id = proto.identificationModule || {};
    const statusMod = proto.statusModule || {};
    const design = proto.designModule || {};
    const arms = proto.armsInterventionsModule || {};
    const eligibility = proto.eligibilityModule || {};
    const outcomes = proto.outcomesModule || {};
    const sponsor = proto.sponsorCollaboratorsModule || {};
    const desc = proto.descriptionModule || {};
    const hasResults = data.hasResults || false;
    const results = data.resultsSection || {};

    const interventionsList = (arms.interventions || [])
      .map((i: any) => `- ${i.type || 'N/A'}: ${i.name || 'N/A'} — ${i.description || ''}`.trim())
      .join('\n');

    const armsList = (arms.armGroups || [])
      .map((a: any) => `- ${a.label || 'N/A'} (${a.type || 'N/A'}): ${a.description || ''}`.trim())
      .join('\n');

    const primaryOutcomes = (outcomes.primaryOutcomes || [])
      .map((o: any) => `- ${o.measure || 'N/A'} [${o.timeFrame || 'N/A'}]`)
      .join('\n');

    const secondaryOutcomes = (outcomes.secondaryOutcomes || [])
      .map((o: any) => `- ${o.measure || 'N/A'} [${o.timeFrame || 'N/A'}]`)
      .join('\n');

    const sections = [
      `NCT ID: ${id.nctId || nctId}`,
      `Title: ${id.briefTitle || 'N/A'}`,
      `Official Title: ${id.officialTitle || 'N/A'}`,
      `Status: ${statusMod.overallStatus || 'N/A'}`,
      `Phase: ${(design.phases || []).join(', ') || 'N/A'}`,
      `Study Type: ${design.studyType || 'N/A'}`,
      `Sponsor: ${sponsor.leadSponsor?.name || 'N/A'}`,
      `Enrollment: ${design.enrollmentInfo?.count || 'N/A'} (${design.enrollmentInfo?.type || 'N/A'})`,
      ``,
      `Description:`,
      desc.briefSummary || '(No description)',
      ``,
      `Interventions:`,
      interventionsList || '(None listed)',
      ``,
      `Arms:`,
      armsList || '(None listed)',
      ``,
      `Eligibility:`,
      `  Sex: ${eligibility.sex || 'N/A'}`,
      `  Min Age: ${eligibility.minimumAge || 'N/A'}`,
      `  Max Age: ${eligibility.maximumAge || 'N/A'}`,
      `  Criteria: ${eligibility.eligibilityCriteria || 'N/A'}`,
      ``,
      `Primary Outcomes:`,
      primaryOutcomes || '(None listed)',
      ``,
      `Secondary Outcomes:`,
      secondaryOutcomes || '(None listed)',
      ``,
      `Has Results: ${hasResults}`,
    ];

    if (hasResults && results.baselineCharacteristicsModule) {
      sections.push(
        ``,
        `Results Summary:`,
        `  Participants: ${results.participantFlowModule?.recruitmentDetails || 'N/A'}`,
      );
    }

    return { toolUseId: '', content: sections.join('\n') };
  }
}
