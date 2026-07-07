import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── vi.hoisted mock variables ───────────────────────────────────────────────
const {
  mockLogger,
  mockConvertJourneyRequestToOptions,
  mockRandomUUID,
  mockOrchestration,
  mockMetrics,
} = vi.hoisted(() => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const mockOrchestration = {
    execute: vi.fn(),
    generateReport: vi.fn(),
    cleanup: vi.fn(),
  };

  const mockConvertJourneyRequestToOptions = vi.fn();
  const mockRandomUUID = vi.fn().mockReturnValue('test-uuid-1234');

  const mockMetrics = {
    auditRequestsTotal: { inc: vi.fn() },
    auditDuration: { observe: vi.fn() },
    activeAudits: { inc: vi.fn(), dec: vi.fn() },
  };

  return {
    mockLogger,
    mockOrchestration,
    mockConvertJourneyRequestToOptions,
    mockRandomUUID,
    mockMetrics,
  };
});

// ─── vi.mock factories ───────────────────────────────────────────────────────
vi.mock('../../shared/utils/logger.js', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../shared/adapters/journey-api.adapter.js', () => ({
  convertJourneyRequestToOptions: (...args: unknown[]) =>
    mockConvertJourneyRequestToOptions(...args),
}));

vi.mock('../../shared/utils/metrics.js', () => ({
  auditRequestsTotal: mockMetrics.auditRequestsTotal,
  auditDuration: mockMetrics.auditDuration,
  activeAudits: mockMetrics.activeAudits,
}));

vi.mock('node:crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}));

// ─── Import under test ──────────────────────────────────────────────────────
import type { Request, Response } from 'express';
import { JourneyController } from './journey.controller.js';
import type { JourneyOrchestrationService } from '@shared/services/journey/journey-orchestration.service.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function createMockReq(body: Record<string, unknown> = {}) {
  return { body } as unknown as Request;
}

function createMockRes() {
  const res: Record<string, unknown> = {};
  const jsonFn = vi.fn().mockReturnValue(res);
  const sendFn = vi.fn().mockReturnValue(res);
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn, send: sendFn });
  const setHeaderFn = vi.fn();

  res['status'] = statusFn;
  res['json'] = jsonFn;
  res['send'] = sendFn;
  res['setHeader'] = setHeaderFn;
  res['locals'] = {};

  return {
    res: res as unknown as Response,
    statusFn,
    jsonFn,
    sendFn,
    setHeaderFn,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────
describe('JourneyController', () => {
  let controller: JourneyController;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestration.execute.mockResolvedValue({
      results: [],
      journeyUrls: ['https://example.com'],
      definedBlocksCount: 1,
      executedBlocksCount: 1,
      definedActionsCount: 2,
      executedActionsCount: 2,
      actionErrors: [],
      journeyStoppedd: false,
      durationMs: 500,
    });
    mockOrchestration.generateReport.mockResolvedValue({
      content: '<html>journey report</html>',
      contentType: 'text/html; charset=utf-8',
    });
    mockOrchestration.cleanup.mockResolvedValue(undefined);
    mockRandomUUID.mockReturnValue('test-uuid-1234');

    controller = new JourneyController(
      mockOrchestration as unknown as JourneyOrchestrationService,
    );
  });

  describe('executeJourney', () => {
    it('should execute journey and return HTML report with correct headers', async () => {
      const req = createMockReq({
        journey: [{ url: 'https://example.com', actions: ['scanner'] }],
        analysisType: 'static',
        reportFormat: 'html',
      });
      const { res, statusFn, sendFn, setHeaderFn } = createMockRes();

      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'html',
      });

      await controller.executeJourney(req, res);

      expect(mockOrchestration.execute).toHaveBeenCalled();
      expect(mockOrchestration.generateReport).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [],
          journeyUrls: ['https://example.com'],
          executedBlocksCount: 1,
        }),
        'html',
        'Test Journey',
      );
      expect(setHeaderFn).toHaveBeenCalledWith(
        'Content-Type',
        'text/html; charset=utf-8',
      );
      expect(statusFn).toHaveBeenCalledWith(200);
      expect(sendFn).toHaveBeenCalledWith('<html>journey report</html>');
    });

    it('should instrument metrics on success', async () => {
      const req = createMockReq({
        journey: [{ url: 'https://example.com', actions: ['scanner'] }],
      });
      const { res } = createMockRes();

      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'html',
      });

      await controller.executeJourney(req, res);

      expect(mockMetrics.activeAudits.inc).toHaveBeenCalledTimes(1);
      expect(mockMetrics.activeAudits.dec).toHaveBeenCalledTimes(1);
      expect(mockMetrics.auditRequestsTotal.inc).toHaveBeenCalledWith({
        status: 'success',
        apiKey: 'anonymous',
      });
      expect(mockMetrics.auditDuration.observe).toHaveBeenCalledTimes(1);
      expect(mockMetrics.auditDuration.observe).toHaveBeenCalledWith(
        expect.any(Number),
      );
    });

    it('attributes the metric to the authenticated key id (res.locals.apiKeyId)', async () => {
      const req = createMockReq({
        journey: [{ url: 'https://example.com', actions: ['scanner'] }],
      });
      const { res } = createMockRes();
      (res as unknown as { locals: Record<string, unknown> }).locals[
        'apiKeyId'
      ] = 'client-a';

      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'html',
      });

      await controller.executeJourney(req, res);

      expect(mockMetrics.auditRequestsTotal.inc).toHaveBeenCalledWith({
        status: 'success',
        apiKey: 'client-a',
      });
    });

    it('should instrument metrics on failure', async () => {
      const req = createMockReq({
        journey: [{ url: 'https://example.com', actions: ['scanner'] }],
      });
      const { res } = createMockRes();

      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'html',
      });
      mockOrchestration.execute.mockRejectedValue(new Error('Browser crash'));

      await controller.executeJourney(req, res);

      expect(mockMetrics.activeAudits.inc).toHaveBeenCalledTimes(1);
      expect(mockMetrics.activeAudits.dec).toHaveBeenCalledTimes(1);
      expect(mockMetrics.auditRequestsTotal.inc).toHaveBeenCalledWith({
        status: 'error',
        apiKey: 'anonymous',
      });
      expect(mockMetrics.auditDuration.observe).toHaveBeenCalledTimes(1);
    });

    it('should execute journey and return JSON report', async () => {
      const req = createMockReq({
        journey: [{ url: 'https://example.com', actions: ['scanner'] }],
        analysisType: 'static',
        reportFormat: 'json',
      });
      const { res, statusFn, sendFn, setHeaderFn } = createMockRes();

      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'json',
      });
      mockOrchestration.generateReport.mockResolvedValue({
        content: '{"result":"ok"}',
        contentType: 'application/json; charset=utf-8',
      });

      await controller.executeJourney(req, res);

      expect(setHeaderFn).toHaveBeenCalledWith(
        'Content-Type',
        'application/json; charset=utf-8',
      );
      expect(statusFn).toHaveBeenCalledWith(200);
      expect(sendFn).toHaveBeenCalledWith('{"result":"ok"}');
    });

    it('should set Content-Disposition header for CSV reports', async () => {
      const req = createMockReq({
        journey: [{ url: 'https://example.com', actions: ['scanner'] }],
        reportFormat: 'csv',
      });
      const { res, statusFn, sendFn, setHeaderFn } = createMockRes();

      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'csv',
      });
      mockOrchestration.generateReport.mockResolvedValue({
        content: 'col1;col2\nval1;val2',
        contentType: 'text/csv; charset=utf-8',
        filename: 'rapport-journey.csv',
      });

      await controller.executeJourney(req, res);

      expect(setHeaderFn).toHaveBeenCalledWith(
        'Content-Type',
        'text/csv; charset=utf-8',
      );
      expect(setHeaderFn).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="rapport-journey.csv"',
      );
      expect(statusFn).toHaveBeenCalledWith(200);
      expect(sendFn).toHaveBeenCalledWith('col1;col2\nval1;val2');
    });

    it('should return 500 on orchestration.execute() failure', async () => {
      const req = createMockReq({
        journey: [{ url: 'https://example.com', actions: ['scanner'] }],
        analysisType: 'static',
      });
      const { res, statusFn, jsonFn } = createMockRes();

      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'html',
      });
      mockOrchestration.execute.mockRejectedValue(new Error('Browser crash'));

      await controller.executeJourney(req, res);

      expect(statusFn).toHaveBeenCalledWith(500);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'INTERNAL_SERVER_ERROR',
            message: expect.stringContaining('requestId:'),
          }),
        }),
      );
    });

    it('should return 500 on orchestration.generateReport() failure', async () => {
      const req = createMockReq({
        journey: [{ url: 'https://example.com', actions: ['scanner'] }],
        analysisType: 'static',
      });
      const { res, statusFn, jsonFn } = createMockRes();

      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'html',
      });
      mockOrchestration.generateReport.mockRejectedValue(
        new Error('Report generation failed'),
      );

      await controller.executeJourney(req, res);

      expect(statusFn).toHaveBeenCalledWith(500);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'INTERNAL_SERVER_ERROR',
            message: expect.stringContaining('requestId:'),
          }),
        }),
      );
    });

    it('should always call orchestration.cleanup() in finally block', async () => {
      const req = createMockReq({
        journey: [{ url: 'https://example.com', actions: ['scanner'] }],
      });
      const { res } = createMockRes();

      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'html',
      });

      // Success case
      await controller.executeJourney(req, res);
      expect(mockOrchestration.cleanup).toHaveBeenCalledTimes(1);

      // Error case
      vi.clearAllMocks();
      mockConvertJourneyRequestToOptions.mockReturnValue({
        name: 'Test Journey',
        blocks: [{ url: 'https://example.com', actions: ['scanner'] }],
        authConfigs: {},
        analysisType: 'static',
        reportFormat: 'html',
      });
      mockOrchestration.execute.mockRejectedValue(new Error('fail'));
      mockOrchestration.cleanup.mockResolvedValue(undefined);

      await controller.executeJourney(req, res);
      expect(mockOrchestration.cleanup).toHaveBeenCalledTimes(1);
    });
  });
});
