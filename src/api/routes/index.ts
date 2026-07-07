import { Router, type RequestHandler } from 'express';

import type { IConfig } from '@shared/config/config.js';
import { BrowserService } from '@shared/services/browser/browser.service.js';
import { AxeRunnerService } from '@shared/services/axe/axe-runner.service.js';
import { ReportGeneratorService } from '@shared/services/report/report-generator.service.js';
import { AIAnalyzerService } from '@shared/services/ai/ai-analyzer.service.js';
import { OpenAIClientService } from '@shared/services/ai/openai-client.service.js';
import { AIErrorClassifierService } from '@shared/services/ai/ai-error-classifier.service.js';
import { ScreenshotService } from '@shared/services/screenshot/screenshot.service.js';
import { ActionExecutorService } from '@shared/services/journey/action-executor.service.js';
import { ActionParserService } from '@shared/services/journey/action-parser.service.js';
import { CookieBannerService } from '@shared/services/journey/cookie-banner.service.js';
import { JourneyOrchestrationService } from '@shared/services/journey/journey-orchestration.service.js';
import { HealthController } from '@api/controllers/health.controller.js';
import { JourneyController } from '@api/controllers/journey.controller.js';
import { apiKeyAuth } from '@api/middlewares/api-key.middleware.js';
import { createHealthRouter } from './health.routes.js';
import { createJourneyRouter } from './journey.routes.js';
import { createDocsRouter } from '@api/docs/docs.routes.js';

/**
 * Composition root: creates all services and controllers with proper DI.
 */
export function createApiRouter(
  config: IConfig,
  requireApiKey: RequestHandler = apiKeyAuth(config),
): {
  router: Router;
  journeyController: JourneyController;
} {
  const router = Router();

  // ─── Shared services ───────────────────────────────────────────────
  const axeRunner = new AxeRunnerService();
  const reportGenerator = new ReportGeneratorService(config.reportsDir);
  const aiErrorClassifier = new AIErrorClassifierService();
  const screenshotService = new ScreenshotService();
  // Single OpenAI client shared by the analyzer and the journey orchestration
  // so they share one LRU cache (no duplicate clients).
  const openaiClient = new OpenAIClientService({
    llmProvider: config.llmProvider,
    proxy: config.proxy,
    env: config.env,
  });
  const aiAnalyzer = new AIAnalyzerService({
    openaiClient,
    screenshotService,
    contextLimit: config.llmProvider?.contextLimit,
  });

  // ─── Journey orchestration ────────────────────────────────────────
  const journeyBrowserService = new BrowserService({
    browser: config.browser,
    env: config.env,
  });
  const actionParser = new ActionParserService(
    openaiClient,
    screenshotService,
    undefined,
    config.businessSelectors,
  );
  const actionExecutor = new ActionExecutorService();
  const cookieBanner = new CookieBannerService();

  const journeyOrchestration = new JourneyOrchestrationService(
    journeyBrowserService,
    axeRunner,
    aiAnalyzer,
    aiErrorClassifier,
    reportGenerator,
    screenshotService,
    actionExecutor,
    actionParser,
    cookieBanner,
    openaiClient,
  );

  // ─── Controllers ───────────────────────────────────────────────────
  const healthController = new HealthController(config);
  const journeyController = new JourneyController(journeyOrchestration);

  // ─── Routes ────────────────────────────────────────────────────────
  // /health stays open (liveness probe). The audit endpoint is guarded by
  // the mandatory API-key middleware (shared instance, see app.ts).
  router.use('/health', createHealthRouter(healthController));
  router.use('/journey', requireApiKey, createJourneyRouter(journeyController));

  if (config.exposeApiDocs) {
    router.use('/docs', createDocsRouter());
  }

  return { router, journeyController };
}
