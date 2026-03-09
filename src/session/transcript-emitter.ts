/**
 * CerberusAgent — Transcript Event Emitter
 * Inspired by OpenClaw's transcript-events.ts
 *
 * Simple pub/sub for session transcript updates.
 * The Cockpit (J6) will subscribe to receive real-time
 * notifications when new events are appended.
 *
 * Also used by the Greffier (J4) to know when to distill.
 */

import { SessionEvent } from './types.js';

export type TranscriptListener = (event: SessionEvent, sessionId: string) => void;

const listeners = new Set<TranscriptListener>();

/**
 * Subscribe to transcript updates.
 * Returns an unsubscribe function.
 */
export function onTranscriptUpdate(listener: TranscriptListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Emit a transcript update to all listeners.
 * Called by SessionManager after each append.
 */
export function emitTranscriptUpdate(event: SessionEvent, sessionId: string): void {
  for (const listener of listeners) {
    try {
      listener(event, sessionId);
    } catch {
      // Listener errors should not break the pipeline
    }
  }
}

/**
 * Get current listener count (for monitoring).
 */
export function getListenerCount(): number {
  return listeners.size;
}
