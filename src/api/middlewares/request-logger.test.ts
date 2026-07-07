import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'events';

// Mock the logger before importing the module under test
// vi.hoisted ensures the variable is available when vi.mock is hoisted
const { mockLoggerInfo } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
}));

vi.mock('../../shared/utils/logger', () => ({
  createLogger: () => ({
    info: mockLoggerInfo,
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { requestLogger } from './request-logger';

/**
 * Creates a mocked Request object with the necessary properties
 */
function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    url: '/api/health',
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
}

/**
 * Creates a mocked Response object based on EventEmitter to simulate the 'finish' event
 */
function createMockResponse(statusCode = 200): Response & EventEmitter {
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    statusCode,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    // Required for the Response type
    headersSent: false,
  }) as unknown as Response & EventEmitter;
  return res;
}

describe('request-logger', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
    mockLoggerInfo.mockClear();
  });

  describe('requestLogger middleware', () => {
    it('should call next() immediately', () => {
      const req = createMockRequest();
      const res = createMockResponse();

      requestLogger(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should call next() with no arguments (no error)', () => {
      const req = createMockRequest();
      const res = createMockResponse();

      requestLogger(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should log the request information when the response ends', () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/audit',
        ip: '10.0.0.1',
      } as Partial<Request>);
      const res = createMockResponse(201);

      requestLogger(req, res, mockNext);

      // Trigger the 'finish' event to simulate the end of the response
      res.emit('finish');

      expect(mockLoggerInfo).toHaveBeenCalledTimes(1);
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          url: '/api/audit',
          status: 201,
          ip: '10.0.0.1',
        }),
      );
    });

    it('should include the duration in the logs', () => {
      const req = createMockRequest();
      const res = createMockResponse();

      requestLogger(req, res, mockNext);
      res.emit('finish');

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          duration: expect.any(Number),
        }),
      );
    });

    it('should compute a positive or zero duration', () => {
      const req = createMockRequest();
      const res = createMockResponse();

      requestLogger(req, res, mockNext);
      res.emit('finish');

      const loggedData = mockLoggerInfo.mock.calls[0][0] as {
        duration: number;
      };
      expect(loggedData.duration).toBeGreaterThanOrEqual(0);
    });

    it('should not log before the response has ended', () => {
      const req = createMockRequest();
      const res = createMockResponse();

      requestLogger(req, res, mockNext);

      // No 'finish' emission
      expect(mockLoggerInfo).not.toHaveBeenCalled();
    });

    it('should log the GET method correctly', () => {
      const req = createMockRequest({ method: 'GET' } as Partial<Request>);
      const res = createMockResponse(200);

      requestLogger(req, res, mockNext);
      res.emit('finish');

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should log the DELETE method correctly', () => {
      const req = createMockRequest({ method: 'DELETE' } as Partial<Request>);
      const res = createMockResponse(204);

      requestLogger(req, res, mockNext);
      res.emit('finish');

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'DELETE', status: 204 }),
      );
    });

    it('should log a 500 error status', () => {
      const req = createMockRequest();
      const res = createMockResponse(500);

      requestLogger(req, res, mockNext);
      res.emit('finish');

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ status: 500 }),
      );
    });

    it('should handle a URL with query parameters', () => {
      const req = createMockRequest({
        url: '/api/audit?url=https://example.com&type=full',
      } as Partial<Request>);
      const res = createMockResponse();

      requestLogger(req, res, mockNext);
      res.emit('finish');

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/api/audit?url=https://example.com&type=full',
        }),
      );
    });

    it('should handle an undefined IP', () => {
      const req = createMockRequest({ ip: undefined } as Partial<Request>);
      const res = createMockResponse();

      requestLogger(req, res, mockNext);
      res.emit('finish');

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ ip: undefined }),
      );
    });
  });
});
