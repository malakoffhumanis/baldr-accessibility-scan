/**
 * Main package entry point
 * Exports the public features
 * @module index
 */

// Export API
export { createApp } from './api/app.js';
export type { IAppContext } from './api/app.js';
export {
  HttpError,
  ValidationError,
  ServiceUnavailableError,
} from './api/middlewares/error-handler.js';

// Export types
export type { AppConfig } from './shared/types/index.js';
export type {
  APIResponse,
  SuccessResponse,
  ErrorResponse,
  ErrorDetail,
} from './shared/types/audit-api.types.js';

// Export config
export { loadConfig } from './shared/config/config.js';
export type { IConfig } from './shared/config/config.js';

// Export utils
export { logger, createLogger } from './shared/utils/logger.js';
