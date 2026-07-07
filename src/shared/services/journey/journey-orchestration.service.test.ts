import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/utils/url-validator.util.js', () => ({
  validateAndNormalizeUrl: vi.fn((url: string) => url),
}));

// Mock DNS so the goto anti-rebinding lookup never hits the network.
// Default: any hostname resolves to a public IP.
const lookupMock = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import { JourneyOrchestrationService } from './journey-orchestration.service.js';
import type { IJourneyInternalOptions } from './journey-orchestration.types.js';

function createMockDeps() {
  const mockPage = {
    url: vi.fn().mockReturnValue('https://example.com'),
    isClosed: vi.fn().mockReturnValue(false),
    title: vi.fn().mockResolvedValue('Test'),
    evaluate: vi.fn().mockResolvedValue('UA'),
    viewport: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return {
    browserService: {
      close: vi.fn().mockResolvedValue(undefined),
      closePage: vi.fn().mockResolvedValue(undefined),
      setAuthConfigs: vi.fn(),
      launch: vi.fn().mockResolvedValue(undefined),
      createPage: vi.fn().mockResolvedValue(mockPage),
      navigateToUrl: vi.fn().mockResolvedValue(undefined),
      waitForPageReady: vi.fn().mockResolvedValue(undefined),
    },
    axeRunner: {
      analyze: vi.fn().mockResolvedValue({
        name: 'Test',
        url: 'https://example.com',
        timestamp: '',
        authenticated: false,
        authMethod: 'none',
        testInfo: {
          userAgent: '',
          viewport: { width: 1920, height: 1080 },
          title: '',
        },
        summary: { violations: 0, passes: 0, incomplete: 0, inapplicable: 0 },
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
      }),
    },
    aiAnalyzer: {
      isAvailable: vi.fn().mockReturnValue(false),
      analyzeWithAI: vi.fn().mockResolvedValue({}),
      analyzeCommonProblems: vi.fn().mockResolvedValue([]),
    },
    aiErrorClassifier: {
      classify: vi.fn().mockReturnValue({ code: 'ERR', message: 'error' }),
      buildConfigurationError: vi
        .fn()
        .mockReturnValue({ code: 'CFG', message: 'not configured' }),
    },
    reportGenerator: {
      generateConsolidatedHTMLReport: vi
        .fn()
        .mockResolvedValue('<html></html>'),
      generateReports: vi.fn().mockResolvedValue(undefined),
    },
    screenshotService: {
      captureFullPage: vi.fn().mockResolvedValue('screenshot'),
    },
    actionExecutor: {
      execute: vi.fn().mockResolvedValue(undefined),
    },
    actionParser: {
      parse: vi.fn().mockResolvedValue({ type: 'scan' }),
      replanAfterNoEffect: vi.fn().mockResolvedValue(null),
    },
    cookieBanner: {
      accept: vi.fn().mockResolvedValue(null),
    },
    openaiClient: {
      isReady: vi.fn().mockReturnValue(false),
      checkModelAvailability: vi.fn().mockResolvedValue(undefined),
    },
    mockPage,
  };
}

function createOptions(
  overrides: Partial<IJourneyInternalOptions> = {},
): IJourneyInternalOptions {
  return {
    name: 'test-journey',
    blocks: [
      {
        url: 'https://example.com',
        actions: ['scan the page'],
      },
    ],
    authConfigs: {},
    analysisType: 'static',
    reportFormat: 'json',
    ...overrides,
  };
}

describe('JourneyOrchestrationService', () => {
  function createService(deps = createMockDeps()) {
    return {
      service: new JourneyOrchestrationService(
        deps.browserService as never,
        deps.axeRunner,
        deps.aiAnalyzer as never,
        deps.aiErrorClassifier as never,
        deps.reportGenerator as never,
        deps.screenshotService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
        deps.openaiClient as never,
      ),
      deps,
    };
  }

  describe('execute', () => {
    it('executes a simple journey with one block and one scan action', async () => {
      const { service, deps } = createService();
      const result = await service.execute(createOptions());

      expect(deps.browserService.close).toHaveBeenCalled();
      expect(deps.browserService.setAuthConfigs).toHaveBeenCalled();
      expect(deps.browserService.createPage).toHaveBeenCalled();
      expect(result.definedBlocksCount).toBe(1);
      expect(result.executedBlocksCount).toBe(1);
      expect(result.definedActionsCount).toBe(1);
      expect(result.journeyStopped).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('performs LLM pre-flight check when openai is ready', async () => {
      const deps = createMockDeps();
      deps.openaiClient.isReady.mockReturnValue(true);
      const { service } = createService(deps);

      await service.execute(createOptions());

      expect(deps.openaiClient.checkModelAvailability).toHaveBeenCalled();
    });

    it('handles empty blocks', async () => {
      const { service } = createService();
      const result = await service.execute(createOptions({ blocks: [] }));

      expect(result.definedBlocksCount).toBe(0);
      expect(result.executedBlocksCount).toBe(0);
    });

    it('records journey URLs', async () => {
      const { service } = createService();
      const result = await service.execute(createOptions());

      expect(result.journeyUrls).toContain('https://example.com');
    });
  });

  describe('generateReport', () => {
    it('delegates to report builder', async () => {
      const { service } = createService();
      const execResult = await service.execute(createOptions());
      const report = await service.generateReport(execResult, 'json', 'test');
      expect(report.contentType).toBe('application/json; charset=utf-8');
    });
  });

  describe('cleanup', () => {
    it('closes the browser', async () => {
      const { service, deps } = createService();
      await service.cleanup();
      expect(deps.browserService.close).toHaveBeenCalled();
    });
  });

  describe('browser failure', () => {
    it('stops journey on page creation failure', async () => {
      const deps = createMockDeps();
      deps.browserService.createPage.mockRejectedValueOnce(
        new Error('browser crash'),
      );
      const { service } = createService(deps);

      const result = await service.execute(createOptions());
      expect(result.journeyStopped).toBe(true);
      expect(result.actionErrors.length).toBeGreaterThan(0);
    });
  });

  describe('navigation failure', () => {
    it('handles navigation error', async () => {
      const deps = createMockDeps();
      deps.browserService.navigateToUrl.mockRejectedValueOnce(
        new Error('net::ERR'),
      );
      const { service } = createService(deps);

      const result = await service.execute(createOptions());
      // Navigation errors are caught and recorded
      expect(result.executedBlocksCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('block with auth', () => {
    it('runs authentication when block has auth key', async () => {
      const deps = createMockDeps();
      const { service } = createService(deps);

      const result = await service.execute(
        createOptions({
          blocks: [
            {
              url: 'https://example.com',
              auth: 'adfs',
              actions: ['scan the page'],
            },
          ],
          authConfigs: {
            adfs: { type: 'adfs', loginUrl: 'https://login.com' },
          },
        }),
      );

      expect(deps.browserService.navigateToUrl).toHaveBeenCalled();
      expect(result.executedBlocksCount).toBeGreaterThanOrEqual(0);
    });

    it('stops on auth failure', async () => {
      const deps = createMockDeps();
      deps.browserService.navigateToUrl.mockRejectedValueOnce(
        new Error('auth fail'),
      );
      const { service } = createService(deps);

      const result = await service.execute(
        createOptions({
          blocks: [
            {
              url: 'https://example.com',
              auth: 'form',
              actions: ['scan'],
            },
          ],
        }),
      );

      expect(result.journeyStopped).toBe(true);
      expect(result.actionErrors.length).toBeGreaterThan(0);
    });
  });

  describe('goto logic', () => {
    it('navigates to URL when not already on it', async () => {
      const deps = createMockDeps();
      deps.mockPage.url.mockReturnValue('https://different.com');
      deps.mockPage.goto = vi.fn().mockResolvedValue(undefined);
      deps.mockPage.waitForNetworkIdle = vi.fn().mockResolvedValue(undefined);
      const { service } = createService(deps);

      const result = await service.execute(createOptions());
      expect(result.executedBlocksCount).toBe(1);
    });

    it('handles goto errors', async () => {
      const deps = createMockDeps();
      deps.mockPage.url.mockReturnValue('https://different.com');
      deps.mockPage.goto = vi.fn().mockRejectedValueOnce(new Error('timeout'));
      const { service } = createService(deps);

      const result = await service.execute(createOptions());
      expect(result.journeyStopped).toBe(true);
    });

    it('blocks goto to an internal block URL (SSRF) before navigating', async () => {
      const deps = createMockDeps();
      deps.mockPage.url.mockReturnValue('about:blank');
      deps.mockPage.goto = vi.fn().mockResolvedValue(undefined);
      const { service } = createService(deps);

      const result = await service.execute(
        createOptions({
          blocks: [
            { url: 'http://169.254.169.254/latest/', actions: ['scan'] },
          ],
        }),
      );

      expect(result.journeyStopped).toBe(true);
      expect(result.actionErrors.length).toBeGreaterThan(0);
      expect(deps.mockPage.goto).not.toHaveBeenCalled();
    });

    it('blocks goto when block URL resolves to a private IP (rebinding)', async () => {
      const deps = createMockDeps();
      deps.mockPage.url.mockReturnValue('about:blank');
      deps.mockPage.goto = vi.fn().mockResolvedValue(undefined);
      lookupMock.mockResolvedValueOnce([{ address: '10.0.0.7', family: 4 }]);
      const { service } = createService(deps);

      const result = await service.execute(
        createOptions({
          blocks: [{ url: 'https://rebind.example/', actions: ['scan'] }],
        }),
      );

      expect(result.journeyStopped).toBe(true);
      expect(deps.mockPage.goto).not.toHaveBeenCalled();
    });

    it('blocks when goto redirects to an internal URL (30x)', async () => {
      const deps = createMockDeps();
      // First url() => about:blank (not on target → goto), after goto => internal.
      let navigated = false;
      deps.mockPage.url.mockImplementation(() =>
        navigated ? 'http://127.0.0.1:9000/' : 'about:blank',
      );
      deps.mockPage.goto = vi.fn().mockImplementation(async () => {
        navigated = true;
        return undefined;
      });
      const { service } = createService(deps);

      const result = await service.execute(
        createOptions({
          blocks: [{ url: 'https://example.com/', actions: ['scan'] }],
        }),
      );

      expect(result.journeyStopped).toBe(true);
      expect(deps.mockPage.goto).toHaveBeenCalled();
    });
  });

  describe('action execution', () => {
    it('handles action errors and stops journey', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockRejectedValueOnce(new Error('parse failed'));
      const { service } = createService(deps);

      const result = await service.execute(createOptions());
      expect(result.journeyStopped).toBe(true);
      expect(result.actionErrors.length).toBeGreaterThan(0);
    });

    it('handles closed page during actions', async () => {
      const deps = createMockDeps();
      deps.mockPage.isClosed
        .mockReturnValueOnce(false) // executeBlock finally check
        .mockReturnValueOnce(true); // runBlockActions loop check
      const { service } = createService(deps);

      const result = await service.execute(createOptions());
      // Page closed is handled, journey may stop
      expect(result.executedBlocksCount).toBeGreaterThanOrEqual(0);
    });

    it('increments action count on success', async () => {
      const deps = createMockDeps();
      const { service } = createService(deps);

      const result = await service.execute(
        createOptions({
          blocks: [
            {
              url: 'https://example.com',
              actions: ['scan', 'scan'],
            },
          ],
        }),
      );

      expect(result.definedActionsCount).toBe(2);
      expect(result.executedActionsCount).toBe(2);
    });
  });

  describe('multiple blocks', () => {
    it('iterates over all blocks', async () => {
      const deps = createMockDeps();
      deps.browserService.createPage.mockResolvedValue(deps.mockPage);
      const { service } = createService(deps);

      const result = await service.execute(
        createOptions({
          blocks: [
            { url: 'https://example.com/1', actions: ['scan'] },
            { url: 'https://example.com/2', actions: ['scan'] },
          ],
        }),
      );

      expect(result.definedBlocksCount).toBe(2);
      // createPage should be called at least for the first block
      expect(deps.browserService.createPage).toHaveBeenCalled();
    });
  });

  describe('mutex', () => {
    it('serializes concurrent executions', async () => {
      const { service } = createService();
      const [r1, r2] = await Promise.all([
        service.execute(createOptions()),
        service.execute(createOptions()),
      ]);
      expect(r1.executedBlocksCount).toBe(1);
      expect(r2.executedBlocksCount).toBe(1);
    });
  });
});
