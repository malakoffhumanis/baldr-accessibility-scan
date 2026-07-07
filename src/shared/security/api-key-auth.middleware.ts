/**
 * Reusable Express API-key authentication middleware.
 *
 * Framework glue around the primitives in `api-key.ts`. It is intentionally
 * decoupled from any application's config or logger: callers pass the keys,
 * an optional logger and presentation options, so the same factory can guard
 * the audit endpoint here or any other Express service.
 *
 * Authentication is MANDATORY: constructing the middleware with an empty key
 * list throws. There is no unauthenticated ("openbar") fallback.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';

import { matchApiKey, type ApiKeyEntry } from './api-key.js';

/** Minimal logger contract — satisfied by pino, console, etc. */
export interface ApiKeyAuthLogger {
  info: (obj: unknown, msg?: string) => void;
}

export interface ApiKeyAuthOptions {
  /** Accepted keys. Must contain at least one entry, or the factory throws. */
  keys: readonly ApiKeyEntry[];
  /** Header carrying the secret (default: `X-API-Key`). */
  headerName?: string;
  /** `res.locals` property set to the matched key id (default: `apiKeyId`). */
  localsKey?: string;
  /** Optional logger; when provided, the enabled key ids are logged at startup. */
  logger?: ApiKeyAuthLogger;
  /**
   * Body returned on a 401. Defaults to the standard error contract
   * `{ success: false, error: { code: 'UNAUTHORIZED', message } }`.
   */
  unauthorizedBody?: unknown;
}

/**
 * Creates an Express middleware enforcing API-key authentication.
 *
 * @throws {Error} if `keys` is empty — unauthenticated mode is not supported.
 */
export function createApiKeyAuth(options: ApiKeyAuthOptions): RequestHandler {
  const {
    keys,
    headerName = 'X-API-Key',
    localsKey = 'apiKeyId',
    logger,
    unauthorizedBody,
  } = options;

  if (keys.length === 0) {
    throw new Error(
      'createApiKeyAuth: at least one API key is required. ' +
        'Unauthenticated ("openbar") mode is not supported — configure API keys.',
    );
  }

  logger?.info(
    { keyIds: keys.map((k) => k.id) },
    'API key authentication enabled',
  );

  const body =
    unauthorizedBody ??
    ({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: `Missing or invalid API key (${headerName} header).`,
      },
    } as const);

  return (req: Request, res: Response, next: NextFunction): void => {
    const matchedId = matchApiKey(req.header(headerName), keys);

    if (matchedId === undefined) {
      res.status(401).json(body);
      return;
    }

    res.locals[localsKey] = matchedId;
    next();
  };
}
