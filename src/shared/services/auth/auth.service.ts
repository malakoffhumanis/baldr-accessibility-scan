import type { Page } from 'puppeteer';

import type { IAuthConfig } from '@shared/types/auth.types.js';
import { createLogger } from '@shared/utils/logger.js';

import type { IAuthStrategy, SessionCookie } from './auth-strategy.types.js';
import { AutoAuthHandler } from './auto-auth.strategy.js';

const logger = createLogger('auth-service');

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

interface CachedSession {
  cookies: SessionCookie[];
  authenticated: boolean;
  timestamp: number;
}

/**
 * Authentication service: routes the request to the appropriate strategy
 * and manages the session cache (reusing cookies to avoid re-authenticating
 * on every request).
 */
export class AuthService {
  private authSessions = new Map<string, CachedSession>();

  private readonly strategies: { auto: IAuthStrategy } = {
    auto: new AutoAuthHandler(),
  };

  /**
   * Authenticates a page according to the configuration. Reuses an existing
   * session if still valid (cached cookies, < SESSION_TIMEOUT_MS).
   */
  async authenticate(
    page: Page,
    authConfig: IAuthConfig,
    targetUrl: string,
    authName: string,
  ): Promise<boolean> {
    const reused = await this.tryReuseSession(page, authName);
    if (reused) return true;

    logger.info(
      { type: authConfig.type, authName },
      'Authentication in progress',
    );

    const strategy = this.strategies[authConfig.type];
    const result = await strategy.authenticate(
      page,
      authConfig,
      targetUrl,
      authName,
    );

    if (result.success && result.cookies) {
      this.authSessions.set(authName, {
        cookies: [...result.cookies],
        authenticated: true,
        timestamp: Date.now(),
      });
      logger.info(
        { authName, cookieCount: result.cookies.length },
        'Session saved',
      );
    }

    return result.success;
  }

  /**
   * Tries to restore an existing session. Returns true if the cookies could
   * be reinjected into the browser context, false otherwise (session missing,
   * expired, or error during setCookie).
   */
  private async tryReuseSession(
    page: Page,
    authName: string,
  ): Promise<boolean> {
    const existingSession = this.authSessions.get(authName);
    if (!existingSession) return false;

    const age = Date.now() - existingSession.timestamp;

    if (age >= SESSION_TIMEOUT_MS) {
      logger.info(
        { authName, ageMinutes: Math.floor(age / 60000) },
        'Session expired, re-authenticating',
      );
      this.authSessions.delete(authName);
      return false;
    }

    logger.info(
      { authName, ageMinutes: Math.floor(age / 60000) },
      'Existing session still valid, reusing cookies',
    );

    try {
      const browserContext = page.browserContext();
      const validCookies = existingSession.cookies
        .filter((cookie) => typeof cookie.domain === 'string')
        .map((cookie) => ({
          ...cookie,
          domain: cookie.domain ?? '',
        }));
      if (validCookies.length > 0) {
        await browserContext.setCookie(...validCookies);
      }
      return true;
    } catch (error) {
      logger.warn({ error }, 'Cookie reuse error, re-authenticating');
      this.authSessions.delete(authName);
      return false;
    }
  }

  /**
   * Clears all cached sessions.
   */
  clearSessions(): void {
    this.authSessions.clear();
    logger.info('Sessions cleared');
  }
}
