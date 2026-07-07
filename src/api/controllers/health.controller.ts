import type { Request, Response } from 'express';
import type { SuccessResponse } from '@shared/types/audit-api.types.js';
import type { IConfig } from '@shared/config/config.js';
import { OpenAIClientService } from '@shared/services/ai/openai-client.service.js';
import { AIAnalyzerService } from '@shared/services/ai/ai-analyzer.service.js';
import { createLogger } from '@shared/utils/logger.js';
import { DEFAULT_LLM_MODEL } from '@shared/config/llm-defaults.js';

const logger = createLogger('health-controller');

/**
 * Controller for the health check route
 */
export class HealthController {
  private readonly appConfig: IConfig;

  constructor(config: IConfig) {
    this.appConfig = config;
  }

  /**
   * API health check endpoint
   */
  async check(_req: Request, res: Response): Promise<void> {
    const response: SuccessResponse<{ status: string; uptime: number }> = {
      success: true,
      data: {
        status: 'healthy',
        uptime: process.uptime(),
      },
      metadata: {
        timestamp: new Date().toISOString(),
        version: this.appConfig.appVersion,
      },
    };

    res.json(response);
  }

  /**
   * Full diagnostic endpoint including LLM Provider
   */
  async diagnostic(_req: Request, res: Response): Promise<void> {
    logger.info('Launching full diagnostic...');

    const diagnostic: Record<string, unknown> = {
      service: 'baldr-api',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: this.appConfig.appVersion,
      environment: this.appConfig.env,
      uptime: process.uptime(),
      checks: {},
    };

    const checks = diagnostic['checks'] as Record<string, unknown>;

    // Check 1: Configuration LLM Provider
    const aiAnalyzer = new AIAnalyzerService({
      llmProvider: this.appConfig.llmProvider,
      proxy: this.appConfig.proxy,
      env: this.appConfig.env,
    });
    const aiAvailable = aiAnalyzer.isAvailable();

    checks['configurationLLM'] = {
      status: aiAvailable ? 'ok' : 'error',
      apiKey:
        (this.appConfig.llmProvider?.apiKey ?? '') !== ''
          ? 'present'
          : 'missing',
      endpoint: this.appConfig.llmProvider?.endpoint ?? 'missing',
      model:
        this.appConfig.llmProvider?.model ?? `default: ${DEFAULT_LLM_MODEL}`,
    };

    // Check 2: Proxy
    checks['proxy'] = {
      status: this.appConfig.proxy ? 'configured' : 'not configured',
      url: this.appConfig.proxy?.url ?? 'none',
    };

    // Check 3: LLM Provider connectivity (real test)
    if (aiAvailable) {
      try {
        const openaiClient = new OpenAIClientService({
          llmProvider: this.appConfig.llmProvider,
          proxy: this.appConfig.proxy,
          env: this.appConfig.env,
        });
        const testResult = await openaiClient.testConnection();
        checks['connectivityLLM'] = {
          status: testResult.success ? 'connected' : 'failed',
          ...testResult.details,
        };

        if (!testResult.success) {
          diagnostic['status'] = 'degraded';
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        checks['connectivityLLM'] = {
          status: 'error',
          error: msg,
        };
        diagnostic['status'] = 'degraded';
      }
    } else {
      checks['connectivityLLM'] = {
        status: 'skipped',
        reason: 'LLM Provider configuration incomplete',
      };
      diagnostic['status'] = 'degraded';
    }

    // Check 4: General config status
    checks['configuration'] = {
      port: this.appConfig.port,
      env: this.appConfig.env,
      browserHeadless: this.appConfig.browser.headless,
    };

    const statusCode = diagnostic['status'] === 'healthy' ? 200 : 503;
    res.status(statusCode).json(diagnostic);
  }
}
