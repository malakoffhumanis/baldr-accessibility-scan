import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the logger before importing the module under test
vi.mock('../../shared/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  HttpError,
  ValidationError,
  ServiceUnavailableError,
  errorHandler,
  notFoundHandler,
} from './error-handler';

/**
 * Helper to create a mocked Response object
 */
function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    statusCode: 200,
  } as unknown as Response;
  return res;
}

/**
 * Helper to create a mocked Request object
 */
function createMockRequest(): Request {
  return {} as Request;
}

describe('error-handler', () => {
  let mockReq: Request;
  let mockRes: Response;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = vi.fn();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // HttpError
  // ═══════════════════════════════════════════════════════════════════════════
  describe('HttpError', () => {
    it('should create an instance with statusCode, code and message', () => {
      const error = new HttpError(400, 'BAD_REQUEST', 'Invalid request');

      expect(error).toBeInstanceOf(HttpError);
      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe('Invalid request');
      expect(error.name).toBe('HttpError');
    });

    it('should create an instance with optional details', () => {
      const details = { field: 'email', reason: 'invalid format' };
      const error = new HttpError(
        422,
        'VALIDATION_ERROR',
        'Validation error',
        details,
      );

      expect(error.details).toEqual(details);
    });

    it('should have undefined details if not provided', () => {
      const error = new HttpError(500, 'SERVER_ERROR', 'Server error');
      expect(error.details).toBeUndefined();
    });

    it('should have a stack trace', () => {
      const error = new HttpError(404, 'NOT_FOUND', 'Not found');
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('HttpError');
    });

    it('should support different HTTP codes', () => {
      const errors = [
        new HttpError(400, 'BAD_REQUEST', 'Bad Request'),
        new HttpError(401, 'UNAUTHORIZED', 'Unauthorized'),
        new HttpError(403, 'FORBIDDEN', 'Forbidden'),
        new HttpError(404, 'NOT_FOUND', 'Not Found'),
        new HttpError(409, 'CONFLICT', 'Conflict'),
        new HttpError(429, 'RATE_LIMITED', 'Too Many Requests'),
        new HttpError(500, 'INTERNAL', 'Internal Server Error'),
        new HttpError(503, 'SERVICE_UNAVAILABLE', 'Service Unavailable'),
      ];

      errors.forEach((err) => {
        expect(err).toBeInstanceOf(HttpError);
        expect(err.statusCode).toBeGreaterThanOrEqual(400);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ValidationError / ServiceUnavailableError
  // ═══════════════════════════════════════════════════════════════════════════
  describe('ValidationError', () => {
    it('is a 400 HttpError with VALIDATION_ERROR code', () => {
      const err = new ValidationError('bad input');
      expect(err).toBeInstanceOf(HttpError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.message).toBe('bad input');
      expect(err.name).toBe('ValidationError');
      expect(err.details).toBeUndefined();
    });

    it('carries optional details', () => {
      const err = new ValidationError('bad', { field: 'url' });
      expect(err.details).toEqual({ field: 'url' });
    });

    it('is handled by errorHandler with a 400 response', () => {
      errorHandler(new ValidationError('bad'), mockReq, mockRes, mockNext);
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
        }),
      );
    });
  });

  describe('ServiceUnavailableError', () => {
    it('is a 503 HttpError with SERVICE_UNAVAILABLE code', () => {
      const err = new ServiceUnavailableError('down', { dep: 'llm' });
      expect(err).toBeInstanceOf(HttpError);
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe('SERVICE_UNAVAILABLE');
      expect(err.message).toBe('down');
      expect(err.name).toBe('ServiceUnavailableError');
      expect(err.details).toEqual({ dep: 'llm' });
    });

    it('is handled by errorHandler with a 503 response', () => {
      errorHandler(
        new ServiceUnavailableError('down'),
        mockReq,
        mockRes,
        mockNext,
      );
      expect(mockRes.status).toHaveBeenCalledWith(503);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // errorHandler
  // ═══════════════════════════════════════════════════════════════════════════
  describe('errorHandler', () => {
    describe('HttpError handling', () => {
      it('should return the correct statusCode for an HttpError', () => {
        const error = new HttpError(400, 'BAD_REQUEST', 'Invalid request');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(400);
      });

      it('should return the APIResponse format with success=false', () => {
        const error = new HttpError(422, 'VALIDATION_ERROR', 'Invalid data');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid data',
            details: undefined,
          },
        });
      });

      it('should include details in the response when present', () => {
        const details = { field: 'url', value: 'invalid' };
        const error = new HttpError(
          400,
          'BAD_REQUEST',
          'Invalid parameter',
          details,
        );

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              details: { field: 'url', value: 'invalid' },
            }),
          }),
        );
      });

      it('should handle a 404 error', () => {
        const error = new HttpError(404, 'NOT_FOUND', 'Resource not found');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Resource not found',
            details: undefined,
          },
        });
      });

      it('should handle a 503 error', () => {
        const error = new HttpError(
          503,
          'SERVICE_UNAVAILABLE',
          'Service unavailable',
        );

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(503);
      });
    });

    describe('generic error handling', () => {
      it('should return 500 for a standard Error', () => {
        const error = new Error('Something went wrong');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(500);
      });

      it('should return a generic message for a standard Error', () => {
        const error = new Error('Sensitive internal details');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      });

      it('should return 500 for a TypeError', () => {
        const error = new TypeError('Cannot read property of undefined');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
          success: false,
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'An unexpected error occurred',
          },
        });
      });

      it('should return 500 for a RangeError', () => {
        const error = new RangeError('Invalid array length');

        errorHandler(error, mockReq, mockRes, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(500);
      });
    });

    it('should not call next', () => {
      const error = new HttpError(400, 'BAD', 'Bad');

      errorHandler(error, mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // notFoundHandler
  // ═══════════════════════════════════════════════════════════════════════════
  describe('notFoundHandler', () => {
    it('should call next with a 404 HttpError', () => {
      notFoundHandler(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const passedError = (mockNext as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(passedError).toBeInstanceOf(HttpError);
      expect(passedError.statusCode).toBe(404);
    });

    it('should pass the NOT_FOUND code', () => {
      notFoundHandler(mockReq, mockRes, mockNext);

      const passedError = (mockNext as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(passedError.code).toBe('NOT_FOUND');
    });

    it('should pass the message "Route not found"', () => {
      notFoundHandler(mockReq, mockRes, mockNext);

      const passedError = (mockNext as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(passedError.message).toBe('Route not found');
    });

    it('should not modify the response directly', () => {
      notFoundHandler(mockReq, mockRes, mockNext);

      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });
  });
});
