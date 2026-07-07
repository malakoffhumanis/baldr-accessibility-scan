import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'puppeteer';

// Use vi.hoisted to ensure mock functions are available before vi.mock hoisting
const { mockAnalyze, mockConfigure } = vi.hoisted(() => ({
  mockAnalyze: vi.fn(),
  mockConfigure: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@axe-core/puppeteer', () => ({
  default: function MockAxePuppeteer() {
    return {
      configure(config: Record<string, unknown>) {
        mockConfigure(config);
        return this;
      },
      analyze: mockAnalyze,
    };
  },
  __esModule: true,
}));

import { AxeRunnerService } from './axe-runner.service';

function createMockPage(overrides: Record<string, unknown> = {}): Page {
  return {
    title: vi.fn().mockResolvedValue('Test Page'),
    evaluate: vi.fn().mockResolvedValue('Mozilla/5.0 Test'),
    viewport: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
    ...overrides,
  } as unknown as Page;
}

const baseAxeResults = {
  violations: [
    {
      id: 'color-contrast',
      impact: 'serious',
      description: 'Color contrast issue',
      help: 'Elements must have sufficient color contrast',
      helpUrl: 'https://dequeuniversity.com/rules/axe/color-contrast',
      tags: ['wcag2aa'],
      nodes: [
        {
          html: '<p style="color:#ccc">text</p>',
          target: ['p'],
          failureSummary: 'Fix contrast',
          any: [],
          all: [],
          none: [],
        },
      ],
    },
  ],
  passes: [
    {
      id: 'image-alt',
      impact: null,
      description: 'Images have alt text',
      help: 'Images must have alt attributes',
      helpUrl: 'https://dequeuniversity.com/rules/axe/image-alt',
      tags: ['wcag2a'],
      nodes: [{ html: '<img alt="Photo" />', target: ['img'] }],
    },
  ],
  incomplete: [
    {
      id: 'aria-valid-attr',
      impact: 'moderate',
      description: 'ARIA valid',
      help: 'ARIA valid',
      helpUrl: 'https://dequeuniversity.com/rules/axe/aria-valid-attr',
      tags: ['wcag2a'],
      nodes: [{ html: '<div aria-labelledby="x">C</div>', target: ['.d'] }],
    },
  ],
  inapplicable: [
    {
      id: 'video-caption',
      impact: null,
      description: 'Video captions',
      help: 'Captions',
      helpUrl: 'https://dequeuniversity.com/rules/axe/video-caption',
      tags: ['wcag2a'],
    },
  ],
};

describe('AxeRunnerService', () => {
  let service: AxeRunnerService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyze.mockResolvedValue(baseAxeResults);
    service = new AxeRunnerService();
  });

  describe('analyze', () => {
    it('should return structured results', async () => {
      const result = await service.analyze(createMockPage(), {
        url: 'https://ex.com',
      });
      expect(result.url).toBe('https://ex.com');
      expect(result.authenticated).toBe(false);
      expect(result.authMethod).toBe('none');
    });

    it('should include test info', async () => {
      const result = await service.analyze(createMockPage(), {
        url: 'https://ex.com',
      });
      expect(result.testInfo.title).toBe('Test Page');
      expect(result.testInfo.userAgent).toBe('Mozilla/5.0 Test');
    });

    it('should use default viewport when null', async () => {
      const page = createMockPage({ viewport: vi.fn().mockReturnValue(null) });
      const result = await service.analyze(page, { url: 'https://ex.com' });
      expect(result.testInfo.viewport).toEqual({ width: 1920, height: 1080 });
    });

    it('should include summary', async () => {
      const result = await service.analyze(createMockPage(), {
        url: 'https://ex.com',
      });
      expect(result.summary).toEqual({
        violations: 1,
        passes: 1,
        incomplete: 1,
        inapplicable: 1,
      });
    });

    it('should map violations', async () => {
      const result = await service.analyze(createMockPage(), {
        url: 'https://ex.com',
      });
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].id).toBe('color-contrast');
    });

    it('should handle name and auth params', async () => {
      const result = await service.analyze(createMockPage(), {
        url: 'https://ex.com',
        name: 'Home',
        authenticated: true,
        authMethod: 'form',
      });
      expect(result.name).toBe('Home');
      expect(result.authenticated).toBe(true);
      expect(result.authMethod).toBe('form');
    });

    it('should default impact to minor', async () => {
      mockAnalyze.mockResolvedValueOnce({
        ...baseAxeResults,
        violations: [{ ...baseAxeResults.violations[0], impact: undefined }],
      });
      const result = await service.analyze(createMockPage(), {
        url: 'https://ex.com',
      });
      expect(result.violations[0].impact).toBe('minor');
    });

    it('should throw on failure', async () => {
      mockAnalyze.mockRejectedValueOnce(new Error('Axe failed'));
      await expect(
        service.analyze(createMockPage(), { url: 'https://ex.com' }),
      ).rejects.toThrow('Axe-Core analysis failed: Axe failed');
    });

    it('should handle non-Error exceptions', async () => {
      mockAnalyze.mockRejectedValueOnce('unknown');
      await expect(
        service.analyze(createMockPage(), { url: 'https://ex.com' }),
      ).rejects.toThrow('Axe-Core analysis failed: Unknown error');
    });

    it('should handle empty results', async () => {
      mockAnalyze.mockResolvedValueOnce({
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
      });
      const result = await service.analyze(createMockPage(), {
        url: 'https://ex.com',
      });
      expect(result.summary.violations).toBe(0);
    });

    it('should configure axe rules', async () => {
      await service.analyze(createMockPage(), { url: 'https://ex.com' });
      expect(mockConfigure).toHaveBeenCalledWith({
        rules: expect.arrayContaining([
          { id: 'color-contrast', enabled: true },
        ]),
      });
    });
  });
});
