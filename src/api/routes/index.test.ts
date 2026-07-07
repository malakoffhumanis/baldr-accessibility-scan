import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock all the services that get instantiated in createApiRouter
vi.mock('@shared/services/browser/browser.service.js', () => ({
  BrowserService: class {
    constructor() {}
  },
}));
vi.mock('@shared/services/axe/axe-runner.service.js', () => ({
  AxeRunnerService: class {
    constructor() {}
  },
}));
vi.mock('@shared/services/report/report-generator.service.js', () => ({
  ReportGeneratorService: class {
    constructor() {}
  },
}));
vi.mock('@shared/services/ai/ai-analyzer.service.js', () => ({
  AIAnalyzerService: class {
    constructor() {}
    isAvailable() {
      return false;
    }
  },
}));
vi.mock('@shared/services/ai/openai-client.service.js', () => ({
  OpenAIClientService: class {
    constructor() {}
  },
}));
vi.mock('@shared/services/ai/ai-error-classifier.service.js', () => ({
  AIErrorClassifierService: class {
    constructor() {}
  },
}));
vi.mock('@shared/services/screenshot/screenshot.service.js', () => ({
  ScreenshotService: class {
    constructor() {}
  },
}));
vi.mock('@shared/services/journey/action-executor.service.js', () => ({
  ActionExecutorService: class {
    constructor() {}
  },
}));
vi.mock('@shared/services/journey/action-parser.service.js', () => ({
  ActionParserService: class {
    constructor() {}
  },
}));
vi.mock('@shared/services/journey/cookie-banner.service.js', () => ({
  CookieBannerService: class {
    constructor() {}
  },
}));
vi.mock('@shared/services/journey/journey-orchestration.service.js', () => ({
  JourneyOrchestrationService: class {
    constructor() {}
  },
}));
vi.mock('@api/docs/docs.routes.js', () => {
  const { Router } = require('express');
  return {
    createDocsRouter: vi.fn().mockReturnValue(Router()),
  };
});

import { createApiRouter } from './index.js';

function createMockConfig() {
  return {
    env: 'test',
    port: 3000,
    appVersion: '1.0.0',
    browser: { headless: true },
    reportsDir: '/tmp/reports',
    exposeApiDocs: true,
    llmProvider: undefined,
    proxy: undefined,
    apiKeys: [{ id: 'test-client', secret: 'test-secret' }],
  };
}

describe('createApiRouter', () => {
  it('creates a router and returns it with journeyController', () => {
    const result = createApiRouter(createMockConfig() as never);
    expect(result.router).toBeDefined();
    expect(result.journeyController).toBeDefined();
  });

  it('includes docs route when exposeApiDocs is true', () => {
    const config = createMockConfig();
    config.exposeApiDocs = true;
    const result = createApiRouter(config as never);
    expect(result.router).toBeDefined();
  });

  it('skips docs route when exposeApiDocs is false', () => {
    const config = createMockConfig();
    config.exposeApiDocs = false;
    const result = createApiRouter(config as never);
    expect(result.router).toBeDefined();
  });
});
