import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/adapters/audit-api.adapter.js', () => ({
  convertToConsolidatedReport: vi.fn().mockReturnValue({
    type: 'consolidated',
    results: [],
  }),
}));

import { JourneyReportBuilder } from './journey-report.builder.js';
import type { IJourneyExecutionResult } from './journey-orchestration.types.js';

function createMockExecResult(): IJourneyExecutionResult {
  return {
    results: [],
    journeyUrls: ['https://example.com'],
    definedBlocksCount: 1,
    executedBlocksCount: 1,
    definedActionsCount: 2,
    executedActionsCount: 2,
    actionErrors: [],
    journeyStopped: false,
    durationMs: 5000,
  };
}

function createMockDeps() {
  return {
    reportGenerator: {
      generateConsolidatedHTMLReport: vi
        .fn()
        .mockResolvedValue('<html>report</html>'),
      generateConsolidatedCSVReport: vi.fn().mockResolvedValue('col1,col2\n'),
    },
    aiAnalyzer: {
      analyzeCommonProblems: vi.fn().mockResolvedValue([]),
    },
  };
}

describe('JourneyReportBuilder', () => {
  describe('build — json format', () => {
    it('returns JSON report without calling AI', async () => {
      const deps = createMockDeps();
      const builder = new JourneyReportBuilder(
        deps.reportGenerator as never,
        deps.aiAnalyzer as never,
      );
      const result = await builder.build(
        createMockExecResult(),
        'json',
        'test-audit',
      );
      expect(result.contentType).toBe('application/json; charset=utf-8');
      expect(deps.aiAnalyzer.analyzeCommonProblems).not.toHaveBeenCalled();
      const parsed = JSON.parse(result.content);
      expect(parsed.journeyUrls).toEqual(['https://example.com']);
      expect(parsed.definedBlocksCount).toBe(1);
      expect(parsed.executedBlocksCount).toBe(1);
      expect(parsed.definedActionsCount).toBe(2);
      expect(parsed.executedActionsCount).toBe(2);
      expect(parsed.journeyStopped).toBe(false);
    });

    it('builds json without auditName', async () => {
      const deps = createMockDeps();
      const builder = new JourneyReportBuilder(
        deps.reportGenerator as never,
        deps.aiAnalyzer as never,
      );
      const result = await builder.build(createMockExecResult(), 'json');
      expect(result.contentType).toBe('application/json; charset=utf-8');
    });
  });

  describe('build — html format', () => {
    it('returns HTML report with AI common problems', async () => {
      const deps = createMockDeps();
      const builder = new JourneyReportBuilder(
        deps.reportGenerator as never,
        deps.aiAnalyzer as never,
      );
      const result = await builder.build(
        createMockExecResult(),
        'html',
        'test',
      );
      expect(result.contentType).toBe('text/html; charset=utf-8');
      expect(result.content).toBe('<html>report</html>');
      expect(deps.aiAnalyzer.analyzeCommonProblems).toHaveBeenCalled();
      expect(
        deps.reportGenerator.generateConsolidatedHTMLReport,
      ).toHaveBeenCalled();
    });
  });

  describe('build — csv format', () => {
    it('returns CSV with HTML content and csv content type', async () => {
      const deps = createMockDeps();
      const builder = new JourneyReportBuilder(
        deps.reportGenerator as never,
        deps.aiAnalyzer as never,
      );
      const result = await builder.build(createMockExecResult(), 'csv');
      expect(result.contentType).toBe('text/csv; charset=utf-8');
      expect(result.filename).toBe('rapport-journey.csv');
      expect(result.content).toBe('<html>report</html>');
    });
  });

  describe('download filename derived from the audit name', () => {
    function build(format: 'html' | 'json' | 'csv', name?: string) {
      const deps = createMockDeps();
      const builder = new JourneyReportBuilder(
        deps.reportGenerator as never,
        deps.aiAnalyzer as never,
      );
      return builder.build(createMockExecResult(), format, name);
    }

    it('uses the sanitized name for every format', async () => {
      expect((await build('html', 'Mon Audit Préprod')).filename).toBe(
        'mon-audit-preprod.html',
      );
      expect((await build('json', 'Mon Audit Préprod')).filename).toBe(
        'mon-audit-preprod.json',
      );
      expect((await build('csv', 'Mon Audit Préprod')).filename).toBe(
        'mon-audit-preprod.csv',
      );
    });

    it('falls back to rapport-journey when name is absent', async () => {
      expect((await build('html')).filename).toBe('rapport-journey.html');
      expect((await build('json')).filename).toBe('rapport-journey.json');
    });

    it('never emits a traversal/injection-unsafe filename', async () => {
      const { filename } = await build('html', '../../etc/passwd');
      expect(filename).toBe('etc-passwd.html');
      expect(filename).not.toMatch(/[/\\"\r\n]/);
    });
  });
});
