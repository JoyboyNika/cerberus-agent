/**
 * CerberusAgent — Gateway Entry Point
 *
 * Jalon 6: WebSocket for Cockpit real-time streaming.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { loadConfig, AppConfig } from './config.js';
import { AnthropicClient } from './llm/anthropic-client.js';
import { ConnectorRegistry } from './mcp/connector-registry.js';
import { PubMedConnector } from './mcp/pubmed-connector.js';
import { OpenAlexConnector } from './mcp/openAlex-connector.js';
import { ClinicalTrialsConnector } from './mcp/clinicaltrials-connector.js';
import { OpenTargetsConnector } from './mcp/opentargets-connector.js';
import { SemanticScholarConnector } from './mcp/semantic-scholar-connector.js';
import { FoodDataConnector } from './mcp/fooddata-connector.js';
import { Orchestrator } from './gateway/orchestrator.js';
import { initWebSocketServer } from './gateway/websocket-server.js';
import { SessionManager } from './session/session-manager.js';
import { buildSystemBlocks } from './prompts/prompt-builder.js';
import { createLogger } from './llm/logger.js';
import { AgentId, HeadId } from './types/index.js';

const log = createLogger('gateway');

function initRegistry(): ConnectorRegistry {
  const registry = new ConnectorRegistry();
  registry.registerForHead('rigueur', new PubMedConnector([
    '"systematic review"[pt] OR "meta-analysis"[pt] OR "randomized controlled trial"[pt] OR "practice guideline"[pt]',
  ]));
  registry.registerForHead('transversalite', new PubMedConnector([
    '"complementary therapies"[mesh] OR "phytotherapy"[mesh] OR "diet therapy"[mesh] OR "herbal medicine"[mesh]',
  ]));
  registry.registerForHead('transversalite', new ClinicalTrialsConnector());
  registry.registerForHead('transversalite', new OpenTargetsConnector());
  registry.registerForHead('transversalite', new FoodDataConnector());
  registry.registerForHead('curiosite', new OpenAlexConnector());
  registry.registerForHead('curiosite', new SemanticScholarConnector());
  log.info('Connector registry initialized', { summary: registry.getSummary() });
  return registry;
}

function verifyPrompts(): boolean {
  const agents: AgentId[] = ['body', 'rigueur', 'transversalite', 'curiosite', 'arbitre', 'greffier'];
  let ok = true;
  for (const agent of agents) {
    try {
      const blocks = buildSystemBlocks(agent);
      log.info('Prompt loaded', { agent, chars: blocks[0].text.length });
    } catch (err) {
      log.error('Prompt missing', { agent, error: String(err) });
      ok = false;
    }
  }
  return ok;
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function createRouter(config: AppConfig, orchestrator: Orchestrator) {
  const sessions = new Map<string, { manager: SessionManager; turn: number }>();

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '';
    const method = req.method || 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (url === '/health' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'ok', service: 'cerberus-agent-gateway', version: '0.4.0',
        timestamp: new Date().toISOString(), activeSessions: sessions.size,
      });
    }

    if (url === '/api/session' && method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const query = body.query as string;
        if (!query) return sendJson(res, 400, { error: 'Missing "query"' });
        const manager = SessionManager.create(config.session.dataDir);
        await manager.startSession(query);
        sessions.set(manager.sessionId, { manager, turn: 0 });
        log.info('Session created', { sessionId: manager.sessionId });
        return sendJson(res, 201, { sessionId: manager.sessionId });
      } catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }
    }

    // List active sessions
    if (url === '/api/sessions' && method === 'GET') {
      const list = Array.from(sessions.entries()).map(([id, s]) => ({ sessionId: id, turn: s.turn }));
      return sendJson(res, 200, { sessions: list });
    }

    const costMatch = url.match(/^\/api\/session\/([^\/]+)\/cost$/);
    if (costMatch && method === 'GET') {
      return sendJson(res, 200, orchestrator.getCostSummary());
    }

    const turnMatch = url.match(/^\/api\/session\/([^\/]+)\/turn$/);
    if (turnMatch && method === 'POST') {
      const sessionId = turnMatch[1];
      const session = sessions.get(sessionId);
      if (!session) return sendJson(res, 404, { error: 'Session not found' });

      let turnQuery: string;
      try { const body = JSON.parse(await readBody(req)); turnQuery = body.query as string || ''; }
      catch { turnQuery = ''; }

      if (!turnQuery && session.turn === 0) {
        const transcript = session.manager.readTranscript();
        const startEvent = transcript.find((e) => e.type === 'session_start');
        turnQuery = startEvent && 'query' in startEvent ? startEvent.query : '';
      }
      if (!turnQuery) return sendJson(res, 400, { error: 'Missing "query"' });

      session.turn++;
      try {
        const result = await orchestrator.executeTurn(turnQuery, session.turn, session.manager);
        await session.manager.append({ type: 'turn_start', sessionId, timestamp: new Date().toISOString(), turn: session.turn, query: turnQuery });
        for (const headId of ['rigueur', 'transversalite', 'curiosite'] as const) {
          const hr = result.headResults[headId];
          await session.manager.append({ type: 'head_report', sessionId, timestamp: new Date().toISOString(), turn: session.turn, head: headId, report: hr.report, tokenUsage: hr.totalTokenUsage, durationMs: hr.durationMs });
        }
        await session.manager.append({ type: 'body_synthesis', sessionId, timestamp: new Date().toISOString(), turn: session.turn, response: result.bodySynthesis, disagreementDetected: result.disagreementDetected, feedbackSent: result.feedbackLoops, recommendContinue: result.recommendContinue });

        const costSummary = orchestrator.getCostSummary();
        return sendJson(res, 200, {
          turn: session.turn, synthesis: result.bodySynthesis,
          heads: Object.fromEntries((['rigueur', 'transversalite', 'curiosite'] as HeadId[]).map(id => [id, {
            confidence: result.headResults[id].report.niveauConfiance, neant: result.headResults[id].report.neant,
            toolCalls: result.headResults[id].toolCallCount, durationMs: result.headResults[id].durationMs, loopDetected: result.headResults[id].loopDetected,
          }])),
          disagreement: result.disagreementDetected, arbitreInvoked: result.arbitreInvoked,
          recommendContinue: result.recommendContinue, feedbackLoops: result.feedbackLoops, windowSlid: result.windowSlid,
          cost: { turnCostUsd: result.costBreakdown.totalCost, sessionTotalUsd: costSummary.totalCostUsd, budgetRemainingUsd: costSummary.budgetRemainingUsd, budgetWarning: costSummary.budgetWarning },
          totalTokenUsage: result.totalTokenUsage, durationMs: result.durationMs,
        });
      } catch (error) {
        log.error('Turn failed', { sessionId, turn: session.turn, error: String(error) });
        await session.manager.append({ type: 'error', sessionId, timestamp: new Date().toISOString(), turn: session.turn, errorCode: 'TURN_FAILED', errorMessage: String(error), recoverable: true });
        return sendJson(res, 500, { error: 'Turn failed', details: String(error) });
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  };
}

async function main() {
  console.log('\n=== CerberusAgent Gateway ===\n');
  let config: AppConfig;
  try { config = loadConfig(); } catch (err) { log.error('Config error', { error: String(err) }); process.exit(1); }
  log.info('Config loaded', { port: config.server.port, modelBody: config.models.body, modelHeads: config.models.heads });
  if (!verifyPrompts()) { log.error('Prompt verification failed'); process.exit(1); }

  // Clean expired sessions at boot
  SessionManager.cleanExpiredSessions(30, config.session.dataDir);

  const client = new AnthropicClient(config.anthropic.apiKey);
  const registry = initRegistry();
  const orchestrator = new Orchestrator(config, client, registry);

  const handler = createRouter(config, orchestrator);
  const server = createServer(handler);

  // WebSocket server for Cockpit real-time streaming
  initWebSocketServer(server);

  server.listen(config.server.port, () => {
    log.info('Gateway listening', {
      url: `http://localhost:${config.server.port}`,
      ws: `ws://localhost:${config.server.port}/ws`,
      endpoints: ['GET /health', 'GET /api/sessions', 'POST /api/session', 'POST /api/session/:id/turn', 'GET /api/session/:id/cost', 'WS /ws'],
    });
  });
}

main().catch((err) => { log.error('Fatal', { error: String(err) }); process.exit(1); });
