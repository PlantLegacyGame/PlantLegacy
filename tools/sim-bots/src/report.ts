/**
 * Findings: the bot's bug report, as data.
 *
 * Every rule here exists to answer a question the docs cannot: what did the
 * server actually do to a plant that was only growing?
 */

export type Severity = 'error' | 'warn' | 'info';

export interface Finding {
  code: string;
  severity: Severity;
  bot: string;
  atMs: number;
  detail: string;
  context?: Record<string, unknown>;
}

export class Findings {
  private readonly items: Finding[] = [];
  private readonly bot: string;

  constructor(bot: string) {
    this.bot = bot;
  }

  add(code: string, severity: Severity, detail: string, context?: Record<string, unknown>): void {
    this.items.push({ code, severity, bot: this.bot, atMs: Date.now(), detail, context });
  }

  error(code: string, detail: string, context?: Record<string, unknown>): void {
    this.add(code, 'error', detail, context);
  }

  warn(code: string, detail: string, context?: Record<string, unknown>): void {
    this.add(code, 'warn', detail, context);
  }

  info(code: string, detail: string, context?: Record<string, unknown>): void {
    this.add(code, 'info', detail, context);
  }

  all(): readonly Finding[] {
    return this.items;
  }

  countBySeverity(): Record<Severity, number> {
    const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
    for (const finding of this.items) counts[finding.severity] += 1;
    return counts;
  }
}
