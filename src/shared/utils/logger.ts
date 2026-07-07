import { createRequire } from 'node:module';

import pino from 'pino';

const require = createRequire(import.meta.url);

/**
 * Paths redacted from every log entry to prevent credential leaks.
 * Uses Pino's fast-redact (compile-once, zero-copy in production).
 */
const REDACT_PATHS = [
  // Direct fields on the log object
  'password',
  'secret',
  'apiKey',
  'authorization',
  'email',
  'username',
  'loginUrl',

  // One level deep (e.g. { config: { password } })
  '*.password',
  '*.secret',
  '*.apiKey',
  '*.email',
  '*.username',
  '*.loginUrl',
  '*.authorization',

  // Two levels deep (e.g. { authConfigs: { site1: { password } } })
  '*.*.password',
  '*.*.secret',
  '*.*.email',
  '*.*.username',

  // Express / HTTP context
  'req.body.authConfigs',
  'req.headers.authorization',
  'req.headers.cookie',
];

function isPrettyAvailable(): boolean {
  try {
    require.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Pretty transport only for an interactive terminal when pino-pretty is
 * installed; JSON otherwise. Injected args make this unit-testable without
 * mocking globals.
 */
export function resolvePrettyTransport(
  isTTY: boolean = process.stdout.isTTY ?? false,
  prettyAvailable: boolean = isPrettyAvailable(),
): pino.TransportSingleOptions | undefined {
  if (isTTY && prettyAvailable) {
    return {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    };
  }
  return undefined;
}

/**
 * Application-wide Pino logger instance.
 */
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  transport: resolvePrettyTransport(),
});

/**
 * Creates a child logger with a specific context
 * @param context - Logger context (e.g. 'api', 'cli', 'service')
 * @returns Logger instance with context
 */
export const createLogger = (context: string): pino.Logger =>
  logger.child({ context });
