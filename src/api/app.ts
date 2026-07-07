import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import type { IConfig } from '@shared/config/config.js';
import { getMetrics, getMetricsContentType } from '@shared/utils/metrics.js';
import { apiKeyAuth } from './middlewares/api-key.middleware.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { requestLogger } from './middlewares/request-logger.js';
import { createApiRouter } from './routes/index.js';
import type { JourneyController } from './controllers/journey.controller.js';

/**
 * Result of creating the application
 */
export interface IAppContext {
  app: express.Application;
  journeyController: JourneyController;
}

/**
 * Creates and configures the Express application (composition root)
 * @param config - Centralized application configuration
 * @returns Express application and controllers for lifecycle management
 */
export const createApp = (config: IConfig): IAppContext => {
  const app = express();

  // Security middlewares
  app.use(helmet());
  app.use(
    cors({
      origin: config.cors.origins.length > 0 ? config.cors.origins : false,
      credentials: true,
    }),
  );

  // Rate limiting
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    message: 'Too many requests from this IP, please try again later.',
  });
  app.use(limiter);

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use(requestLogger);

  // Build the API-key guard once and reuse it for every protected route.
  const requireApiKey = apiKeyAuth(config);

  // Prometheus metrics endpoint (outside /api/v1) — protected by the same
  // API-key system as the audit API; scrapers must send the X-API-Key header.
  app.get('/metrics', requireApiKey, (_req, res) => {
    void getMetrics().then((metrics) => {
      res.set('Content-Type', getMetricsContentType());
      res.end(metrics);
    });
  });

  // API routes (composition root: config flows into controllers/services)
  const { router, journeyController } = createApiRouter(config, requireApiKey);
  app.use('/api/v1', router);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return { app, journeyController };
};
