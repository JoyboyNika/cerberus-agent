/**
 * CerberusAgent — WebSocket Server
 *
 * Bridges transcript events to connected Cockpit clients.
 * Each client subscribes to a session and receives real-time
 * events as they are appended to the transcript.
 *
 * Protocol:
 * - Client sends: { type: 'subscribe', sessionId: string }
 * - Server sends: SessionEvent objects as they occur
 * - Server sends: { type: 'ping' } every 30s for keepalive
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { onTranscriptUpdate } from '../session/transcript-emitter.js';
import { SessionEvent } from '../session/types.js';
import { createLogger } from '../llm/logger.js';

const log = createLogger('websocket');

interface ConnectedClient {
  ws: WebSocket;
  sessionId: string | null;
  connectedAt: number;
}

export function initWebSocketServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const clients = new Set<ConnectedClient>();

  // Subscribe to transcript events and broadcast to relevant clients
  onTranscriptUpdate((event: SessionEvent, sessionId: string) => {
    for (const client of clients) {
      if (client.sessionId === sessionId && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify({
            type: 'transcript_event',
            sessionId,
            event,
          }));
        } catch (err) {
          log.error('Failed to send event to client', { error: String(err) });
        }
      }
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    const client: ConnectedClient = { ws, sessionId: null, connectedAt: Date.now() };
    clients.add(client);

    log.info('Client connected', { totalClients: clients.size });

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'subscribe' && typeof msg.sessionId === 'string') {
          client.sessionId = msg.sessionId;
          log.info('Client subscribed', { sessionId: msg.sessionId });

          ws.send(JSON.stringify({
            type: 'subscribed',
            sessionId: msg.sessionId,
          }));
        }
      } catch (err) {
        log.warn('Invalid message from client', { error: String(err) });
      }
    });

    ws.on('close', () => {
      clients.delete(client);
      log.info('Client disconnected', { totalClients: clients.size });
    });

    ws.on('error', (err) => {
      log.error('WebSocket error', { error: String(err) });
      clients.delete(client);
    });
  });

  // Keepalive ping every 30s
  const pingInterval = setInterval(() => {
    for (const client of clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
      }
    }
  }, 30_000);

  wss.on('close', () => clearInterval(pingInterval));

  log.info('WebSocket server initialized', { path: '/ws' });
  return wss;
}
