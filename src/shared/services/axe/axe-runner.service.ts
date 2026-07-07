import type { Page } from 'puppeteer';
import AxePuppeteer from '@axe-core/puppeteer';

import { createLogger } from '@shared/utils/logger.js';
import type { IAxeResult } from '@shared/types/audit.types.js';

const logger = createLogger('axe-runner');

/**
 * Service that runs Axe-Core tests
 */
/** Page metadata passed to {@link AxeRunnerService.analyze}. */
export interface AxeAnalyzeOptions {
  /** Page URL */
  url: string;
  /** Page name (optional) */
  name?: string;
  /** Whether the page required authentication */
  authenticated?: boolean;
  /** Authentication method used */
  authMethod?: 'form' | 'session' | 'none' | 'adfs';
}

export class AxeRunnerService {
  /**
   * Runs the Axe-Core analysis on a page.
   */
  async analyze(page: Page, options: AxeAnalyzeOptions): Promise<IAxeResult> {
    const { url, name, authenticated, authMethod } = options;
    logger.info({ url, name }, 'Starting Axe-Core analysis');

    try {
      // Inject and run Axe-Core
      const axeResults = await new AxePuppeteer(page)
        .configure({
          // Explicitly keep these key WCAG/RGAA checks enabled; all other
          // rules still run via axe-core's default ruleset.
          rules: [
            { id: 'color-contrast', enabled: true },
            { id: 'image-alt', enabled: true },
            { id: 'label', enabled: true },
          ],
        })
        .analyze();

      logger.info(
        {
          violations: axeResults.violations.length,
          passes: axeResults.passes.length,
        },
        'Axe-Core analysis complete',
      );

      // Retrieve page info
      const title = await page.title();
      const userAgent: string = await page.evaluate(() => navigator.userAgent);

      const currentViewport = page.viewport();
      const viewport = currentViewport ?? { width: 1920, height: 1080 };

      /**
       * Normalizes an Axe selector into a string or string[]
       */
      const normalizeTarget = (target: unknown): string[] | string => {
        if (Array.isArray(target)) {
          return target.map((t) => String(t));
        }
        return String(target);
      };

      // Build the final result
      const result: IAxeResult = {
        name,
        url,
        timestamp: new Date().toISOString(),
        authenticated: authenticated ?? false,
        authMethod: authMethod ?? 'none',
        testInfo: {
          userAgent,
          viewport,
          title: title || 'Untitled',
        },
        summary: {
          violations: axeResults.violations.length,
          passes: axeResults.passes.length,
          incomplete: axeResults.incomplete.length,
          inapplicable: axeResults.inapplicable.length,
        },
        violations: axeResults.violations.map((v) => ({
          id: v.id,
          impact: v.impact ?? 'minor',
          description: v.description,
          help: v.help,
          helpUrl: v.helpUrl,
          tags: v.tags,
          nodes: v.nodes.map((node) => ({
            html: node.html,
            target: normalizeTarget(node.target),
            failureSummary: node.failureSummary,
            any: node.any,
            all: node.all,
            none: node.none,
          })),
        })),
        passes: axeResults.passes.map((p) => ({
          id: p.id,
          impact: p.impact ?? null,
          tags: p.tags,
          description: p.description,
          help: p.help,
          helpUrl: p.helpUrl,
          nodes: p.nodes.map((node) => ({
            html: node.html,
            target: normalizeTarget(node.target),
          })),
        })),
        incomplete: axeResults.incomplete.map((i) => ({
          id: i.id,
          impact: i.impact ?? null,
          tags: i.tags,
          description: i.description,
          help: i.help,
          helpUrl: i.helpUrl,
          nodes: i.nodes.map((node) => ({
            html: node.html,
            target: normalizeTarget(node.target),
          })),
        })),
        inapplicable: axeResults.inapplicable.map((ia) => ({
          id: ia.id,
          impact: ia.impact ?? null,
          tags: ia.tags,
          description: ia.description,
          help: ia.help,
          helpUrl: ia.helpUrl,
        })),
      };

      return result;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage, url }, 'Axe-Core analysis failed');
      throw new Error(`Axe-Core analysis failed: ${errorMessage}`, {
        cause: error,
      });
    }
  }
}
