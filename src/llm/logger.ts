/**
 * CerberusAgent — Structured Logger
 *
 * JSON-formatted structured logging for monitoring.
 * Writes to stdout (Docker captures it).
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  [key: string]: unknown;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[MIN_LEVEL];
}

function emit(entry: LogEntry): void {
  const output = JSON.stringify(entry);
  if (entry.level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

export function createLogger(service: string) {
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      if (!shouldLog('debug')) return;
      emit({ timestamp: new Date().toISOString(), level: 'debug', service, message, ...meta });
    },
    info(message: string, meta?: Record<string, unknown>) {
      if (!shouldLog('info')) return;
      emit({ timestamp: new Date().toISOString(), level: 'info', service, message, ...meta });
    },
    warn(message: string, meta?: Record<string, unknown>) {
      if (!shouldLog('warn')) return;
      emit({ timestamp: new Date().toISOString(), level: 'warn', service, message, ...meta });
    },
    error(message: string, meta?: Record<string, unknown>) {
      if (!shouldLog('error')) return;
      emit({ timestamp: new Date().toISOString(), level: 'error', service, message, ...meta });
    },
  };
}
