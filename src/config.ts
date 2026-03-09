/**
 * CerberusAgent — Configuration
 *
 * Centralized config loaded from environment variables.
 * Single source of truth for all runtime settings.
 */

import { config as dotenvConfig } from 'dotenv';
import { ModelConfig } from './types/index.js';

dotenvConfig();

export interface AppConfig {
  models: ModelConfig;
  server: {
    port: number;
  };
  session: {
    dataDir: string;
  };
  anthropic: {
    apiKey: string;
  };
  pipeline: {
    defaultMaxTurns: number;
    visibleTurns: number;
  };
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    models: {
      body: process.env.MODEL_BODY || 'claude-sonnet-4-20250514',
      heads: process.env.MODEL_HEADS || 'claude-sonnet-4-20250514',
      arbitre: process.env.MODEL_ARBITRE || 'claude-opus-4-20250514',
      greffier: process.env.MODEL_GREFFIER || 'claude-haiku-4-20250414',
    },
    server: {
      port: parseInt(process.env.GATEWAY_PORT || '3000', 10),
    },
    session: {
      dataDir: process.env.SESSION_DATA_DIR || './data/sessions',
    },
    anthropic: {
      apiKey: requireEnv('ANTHROPIC_API_KEY'),
    },
    pipeline: {
      defaultMaxTurns: 20,
      visibleTurns: 5,
    },
  };
}
