import React, { useState, useEffect, useRef, useCallback } from 'react';

// === Types ===
interface HeadStatus {
  confidence: 'eleve' | 'modere' | 'faible';
  neant: boolean;
  toolCalls: number;
  durationMs: number;
  loopDetected: boolean;
}

interface TurnResult {
  turn: number;
  synthesis: string;
  heads: Record<string, HeadStatus>;
  disagreement: boolean;
  arbitreInvoked: boolean;
  feedbackLoops: Array<{ head: string; query: string }>;
  windowSlid: boolean;
  cost: { turnCostUsd: number; sessionTotalUsd: number; budgetRemainingUsd: number; budgetWarning: boolean };
  durationMs: number;
}

interface WsEvent {
  type: string;
  sessionId?: string;
  event?: any;
}

// === Styles ===
const COLORS = {
  bg: '#0a0a0f', surface: '#12121a', border: '#1e1e2e',
  red: '#c0392b', gold: '#d4a853', green: '#27ae60',
  orange: '#e67e22', purple: '#8e44ad', blue: '#3498db',
  cyan: '#1abc9c', text: '#e8e6e3', muted: '#7a7a8c', dim: '#4a4a5c',
};
const MONO = "'JetBrains Mono', monospace";

const HEAD_COLORS: Record<string, string> = {
  rigueur: COLORS.green, transversalite: COLORS.orange, curiosite: COLORS.purple,
};
const HEAD_ICONS: Record<string, string> = {
  rigueur: '🔬', transversalite: '🌿', curiosite: '🔭',
};
const CONFIDENCE_COLORS: Record<string, string> = {
  eleve: COLORS.green, modere: COLORS.gold, faible: COLORS.red,
};

// === Components ===
function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span style={{
      fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: 1.5,
      textTransform: 'uppercase', color, background: `${color}18`,
      padding: '3px 8px', borderRadius: 4, border: `1px solid ${color}30`,
    }}>{children}</span>
  );
}

function HeadCard({ headId, status }: { headId: string; status: HeadStatus }) {
  const color = HEAD_COLORS[headId] || COLORS.muted;
  return (
    <div style={{
      background: COLORS.surface, border: `1px solid ${color}40`,
      borderRadius: 8, padding: '12px 14px', flex: 1, minWidth: 200,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>{HEAD_ICONS[headId]}</span>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color, letterSpacing: 0.5 }}>
          {headId.toUpperCase()}
        </span>
        <Badge color={CONFIDENCE_COLORS[status.confidence] || COLORS.muted}>
          {status.confidence}
        </Badge>
      </div>
      <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 2, fontFamily: MONO }}>
        <div>Outils : {status.toolCalls} appels</div>
        <div>Durée : {(status.durationMs / 1000).toFixed(1)}s</div>
        {status.neant && <div style={{ color: COLORS.gold }}>⚠ Néant</div>}
        {status.loopDetected && <div style={{ color: COLORS.red }}>⚠ Boucle détectée</div>}
      </div>
    </div>
  );
}

function CostBar({ cost }: { cost: TurnResult['cost'] }) {
  const pct = ((cost.sessionTotalUsd / (cost.sessionTotalUsd + cost.budgetRemainingUsd)) * 100);
  return (
    <div style={{ background: COLORS.surface, borderRadius: 8, padding: '12px 16px', border: `1px solid ${COLORS.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: COLORS.muted, letterSpacing: 1 }}>BUDGET</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: cost.budgetWarning ? COLORS.red : COLORS.green }}>
          ${cost.sessionTotalUsd.toFixed(4)} / ${(cost.sessionTotalUsd + cost.budgetRemainingUsd).toFixed(0)}€
        </span>
      </div>
      <div style={{ background: '#1a1a25', borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.min(pct, 100)}%`, height: '100%', borderRadius: 4,
          background: cost.budgetWarning ? COLORS.red : COLORS.green,
          transition: 'width 0.5s ease',
        }} />
      </div>
    </div>
  );
}

function LiveEvents({ events }: { events: WsEvent[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events]);

  return (
    <div style={{
      background: COLORS.surface, borderRadius: 8, padding: '12px 14px',
      border: `1px solid ${COLORS.border}`, maxHeight: 200, overflowY: 'auto',
    }}>
      <div style={{ fontFamily: MONO, fontSize: 9, color: COLORS.dim, letterSpacing: 1.5, marginBottom: 8 }}>EVENTS EN DIRECT</div>
      {events.length === 0 && <div style={{ color: COLORS.dim, fontSize: 11 }}>En attente d'événements...</div>}
      {events.slice(-20).map((e, i) => (
        <div key={i} style={{ fontSize: 10, fontFamily: MONO, color: COLORS.muted, padding: '2px 0', borderBottom: `1px solid ${COLORS.bg}` }}>
          <span style={{ color: COLORS.dim }}>{e.event?.timestamp?.slice(11, 19) || ''}</span>{' '}
          <span style={{ color: COLORS.gold }}>{e.event?.type}</span>{' '}
          {e.event?.head && <span style={{ color: HEAD_COLORS[e.event.head] || COLORS.muted }}>[{e.event.head}]</span>}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

// === Main App ===
export default function App() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [turns, setTurns] = useState<TurnResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [wsEvents, setWsEvents] = useState<WsEvent[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket connection
  const connectWs = useCallback((sid: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      ws.send(JSON.stringify({ type: 'subscribe', sessionId: sid }));
    };
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data) as WsEvent;
      if (data.type === 'transcript_event') {
        setWsEvents(prev => [...prev, data]);
      }
    };
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
  }, []);

  // Create session
  const createSession = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setSessionId(data.sessionId);
      setWsEvents([]);
      connectWs(data.sessionId);
      // Auto-run first turn
      await runTurn(data.sessionId);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  // Run turn
  const runTurn = async (sid?: string) => {
    const id = sid || sessionId;
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/session/${id}/turn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sid ? undefined : query }),
      });
      const data = await res.json() as TurnResult;
      setTurns(prev => [...prev, data]);
      setQuery('');
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', padding: '24px 20px', maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 4, color: COLORS.red }}>CERBERUSAGENT</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: '4px 0 0' }}>Cockpit</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: wsConnected ? COLORS.green : COLORS.red,
          }} />
          <span style={{ fontFamily: MONO, fontSize: 10, color: COLORS.muted }}>
            {wsConnected ? 'Connecté' : 'Déconnecté'}
          </span>
        </div>
      </div>

      {/* Query input */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (sessionId ? runTurn() : createSession())}
          placeholder="Requête médicale..."
          disabled={loading}
          style={{
            flex: 1, background: COLORS.surface, border: `1px solid ${COLORS.border}`,
            borderRadius: 8, color: '#fff', padding: '12px 16px',
            fontFamily: "'DM Sans', sans-serif", fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={sessionId ? () => runTurn() : createSession}
          disabled={loading || !query.trim()}
          style={{
            background: loading ? COLORS.dim : COLORS.red, color: '#fff',
            border: 'none', borderRadius: 8, padding: '12px 24px',
            fontFamily: MONO, fontSize: 12, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
            letterSpacing: 1, opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? 'EN COURS...' : sessionId ? 'TOUR SUIVANT' : 'DÉMARRER'}
        </button>
      </div>

      {/* Live events */}
      {sessionId && <LiveEvents events={wsEvents} />}

      {/* Turns */}
      {turns.map((turn, i) => (
        <div key={i} style={{ marginTop: 20 }}>
          {/* Turn header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: 12, padding: '8px 0', borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontFamily: MONO, fontSize: 13, color: COLORS.red, fontWeight: 700 }}>TOUR {turn.turn}</span>
              <span style={{ fontSize: 11, color: COLORS.muted }}>{(turn.durationMs / 1000).toFixed(1)}s</span>
              {turn.disagreement && <Badge color={COLORS.red}>Désaccord</Badge>}
              {turn.arbitreInvoked && <Badge color={COLORS.gold}>Arbitre</Badge>}
              {turn.windowSlid && <Badge color={COLORS.blue}>Fenêtre glissée</Badge>}
            </div>
            <span style={{ fontFamily: MONO, fontSize: 10, color: COLORS.dim }}>
              ${turn.cost.turnCostUsd.toFixed(4)}
            </span>
          </div>

          {/* Head cards */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            {Object.entries(turn.heads).map(([id, status]) => (
              <HeadCard key={id} headId={id} status={status as HeadStatus} />
            ))}
          </div>

          {/* Feedback loops */}
          {turn.feedbackLoops.length > 0 && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: `${COLORS.gold}10`, borderRadius: 6, border: `1px solid ${COLORS.gold}30` }}>
              <span style={{ fontFamily: MONO, fontSize: 9, color: COLORS.gold, letterSpacing: 1 }}>BOUCLES DE RÉTROACTION</span>
              {turn.feedbackLoops.map((fb, j) => (
                <div key={j} style={{ fontSize: 11, color: COLORS.muted, marginTop: 4 }}>
                  <span style={{ color: HEAD_COLORS[fb.head] }}>{fb.head}</span> → {fb.query.slice(0, 80)}...
                </div>
              ))}
            </div>
          )}

          {/* Body synthesis */}
          <div style={{
            background: COLORS.surface, borderRadius: 8, padding: '16px 18px',
            border: `1px solid ${COLORS.border}`, marginBottom: 12,
          }}>
            <div style={{ fontFamily: MONO, fontSize: 9, color: COLORS.red, letterSpacing: 1.5, marginBottom: 8 }}>SYNTHÈSE DU BODY</div>
            <div style={{ fontSize: 13, color: COLORS.text, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {turn.synthesis}
            </div>
          </div>

          {/* Cost bar */}
          <CostBar cost={turn.cost} />
        </div>
      ))}

      {/* Empty state */}
      {turns.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: COLORS.dim }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🏛️</div>
          <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: 2, marginBottom: 8 }}>CERBERUSAGENT</div>
          <div style={{ fontSize: 13, color: COLORS.muted }}>Entrez une requête médicale pour démarrer une consultation panoptique</div>
        </div>
      )}
    </div>
  );
}
