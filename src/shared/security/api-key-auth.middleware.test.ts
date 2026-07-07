import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { parseApiKeys, matchApiKey, safeCompare } from './api-key.js';
import { createApiKeyAuth } from './api-key-auth.middleware.js';

// ─── Pure primitives ──────────────────────────────────────────────────────────

describe('api-key primitives', () => {
  describe('parseApiKeys', () => {
    it('parses labelled entries', () => {
      expect(parseApiKeys('a:s1, b:s2')).toEqual([
        { id: 'a', secret: 's1' },
        { id: 'b', secret: 's2' },
      ]);
    });

    it('derives a non-sensitive id for a bare secret', () => {
      const [entry] = parseApiKeys('just-a-secret');
      expect(entry?.secret).toBe('just-a-secret');
      expect(entry?.id).toMatch(/^key-[0-9a-f]{8}$/);
      expect(entry?.id).not.toBe('just-a-secret');
    });

    it('drops empty / secret-less entries and trims', () => {
      expect(parseApiKeys(' , a:s1 , bad: , ,')).toEqual([
        { id: 'a', secret: 's1' },
      ]);
    });

    it('returns [] for undefined', () => {
      expect(parseApiKeys(undefined)).toEqual([]);
    });
  });

  describe('safeCompare', () => {
    it('is true for equal strings', () => {
      expect(safeCompare('abc', 'abc')).toBe(true);
    });
    it('is false for different same-length strings', () => {
      expect(safeCompare('abc', 'abd')).toBe(false);
    });
    it('is false for different-length strings', () => {
      expect(safeCompare('abc', 'abcd')).toBe(false);
    });
  });

  describe('matchApiKey', () => {
    const keys = [
      { id: 'a', secret: 's1' },
      { id: 'b', secret: 's2' },
    ];
    it('returns the matched id', () => {
      expect(matchApiKey('s2', keys)).toBe('b');
    });
    it('returns undefined on no match', () => {
      expect(matchApiKey('nope', keys)).toBeUndefined();
    });
    it('returns undefined when nothing presented', () => {
      expect(matchApiKey(undefined, keys)).toBeUndefined();
    });
  });
});

// ─── createApiKeyAuth factory ─────────────────────────────────────────────────

function mockReq(headers: Record<string, string>): Request {
  return {
    header: (name: string) => headers[name],
  } as unknown as Request;
}

function mockRes() {
  const res: Record<string, unknown> = { locals: {} };
  const json = vi.fn().mockReturnValue(res);
  const status = vi.fn().mockReturnValue({ json });
  res['status'] = status;
  res['json'] = json;
  return { res: res as unknown as Response, status, json };
}

describe('createApiKeyAuth', () => {
  const keys = [{ id: 'client-a', secret: 'secret-key' }];

  it('throws when no keys are provided (no openbar mode)', () => {
    expect(() => createApiKeyAuth({ keys: [] })).toThrow(
      /at least one API key/i,
    );
  });

  it('logs the enabled key ids via the injected logger (never the secret)', () => {
    const logger = { info: vi.fn() };
    createApiKeyAuth({ keys, logger });
    expect(logger.info).toHaveBeenCalledWith(
      { keyIds: ['client-a'] },
      expect.any(String),
    );
  });

  it('passes through and tags res.locals on a match', () => {
    const mw = createApiKeyAuth({ keys });
    const req = mockReq({ 'X-API-Key': 'secret-key' });
    const { res, status } = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
    expect(res.locals['apiKeyId']).toBe('client-a');
  });

  it('returns 401 with the default error body on mismatch', () => {
    const mw = createApiKeyAuth({ keys });
    const req = mockReq({ 'X-API-Key': 'wrong-keyy' });
    const { res, status, json } = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid API key (X-API-Key header).',
      },
    });
  });

  it('honors a custom header name and locals key', () => {
    const mw = createApiKeyAuth({
      keys,
      headerName: 'Authorization',
      localsKey: 'clientId',
    });
    const req = mockReq({ Authorization: 'secret-key' });
    const { res } = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.locals['clientId']).toBe('client-a');
  });

  it('returns a custom unauthorized body when provided', () => {
    const mw = createApiKeyAuth({ keys, unauthorizedBody: { denied: true } });
    const req = mockReq({});
    const { res, status, json } = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    mw(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ denied: true });
  });
});
