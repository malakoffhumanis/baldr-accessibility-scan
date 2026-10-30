import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/adapters/audit-api.adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AdapterModule>();
  return {
    ...actual,
    convertToConsolidatedReport: vi.fn(actual.convertToConsolidatedReport),
  };
});

import type * as AdapterModule from '@shared/adapters/audit-api.adapter.js';
import { JourneyReportBuilder } from './journey-report.builder.js';
import type { IJourneyExecutionResult } from './journey-orchestration.types.js';
import type { IAxeResult } from '@shared/types/audit.types.js';

function createAxeResult(): IAxeResult {
  return {
    url: 'https://example.com',
    timestamp: '2026-10-28T10:00:00.000Z',
    testInfo: {
      userAgent: 'HeadlessChrome/120',
      viewport: { width: 1920, height: 1080 },
      title: 'Accueil',
    },
    summary: { violations: 1, passes: 1, incomplete: 0, inapplicable: 0 },
    violations: [
      {
        id: 'image-alt',
        impact: 'critical',
        description: 'Images must have alternate text',
        help: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.8/image-alt',
        tags: ['wcag2a'],
        nodes: [{ html: '<img>', target: ['img'] }],
      },
    ],
    passes: [
      {
        id: 'html-has-lang',
        impact: null,
        tags: ['wcag2a'],
        description: 'html element has a lang attribute',
        help: '<html> element must have a lang attribute',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.8/html-has-lang',
        nodes: [{ html: '<html lang="fr">', target: ['html'] }],
      },
    ],
    incomplete: [],
    inapplicable: [],
  };
}

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

    it('carries the exported scoring figures', async () => {
      const deps = createMockDeps();
      const builder = new JourneyReportBuilder(
        deps.reportGenerator as never,
        deps.aiAnalyzer as never,
      );
      const result = await builder.build(
        { ...createMockExecResult(), results: [createAxeResult()] },
        'json',
        'scoring',
      );
      const parsed = JSON.parse(result.content) as {
        results: {
          passes?: { id: string }[];
          scoring?: { score: number; level: string; cards: { source: string } };
        }[];
        scoring?: { score: number; pageCount: number };
      };

      expect(parsed.results[0].passes).toEqual([
        expect.objectContaining({ id: 'html-has-lang', nodeCount: 1 }),
      ]);
      expect(parsed.results[0].scoring).toMatchObject({
        score: 50,
        level: 'Faible',
        cards: { source: 'axe' },
      });
      expect(parsed.scoring).toMatchObject({ score: 50, pageCount: 1 });
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

  describe('buildAll', () => {
    it('returns a single report for a single format', async () => {
      const deps = createMockDeps();
      const builder = new JourneyReportBuilder(
        deps.reportGenerator as never,
        deps.aiAnalyzer as never,
      );
      const reports = await builder.buildAll(
        createMockExecResult(),
        ['html'],
        'test',
      );
      expect(reports).toHaveLength(1);
      expect(reports[0].contentType).toBe('text/html; charset=utf-8');
    });

    it('returns one report per format, in order', async () => {
      const deps = createMockDeps();
      const builder = new JourneyReportBuilder(
        deps.reportGenerator as never,
        deps.aiAnalyzer as never,
      );
      const reports = await builder.buildAll(
        createMockExecResult(),
        ['html', 'json'],
        'Mon Audit',
      );
      expect(reports.map((r) => r.filename)).toEqual([
        'mon-audit.html',
        'mon-audit.json',
      ]);
      expect(reports.map((r) => r.contentType)).toEqual([
        'text/html; charset=utf-8',
        'application/json; charset=utf-8',
      ]);
      expect(
        deps.reportGenerator.generateConsolidatedHTMLReport,
      ).toHaveBeenCalledTimes(1);
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
