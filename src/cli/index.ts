#!/usr/bin/env node

import 'dotenv/config';

import { Command } from 'commander';
import { readFileSync } from 'node:fs';

import { setRuntimeMode } from '@shared/config/runtime-mode.js';
import { createRunCommand } from './commands/run.command.js';

// Mark the process as CLI before any config load: the CLI audits locally and
// is exempt from the server's mandatory API_KEYS check.
setRuntimeMode('cli');

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'),
    ) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program
  .name('baldr')
  .description('BALDR — Accessibility audit tool (axe-core + AI)')
  .version(readPackageVersion());

program.addCommand(createRunCommand());

program.addHelpText(
  'after',
  '\nRun "baldr run --help" for the request format, authentication modes and examples.' +
    '\nThe companion HTTP API server ships as the separate "baldrd" binary.',
);

program.parse();
