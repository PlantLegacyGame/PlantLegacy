/**
 * CLI: play the game as N bots and report what happened.
 *
 *   node tools/sim-bots/src/run.ts --bots 2 --minutes 5
 *   node tools/sim-bots/src/run.ts --bots 1 --minutes 2 --verbose
 *   node tools/sim-bots/src/run.ts --fail-on-error   # for CI
 *
 * The server must be running: `pnpm dev:server` (or `pnpm dev`, which also
 * starts the client).
 */
import { writeFileSync } from 'node:fs';
import { Bot } from './bot.ts';
import type { Finding } from './report.ts';

interface Args {
  url: string;
  bots: number;
  minutes: number;
  verbose: boolean;
  json: string;
  failOnError: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    url: 'ws://127.0.0.1:8080/ws',
    bots: 1,
    minutes: 5,
    verbose: false,
    json: 'tools/sim-bots/last-run.json',
    failOnError: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = (): string => argv[index + 1] ?? '';
    switch (arg) {
      case '--url':
        args.url = next();
        index += 1;
        break;
      case '--bots':
        args.bots = Math.max(1, Number.parseInt(next(), 10) || 1);
        index += 1;
        break;
      case '--minutes':
        args.minutes = Math.max(0.05, Number.parseFloat(next()) || 5);
        index += 1;
        break;
      case '--json':
        args.json = next();
        index += 1;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--fail-on-error':
        args.failOnError = true;
        break;
      default:
        break;
    }
  }
  return args;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function printReport(findings: readonly Finding[], rows: Array<Record<string, unknown>>): void {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const bucket = groups.get(finding.code) ?? [];
    bucket.push(finding);
    groups.set(finding.code, bucket);
  }

  const order = ['error', 'warn', 'info'] as const;
  console.log('');
  console.log('Findings');
  console.log('========');
  if (groups.size === 0) {
    console.log('  none');
  }
  for (const severity of order) {
    const codes = [...groups.keys()].filter((code) => groups.get(code)?.[0]?.severity === severity);
    for (const code of codes) {
      const bucket = groups.get(code) ?? [];
      console.log(`  [${severity}] ${pad(code, 26)} x${bucket.length}`);
      for (const finding of bucket.slice(0, 3)) {
        console.log(`      ${finding.detail}`);
        if (finding.context) {
          const context = JSON.stringify(finding.context);
          console.log(`      ${context.length > 200 ? `${context.slice(0, 200)}...` : context}`);
        }
      }
      if (bucket.length > 3) console.log(`      ... ${bucket.length - 3} more`);
    }
  }

  console.log('');
  console.log('Bots');
  console.log('====');
  for (const row of rows) {
    console.log(
      `  ${pad(String(row.name), 10)} growths=${pad(String(row.growths), 3)} nodes=${pad(
        String(row.nodes),
        3,
      )} rejects=${pad(String(row.rejects), 3)} alive=${String(row.alive)}`,
    );
  }
  console.log('');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const durationMs = Math.round(args.minutes * 60_000);
  console.log(`Playing ${args.bots} bot(s) for ${args.minutes} min against ${args.url} ...`);

  const bots: Bot[] = [];
  const runs: Array<Promise<void>> = [];
  for (let index = 0; index < args.bots; index += 1) {
    const bot = new Bot({
      name: `bot-${index + 1}`,
      url: args.url,
      durationMs,
      verbose: args.verbose,
    });
    bots.push(bot);
    runs.push(bot.play());
  }
  await Promise.all(runs);

  const findings = bots.flatMap((bot) => [...bot.findings.all()]);
  const rows = bots.map((bot) => {
    const snapshot = bot.snapshot();
    return {
      name: bot.name,
      growths: snapshot.growths,
      nodes: snapshot.nodes,
      rejects: snapshot.rejects,
      alive: snapshot.alive,
      mutations: snapshot.mutations,
    };
  });

  printReport(findings, rows);

  const payload = {
    ranAt: new Date().toISOString(),
    url: args.url,
    durationMinutes: args.minutes,
    bots: rows,
    findings,
  };
  try {
    writeFileSync(args.json, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`Report written to ${args.json}`);
  } catch (error) {
    console.error(`Could not write ${args.json}: ${String(error)}`);
  }

  const errors = findings.filter((finding) => finding.severity === 'error').length;
  if (args.failOnError && errors > 0) process.exitCode = 1;
}

void main();
