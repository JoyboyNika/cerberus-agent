/**
 * CerberusAgent — Gateway Entry Point
 *
 * Jalon 1: Health check endpoint + system verification.
 * Jalon 2 will add: WebSocket server, API routing, LLM coordination.
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { config } from 'dotenv';
import { buildSystemBlocks, getPromptText } from './prompts/prompt-builder.js';
import { SessionManager } from './session/session-manager.js';
import { AgentId } from './types/index.js';

config(); // Load .env

const PORT = parseInt(process.env.GATEWAY_PORT || '3000', 10);

// === Startup verification ===

function verifyPrompts(): boolean {
  const agents: AgentId[] = ['body', 'rigueur', 'transversalite', 'curiosite', 'arbitre'];
  let ok = true;

  for (const agent of agents) {
    try {
      const blocks = buildSystemBlocks(agent);
      console.log(`[BOOT] ✅ Prompt ${agent}: ${blocks[0].text.length} chars, cache_control=${!!blocks[0].cache_control}`);
    } catch (err) {
      console.error(`[BOOT] ❌ Prompt ${agent}: MISSING OR UNREADABLE`);
      ok = false;
    }
  }

  return ok;
}

function verifySession(): boolean {
  try {
    const session = SessionManager.create();
    console.log(`[BOOT] ✅ Session manager: sessionId=${session.sessionId}`);
    session.close();
    return true;
  } catch (err) {
    console.error(`[BOOT] ❌ Session manager: ${err}`);
    return false;
  }
}

// === HTTP server (health + future API) ===

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'cerberus-agent-gateway',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Future: WebSocket upgrade, API routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// === Boot sequence ===

console.log('\n=== CerberusAgent Gateway ===');
console.log(`[BOOT] Port: ${PORT}`);
console.log(`[BOOT] Node: ${process.version}`);
console.log(`[BOOT] Models: body=${process.env.MODEL_BODY || 'not set'}, heads=${process.env.MODEL_HEADS || 'not set'}`);
console.log('');

const promptsOk = verifyPrompts();
const sessionOk = verifySession();

console.log('');

if (promptsOk && sessionOk) {
  server.listen(PORT, () => {
    console.log(`[BOOT] ✅ Gateway listening on http://localhost:${PORT}`);
    console.log(`[BOOT] ✅ Health check: http://localhost:${PORT}/health`);
    console.log('');
  });
} else {
  console.error('[BOOT] ❌ Startup verification failed. Fix errors above.');
  process.exit(1);
}
