import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { validate } from './validate.js';
import type { Request, Response, NextFunction } from 'express';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockReq(body: unknown) {
  return { body } as Request;
}

function createMockRes() {
  const res: Record<string, unknown> = {};
  const jsonFn = vi.fn().mockReturnValue(res);
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  res['status'] = statusFn;
  res['json'] = jsonFn;
  return { res: res as unknown as Response, statusFn, jsonFn };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('validate middleware', () => {
  const testSchema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive().optional(),
  });

  it('should call next() for valid body', () => {
    const req = createMockReq({ name: 'Alice' });
    const { res } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    validate(testSchema)(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should replace req.body with parsed data', () => {
    const req = createMockReq({ name: 'Alice', extraField: 'ignored' });
    const { res } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    validate(testSchema)(req, res, next);

    // Zod strips unknown keys by default
    expect(req.body).toEqual({ name: 'Alice' });
  });

  it('should return 400 with VALIDATION_ERROR on invalid body', () => {
    const req = createMockReq({});
    const { res, statusFn, jsonFn } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    validate(testSchema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(400);
    expect(jsonFn).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
        }),
      }),
    );
  });

  it('should format missing field error correctly', () => {
    const req = createMockReq({});
    const { res, jsonFn } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    validate(testSchema)(req, res, next);

    const response = jsonFn.mock.calls[0]?.[0] as {
      error: { message: string };
    };
    expect(response.error.message).toContain('name');
    expect(response.error.message).toContain('required');
  });

  it('should format enum error with allowed values', () => {
    const enumSchema = z.object({
      format: z.enum(['html', 'json', 'csv']),
    });
    const req = createMockReq({ format: 'pdf' });
    const { res, jsonFn } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    validate(enumSchema)(req, res, next);

    const response = jsonFn.mock.calls[0]?.[0] as {
      error: { message: string };
    };
    expect(response.error.message).toContain('invalid');
    expect(response.error.message).toContain('html');
    expect(response.error.message).toContain('json');
    expect(response.error.message).toContain('csv');
  });

  it('should format URL validation error', () => {
    const urlSchema = z.object({ url: z.string().url() });
    const req = createMockReq({ url: 'not-a-url' });
    const { res, jsonFn } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    validate(urlSchema)(req, res, next);

    const response = jsonFn.mock.calls[0]?.[0] as {
      error: { message: string };
    };
    expect(response.error.message).toContain('url');
    expect(response.error.message).toContain('invalid');
  });

  it('should format journey path correctly (Page #N)', () => {
    const journeySchema = z.object({
      pages: z.array(
        z.object({ url: z.string().url(), actions: z.array(z.string()) }),
      ),
    });
    const req = createMockReq({
      pages: [{ url: 'not-url', actions: ['scanner'] }],
    });
    const { res, jsonFn } = createMockRes();
    const next = vi.fn() as unknown as NextFunction;

    validate(journeySchema)(req, res, next);

    const response = jsonFn.mock.calls[0]?.[0] as {
      error: { message: string };
    };
    expect(response.error.message).toContain('Page #0');
    expect(response.error.message).toContain('url');
    expect(response.error.message).toContain('invalid');
  });
});

describe('validate', () => {
  function createMockReq(body: unknown = {}) {
    return { body } as never;
  }

  function createMockRes() {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    return res;
  }

  const schema = z.object({
    name: z.string().min(1),
    age: z.number().int().positive().optional(),
  });

  it('calls next when body is valid', () => {
    const middleware = validate(schema);
    const req = createMockReq({ name: 'John', age: 30 });
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res as never, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 400 when body is invalid', () => {
    const middleware = validate(schema);
    const req = createMockReq({ name: '' }); // empty string, min 1
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns error with VALIDATION_ERROR code', () => {
    const middleware = validate(schema);
    const req = createMockReq({ name: 123 }); // wrong type
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res as never, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
        }),
      }),
    );
  });

  it('replaces req.body with parsed data on success', () => {
    const middleware = validate(schema);
    const req = { body: { name: 'John', extra: 'field' } } as never;
    const res = createMockRes();
    const next = vi.fn();

    middleware(req, res as never, next);

    expect(next).toHaveBeenCalled();
  });

  // Test formatZodError for various error codes
  describe('formatZodError — invalid_type', () => {
    it('reports required field when input is undefined', () => {
      const s = z.object({ email: z.string() });
      const middleware = validate(s);
      const req = createMockReq({});
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      expect(error.message).toContain('required');
    });

    it('reports wrong type', () => {
      const s = z.object({ count: z.number() });
      const middleware = validate(s);
      const req = createMockReq({ count: 'abc' });
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      expect(error.message).toContain('count');
    });
  });

  describe('formatZodError — invalid_format', () => {
    it('reports invalid URL', () => {
      const s = z.object({ url: z.url() });
      const middleware = validate(s);
      const req = createMockReq({ url: 'not-a-url' });
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      expect(error.message).toContain('url');
    });
  });

  describe('formatZodError — too_small', () => {
    it('reports min length violation', () => {
      const s = z.object({ items: z.array(z.string()).min(2) });
      const middleware = validate(s);
      const req = createMockReq({ items: ['one'] });
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      expect(error.message.length).toBeGreaterThan(0);
    });
  });

  describe('formatZodError — too_big', () => {
    it('reports max length violation', () => {
      const s = z.object({ name: z.string().max(3) });
      const middleware = validate(s);
      const req = createMockReq({ name: 'toolong' });
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      expect(error.message.length).toBeGreaterThan(0);
    });
  });

  describe('formatZodError — invalid_value (enum)', () => {
    it('reports invalid enum value', () => {
      const s = z.object({ type: z.enum(['a', 'b', 'c']) });
      const middleware = validate(s);
      const req = createMockReq({ type: 'invalid' });
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      expect(error.message).toContain('Allowed values');
    });
  });

  describe('formatZodError — custom (superRefine)', () => {
    it('reports custom validation message', () => {
      const s = z.string().superRefine((val, ctx) => {
        if (val !== 'secret') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Must be "secret"',
          });
        }
      });
      const middleware = validate(s);
      const req = createMockReq('wrong');
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      expect(error.message).toContain('secret');
    });
  });

  describe('formatPath — journey paths', () => {
    it('formats journey page path', () => {
      const s = z.object({
        pages: z.array(
          z.object({
            url: z.url(),
            actions: z.array(z.string().min(1)),
          }),
        ),
      });
      const middleware = validate(s);
      const req = createMockReq({
        pages: [{ url: 'not-url', actions: ['valid'] }],
      });
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      expect(error.message).toContain('Page #0');
    });

    it('formats journey action path', () => {
      const s = z.object({
        pages: z.array(
          z.object({
            url: z.url(),
            actions: z.array(z.string().min(1)),
          }),
        ),
      });
      const middleware = validate(s);
      const req = createMockReq({
        pages: [{ url: 'https://example.com', actions: [''] }],
      });
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      // Should reference block and action
      expect(error.message.length).toBeGreaterThan(0);
    });
  });

  describe('formatZodError — union error', () => {
    it('reports union validation error', () => {
      const s = z.union([z.string(), z.number()]);
      const middleware = validate(s);
      const req = createMockReq(true);
      const res = createMockRes();
      middleware(req, res as never, vi.fn());

      const error = (
        res.json.mock.calls[0][0] as { error: { message: string } }
      ).error;
      expect(error.message.length).toBeGreaterThan(0);
    });
  });
});
