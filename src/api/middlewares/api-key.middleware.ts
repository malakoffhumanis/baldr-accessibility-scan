/**
 * BALDR-specific API-key authentication middleware.
 *
 * Thin adapter wiring the application config and logger into the reusable
 * `createApiKeyAuth` factory. Every request to the guarded endpoint must carry
 * an `X-API-Key` header matching one of the configured secrets (constant-time
 * compare); the matched key's public `id` is exposed on `res.locals.apiKeyId`
 * for log/metric attribution. The secret itself is never logged.
 *
 * Authentication is mandatory — `config.apiKeys` is validated as non-empty at
 * startup (see config.ts), and this factory throws if it is somehow empty.
 */
import type { RequestHandler } from 'express';

import type { IConfig } from '@shared/config/config.js';
import { createApiKeyAuth } from '@shared/security/api-key-auth.middleware.js';
import { createLogger } from '@shared/utils/logger.js';

const logger = createLogger('api-key-auth');

/**
 * Creates the audit-endpoint API-key middleware from the app config.
 *
 * @param config - Application configuration (reads `config.apiKeys`).
 */
export function apiKeyAuth(config: IConfig): RequestHandler {
  return createApiKeyAuth({ keys: config.apiKeys, logger });
}
