import type { Request, Response, NextFunction } from 'express';

import type { APIResponse } from '@shared/types/audit-api.types.js';
import { createLogger } from '@shared/utils/logger.js';

const logger = createLogger('error-handler');

/**
 * Custom error class for HTTP errors
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 - Validation error (invalid request body, params, etc.) */
export class ValidationError extends HttpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, 'VALIDATION_ERROR', message, details);
    this.name = 'ValidationError';
  }
}

/** 503 - Service unavailable (downstream dependency failure) */
export class ServiceUnavailableError extends HttpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(503, 'SERVICE_UNAVAILABLE', message, details);
    this.name = 'ServiceUnavailableError';
  }
}

/**
 * Global error handling middleware
 * @param err - Captured error
 * @param _req - Express request (unused)
 * @param res - Express response
 * @param _next - next function (unused)
 */
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  logger.error({ err }, 'Error occurred');

  if (err instanceof HttpError) {
    const response: APIResponse = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // Unknown error
  const response: APIResponse = {
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  };
  res.status(500).json(response);
};

/**
 * Middleware to handle routes that were not found
 * @param _req - Express request (unused)
 * @param _res - Express response (unused)
 * @param next - next function
 */
export const notFoundHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  next(new HttpError(404, 'NOT_FOUND', 'Route not found'));
};
