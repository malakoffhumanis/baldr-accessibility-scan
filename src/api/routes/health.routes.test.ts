import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'supertest';
import request from 'supertest';
import express from 'express';
import type { IConfig } from '@shared/config/config.js';

const { mockCheck, mockDiagnostic } = vi.hoisted(() => ({
  mockCheck: vi.fn(),
  mockDiagnostic: vi.fn(),
}));

vi.mock('../controllers/health.controller.js', () => ({
  HealthController: function HealthControllerMock() {
    return {
      check: mockCheck,
      diagnostic: mockDiagnostic,
    };
  },
}));

import { createHealthRouter } from './health.routes';
import { HealthController } from '@api/controllers/health.controller';

describe('health.routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();

    const controller = new HealthController({} as IConfig);
    app = express();
    app.use(express.json());
    app.use('/health', createHealthRouter(controller));
  });

  describe('GET /health/', () => {
    it('should call check and return 200 with healthy status', async () => {
      mockCheck.mockImplementation((_req: unknown, res: express.Response) => {
        res.status(200).json({
          success: true,
          data: { status: 'healthy', uptime: 42 },
          metadata: { timestamp: '2026-01-01T00:00:00.000Z', version: '1.0.0' },
        });
        return Promise.resolve();
      });

      const response: Response = await request(app).get('/health/').expect(200);

      const body = response.body as {
        success: boolean;
        data: { status: string; uptime: number };
      };
      expect(body).toHaveProperty('success', true);
      expect(body.data).toHaveProperty('status', 'healthy');
      expect(body.data).toHaveProperty('uptime', 42);
      expect(mockCheck).toHaveBeenCalledTimes(1);
    });

    it('should include metadata in the response', async () => {
      mockCheck.mockImplementation((_req: unknown, res: express.Response) => {
        res.status(200).json({
          success: true,
          data: { status: 'healthy', uptime: 10 },
          metadata: { timestamp: '2026-01-01T00:00:00.000Z', version: '1.0.0' },
        });
        return Promise.resolve();
      });

      const response: Response = await request(app).get('/health/').expect(200);

      const body = response.body as {
        metadata: { timestamp: string; version: string };
      };
      expect(body).toHaveProperty('metadata');
      expect(body.metadata).toHaveProperty('timestamp');
      expect(body.metadata).toHaveProperty('version');
    });
  });

  describe('GET /health/diagnostic', () => {
    it('should call diagnostic and return 200 for healthy service', async () => {
      mockDiagnostic.mockImplementation(
        (_req: unknown, res: express.Response) => {
          res.status(200).json({
            service: 'baldr-api',
            status: 'healthy',
            timestamp: '2026-01-01T00:00:00.000Z',
            version: '1.0.0',
            checks: {},
          });
          return Promise.resolve();
        },
      );

      const response: Response = await request(app)
        .get('/health/diagnostic')
        .expect(200);

      const body = response.body as { service: string; status: string };
      expect(body).toHaveProperty('service', 'baldr-api');
      expect(body).toHaveProperty('status', 'healthy');
      expect(mockDiagnostic).toHaveBeenCalledTimes(1);
    });

    it('should return 503 when service is degraded', async () => {
      mockDiagnostic.mockImplementation(
        (_req: unknown, res: express.Response) => {
          res.status(503).json({
            service: 'baldr-api',
            status: 'degraded',
            timestamp: '2026-01-01T00:00:00.000Z',
            checks: {
              configurationLLM: { status: 'error' },
            },
          });
          return Promise.resolve();
        },
      );

      const response: Response = await request(app)
        .get('/health/diagnostic')
        .expect(503);

      const body = response.body as {
        status: string;
        checks: { configurationLLM: { status: string } };
      };
      expect(body).toHaveProperty('status', 'degraded');
      expect(body.checks.configurationLLM).toHaveProperty('status', 'error');
    });
  });
});
