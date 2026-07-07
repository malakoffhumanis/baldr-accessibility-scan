import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'supertest';
import request from 'supertest';
import express from 'express';

import type { SuccessResponse } from '@shared/types/audit-api.types.js';

// Mutable mock state so each test can drive the AI/connectivity branches.
const mockState = vi.hoisted(() => ({
  isAvailable: true,
  testConnection: vi.fn(),
}));

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/services/ai/openai-client.service.js', () => ({
  OpenAIClientService: class {
    testConnection = mockState.testConnection;
  },
}));

vi.mock('@shared/services/ai/ai-analyzer.service.js', () => ({
  AIAnalyzerService: class {
    isAvailable = (): boolean => mockState.isAvailable;
  },
}));

import { HealthController } from './health.controller.js';

function createMockRes() {
  return {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };
}

function createMockConfig(overrides: Record<string, unknown> = {}) {
  return {
    appVersion: '1.0.0',
    env: 'test',
    port: 3000,
    browser: { headless: true },
    llmProvider: {
      apiKey: 'test-key',
      endpoint: 'https://llm.test.com',
      model: 'gpt-4o',
    },
    proxy: null,
    ...overrides,
  };
}

beforeEach(() => {
  // Sensible defaults: AI available, connectivity succeeds.
  mockState.isAvailable = true;
  mockState.testConnection.mockReset();
  mockState.testConnection.mockResolvedValue({
    success: true,
    details: { latencyMs: 100 },
  });
});

describe('HealthController', () => {
  describe('GET /health', () => {
    let app: express.Application;
    let controller: HealthController;

    beforeEach(() => {
      app = express();
      app.use(express.json());
      controller = new HealthController({
        port: 3000,
        env: 'test',
        logLevel: 'info',
        cors: { origins: [] },
        browser: { headless: true },
        appVersion: '1.0.0-test',
      } as never);

      app.get('/health', (req, res) => {
        void controller.check(req, res);
      });
    });

    it('should return healthy status', async () => {
      // Act
      const response: Response = await request(app).get('/health').expect(200);

      // Assert
      const body = response.body as SuccessResponse<{
        status: string;
        uptime: number;
      }>;
      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('status', 'healthy');
      expect(body.data).toHaveProperty('uptime');
      expect(body).toHaveProperty('metadata');
    });

    it('should return current uptime', async () => {
      // Act
      const response: Response = await request(app).get('/health').expect(200);

      // Assert
      const body = response.body as SuccessResponse<{
        status: string;
        uptime: number;
      }>;
      expect(body.data?.uptime).toBeTypeOf('number');
      expect(body.data?.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should include timestamp in metadata', async () => {
      // Act
      const response: Response = await request(app).get('/health').expect(200);

      // Assert
      const body = response.body as SuccessResponse<{
        status: string;
        uptime: number;
      }>;
      expect(body.metadata).toHaveProperty('timestamp');
      expect(body.metadata?.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
    });
  });

  describe('check', () => {
    it('returns healthy status with uptime', async () => {
      const config = createMockConfig();
      const controller = new HealthController(config as never);
      const res = createMockRes();

      await controller.check({} as never, res as never);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            status: 'healthy',
            uptime: expect.any(Number),
          }),
          metadata: expect.objectContaining({
            timestamp: expect.any(String),
            version: '1.0.0',
          }),
        }),
      );
    });
  });

  describe('diagnostic', () => {
    it('returns healthy diagnostic when AI is available and connected', async () => {
      const config = createMockConfig();
      const controller = new HealthController(config as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          service: 'baldr-api',
          status: 'healthy',
        }),
      );
    });

    it('returns degraded when AI is not available', async () => {
      mockState.isAvailable = false;
      const config = createMockConfig({
        llmProvider: { apiKey: undefined, endpoint: undefined },
      });
      const controller = new HealthController(config as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      // With no apiKey, AI should not be available => degraded
      const callArg = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg['status']).toBeDefined();
    });

    it('includes connectivity check when AI is available', async () => {
      const config = createMockConfig();
      const controller = new HealthController(config as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      const callArg = res.json.mock.calls[0][0] as Record<string, unknown>;
      const checks = callArg['checks'] as Record<
        string,
        Record<string, unknown>
      >;
      expect(checks['connectivityLLM']).toBeDefined();
    });

    it('handles connection test gracefully', async () => {
      const config = createMockConfig();
      const controller = new HealthController(config as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      expect(res.json).toHaveBeenCalled();
    });

    it('includes proxy info when configured', async () => {
      const config = createMockConfig({
        proxy: { url: 'http://proxy.test.com:8080' },
      });
      const controller = new HealthController(config as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      const callArg = res.json.mock.calls[0][0] as Record<string, unknown>;
      const checks = callArg['checks'] as Record<
        string,
        Record<string, unknown>
      >;
      expect(checks['proxy']['status']).toBe('configured');
      expect(checks['proxy']['url']).toBe('http://proxy.test.com:8080');
    });

    it('includes configuration check', async () => {
      const config = createMockConfig();
      const controller = new HealthController(config as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      const callArg = res.json.mock.calls[0][0] as Record<string, unknown>;
      const checks = callArg['checks'] as Record<
        string,
        Record<string, unknown>
      >;
      expect(checks['configuration']).toBeDefined();
      expect(checks['configuration']['port']).toBe(3000);
    });
  });

  describe('diagnostic — degraded branches', () => {
    it('returns 503 degraded when the connectivity test fails (success=false)', async () => {
      mockState.testConnection.mockResolvedValue({
        success: false,
        details: { latencyMs: 9999 },
      });

      const controller = new HealthController(createMockConfig() as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(body['status']).toBe('degraded');
      const checks = body['checks'] as Record<string, Record<string, unknown>>;
      expect(checks['connectivityLLM']['status']).toBe('failed');
      // Spread details are preserved
      expect(checks['connectivityLLM']['latencyMs']).toBe(9999);
    });

    it('returns 503 degraded with error status when testConnection throws an Error', async () => {
      mockState.testConnection.mockRejectedValue(new Error('socket hang up'));

      const controller = new HealthController(createMockConfig() as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(body['status']).toBe('degraded');
      const checks = body['checks'] as Record<string, Record<string, unknown>>;
      expect(checks['connectivityLLM']['status']).toBe('error');
      expect(checks['connectivityLLM']['error']).toBe('socket hang up');
    });

    it('stringifies non-Error rejections from testConnection', async () => {
      mockState.testConnection.mockRejectedValue('boom-string');

      const controller = new HealthController(createMockConfig() as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      const body = res.json.mock.calls[0][0] as Record<string, unknown>;
      const checks = body['checks'] as Record<string, Record<string, unknown>>;
      expect(checks['connectivityLLM']['error']).toBe('boom-string');
      expect(body['status']).toBe('degraded');
    });

    it('skips connectivity and returns 503 degraded when AI is not available', async () => {
      mockState.isAvailable = false;

      const controller = new HealthController(createMockConfig() as never);
      const res = createMockRes();

      await controller.diagnostic({} as never, res as never);

      // testConnection must never be reached
      expect(mockState.testConnection).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0] as Record<string, unknown>;
      expect(body['status']).toBe('degraded');
      const checks = body['checks'] as Record<string, Record<string, unknown>>;
      expect(checks['connectivityLLM']['status']).toBe('skipped');
      expect(checks['connectivityLLM']['reason']).toContain('incomplete');
      expect(checks['configurationLLM']['status']).toBe('error');
    });
  });
});
