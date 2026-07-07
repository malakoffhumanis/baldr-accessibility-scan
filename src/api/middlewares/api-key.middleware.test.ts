import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';

const logSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => logSpies,
}));

import { apiKeyAuth } from './api-key.middleware.js';
import type { IConfig, ApiKeyEntry } from '@shared/config/config.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cfg(apiKeys: ApiKeyEntry[] = []): IConfig {
  return { apiKeys } as unknown as IConfig;
}

function createMockReq(headerValue?: string): Request {
  return {
    header: vi.fn((name: string) =>
      name === 'X-API-Key' ? headerValue : undefined,
    ),
  } as unknown as Request;
}

function createMockRes() {
  const res: Record<string, unknown> = { locals: {} };
  const jsonFn = vi.fn().mockReturnValue(res);
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  res['status'] = statusFn;
  res['json'] = jsonFn;
  return { res: res as unknown as Response, statusFn, jsonFn };
}

const KEYS: ApiKeyEntry[] = [
  { id: 'client-a', secret: 'secret-key' },
  { id: 'client-b', secret: 'another-secret' },
];

// ─── Unit tests ──────────────────────────────────────────────────────────────

describe('apiKeyAuth middleware', () => {
  beforeEach(() => {
    logSpies.warn.mockClear();
    logSpies.info.mockClear();
  });

  it('throws when constructed with no API keys (no openbar mode)', () => {
    expect(() => apiKeyAuth(cfg([]))).toThrow(/at least one API key/i);
  });

  it('logs the enabled key ids (never the secrets) when keys are configured', () => {
    apiKeyAuth(cfg(KEYS));
    expect(logSpies.warn).not.toHaveBeenCalled();
    expect(logSpies.info).toHaveBeenCalledTimes(1);
    expect(logSpies.info.mock.calls[0]?.[0]).toEqual({
      keyIds: ['client-a', 'client-b'],
    });
  });

  it('passes through and tags res.locals.apiKeyId on a match', () => {
    const middleware = apiKeyAuth(cfg(KEYS));
    const req = createMockReq('secret-key');
    const { res, statusFn } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(statusFn).not.toHaveBeenCalled();
    expect(res.locals['apiKeyId']).toBe('client-a');
  });

  it('matches any of the configured keys (second key → its id)', () => {
    const middleware = apiKeyAuth(cfg(KEYS));
    const req = createMockReq('another-secret');
    const { res } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.locals['apiKeyId']).toBe('client-b');
  });

  it('returns 401 with the standard error shape when the header is missing', () => {
    const middleware = apiKeyAuth(cfg(KEYS));
    const req = createMockReq(undefined);
    const { res, statusFn, jsonFn } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid API key (X-API-Key header).',
      },
    });
    expect(res.locals['apiKeyId']).toBeUndefined();
  });

  it('returns 401 when the header value is incorrect (same length)', () => {
    const middleware = apiKeyAuth(cfg(KEYS));
    const req = createMockReq('wrong-keyy'); // same length as 'secret-key'
    const { res, statusFn } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(401);
  });

  it('returns 401 when the header value differs in length', () => {
    const middleware = apiKeyAuth(cfg(KEYS));
    const req = createMockReq('short');
    const { res, statusFn } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(401);
  });

  // ─── Integration (supertest) ───────────────────────────────────────────────

  describe('integration via Express', () => {
    function buildApp(apiKeys: ApiKeyEntry[]): express.Application {
      const app = express();
      app.use(express.json());
      app.post(
        '/journey',
        apiKeyAuth(cfg(apiKeys)),
        (_req: Request, res: Response) => {
          res
            .status(200)
            .json({ success: true, keyId: res.locals['apiKeyId'] });
        },
      );
      return app;
    }

    it('refuses to build a route with no key configured (no openbar mode)', () => {
      expect(() => buildApp([])).toThrow(/at least one API key/i);
    });

    it('allows the request with a correct X-API-Key and exposes the key id', async () => {
      const res = await request(buildApp(KEYS))
        .post('/journey')
        .set('X-API-Key', 'another-secret')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, keyId: 'client-b' });
    });

    it('rejects the request with 401 when the header is missing', async () => {
      const res = await request(buildApp(KEYS)).post('/journey').send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects the request with 401 when the header is wrong', async () => {
      const res = await request(buildApp(KEYS))
        .post('/journey')
        .set('X-API-Key', 'nope')
        .send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
