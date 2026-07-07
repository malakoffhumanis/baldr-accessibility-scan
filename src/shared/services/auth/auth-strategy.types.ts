import type { Page } from 'puppeteer';

import type { IAuthConfig } from '@shared/types/auth.types.js';

/**
 * Session cookie, structure compatible with what Puppeteer's
 * `BrowserContext.cookies()` returns and with the format expected
 * by `BrowserContext.setCookie()`.
 */
export interface SessionCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

/**
 * Result of an authentication attempt.
 *
 * - `success`: true if authentication succeeded (or was not required).
 * - `cookies`: cookies to cache for reuse on subsequent requests
 *              (omitted if there is nothing to cache, e.g. type 'none').
 */
export interface AuthResult {
  success: boolean;
  cookies?: readonly SessionCookie[];
}

/**
 * Common contract for all authentication strategies.
 *
 * A strategy is responsible for authenticating the page according to its
 * configuration. It does NOT manage the session cache: it returns the
 * obtained cookies to `AuthService`, which handles persistence.
 */
export interface IAuthStrategy<TConfig extends IAuthConfig = IAuthConfig> {
  authenticate(
    page: Page,
    config: TConfig,
    targetUrl: string,
    authName: string,
  ): Promise<AuthResult>;
}
