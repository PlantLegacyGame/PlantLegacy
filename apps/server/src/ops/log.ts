export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Get error rate statistics for monitoring */
  getErrorStats(): { errorCount: number; warnCount: number; lastError?: string; lastWarn?: string };
}

interface ErrorStats {
  errorCount: number;
  warnCount: number;
  lastError?: { message: string; timestamp: string };
  lastWarn?: { message: string; timestamp: string };
}

/**
 * Line-per-event JSON logging. No dependency, no paid monitoring (Part 15).
 * Free-first ops means logs must be greppable with plain tools.
 */
export function createLogger(level: LogLevel): Logger {
  const threshold = ORDER[level];
  const stats: ErrorStats = { errorCount: 0, warnCount: 0 };

  const write = (entryLevel: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (ORDER[entryLevel] < threshold) return;
    const timestamp = new Date().toISOString();
    const line = JSON.stringify({
      ts: timestamp,
      level: entryLevel,
      msg: message,
      ...fields,
    });
    if (entryLevel === 'error' || entryLevel === 'warn') console.error(line);
    else console.log(line);

    // Track error/warn stats
    if (entryLevel === 'error') {
      stats.errorCount++;
      stats.lastError = { message, timestamp };
    } else if (entryLevel === 'warn') {
      stats.warnCount++;
      stats.lastWarn = { message, timestamp };
    }
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    getErrorStats: () => ({
      errorCount: stats.errorCount,
      warnCount: stats.warnCount,
      lastError: stats.lastError?.message,
      lastWarn: stats.lastWarn?.message,
    }),
  };
}
