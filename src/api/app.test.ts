import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mocks ---

const mockUse = vi.fn().mockReturnThis();
const mockGet = vi.fn().mockReturnThis();
const mockExpressApp = {
  use: mockUse,
  get: mockGet,
};

function mockExpress(): typeof mockExpressApp {
  return mockExpressApp;
}
mockExpress.json = vi.fn().mockReturnValue('express-json-middleware');
mockExpress.urlencoded = vi
  .fn()
  .mockReturnValue('express-urlencoded-middleware');

vi.mock('express', () => ({
  default: mockExpress,
}));

vi.mock('helmet', () => ({
  default: function helmetMock() {
    return 'helmet-middleware';
  },
}));

vi.mock('cors', () => ({
  default: function corsMock() {
    return 'cors-middleware';
  },
}));

vi.mock('express-rate-limit', () => ({
  default: function rateLimitMock() {
    return 'rate-limit-middleware';
  },
}));

vi.mock('./middlewares/error-handler.js', () => ({
  errorHandler: 'error-handler-middleware',
  notFoundHandler: 'not-found-handler-middleware',
}));

vi.mock('./middlewares/request-logger.js', () => ({
  requestLogger: 'request-logger-middleware',
}));

vi.mock('@shared/utils/metrics.js', () => ({
  getMetrics: vi.fn().mockResolvedValue(''),
  getMetricsContentType: vi.fn().mockReturnValue('text/plain'),
}));

vi.mock('./routes/index.js', () => ({
  createApiRouter: function createApiRouter() {
    return { router: 'api-router', auditController: {} };
  },
}));

import { createApp } from './app';
import { getMetrics, getMetricsContentType } from '@shared/utils/metrics.js';
import type { IConfig } from '@shared/config/config';

const testConfig: IConfig = {
  port: 3000,
  env: 'test',
  logLevel: 'info',
  cors: { origins: [] },
  rateLimit: { windowMs: 15 * 60 * 1000, max: 100 },
  browser: { headless: true },
  appVersion: '1.0.0-test',
  apiKeys: [{ id: 'test-client', secret: 'test-secret' }],
};

describe('createApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpress.json.mockReturnValue('express-json-middleware');
    mockExpress.urlencoded.mockReturnValue('express-urlencoded-middleware');
  });

  it('should return an Express application object', () => {
    const { app } = createApp(testConfig);

    expect(app).toBeDefined();
    expect(app).toBe(mockExpressApp);
  });

  it('should apply helmet middleware', () => {
    createApp(testConfig);

    expect(mockUse).toHaveBeenCalledWith('helmet-middleware');
  });

  it('should apply cors middleware', () => {
    createApp(testConfig);

    expect(mockUse).toHaveBeenCalledWith('cors-middleware');
  });

  it('should apply rate limiter middleware', () => {
    createApp(testConfig);

    expect(mockUse).toHaveBeenCalledWith('rate-limit-middleware');
  });

  it('should apply JSON body parser', () => {
    createApp(testConfig);

    expect(mockExpress.json).toHaveBeenCalled();
    expect(mockUse).toHaveBeenCalledWith('express-json-middleware');
  });

  it('should apply urlencoded body parser', () => {
    createApp(testConfig);

    expect(mockExpress.urlencoded).toHaveBeenCalledWith({ extended: true });
    expect(mockUse).toHaveBeenCalledWith('express-urlencoded-middleware');
  });

  it('should apply request logger middleware', () => {
    createApp(testConfig);

    expect(mockUse).toHaveBeenCalledWith('request-logger-middleware');
  });

  it('should mount API routes on /api/v1', () => {
    createApp(testConfig);

    expect(mockUse).toHaveBeenCalledWith('/api/v1', 'api-router');
  });

  it('should apply notFoundHandler middleware', () => {
    createApp(testConfig);

    expect(mockUse).toHaveBeenCalledWith('not-found-handler-middleware');
  });

  it('should apply errorHandler middleware', () => {
    createApp(testConfig);

    expect(mockUse).toHaveBeenCalledWith('error-handler-middleware');
  });

  it('should register a GET /metrics endpoint guarded by the API-key middleware', () => {
    createApp(testConfig);

    // path + auth middleware + handler
    expect(mockGet).toHaveBeenCalledWith(
      '/metrics',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('the /metrics handler serves Prometheus metrics', async () => {
    vi.mocked(getMetrics).mockResolvedValue('metric_value 1');
    vi.mocked(getMetricsContentType).mockReturnValue(
      'text/plain; version=0.0.4',
    );

    createApp(testConfig);

    const metricsCall = mockGet.mock.calls.find(
      (c: unknown[]) => c[0] === '/metrics',
    );
    expect(metricsCall).toBeDefined();
    // [0] path, [1] auth middleware, [2] the metrics handler
    const handler = metricsCall![2] as (req: unknown, res: unknown) => void;

    const res = {
      set: vi.fn(),
      end: vi.fn(),
    };
    handler({}, res);

    // Wait for the internal promise chain to resolve
    await new Promise((resolve) => setImmediate(resolve));

    expect(getMetrics).toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith(
      'Content-Type',
      'text/plain; version=0.0.4',
    );
    expect(res.end).toHaveBeenCalledWith('metric_value 1');
  });

  it('should apply middleware in the correct order', () => {
    createApp(testConfig);

    const calls = mockUse.mock.calls.map(
      (call: unknown[]) => call[call.length - 1] as string,
    );

    const helmetIndex = calls.indexOf('helmet-middleware');
    const corsIndex = calls.indexOf('cors-middleware');
    const rateLimitIndex = calls.indexOf('rate-limit-middleware');
    const jsonIndex = calls.indexOf('express-json-middleware');
    const notFoundIndex = calls.indexOf('not-found-handler-middleware');
    const errorIndex = calls.indexOf('error-handler-middleware');

    // Security middleware comes before body parsing
    expect(helmetIndex).toBeLessThan(jsonIndex);
    expect(corsIndex).toBeLessThan(jsonIndex);
    expect(rateLimitIndex).toBeLessThan(jsonIndex);

    // Error handlers come last
    expect(notFoundIndex).toBeLessThan(errorIndex);
    expect(jsonIndex).toBeLessThan(notFoundIndex);
  });
});
