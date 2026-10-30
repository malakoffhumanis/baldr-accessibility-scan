import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { createLogger } from '@shared/utils/logger.js';
import type { JourneyOrchestrationService } from '@shared/services/journey/journey-orchestration.service.js';
import { convertJourneyRequestToOptions } from '@shared/adapters/journey-api.adapter.js';
import type { APIResponse } from '@shared/types/audit-api.types.js';
import type { ValidatedJourneyRequest } from '@shared/validation/schemas.js';
import {
  auditRequestsTotal,
  auditDuration,
  activeAudits,
} from '@shared/utils/metrics.js';

const logger = createLogger('journey-controller');

/**
 * Controller for the POST /api/v1/journey endpoint.
 * Responsibility: dispatch to the orchestration service,
 * format HTTP responses. No business logic.
 *
 * Validation is performed upstream by the validate(journeyRequestSchema) middleware.
 */
export class JourneyController {
  constructor(private readonly orchestration: JourneyOrchestrationService) {}

  executeJourney = async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const requestId = randomUUID();
    // Set by the API-key middleware on a match; "anonymous" when auth is off.
    const apiKeyId =
      (res.locals['apiKeyId'] as string | undefined) ?? 'anonymous';

    // A single HTTP response carries one report: multi-format is CLI-only.
    const requestedFormat = (req.body as ValidatedJourneyRequest).options
      ?.reportFormat;
    if (Array.isArray(requestedFormat) && requestedFormat.length > 1) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message:
            '"options.reportFormat" invalid. A list of formats produces one file per format and is only available via the CLI (baldr run); request a single format here.',
        },
      } satisfies APIResponse);
      return;
    }

    activeAudits.inc();

    try {
      const request = req.body as ValidatedJourneyRequest;
      const options = convertJourneyRequestToOptions(request);

      logger.info(
        {
          requestId,
          apiKeyId,
          blockCount: options.blocks.length,
          totalActions: options.blocks.reduce(
            (acc, b) => acc + b.actions.length,
            0,
          ),
          analysisType: options.analysisType,
          reportFormat: options.reportFormats,
        },
        'Journey request received',
      );

      // Execute journey
      const execResult = await this.orchestration.execute(options);

      logger.info(
        {
          requestId,
          blocksExecuted: execResult.executedBlocksCount,
          actionsExecuted: execResult.executedActionsCount,
          pagesAudited: execResult.results.length,
          errors: execResult.actionErrors.length,
          stopped: execResult.journeyStopped,
          durationMs: execResult.durationMs,
        },
        'Journey completed',
      );

      // Generate and send report
      const [report] = await this.orchestration.generateReports(
        execResult,
        options.reportFormats,
        options.name,
      );

      res.setHeader('Content-Type', report.contentType);
      if (report.filename != null && report.filename !== '') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${report.filename}"`,
        );
      }
      res.status(200).send(report.content);
      auditRequestsTotal.inc({ status: 'success', apiKey: apiKeyId });
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      logger.error(
        { err, durationMs, requestId, apiKeyId },
        'Journey fatal error',
      );
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: `An internal error occurred (requestId: ${requestId})`,
        },
        durationMs,
      } satisfies APIResponse);
      auditRequestsTotal.inc({ status: 'error', apiKey: apiKeyId });
    } finally {
      auditDuration.observe((Date.now() - startTime) / 1000);
      activeAudits.dec();
      await this.orchestration.cleanup();
    }
  };

  async cleanup(): Promise<void> {
    await this.orchestration.cleanup();
  }
}
