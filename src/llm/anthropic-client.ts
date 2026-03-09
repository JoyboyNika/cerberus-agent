/**
 * CerberusAgent — Anthropic Client Wrapper
 *
 * Thin wrapper around the Anthropic SDK providing:
 * - Cache-aware system blocks (prompt caching)
 * - Token usage tracking
 * - Fallback chain (Opus → Sonnet → Haiku)
 * - Context overflow detection (NO fallback on overflow)
 * - Raw response access (for tool_use blocks)
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

export interface LlmRawResponse {
  rawContent: Anthropic.ContentBlock[];
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
   * Send a message and get text content back.
   */
  async sendMessage(request: LlmRequest): Promise<LlmResponse> {
    const raw = await this.sendRaw(request);
    const content = raw.rawContent
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    return {
      content,
      tokenUsage: raw.tokenUsage,
      model: raw.model,
      stopReason: raw.stopReason,
      durationMs: raw.durationMs,
    };
  }

  /**
   * Send a message and get raw content blocks back.
   */
  async sendRaw(request: LlmRequest): Promise<LlmRawResponse> {
    const start = Date.now();

    try {
      const response = await this.client.messages.create({
        model: request.model,
        max_tokens: request.maxTokens || 4096,
        system: request.systemBlocks,
        messages: request.messages,
        ...(request.tools && request.tools.length > 0 ? { tools: request.tools } : {}),
      });

      const tokenUsage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: (response.usage as any).cache_read_input_tokens || 0,
        cacheCreationTokens: (response.usage as any).cache_creation_input_tokens || 0,
      };

      return {
        rawContent: response.content,
        tokenUsage,
        model: request.model,
        stopReason: response.stop_reason,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      // CRITICAL: Context overflow errors must NOT trigger fallback.
      // A smaller model has a smaller (or equal) context window,
      // so falling back would make the problem worse.
      // Pattern from OpenClaw's model-fallback.ts.
      if (this.isContextOverflowError(error)) {
        console.error(`[LLM] Context overflow on ${request.model} \u2014 NOT falling back (smaller model would be worse)`);
        throw error;
      }

      // Fallback on retryable errors (rate limit, server error, connection)
      if (this.isRetryable(error) && request.model !== FALLBACK_CHAIN[FALLBACK_CHAIN.length - 1]) {
        const nextModel = this.getNextFallback(request.model);
        if (nextModel) {
          console.warn(`[LLM] Fallback: ${request.model} \u2192 ${nextModel} (${this.getErrorCode(error)})`);
          return this.sendRaw({ ...request, model: nextModel });
        }
      }
      throw error;
    }
  }

  /**
   * Detect context overflow errors.
   * Anthropic returns 400 with specific error messages for context overflow.
   */
  private isContextOverflowError(error: unknown): boolean {
    if (error instanceof Anthropic.BadRequestError) {
      const message = error.message.toLowerCase();
      return (
        message.includes('context') ||
        message.includes('too many tokens') ||
        message.includes('maximum context length') ||
        message.includes('prompt is too long')
      );
    }
    return false;
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
