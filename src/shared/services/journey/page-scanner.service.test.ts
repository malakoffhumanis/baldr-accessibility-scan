import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/config/rgaa-rules/index.js', () => ({
  rgaaRulesLoader: {
    loadAllRules: vi.fn().mockResolvedValue({
      rules: { r1: { id: 'r1', name: 'Rule 1' } },
    }),
    loadSpecificRulesByRGAAIds: vi.fn().mockResolvedValue([{ id: 'r1' }]),
  },
}));

import { PageScanner, type ScanPageArgs } from './page-scanner.service.js';
import { JourneyError } from './journey-error.util.js';

function createMockPage() {
  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Test Page'),
    evaluate: vi.fn().mockResolvedValue('Mozilla/5.0'),
    viewport: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
  };
}

function createMockDeps() {
  return {
    axeRunner: {
      analyze: vi.fn().mockResolvedValue({
        name: 'Test',
        url: 'https://example.com',
        timestamp: new Date().toISOString(),
        authenticated: false,
        authMethod: 'none',
        testInfo: {
          userAgent: 'test',
          viewport: { width: 1920, height: 1080 },
          title: 'Test',
        },
        summary: { violations: 0, passes: 0, incomplete: 0, inapplicable: 0 },
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
      }),
    },
    aiAnalyzer: {
      isAvailable: vi.fn().mockReturnValue(true),
      analyzeWithAI: vi.fn().mockResolvedValue({ rules: [] }),
    },
    aiErrorClassifier: {
      classify: vi
        .fn()
        .mockReturnValue({ code: 'AI_ERROR', message: 'AI failed' }),
      buildConfigurationError: vi
        .fn()
        .mockReturnValue({ code: 'CONFIG_ERROR', message: 'Not configured' }),
    },
    screenshotService: {
      captureFullPage: vi.fn().mockResolvedValue('base64screenshot'),
    },
  };
}

describe('PageScanner', () => {
  describe('scan — static mode', () => {
    it('uses axe runner only', async () => {
      const deps = createMockDeps();
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      const result = await scanner.scan({
        page: page as never,
        analysisType: 'static',
        specificRules: undefined,
      });
      expect(deps.axeRunner.analyze).toHaveBeenCalled();
      expect(deps.aiAnalyzer.analyzeWithAI).not.toHaveBeenCalled();
      expect(result.screenshot).toBe('base64screenshot');
    });
  });

  describe('scan — full mode', () => {
    it('uses axe runner and enriches with AI', async () => {
      const deps = createMockDeps();
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      const result = await scanner.scan({
        page: page as never,
        analysisType: 'full',
        specificRules: undefined,
      });
      expect(deps.axeRunner.analyze).toHaveBeenCalled();
      expect(deps.aiAnalyzer.analyzeWithAI).toHaveBeenCalled();
      expect(result.aiEnrichedResult).toEqual({ rules: [] });
    });

    it('sets aiAnalysisError when AI is not available in full mode', async () => {
      const deps = createMockDeps();
      deps.aiAnalyzer.isAvailable.mockReturnValue(false);
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      const result = await scanner.scan({
        page: page as never,
        analysisType: 'full',
        specificRules: undefined,
      });
      expect(result.aiAnalysisError).toBeDefined();
      expect(deps.aiErrorClassifier.buildConfigurationError).toHaveBeenCalled();
    });

    it('classifies AI errors in full mode', async () => {
      const deps = createMockDeps();
      deps.aiAnalyzer.analyzeWithAI.mockRejectedValueOnce(
        new Error('AI failed'),
      );
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      const result = await scanner.scan({
        page: page as never,
        analysisType: 'full',
        specificRules: undefined,
      });
      expect(result.aiAnalysisError).toBeDefined();
      expect(deps.aiErrorClassifier.classify).toHaveBeenCalledWith('AI failed');
    });

    it('uses specific rules when provided in full mode', async () => {
      const deps = createMockDeps();
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      await scanner.scan({
        page: page as never,
        analysisType: 'full',
        specificRules: ['1.1', '1.2'],
      });
      const { rgaaRulesLoader } =
        await import('@shared/config/rgaa-rules/index.js');
      expect(rgaaRulesLoader.loadSpecificRulesByRGAAIds).toHaveBeenCalledWith([
        '1.1',
        '1.2',
      ]);
    });
  });

  describe('scan — intel mode', () => {
    it('uses AI only without axe', async () => {
      const deps = createMockDeps();
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      const result = await scanner.scan({
        page: page as never,
        analysisType: 'intel',
        specificRules: undefined,
      });
      expect(deps.axeRunner.analyze).not.toHaveBeenCalled();
      expect(deps.aiAnalyzer.analyzeWithAI).toHaveBeenCalled();
      expect(result.name).toBe('Test Page');
      expect(result.url).toBe('https://example.com');
      expect(result.aiEnrichedResult).toEqual({ rules: [] });
    });

    it('throws when AI is not available in intel mode', async () => {
      const deps = createMockDeps();
      deps.aiAnalyzer.isAvailable.mockReturnValue(false);
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      await expect(
        scanner.scan({
          page: page as never,
          analysisType: 'intel',
          specificRules: undefined,
        }),
      ).rejects.toThrow(JourneyError);
    });

    it('uses specific rules when provided in intel mode', async () => {
      const deps = createMockDeps();
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      await scanner.scan({
        page: page as never,
        analysisType: 'intel',
        specificRules: ['1.1'],
      });
      const { rgaaRulesLoader } =
        await import('@shared/config/rgaa-rules/index.js');
      expect(rgaaRulesLoader.loadSpecificRulesByRGAAIds).toHaveBeenCalled();
    });
  });

  describe('screenshot capture', () => {
    it('continues without screenshot when capture fails', async () => {
      const deps = createMockDeps();
      deps.screenshotService.captureFullPage.mockRejectedValueOnce(
        new Error('screenshot failed'),
      );
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      const result = await scanner.scan({
        page: page as never,
        analysisType: 'static',
        specificRules: undefined,
      });
      expect(result.screenshot).toBeUndefined();
    });
  });

  describe('page title handling', () => {
    it('uses URL as page name when title is empty', async () => {
      const deps = createMockDeps();
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      page.title.mockResolvedValueOnce('   ');
      await scanner.scan({
        page: page as never,
        analysisType: 'static',
        specificRules: undefined,
      });
      expect(deps.axeRunner.analyze).toHaveBeenCalledWith(page, {
        url: 'https://example.com',
        name: 'https://example.com',
        authenticated: false,
        authMethod: 'none',
      });
    });

    it('handles title() throwing', async () => {
      const deps = createMockDeps();
      const scanner = new PageScanner(
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.screenshotService as never,
      );
      const page = createMockPage();
      page.title.mockRejectedValueOnce(new Error('page closed'));
      await scanner.scan({
        page: page as never,
        analysisType: 'static',
        specificRules: undefined,
      });
      expect(deps.axeRunner.analyze).toHaveBeenCalled();
    });
  });
});
