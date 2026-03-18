/**
 * CerberusAgent — USDA FoodData Central MCP Connector
 *
 * Provides nutritional composition data for the Transversalité head.
 * Uses the USDA FoodData Central API (free, API key required).
 *
 * Tools:
 * - fdc_search: Search foods by name
 * - fdc_get_food: Get detailed nutritional profile by FDC ID
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpConnector, McpToolResult } from './mcp-connector.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('mcp:fooddata');

const FDC_BASE = 'https://api.nal.usda.gov/fdc/v1';

export class FoodDataConnector extends McpConnector {
  readonly name = 'fooddata';
  readonly description = 'Search USDA FoodData Central for nutritional composition data';

  private get apiKey(): string {
    return process.env.FDC_API_KEY || 'DEMO_KEY';
  }

  getTools(): Anthropic.Tool[] {
    return [
      {
        name: 'fdc_search',
        description:
          'Search USDA FoodData Central for foods by name. Returns food descriptions, FDC IDs, and data types. ' +
          'Use Foundation and SR Legacy for best data quality.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Food search query (e.g., "broccoli raw", "turmeric")' },
            data_types: {
              type: 'array',
              items: { type: 'string' },
              description: 'Data types to search (default: ["Foundation", "SR Legacy"])',
            },
            max_results: { type: 'number', description: 'Max results (default: 10, max: 50)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'fdc_get_food',
        description:
          'Get detailed nutritional profile of a food by its FDC ID. Returns nutrient amounts per 100g ' +
          'with optional filtering by nutrient IDs.',
        input_schema: {
          type: 'object' as const,
          properties: {
            fdc_id: { type: 'number', description: 'FoodData Central food ID' },
            nutrients: {
              type: 'array',
              items: { type: 'number' },
              description: 'Nutrient IDs to filter (e.g., [328, 401, 303] for Vit D, Vit C, Iron)',
            },
          },
          required: ['fdc_id'],
        },
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<McpToolResult> {
    try {
      switch (toolName) {
        case 'fdc_search':
          return await this.search(input);
        case 'fdc_get_food':
          return await this.getFood(input.fdc_id as number, input.nutrients as number[] | undefined);
        default:
          return { toolUseId: '', content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (error) {
      log.error('Tool execution failed', { toolName, error: String(error) });
      return { toolUseId: '', content: `Error: ${String(error)}`, isError: true };
    }
  }

  private async search(input: Record<string, unknown>): Promise<McpToolResult> {
    const query = input.query as string;
    const dataTypes = (input.data_types as string[]) || ['Foundation', 'SR Legacy'];
    const maxResults = Math.min((input.max_results as number) || 10, 50);

    log.info('FoodData search', { query, dataTypes, maxResults });

    const url = `${FDC_BASE}/foods/search?api_key=${this.apiKey}`;
    const body = JSON.stringify({
      query,
      dataType: dataTypes,
      pageSize: maxResults,
      requireAllWords: true,
      sortBy: 'score',
      sortOrder: 'desc',
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => '(unreadable)');
        throw new Error(`HTTP ${response.status} from FoodData: ${errBody.slice(0, 200)}`);
      }

      const data = await response.json() as any;
      const foods = data.foods || [];

      if (foods.length === 0) {
        return { toolUseId: '', content: 'No foods found for this query.' };
      }

      const results = foods.map((f: any) =>
        [
          `FDC ID: ${f.fdcId}`,
          `Description: ${f.description || 'N/A'}`,
          `Data Type: ${f.dataType || 'N/A'}`,
          `Published: ${f.publishedDate || 'N/A'}`,
          `Brand: ${f.brandOwner || 'N/A'}`,
        ].join('\n')
      );

      return {
        toolUseId: '',
        content: `Found ${data.totalHits || foods.length} foods (showing ${foods.length}):\n\n${results.join('\n\n---\n\n')}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async getFood(fdcId: number, nutrients?: number[]): Promise<McpToolResult> {
    log.info('FoodData get food', { fdcId, nutrients });

    let url = `${FDC_BASE}/food/${fdcId}?api_key=${this.apiKey}&format=full`;
    if (nutrients && nutrients.length > 0) {
      url += `&nutrients=${nutrients.join(',')}`;
    }

    const res = await this.fetchWithTimeout(url);
    const data = await res.json() as any;

    if (!data.description) {
      return { toolUseId: '', content: `Food not found: FDC ID ${fdcId}` };
    }

    const nutrientsList = (data.foodNutrients || [])
      .filter((n: any) => n.nutrient && n.amount !== undefined)
      .map((n: any) => {
        const parts = [`  ${n.nutrient.name}: ${n.amount} ${n.nutrient.unitName}`];
        if (n.min !== undefined) parts.push(`min: ${n.min}`);
        if (n.max !== undefined) parts.push(`max: ${n.max}`);
        if (n.median !== undefined) parts.push(`median: ${n.median}`);
        return parts.join(' | ');
      })
      .join('\n');

    const portions = (data.foodPortions || [])
      .map((p: any) =>
        `  ${p.amount || ''} ${p.measureUnit?.name || p.modifier || 'unit'} = ${p.gramWeight || '?'}g`
      )
      .join('\n');

    return {
      toolUseId: '',
      content: [
        `FDC ID: ${fdcId}`,
        `Description: ${data.description}`,
        `Data Type: ${data.dataType || 'N/A'}`,
        `Category: ${data.foodCategory?.description || 'N/A'}`,
        ``,
        `Nutrients (per 100g):`,
        nutrientsList || '(No nutrient data)',
        ``,
        `Portions:`,
        portions || '(No portion data)',
      ].join('\n'),
    };
  }
}
