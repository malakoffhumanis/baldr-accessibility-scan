import type { Page } from 'puppeteer';
import { Mutex } from 'async-mutex';

import type { AIAnalyzerService } from '@shared/services/ai/ai-analyzer.service.js';
import type { AxeRunnerService } from '@shared/services/axe/axe-runner.service.js';
import type { BrowserService } from '@shared/services/browser/browser.service.js';
import type { AIErrorClassifierService } from '@shared/services/ai/ai-error-classifier.service.js';
import type { OpenAIClientService } from '@shared/services/ai/openai-client.service.js';
import type { ReportGeneratorService } from '@shared/services/report/report-generator.service.js';
import type { ScreenshotService } from '@shared/services/screenshot/screenshot.service.js';
import type { IAxeResult } from '@shared/types/audit.types.js';
import type {
  JourneyBlock,
  ActionErrorResult,
} from '@shared/types/journey-api.types.js';
import { createLogger } from '@shared/utils/logger.js';
import {
  validateUrlSsrf,
  validateUrlSsrfResolved,
} from '@shared/utils/ssrf-guard.util.js';
import { validateAndNormalizeUrl } from '@shared/utils/url-validator.util.js';

import { ActionExecutionHandler } from './action-execution.handler.js';
import type {
  ActionExecutorService,
  ExecutionContext,
} from './action-executor.service.js';
import type { ActionParserService } from './action-parser.service.js';
import type { CookieBannerService } from './cookie-banner.service.js';
import { PageScanner } from './page-scanner.service.js';
import { buildActionError, JourneyError } from './journey-error.util.js';
import type {
  IJourneyExecutionResult,
  IJourneyInternalOptions,
  IJourneyReport,
} from './journey-orchestration.types.js';
import { JourneyReportBuilder } from './journey-report.builder.js';
import {
  type ErrorContext,
  inferErrorContext,
  detectAuthAtStart,
  isOnUrl,
  isSameBasePath,
} from './journey.util.js';

export type {
  IJourneyExecutionResult,
  IJourneyInternalOptions,
  IJourneyReport,
} from './journey-orchestration.types.js';

const logger = createLogger('journey-orchestration');

const GOTO_TIMEOUT_MS = 30000;

/**
 * High-level orchestration of a journey: iterates over the blocks, delegates
 * action execution to `ActionExecutionHandler`, scanning to `PageScanner`,
 * and report generation to `JourneyReportBuilder`.
 *
 * Stateless service — execution state flows via parameters between calls.
 */
export class JourneyOrchestrationService {
  private readonly actionHandler: ActionExecutionHandler;
  private readonly pageScanner: PageScanner;
  private readonly reportBuilder: JourneyReportBuilder;
  private readonly executionMutex = new Mutex();
  private readonly openaiClient: OpenAIClientService;

  constructor(
    private readonly browserService: BrowserService,
    axeRunner: AxeRunnerService,
    aiAnalyzer: AIAnalyzerService,
    aiErrorClassifier: AIErrorClassifierService,
    reportGenerator: ReportGeneratorService,
    screenshotService: ScreenshotService,
    actionExecutor: ActionExecutorService,
    actionParser: ActionParserService,
    cookieBanner: CookieBannerService,
    openaiClient: OpenAIClientService,
  ) {
    this.openaiClient = openaiClient;
    this.actionHandler = new ActionExecutionHandler(
      browserService,
      actionExecutor,
      actionParser,
      cookieBanner,
    );
    this.pageScanner = new PageScanner(
      axeRunner,
      aiAnalyzer,
      aiErrorClassifier,
      screenshotService,
    );
    this.reportBuilder = new JourneyReportBuilder(reportGenerator, aiAnalyzer);
  }

  async execute(
    options: IJourneyInternalOptions,
  ): Promise<IJourneyExecutionResult> {
    return this.executionMutex.runExclusive(async () =>
      this.executeInternal(options),
    );
  }

  private async executeInternal(
    options: IJourneyInternalOptions,
  ): Promise<IJourneyExecutionResult> {
    const startTime = Date.now();

    // Pre-flight: verify LLM provider is reachable and model exists
    if (this.openaiClient.isReady()) {
      await this.openaiClient.checkModelAvailability();
      logger.info('LLM pre-flight check passed');
    }

    await this.browserService.close();
    this.browserService.setAuthConfigs(options.authConfigs);

    const internalResults: IAxeResult[] = [];
    const actionErrors: ActionErrorResult[] = [];
    const journeyUrls: string[] = [];
    const definedActionsCount = options.blocks.reduce(
      (acc, b) => acc + b.actions.length,
      0,
    );
    let executedActionsCount = 0;
    let executedBlocksCount = 0;
    let journeyStopped = false;

    for (let blockIndex = 0; blockIndex < options.blocks.length; blockIndex++) {
      const block = options.blocks[blockIndex];

      if (block == null) continue;

      const stopReason = await this.executeBlock({
        blockIndex,
        block,
        options,
        internalResults,
        actionErrors,
        journeyUrls,
        incrementActions: () => {
          executedActionsCount++;
        },
      });

      executedBlocksCount++;
      if (stopReason === 'STOP') {
        journeyStopped = true;
        break;
      }
    }

    return {
      results: internalResults,
      journeyUrls,
      definedBlocksCount: options.blocks.length,
      executedBlocksCount,
      definedActionsCount,
      executedActionsCount,
      actionErrors,
      journeyStopped,
      durationMs: Date.now() - startTime,
    };
  }

  async generateReport(
    execResult: IJourneyExecutionResult,
    format: 'html' | 'json' | 'csv',
    auditName?: string,
  ): Promise<IJourneyReport> {
    return this.reportBuilder.build(execResult, format, auditName);
  }

  async cleanup(): Promise<void> {
    await this.browserService.close();
  }

  /**
   * Execution of a single block: open page, auth if required, initial goto
   * (unless deferred for auth-as-action), iterate over the block's actions.
   * Returns 'STOP' on the first fatal error, 'CONTINUE' otherwise.
   */
  private async executeBlock(args: {
    blockIndex: number;
    block: JourneyBlock;
    options: IJourneyInternalOptions;
    internalResults: IAxeResult[];
    actionErrors: ActionErrorResult[];
    journeyUrls: string[];
    incrementActions: () => void;
  }): Promise<'STOP' | 'CONTINUE'> {
    const {
      blockIndex,
      block,
      options,
      internalResults,
      actionErrors,
      journeyUrls,
      incrementActions,
    } = args;

    const authKey = block.auth ?? 'none';
    const urlNorm = validateAndNormalizeUrl(block.url);
    journeyUrls.push(urlNorm);

    logger.info(
      { blockIndex, url: urlNorm, authKey, actionCount: block.actions.length },
      'Starting block',
    );

    const page = await this.openBlockPage(
      blockIndex,
      urlNorm,
      block,
      options,
      actionErrors,
    );
    if (page === null) return 'STOP';

    const execContext: ExecutionContext = {
      currentFrame: null,
      menuTriggerChain: [],
    };

    try {
      if (authKey !== 'none') {
        const authOk = await this.runBlockAuth(
          page,
          urlNorm,
          authKey,
          blockIndex,
          actionErrors,
        );
        if (!authOk) return 'STOP';
      }

      const navOk = await this.runBlockGoto(
        page,
        urlNorm,
        block,
        authKey,
        blockIndex,
        actionErrors,
      );
      if (!navOk) return 'STOP';

      return await this.runBlockActions({
        page,
        block,
        urlNorm,
        blockIndex,
        execContext,
        options,
        internalResults,
        actionErrors,
        incrementActions,
      });
    } finally {
      if (!page.isClosed()) {
        await this.browserService.closePage(page);
      }
    }
  }

  private async openBlockPage(
    blockIndex: number,
    urlNorm: string,
    block: JourneyBlock,
    options: IJourneyInternalOptions,
    actionErrors: ActionErrorResult[],
  ): Promise<Page | null> {
    const authKey = block.auth ?? 'none';
    const pageOptions: Parameters<typeof this.browserService.createPage>[0] = {
      url: urlNorm,
      name: options.name ?? block.url,
      auth: authKey,
      analysisType: options.analysisType,
      reportFormat: options.reportFormat,
    };
    if (options.specificRules !== undefined) {
      pageOptions.specificRules = options.specificRules;
    }
    if (options.viewport) {
      pageOptions.viewport = options.viewport;
    }

    try {
      return await this.browserService.createPage(pageOptions);
    } catch (err) {
      const errResult = await buildActionError({
        blockIndex,
        actionIndex: -1,
        blockUrl: urlNorm,
        action: '<page initialization>',
        err,
        page: null,
        context: 'other',
      });
      actionErrors.push(errResult);
      return null;
    }
  }

  private async runBlockAuth(
    page: Page,
    urlNorm: string,
    authKey: string,
    blockIndex: number,
    actionErrors: ActionErrorResult[],
  ): Promise<boolean> {
    try {
      await this.browserService.navigateToUrl(page, urlNorm, {
        url: urlNorm,
        auth: authKey,
      });
      await this.browserService.waitForPageReady(page);
      logger.info({ authKey }, 'Authentication succeeded');
      return true;
    } catch (err) {
      actionErrors.push(
        await buildActionError({
          blockIndex,
          actionIndex: -1,
          blockUrl: urlNorm,
          action: `<authentication ${authKey}>`,
          err,
          page,
          context: 'auth',
        }),
      );
      return false;
    }
  }

  /**
   * Initial goto of the block, **unless** the first significant action is an
   * auth-as-action (in which case the auth itself triggers the navigation).
   */
  private async runBlockGoto(
    page: Page,
    urlNorm: string,
    block: JourneyBlock,
    authKey: string,
    blockIndex: number,
    actionErrors: ActionErrorResult[],
  ): Promise<boolean> {
    const deferGoto = authKey === 'none' && detectAuthAtStart(block.actions);

    if (deferGoto) {
      logger.info(
        { url: urlNorm },
        'Goto deferred: first action is auth-as-action',
      );
      return true;
    }

    if (isOnUrl(page, urlNorm)) return true;

    try {
      const targetHash = urlNorm.includes('#')
        ? urlNorm.slice(urlNorm.indexOf('#'))
        : null;
      const hashOnlyNav =
        targetHash !== null && isSameBasePath(page.url(), urlNorm);

      if (hashOnlyNav) {
        // SPA hash navigation: page.goto won't trigger a real load for same-
        // origin hash changes, so we set the hash directly and wait for
        // the SPA router to settle.
        logger.info(
          { url: urlNorm },
          'SPA hash navigation — setting hash via JS',
        );
        await page.evaluate((hash: string) => {
          window.location.hash = hash;
        }, targetHash);
        // Wait for SPA AJAX calls triggered by route change
        await page
          .waitForNetworkIdle({ idleTime: 500, timeout: 10000 })
          .catch(() => {
            // Timeout is acceptable for SPAs with WebSocket connections
          });
      } else {
        // SSRF guard before the real navigation (incl. DNS / anti-rebinding).
        const ssrfErr = await validateUrlSsrfResolved(urlNorm);
        if (ssrfErr !== null) {
          throw new JourneyError(
            'NAVIGATION_BLOCK',
            `Navigation to "${urlNorm}" blocked (SSRF): ${ssrfErr}`,
          );
        }
        await page.goto(urlNorm, {
          waitUntil: 'networkidle2',
          timeout: GOTO_TIMEOUT_MS,
        });
        // Redirect guard: a 30x could land on an internal target.
        const finalErr = validateUrlSsrf(page.url());
        if (finalErr !== null) {
          throw new JourneyError(
            'NAVIGATION_BLOCK',
            `Navigation redirected to a blocked internal URL "${page.url()}" (SSRF): ${finalErr}`,
          );
        }
      }

      await this.browserService.waitForPageReady(page);
      return true;
    } catch (err) {
      actionErrors.push(
        await buildActionError({
          blockIndex,
          actionIndex: -1,
          blockUrl: urlNorm,
          action: `<goto ${urlNorm}>`,
          err,
          page,
          context: 'navigation',
        }),
      );
      return false;
    }
  }

  private async runBlockActions(args: {
    page: Page;
    block: JourneyBlock;
    urlNorm: string;
    blockIndex: number;
    execContext: ExecutionContext;
    options: IJourneyInternalOptions;
    internalResults: IAxeResult[];
    actionErrors: ActionErrorResult[];
    incrementActions: () => void;
  }): Promise<'STOP' | 'CONTINUE'> {
    const {
      page,
      block,
      urlNorm,
      blockIndex,
      execContext,
      options,
      internalResults,
      actionErrors,
      incrementActions,
    } = args;

    for (
      let actionIndex = 0;
      actionIndex < block.actions.length;
      actionIndex++
    ) {
      const actionStr = block.actions[actionIndex];
      if (actionStr == null || actionStr === '') continue;

      if (page.isClosed()) {
        actionErrors.push(
          await buildActionError({
            blockIndex,
            actionIndex,
            blockUrl: urlNorm,
            action: actionStr,
            err: new JourneyError(
              'BROWSER_CRASH',
              'Page closed before execution',
            ),
            page: null,
            context: 'other',
          }),
        );
        return 'STOP';
      }

      const actionStart = Date.now();
      try {
        await this.actionHandler.execute({
          blockIndex,
          actionIndex,
          actionStr,
          blockUrl: urlNorm,
          page,
          execContext,
          analysisType: options.analysisType,
          specificRules: options.specificRules,
          onScan: async () => {
            const result = await this.pageScanner.scan({
              page,
              analysisType: options.analysisType,
              specificRules: options.specificRules,
            });
            internalResults.push(result);
          },
        });
        incrementActions();
        logger.info(
          {
            blockIndex,
            actionIndex,
            actionStr,
            durationMs: Date.now() - actionStart,
            status: 'success',
          },
          `✓ Action [${String(blockIndex)}:${String(actionIndex)}] succeeded`,
        );
      } catch (err: unknown) {
        const errContext: ErrorContext = inferErrorContext(err);
        actionErrors.push(
          await buildActionError({
            blockIndex,
            actionIndex,
            blockUrl: urlNorm,
            action: actionStr,
            err,
            page,
            context: errContext,
          }),
        );
        logger.error(
          {
            blockIndex,
            actionIndex,
            actionStr,
            durationMs: Date.now() - actionStart,
            status: 'error',
            err: err instanceof Error ? err.message : String(err),
          },
          `✗ Action [${String(blockIndex)}:${String(actionIndex)}] failed — stopping journey`,
        );
        return 'STOP';
      }
    }

    return 'CONTINUE';
  }
}
