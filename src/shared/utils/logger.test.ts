import { Writable } from 'node:stream';

import pino from 'pino';
import { describe, it, expect } from 'vitest';

import { logger, createLogger, resolvePrettyTransport } from './logger';

/**
 * Helper: create a logger that writes JSON lines into an array so we can
 * inspect the serialised output (including redaction).
 */
function createTestLogger(): {
  log: pino.Logger;
  lines: Record<string, unknown>[];
} {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      cb();
    },
  });
  const log = pino(
    {
      level: 'info',
      redact: {
        paths: [
          'password',
          'secret',
          'apiKey',
          'authorization',
          'email',
          'username',
          'loginUrl',
          '*.password',
          '*.secret',
          '*.apiKey',
          '*.email',
          '*.username',
          '*.loginUrl',
          '*.authorization',
          '*.*.password',
          '*.*.secret',
          '*.*.email',
          '*.*.username',
          'req.body.authConfigs',
          'req.headers.authorization',
          'req.headers.cookie',
        ],
        censor: '[REDACTED]',
      },
    },
    stream,
  );
  return { log, lines };
}

describe('Logger', () => {
  describe('logger', () => {
    it('should be defined', () => {
      expect(logger).toBeDefined();
    });

    it('should have standard log methods', () => {
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should have a level property', () => {
      expect(logger.level).toBeDefined();
      expect(typeof logger.level).toBe('string');
    });
  });

  describe('createLogger', () => {
    it('should return a child logger with context', () => {
      const childLogger = createLogger('test-context');
      expect(childLogger).toBeDefined();
      expect(typeof childLogger.info).toBe('function');
      expect(typeof childLogger.warn).toBe('function');
      expect(typeof childLogger.error).toBe('function');
      expect(typeof childLogger.debug).toBe('function');
    });

    it('should create distinct loggers for different contexts', () => {
      const logger1 = createLogger('context-a');
      const logger2 = createLogger('context-b');
      expect(logger1).not.toBe(logger2);
    });
  });

  describe('resolvePrettyTransport', () => {
    it('returns a pino-pretty transport when TTY and pino-pretty are both available', () => {
      const result = resolvePrettyTransport(true, true);

      expect(result).toBeDefined();
      expect(result?.target).toBe('pino-pretty');
      expect(result?.options).toMatchObject({
        colorize: true,
        ignore: 'pid,hostname',
      });
    });

    it('returns undefined when stdout is not a TTY (piped/redirected), even if pino-pretty is installed', () => {
      const result = resolvePrettyTransport(false, true);

      expect(result).toBeUndefined();
    });

    it('returns undefined when pino-pretty is absent, even if stdout is a TTY', () => {
      const result = resolvePrettyTransport(true, false);

      expect(result).toBeUndefined();
    });

    it('returns undefined when stdout is not a TTY and pino-pretty is absent', () => {
      const result = resolvePrettyTransport(false, false);

      expect(result).toBeUndefined();
    });
  });

  describe('redaction', () => {
    it('should redact top-level password', () => {
      const { log, lines } = createTestLogger();
      log.info({ password: 's3cr3t-test' }, 'test');
      expect(lines[0]).toHaveProperty('password', '[REDACTED]');
    });

    it('should redact nested password (one level)', () => {
      const { log, lines } = createTestLogger();
      log.info({ config: { password: 'secret123' } }, 'test');
      expect(
        (lines[0] as Record<string, Record<string, unknown>>)['config']?.[
          'password'
        ],
      ).toBe('[REDACTED]');
    });

    it('should redact deeply nested auth config password', () => {
      const { log, lines } = createTestLogger();
      log.info(
        { authConfigs: { site1: { password: 'p@ss', email: 'a@b.com' } } },
        'test',
      );
      const site1 = (
        lines[0] as Record<string, Record<string, Record<string, unknown>>>
      )['authConfigs']?.['site1'];
      expect(site1?.['password']).toBe('[REDACTED]');
      expect(site1?.['email']).toBe('[REDACTED]');
    });

    it('should redact req.headers.authorization', () => {
      const { log, lines } = createTestLogger();
      log.info({ req: { headers: { authorization: 'Bearer tok' } } }, 'test');
      const headers = (
        lines[0] as Record<string, Record<string, Record<string, unknown>>>
      )['req']?.['headers'];
      expect(headers?.['authorization']).toBe('[REDACTED]');
    });

    it('should redact top-level email', () => {
      const { log, lines } = createTestLogger();
      log.info({ email: 'jean@test.com' }, 'test');
      expect(lines[0]).toHaveProperty('email', '[REDACTED]');
    });

    it('should redact top-level username', () => {
      const { log, lines } = createTestLogger();
      log.info({ username: 'DOMAIN\\jean' }, 'test');
      expect(lines[0]).toHaveProperty('username', '[REDACTED]');
    });

    it('should redact top-level loginUrl', () => {
      const { log, lines } = createTestLogger();
      log.info({ loginUrl: 'https://adfs.corp/login' }, 'test');
      expect(lines[0]).toHaveProperty('loginUrl', '[REDACTED]');
    });

    it('should not redact non-sensitive fields', () => {
      const { log, lines } = createTestLogger();
      log.info({ url: 'https://example.com', status: 200 }, 'test');
      expect(lines[0]).toHaveProperty('url', 'https://example.com');
      expect(lines[0]).toHaveProperty('status', 200);
    });
  });
});
