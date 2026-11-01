#!/usr/bin/env node
/**
 * Validates every `config/*.json` file against the extended-1 format and bans
 * any `rarity` field (RULE_20). Runs in CI and at server startup.
 *
 * Usage:
 *   node tools/config-validator/src/cli.ts [--dir config] [--json] [--quiet]
 *
 * Exit code 1 means at least one config is invalid; CI must fail.
 */
import { resolve } from 'node:path';
import process from 'node:process';
import { formatIssue, loadConfigDir } from '@plant-legacy/shared/config';

interface Options {
  dir: string;
  json: boolean;
  quiet: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { dir: resolve(process.cwd(), 'config'), json: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dir') {
      const next = argv[i + 1];
      if (!next) throw new Error('--dir needs a path');
      options.dir = resolve(process.cwd(), next);
      i += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--quiet') {
      options.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: config-validator [--dir <path>] [--json] [--quiet]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const result = await loadConfigDir(options.dir);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          dir: result.dir,
          files: result.files,
          issueCount: result.issues.length,
          issues: result.issues,
        },
        null,
        2,
      ),
    );
  } else {
    if (!options.quiet) {
      console.log(`config: ${result.files.length} file(s) in ${result.dir}`);
    }
    for (const issue of result.issues) {
      console.error(`  ${formatIssue(issue)}`);
    }
    if (!options.quiet) {
      console.log(result.ok ? 'config: OK' : `config: FAILED (${result.issues.length} issue(s))`);
    }
  }

  return result.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
