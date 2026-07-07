import type { Request, Response, NextFunction } from 'express';

import { createLogger } from '@shared/utils/logger.js';

const logger = createLogger('request-logger');

/**
 * HTTP request logging middleware
 * @param req - Express request
 * @param res - Express response
 * @param next - next function
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      ip: req.ip,
    });
  });

  next();
};
