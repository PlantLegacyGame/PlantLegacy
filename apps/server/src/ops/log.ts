export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * Line-per-event JSON logging. No dependency, no paid monitoring (Part 15).
 * Free-first ops means logs must be greppable with plain tools.
 */
export function createLogger(level: LogLevel): Logger {
  const threshold = ORDER[level];

  const write = (entryLevel: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (ORDER[entryLevel] < threshold) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: entryLevel,
      msg: message,
      ...fields,
    });
    if (entryLevel === 'error' || entryLevel === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}
