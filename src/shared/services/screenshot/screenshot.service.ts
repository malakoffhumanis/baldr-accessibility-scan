import type { Page } from 'puppeteer';

import { createLogger } from '@shared/utils/logger.js';

const logger = createLogger('screenshot-service');

/**
 * Screenshot capture and DOM extraction service
 */
export class ScreenshotService {
  /**
   * Captures a full page as base64
   */
  private static readonly MAX_SCREENSHOT_HEIGHT = 4000;
  private static readonly SCREENSHOT_QUALITY = 60;

  async captureFullPage(page: Page): Promise<string> {
    try {
      logger.info('Capturing full page screenshot');

      const dimensions = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      }));

      let screenshot: string;

      if (dimensions.height > ScreenshotService.MAX_SCREENSHOT_HEIGHT) {
        logger.info(
          {
            originalHeight: dimensions.height,
            clippedHeight: ScreenshotService.MAX_SCREENSHOT_HEIGHT,
          },
          'Page too tall, clipping screenshot',
        );
        screenshot = await page.screenshot({
          encoding: 'base64',
          type: 'jpeg',
          quality: ScreenshotService.SCREENSHOT_QUALITY,
          clip: {
            x: 0,
            y: 0,
            width: dimensions.width,
            height: ScreenshotService.MAX_SCREENSHOT_HEIGHT,
          },
        });
      } else {
        screenshot = await page.screenshot({
          encoding: 'base64',
          type: 'jpeg',
          quality: ScreenshotService.SCREENSHOT_QUALITY,
          fullPage: true,
        });
      }

      logger.info('Full page screenshot captured');
      return screenshot;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Screenshot capture failed');
      throw new Error(`Screenshot capture failed: ${errorMessage}`, {
        cause: error,
      });
    }
  }

  /**
   * Extracts the page DOM
   */
  async extractDOM(page: Page): Promise<string> {
    try {
      logger.info('Extracting page DOM');

      const html = await page.content();

      // Clean the DOM by removing scripts and styles
      const cleanedHtml = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

      const sizeKB = Buffer.byteLength(cleanedHtml, 'utf8') / 1024;
      logger.info({ sizeKB: sizeKB.toFixed(2) }, 'DOM extracted successfully');

      return cleanedHtml;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'DOM extraction failed');
      throw new Error(`DOM extraction failed: ${errorMessage}`, {
        cause: error,
      });
    }
  }
}
