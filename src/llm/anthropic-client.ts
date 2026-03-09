/**
 * CerberusAgent — Anthropic Client Wrapper
 *
 * Thin wrapper around the Anthropic SDK providing:
 * - Cache-aware system blocks (prompt caching)
 * - Token usage tracking
 * - Fallback chain (Opus → Sonnet → Haiku)
 * - Structured error handling
 */

import Anthropic from '@anthropic-ai/sdk';
import { SystemBlock, TokenUsage } from '../types/index.js';

const FALLBACK_CHAIN = [
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-haiku-4-20250414',
];

export interface LlmRequest {
  model: string;
  systemBlocks: SystemBlock[];
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  tools?: Anthropic.Tool[];
}

export interface LlmResponse {
  content: string;
  tokenUsage: TokenUsage;
  model: string;
  stopReason: string | null;
  durationMs: number;
}

export class AnthropicClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  /**
   * Send a message to Claude with cache-aware system blocks.
   *
   * The systemBlocks should come from prompt-builder.ts and
   * include cache_control markers for prompt caching.
   */
  async sendMessage(request: LlmRequest): Promise<LlmResponse> {
    const start = Date.now();

    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens || 4096,
        system: request.systemBlocks,
        messages: request.messages,
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
      });

      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      const tokenUsage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: (response.usage as any).cache_read_input_tokens || 0,
        cacheCreationTokens: (response.usage as any).cache_creation_input_tokens || 0,
      };

      return {
        content,
        tokenUsage,
        model: request.model,
        stopReason: response.stop_reason,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      // Attempt fallback if rate limited or model unavailable
      if (this.isRetryable(error) && request.model !== FALLBACK_CHAIN[FALLBACK_CHAIN.length - 1]) {
        const nextModel = this.getNextFallback(request.model);
        if (nextModel) {
          console.warn(`[LLM] Fallback: ${request.model} → ${nextModel} (${this.getErrorCode(error)})`);
          return this.sendMessage({ ...request, model: nextModel });
        }
      }
      throw error;
    }
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof Anthropic.RateLimitError) return true;
    if (error instanceof Anthropic.InternalServerError) return true;
    if (error instanceof Anthropic.APIConnectionError) return true;
    return false;
  }

  private getErrorCode(error: unknown): string {
    if (error instanceof Anthropic.APIError) return `${error.status}`;
    return 'unknown';
  }

  private getNextFallback(currentModel: string): string | null {
    const idx = FALLBACK_CHAIN.indexOf(currentModel);
    if (idx === -1 || idx >= FALLBACK_CHAIN.length - 1) return null;
    return FALLBACK_CHAIN[idx + 1];
  }
}
