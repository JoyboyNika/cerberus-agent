/**
 * CerberusAgent — Session Event Types (JSONL schema)
 *
 * Each line in a .jsonl transcript file is one SessionEvent.
 * Event-sourced design: append-only, granular, extensible.
 *
 * The Greffier (J4) will consume these events from a buffer
 * to produce distilled reports.
 */

import { HeadId, HeadReport, TokenUsage } from '../types/index.js';

// === Event type discriminator ===

export type SessionEventType =
  | 'session_start'
  | 'turn_start'
  | 'head_dispatch'
  | 'head_report'
  | 'body_synthesis'
  | 'body_feedback'
  | 'user_instruction'
  | 'arbitre_saisine'
  | 'arbitre_decision'
  | 'arbitre_parse_failure'
  | 'greffier_distillation'
  | 'window_slide'
  | 'session_end'
  | 'error';

// === Base event ===

interface BaseEvent {
  type: SessionEventType;
  sessionId: string;
  timestamp: string; // ISO 8601
}

// === Specific events ===

export interface SessionStartEvent extends BaseEvent {
  type: 'session_start';
  query: string;
}

export interface TurnStartEvent extends BaseEvent {
  type: 'turn_start';
  turn: number;
  query: string;
}

export interface HeadDispatchEvent extends BaseEvent {
  type: 'head_dispatch';
  turn: number;
  head: HeadId;
  query: string;
  model: string;
}

export interface HeadReportEvent extends BaseEvent {
  type: 'head_report';
  turn: number;
  head: HeadId;
  report: HeadReport;
  tokenUsage: TokenUsage;
  durationMs: number;
}

export interface BodySynthesisEvent extends BaseEvent {
  type: 'body_synthesis';
  turn: number;
  response: string;
  disagreementDetected: boolean;
  feedbackSent: Array<{ head: HeadId; query: string }>;
  recommendContinue: boolean;
  suggestedTurns?: number;
}

export interface BodyFeedbackEvent extends BaseEvent {
  type: 'body_feedback';
  turn: number;
  targetHead: HeadId;
  feedbackQuery: string;
  reason: string;
}

export interface UserInstructionEvent extends BaseEvent {
  type: 'user_instruction';
  turn: number;
  instruction: string;
}

export interface ArbitreSaisineEvent extends BaseEvent {
  type: 'arbitre_saisine';
  turn: number;
  reason: string;
  headReports: Record<HeadId, HeadReport>;
}

export interface ArbitreDecisionEvent extends BaseEvent {
  type: 'arbitre_decision';
  turn: number;
  decision: 'follow' | 'abandon';
  motivatedReport: string;
  targetHead: HeadId;
  tokenUsage: TokenUsage;
}

export interface ArbitreParseFailureEvent extends BaseEvent {
  type: 'arbitre_parse_failure';
  turn: number;
  failedFields: Array<'decision' | 'target'>;
  contentPreview: string;
}

export interface GreffierDistillationEvent extends BaseEvent {
  type: 'greffier_distillation';
  afterTurn: number;
  distilledReport: string;
  tokenUsage: TokenUsage;
}

export interface WindowSlideEvent extends BaseEvent {
  type: 'window_slide';
  fromTurn: number;
  toTurn: number;
  distilledContext: string;
}

export interface SessionEndEvent extends BaseEvent {
  type: 'session_end';
  totalTurns: number;
  totalTokenUsage: TokenUsage;
  estimatedCostUsd: number;
}

export interface ErrorEvent extends BaseEvent {
  type: 'error';
  turn?: number;
  head?: HeadId;
  errorCode: string;
  errorMessage: string;
  recoverable: boolean;
}

// === Union type ===

export type SessionEvent =
  | SessionStartEvent
  | TurnStartEvent
  | HeadDispatchEvent
  | HeadReportEvent
  | BodySynthesisEvent
  | BodyFeedbackEvent
  | UserInstructionEvent
  | ArbitreSaisineEvent
  | ArbitreDecisionEvent
  | ArbitreParseFailureEvent
  | GreffierDistillationEvent
  | WindowSlideEvent
  | SessionEndEvent
  | ErrorEvent;
