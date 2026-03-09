/**
 * CerberusAgent — Gateway Entry Point
 *
 * Jalon 2: Full pipeline wiring.
 * - HTTP health check
 * - POST /api/query → single turn through 3 heads + Body
 * - Connector registry with physical isolation per head
 * - Session management with JSONL transcripts
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { loadConfig, AppConfig } from './config.js';
import { AnthropicClient } from './llm/anthropic-client.js';
import { ConnectorRegistry } from './mcp/connector-registry.js';
import { PubMedConnector } from './mcp/pubmed-connector.js';
import { OpenAlexConnector } from './mcp/openAlex-connector.js';
import { Orchestrator, TurnResult } from './gateway/orchestrator.js';
import { SessionManager } from './session/session-manager.js';
import { buildSystemBlocks } from './prompts/prompt-builder.js';
import { createLogger } from './llm/logger.js';
import { AgentId } from './types/index.js';

const log = createLogger('gateway');

// === Initialization ===

function initRegistry(): ConnectorRegistry {
  const registry = new ConnectorRegistry();

  // Rigueur: PubMed with EBM filters
  registry.registerForHead('rigueur', new PubMedConnector([
    '"systematic review"[pt] OR "meta-analysis"[pt] OR "randomized controlled trial"[pt] OR "practice guideline"[pt]',
  ]));

  // Transversalité: PubMed with alternative medicine filters
  registry.registerForHead('transversalite', new PubMedConnector([
    '"complementary therapies"[mesh] OR "phytotherapy"[mesh] OR "diet therapy"[mesh] OR "herbal medicine"[mesh]',
  ]));

  // Curiosité: OpenAlex (non-medical academic)
  registry.registerForHead('curiosite', new OpenAlexConnector());

  log.info('Connector registry initialized', { summary: registry.getSummary() });
  return registry;
}

function verifyPrompts(): boolean {
  const agents: AgentId[] = ['body', 'rigueur', 'transversalite', 'curiosite', 'arbitre'];
  let ok = true;
  for (const agent of agents) {
    try {
      const blocks = buildSystemBlocks(agent);
      log.info('Prompt loaded', {
        agent,
        chars: blocks[0].text.length,
        cacheControl: !!blocks[0].cache_control,
      });
    } catch (err) {
      log.error('Prompt missing', { agent, error: String(err) });
      ok = false;
    }
  }
  return ok;
}

// === HTTP request handling ===

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function createRouter(config: AppConfig, orchestrator: Orchestrator) {
  // Active sessions keyed by sessionId
  const sessions = new Map<string, { manager: SessionManager; turn: number; history: string }>();

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '';
    const method = req.method || 'GET';

    // Health check
    if (url === '/health' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok',
        service: 'cerberus-agent-gateway',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
      });
    }

    // Start a new consultation session
    if (url === '/api/session' && method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const query = body.query as string;
      if (!query) {
        return sendJson(res, 400, { error: 'Missing "query" field' });
      }

      const manager = SessionManager.create(config.session.dataDir);
      await manager.startSession(query);

      sessions.set(manager.sessionId, { manager, turn: 0, history: '' });

      log.info('Session created', { sessionId: manager.sessionId, query: query.slice(0, 100) });
      return sendJson(res, 201, { sessionId: manager.sessionId });
    }

    // Execute a turn in an existing session
    if (url.startsWith('/api/session/') && url.endsWith('/turn') && method === 'POST') {
      const sessionId = url.split('/')[3];
      const session = sessions.get(sessionId);

      if (!session) {
        return sendJson(res, 404, { error: 'Session not found' });
      }

      const body = JSON.parse(await readBody(req));
      const query = (body.query as string) || '';

      session.turn++;
      const effectiveQuery = query || (session.turn === 1 ? '' : '');

      // For turn 1, use the session's initial query if no override
      let turnQuery = query;
      if (!turnQuery && session.turn === 1) {
        const transcript = session.manager.readTranscript();
        const startEvent = transcript.find((e) => e.type === 'session_start');
        turnQuery = startEvent && 'query' in startEvent ? startEvent.query : '';
      }

      if (!turnQuery) {
        return sendJson(res, 400, { error: 'Missing "query" field' });
      }

      log.info('Turn starting', { sessionId, turn: session.turn });

      try {
        const result = await orchestrator.executeTurn(turnQuery, session.turn, session.history);

        // Record events in session
        await session.manager.append({
          type: 'turn_start',
          sessionId,
          timestamp: new Date().toISOString(),
          turn: session.turn,
          query: turnQuery,
        });

        for (const headId of ['rigueur', 'transversalite', 'curiosite'] as const) {
          const hr = result.headResults[headId];
          await session.manager.append({
            type: 'head_report',
            sessionId,
            timestamp: new Date().toISOString(),
            turn: session.turn,
            head: headId,
            report: hr.report,
            tokenUsage: hr.totalTokenUsage,
            durationMs: hr.durationMs,
          });
        }

        await session.manager.append({
          type: 'body_synthesis',
          sessionId,
          timestamp: new Date().toISOString(),
          turn: session.turn,
          response: result.bodySynthesis,
          disagreementDetected: result.disagreementDetected,
          feedbackSent: [],
          recommendContinue: result.recommendContinue,
        });

        // Append to history for next turn
        session.history += `\n\n--- Tour ${session.turn} ---\n${result.bodySynthesis}`;

        return sendJson(res, 200, {
          turn: session.turn,
          synthesis: result.bodySynthesis,
          heads: {
            rigueur: {
              confidence: result.headResults.rigueur.report.niveauConfiance,
              neant: result.headResults.rigueur.report.neant,
              toolCalls: result.headResults.rigueur.toolCallCount,
              durationMs: result.headResults.rigueur.durationMs,
            },
            transversalite: {
              confidence: result.headResults.transversalite.report.niveauConfiance,
              neant: result.headResults.transversalite.report.neant,
              toolCalls: result.headResults.transversalite.toolCallCount,
              durationMs: result.headResults.transversalite.durationMs,
            },
            curiosite: {
              confidence: result.headResults.curiosite.report.niveauConfiance,
              neant: result.headResults.curiosite.report.neant,
              toolCalls: result.headResults.curiosite.toolCallCount,
              durationMs: result.headResults.curiosite.durationMs,
            },
          },
          disagreement: result.disagreementDetected,
          recommendContinue: result.recommendContinue,
          totalTokenUsage: result.totalTokenUsage,
          durationMs: result.durationMs,
        });
      } catch (error) {
        log.error('Turn failed', { sessionId, turn: session.turn, error: String(error) });

        await session.manager.append({
          type: 'error',
          sessionId,
          timestamp: new Date().toISOString(),
          turn: session.turn,
          errorCode: 'TURN_FAILED',
          errorMessage: String(error),
          recoverable: true,
        });

        return sendJson(res, 500, { error: 'Turn execution failed', details: String(error) });
      }
    }

    // 404
    sendJson(res, 404, { error: 'Not found' });
  };
}

// === Boot sequence ===

async function main() {
  console.log('\n=== CerberusAgent Gateway ===\n');

  // Load config (will throw if ANTHROPIC_API_KEY missing)
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (err) {
    log.error('Config error', { error: String(err) });
    process.exit(1);
  }

  log.info('Config loaded', {
    port: config.server.port,
    node: process.version,
    modelBody: config.models.body,
    modelHeads: config.models.heads,
    modelArbitre: config.models.arbitre,
  });

  // Verify prompts
  if (!verifyPrompts()) {
    log.error('Prompt verification failed');
    process.exit(1);
  }

  // Init Anthropic client
  const client = new AnthropicClient(config.anthropic.apiKey);
  log.info('Anthropic client ready');

  // Init connector registry (physical isolation per head)
  const registry = initRegistry();

  // Init orchestrator
  const orchestrator = new Orchestrator(config, client, registry);
  log.info('Orchestrator ready');

  // Start HTTP server
  const handler = createRouter(config, orchestrator);
  const server = createServer(handler);

  server.listen(config.server.port, () => {
    log.info('Gateway listening', {
      url: `http://localhost:${config.server.port}`,
      endpoints: [
        'GET  /health',
        'POST /api/session         → { query }',
        'POST /api/session/:id/turn → { query? }',
      ],
    });
  });
}

main().catch((err) => {
  log.error('Fatal error', { error: String(err) });
  process.exit(1);
});
