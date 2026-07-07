import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'puppeteer';

// Mock logger before importing the service
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ScreenshotService } from './screenshot.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPage(overrides: Record<string, unknown> = {}): Page {
  return {
    screenshot: vi.fn().mockResolvedValue('base64-screenshot-data'),
    content: vi.fn().mockResolvedValue('<html><body>test</body></html>'),
    $: vi.fn().mockResolvedValue(null),
    $$eval: vi.fn().mockResolvedValue([]),
    evaluate: vi.fn().mockResolvedValue({ width: 1920, height: 3000 }),
    ...overrides,
  } as unknown as Page;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScreenshotService', () => {
  let service: ScreenshotService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ScreenshotService();
  });

  // =========================================================================
  // captureFullPage()
  // =========================================================================
  describe('captureFullPage()', () => {
    it('should capture a full page screenshot as base64 when page height is under limit', async () => {
      const mockPage = createMockPage();

      const result = await service.captureFullPage(mockPage);

      expect(result).toBe('base64-screenshot-data');
      expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
      expect(mockPage.screenshot).toHaveBeenCalledWith({
        encoding: 'base64',
        fullPage: true,
        type: 'jpeg',
        quality: 60,
      });
    });

    it('should use clip when page height exceeds 4000px', async () => {
      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue({ width: 1920, height: 8000 }),
      });

      await service.captureFullPage(mockPage);

      expect(mockPage.screenshot).toHaveBeenCalledWith({
        encoding: 'base64',
        type: 'jpeg',
        quality: 60,
        clip: { x: 0, y: 0, width: 1920, height: 4000 },
      });
    });

    it('should call screenshot with correct options for short pages', async () => {
      const mockPage = createMockPage();

      await service.captureFullPage(mockPage);

      expect(mockPage.screenshot).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(mockPage.screenshot).mock.calls[0]?.[0] as {
        encoding: string;
        fullPage: boolean;
        type: string;
        quality: number;
      };
      expect(callArgs.encoding).toBe('base64');
      expect(callArgs.fullPage).toBe(true);
      expect(callArgs.type).toBe('jpeg');
      expect(callArgs.quality).toBe(60);
    });

    it('should throw with descriptive message when screenshot fails', async () => {
      const mockPage = createMockPage({
        screenshot: vi.fn().mockRejectedValue(new Error('GPU process crashed')),
      });

      await expect(service.captureFullPage(mockPage)).rejects.toThrow(
        'Screenshot capture failed: GPU process crashed',
      );
    });

    it('should throw with "Unknown error" for non-Error exceptions', async () => {
      const mockPage = createMockPage({
        screenshot: vi.fn().mockRejectedValue('string error'),
      });

      await expect(service.captureFullPage(mockPage)).rejects.toThrow(
        'Screenshot capture failed: Unknown error',
      );
    });

    it('should return the base64 string from the screenshot', async () => {
      const longBase64 = 'A'.repeat(10000);
      const mockPage = createMockPage({
        screenshot: vi.fn().mockResolvedValue(longBase64),
      });

      const result = await service.captureFullPage(mockPage);

      expect(result).toBe(longBase64);
      expect(result).toHaveLength(10000);
    });
  });

  // =========================================================================
  // extractDOM()
  // =========================================================================
  describe('extractDOM()', () => {
    it('should return HTML content from the page', async () => {
      const mockPage = createMockPage({
        content: vi
          .fn()
          .mockResolvedValue(
            '<html><head></head><body><p>Hello</p></body></html>',
          ),
      });

      const result = await service.extractDOM(mockPage);

      expect(result).toBe(
        '<html><head></head><body><p>Hello</p></body></html>',
      );
    });

    it('should remove script tags from the DOM', async () => {
      const htmlWithScripts =
        '<html><head><script>alert("xss")</script></head><body><p>Content</p><script type="text/javascript">var x = 1;</script></body></html>';
      const mockPage = createMockPage({
        content: vi.fn().mockResolvedValue(htmlWithScripts),
      });

      const result = await service.extractDOM(mockPage);

      expect(result).not.toContain('<script');
      expect(result).not.toContain('</script>');
      expect(result).not.toContain('alert("xss")');
      expect(result).toContain('<p>Content</p>');
    });

    it('should remove style tags from the DOM', async () => {
      const htmlWithStyles =
        '<html><head><style>body { color: red; }</style></head><body><p>Content</p></body></html>';
      const mockPage = createMockPage({
        content: vi.fn().mockResolvedValue(htmlWithStyles),
      });

      const result = await service.extractDOM(mockPage);

      expect(result).not.toContain('<style');
      expect(result).not.toContain('</style>');
      expect(result).not.toContain('color: red');
      expect(result).toContain('<p>Content</p>');
    });

    it('should remove both scripts and styles in a complex document', async () => {
      const complexHtml = [
        '<html>',
        '<head>',
        '<style>.cls { display: none; }</style>',
        '<script src="vendor.js"></script>',
        '</head>',
        '<body>',
        '<div id="app">',
        '<h1>Title</h1>',
        '<style>.inline { font-size: 14px; }</style>',
        '<script>document.getElementById("app");</script>',
        '<p>Paragraph text</p>',
        '</div>',
        '</body>',
        '</html>',
      ].join('');

      const mockPage = createMockPage({
        content: vi.fn().mockResolvedValue(complexHtml),
      });

      const result = await service.extractDOM(mockPage);

      expect(result).not.toContain('<script');
      expect(result).not.toContain('<style');
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('<p>Paragraph text</p>');
      expect(result).toContain('<div id="app">');
    });

    it('should throw with descriptive message when content extraction fails', async () => {
      const mockPage = createMockPage({
        content: vi.fn().mockRejectedValue(new Error('Page has been closed')),
      });

      await expect(service.extractDOM(mockPage)).rejects.toThrow(
        'DOM extraction failed: Page has been closed',
      );
    });

    it('should throw with "Unknown error" for non-Error exceptions', async () => {
      const mockPage = createMockPage({
        content: vi.fn().mockRejectedValue(42),
      });

      await expect(service.extractDOM(mockPage)).rejects.toThrow(
        'DOM extraction failed: Unknown error',
      );
    });

    it('should handle empty page content', async () => {
      const mockPage = createMockPage({
        content: vi.fn().mockResolvedValue(''),
      });

      const result = await service.extractDOM(mockPage);

      expect(result).toBe('');
    });

    it('should handle page with only scripts and styles (return stripped content)', async () => {
      const scriptOnlyHtml =
        '<html><head><script>code</script><style>rules</style></head><body></body></html>';
      const mockPage = createMockPage({
        content: vi.fn().mockResolvedValue(scriptOnlyHtml),
      });

      const result = await service.extractDOM(mockPage);

      expect(result).not.toContain('code');
      expect(result).not.toContain('rules');
      expect(result).toContain('<html>');
      expect(result).toContain('<body></body>');
    });
  });
});
