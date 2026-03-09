/**
 * CerberusAgent — Session Manager
 *
 * Manages consultation sessions with JSONL transcripts.
 * Event-sourced: each event is appended as a JSON line.
 *
 * Integrates transcript emitter for real-time notifications
 * to Cockpit (J6) and Greffier (J4).
 */

import { createWriteStream, mkdirSync, readFileSync, existsSync, WriteStream } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { SessionEvent, SessionStartEvent, SessionEndEvent } from './types.js';
import { emitTranscriptUpdate } from './transcript-emitter.js';

const DEFAULT_DATA_DIR = process.env.SESSION_DATA_DIR || './data/sessions';

export class SessionManager {
  readonly sessionId: string;
  private readonly filePath: string;
  private readonly writeStream: WriteStream;
  private buffer: SessionEvent[] = [];
  private eventCount = 0;

  private constructor(sessionId: string, dataDir: string) {
    this.sessionId = sessionId;
    mkdirSync(dataDir, { recursive: true });
    this.filePath = join(dataDir, `${sessionId}.jsonl`);
    this.writeStream = createWriteStream(this.filePath, { flags: 'a' });
  }

  static create(dataDir: string = DEFAULT_DATA_DIR): SessionManager {
    return new SessionManager(randomUUID(), dataDir);
  }

  static load(sessionId: string, dataDir: string = DEFAULT_DATA_DIR): SessionManager {
    const manager = new SessionManager(sessionId, dataDir);
    const filePath = join(dataDir, `${sessionId}.jsonl`);

    if (existsSync(filePath)) {
      const lines = readFileSync(filePath, 'utf-8')
        .split('\n')
        .filter((line) => line.trim());

      for (const line of lines) {
        const event = JSON.parse(line) as SessionEvent;
        manager.buffer.push(event);
        manager.eventCount++;
      }
    }

    return manager;
  }

  async append(event: SessionEvent): Promise<void> {
    const line = JSON.stringify(event) + '\n';

    return new Promise((resolve, reject) => {
      this.writeStream.write(line, (err) => {
        if (err) {
          reject(err);
        } else {
          this.buffer.push(event);
          this.eventCount++;

          // Notify listeners (Cockpit, Greffier)
          emitTranscriptUpdate(event, this.sessionId);

          resolve();
        }
      });
    });
  }

  async startSession(query: string): Promise<void> {
    const event: SessionStartEvent = {
      type: 'session_start',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      query,
    };
    await this.append(event);
  }

  async endSession(totalTurns: number, totalTokenUsage: SessionEndEvent['totalTokenUsage'], estimatedCostUsd: number): Promise<void> {
    const event: SessionEndEvent = {
      type: 'session_end',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      totalTurns,
      totalTokenUsage,
      estimatedCostUsd,
    };
    await this.append(event);
  }

  getBuffer(): ReadonlyArray<SessionEvent> {
    return this.buffer;
  }

  flushBuffer(): SessionEvent[] {
    const flushed = [...this.buffer];
    this.buffer = [];
    return flushed;
  }

  readTranscript(): SessionEvent[] {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as SessionEvent);
  }

  getEventCount(): number {
    return this.eventCount;
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.writeStream.end(resolve);
    });
  }
}
