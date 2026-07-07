import type { Page } from 'puppeteer';

import type { AIAnalyzerService } from '@shared/services/ai/ai-analyzer.service.js';
import type { AxeRunnerService } from '@shared/services/axe/axe-runner.service.js';
import type { AIErrorClassifierService } from '@shared/services/ai/ai-error-classifier.service.js';
import type { ScreenshotService } from '@shared/services/screenshot/screenshot.service.js';
import { rgaaRulesLoader } from '@shared/config/rgaa-rules/index.js';
import type { IAxeResult } from '@shared/types/audit.types.js';
import { createLogger } from '@shared/utils/logger.js';

import { JourneyError } from './journey-error.util.js';

const logger = createLogger('page-scanner');

export type AnalysisType = 'static' | 'intel' | 'full';

export interface ScanPageArgs {
  page: Page;
  pageName?: string;
  analysisType: AnalysisType;
  specificRules: string[] | undefined;
}

/**
 * Accessibility scan of an open Puppeteer page. Depending on
 * `analysisType`, combines: Axe-Core only (`static`), AI only (`intel`), or
 * both merged (`full`). Also captures a full-page screenshot on a
 * best-effort basis.
 */
export class PageScanner {
  constructor(
    private readonly axeRunner: AxeRunnerService,
    private readonly aiAnalyzer: AIAnalyzerService,
    private readonly aiErrorClassifier: AIErrorClassifierService,
    private readonly screenshotService: ScreenshotService,
  ) {}

  async scan(args: ScanPageArgs): Promise<IAxeResult> {
    const { page, analysisType, specificRules } = args;

    const url = page.url();
    let pageTitle = '';
    try {
      pageTitle = (await page.title()).trim();
    } catch {
      // ignore
    }
    const pageName = pageTitle.length > 0 ? pageTitle : url;

    const screenshot = await this.captureScreenshotSafe(page);

    let axeResult: IAxeResult;

    if (analysisType === 'intel') {
      axeResult = await this.scanIntelOnly(page, pageName, url, specificRules);
    } else {
      axeResult = await this.axeRunner.analyze(page, {
        url,
        name: pageName,
        authenticated: false,
        authMethod: 'none',
      });
      if (analysisType === 'full') {
        await this.enrichWithAI(page, axeResult, specificRules);
      }
    }

    if (screenshot !== undefined) {
      axeResult.screenshot = screenshot;
    }
    return axeResult;
  }

  private async captureScreenshotSafe(page: Page): Promise<string | undefined> {
    try {
      return await this.screenshotService.captureFullPage(page);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Screenshot capture failed (continuing without)',
      );
      return undefined;
    }
  }

  private async scanIntelOnly(
    page: Page,
    pageName: string,
    url: string,
    specificRules: string[] | undefined,
  ): Promise<IAxeResult> {
    if (!this.aiAnalyzer.isAvailable()) {
      throw new JourneyError(
        'AI_ANALYSIS',
        "Mode 'intel' requested but AI service not configured (LLM_PROVIDER_API_KEY/ENDPOINT)",
      );
    }
    const rules = specificRules
      ? await rgaaRulesLoader.loadSpecificRulesByRGAAIds(specificRules)
      : Object.values((await rgaaRulesLoader.loadAllRules()).rules);
    const aiResult = await this.aiAnalyzer.analyzeWithAI(
      page,
      {} as IAxeResult,
      rules,
    );
    return {
      name: pageName,
      url,
      timestamp: new Date().toISOString(),
      authenticated: false,
      authMethod: 'none',
      testInfo: {
        userAgent: await page.evaluate(() => navigator.userAgent),
        viewport: page.viewport() ?? { width: 1920, height: 1080 },
        title: pageName,
      },
      summary: { violations: 0, passes: 0, incomplete: 0, inapplicable: 0 },
      violations: [],
      passes: [],
      incomplete: [],
      inapplicable: [],
      aiEnrichedResult: aiResult,
    };
  }

  /**
   * `full` mode: enriches the existing Axe result with an AI analysis.
   * AI errors are caught and classified into `aiAnalysisError` —
   * they do not invalidate the Axe result.
   */
  private async enrichWithAI(
    page: Page,
    axeResult: IAxeResult,
    specificRules: string[] | undefined,
  ): Promise<void> {
    if (!this.aiAnalyzer.isAvailable()) {
      axeResult.aiAnalysisError =
        this.aiErrorClassifier.buildConfigurationError();
      return;
    }
    try {
      const rules = specificRules
        ? await rgaaRulesLoader.loadSpecificRulesByRGAAIds(specificRules)
        : Object.values((await rgaaRulesLoader.loadAllRules()).rules);
      const aiResult = await this.aiAnalyzer.analyzeWithAI(
        page,
        axeResult,
        rules,
      );
      axeResult.aiEnrichedResult = aiResult;
    } catch (errAI: unknown) {
      const errMsg = errAI instanceof Error ? errAI.message : String(errAI);
      logger.error({ err: errMsg }, 'AI enrichment failed during journey');
      axeResult.aiAnalysisError = this.aiErrorClassifier.classify(errMsg);
    }
  }
}
