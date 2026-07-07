import type { Page } from 'puppeteer';

import type { IAutoAuthConfig } from '@shared/types/auth.types.js';
import { createLogger } from '@shared/utils/logger.js';
import { CookieBannerService } from '@shared/services/journey/cookie-banner.service.js';

import type {
  AuthResult,
  IAuthStrategy,
  SessionCookie,
} from './auth-strategy.types.js';

const logger = createLogger('auth-strategy-auto');

const NAV_TIMEOUT_MS = 30000;
const FIELD_WAIT_MS = 8000;
const POST_SUBMIT_NAV_MS = 12000;
const TYPE_DELAY_MS = 30;

/** Heuristic selectors covering most login forms (ADFS, generic, SSO portals). */
const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[name="UserName"]',
  'input#userNameInput',
  'input[autocomplete="username"]',
  'input[name*="user" i]',
  'input[name*="login" i]',
  'input[name*="email" i]',
  'input[id*="user" i]',
  'input[id*="email" i]',
  'input[type="text"]',
].join(', ');

const PASSWORD_SELECTORS =
  'input[type="password"], input[name="Password"], input#passwordInput';

const SUBMIT_SELECTORS =
  'button[type="submit"], input[type="submit"], button[id*="submit" i], button[name*="submit" i], button[id*="login" i]';

/**
 * Adaptive "auto" authentication strategy.
 *
 * Takes only credentials and adapts to whatever the site presents:
 *   - native HTTP auth popups (Basic/NTLM) → answered via `page.authenticate`;
 *   - HTML login forms (single- or two-step, e.g. ADFS) → fields located by
 *     heuristic selectors, filled and submitted.
 *
 * Deliberately uses NO request interception (which breaks navigations with
 * net::ERR_INVALID_ARGUMENT on some Chromium builds) and `domcontentloaded`
 * (SPAs that keep polling never reach `networkidle`).
 *
 * Limitation: transparent domain SSO (Kerberos/Negotiate without a prompt)
 * cannot be reproduced with id+password off a domain-joined machine.
 */
export class AutoAuthHandler implements IAuthStrategy {
  async authenticate(
    page: Page,
    config: IAutoAuthConfig,
    targetUrl: string,
  ): Promise<AuthResult> {
    logger.info(
      { username: config.username, hasLoginUrl: config.loginUrl != null },
      'Auto authentication',
    );

    try {
      // 1. Answer native HTTP auth popups (Basic/NTLM) silently.
      await page.authenticate({
        username: config.username,
        password: config.password,
      });

      // 2. Navigate to the login page (explicit, or the target which usually
      //    redirects to login). domcontentloaded avoids SPA networkidle hangs.
      const startUrl = config.loginUrl ?? targetUrl;
      await page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });

      if (page.url().startsWith('chrome-error://')) {
        throw new Error(`Navigation to ${startUrl} failed (chrome-error).`);
      }

      // A cookie-consent overlay sits on top of the login form and intercepts
      // the submit click (form filled but never submitted). Such banners are
      // often injected by JS shortly after load, so let the page settle first,
      // then dismiss it. Best-effort: any failure must not block the login.
      await page
        .waitForNetworkIdle({ idleTime: 500, timeout: 3000 })
        .catch(() => undefined);
      await new CookieBannerService().accept(page).catch(() => null);

      // 3. Is there an HTML login form at all? (username OR password field)
      const hasForm = await this.waitForSelector(
        page,
        `${USERNAME_SELECTORS}, ${PASSWORD_SELECTORS}`,
        FIELD_WAIT_MS,
      );

      if (!hasForm) {
        // No form → the native popup/SSO authenticated us, or no auth needed.
        logger.info('No HTML login form detected (native auth / no auth)');
        return await this.success(page, config, targetUrl);
      }

      // 4. Fill the username field if present.
      await this.fillIfPresent(page, USERNAME_SELECTORS, config.username);

      // 5. Ensure the password field; advance the form if it is two-step.
      let hasPassword = (await page.$(PASSWORD_SELECTORS)) !== null;
      if (!hasPassword) {
        await this.submit(page);
        hasPassword = await this.waitForSelector(
          page,
          PASSWORD_SELECTORS,
          FIELD_WAIT_MS,
        );
      }

      // 6. Fill the password and submit.
      if (hasPassword) {
        await this.fillIfPresent(page, PASSWORD_SELECTORS, config.password);
        await this.submit(page);
        await page
          .waitForNavigation({
            waitUntil: 'domcontentloaded',
            timeout: POST_SUBMIT_NAV_MS,
          })
          .catch(() => {
            // Some flows update the SPA without a full navigation.
          });
      }

      logger.info('Auto authentication submitted');
      return await this.success(page, config, targetUrl);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          username: config.username,
          currentUrl: page.url(),
        },
        'Auto authentication error',
      );
      return { success: false };
    }
  }

  /** Ensures the page ends on the target, then collects cookies for reuse. */
  private async success(
    page: Page,
    config: IAutoAuthConfig,
    targetUrl: string,
  ): Promise<AuthResult> {
    // If we started from an explicit loginUrl, land back on the target page.
    if (config.loginUrl != null && config.loginUrl !== '') {
      await page
        .goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT_MS,
        })
        .catch(() => {
          // Best effort; the journey navigation will retry if needed.
        });
    }
    return { success: true, cookies: await this.collectCookies(page) };
  }

  private async waitForSelector(
    page: Page,
    selector: string,
    timeout: number,
  ): Promise<boolean> {
    try {
      await page.waitForSelector(selector, { timeout, visible: true });
      return true;
    } catch {
      return (await page.$(selector)) !== null;
    }
  }

  private async fillIfPresent(
    page: Page,
    selector: string,
    value: string,
  ): Promise<void> {
    const el = await page.$(selector);
    if (!el) return;
    try {
      await el.click({ delay: TYPE_DELAY_MS });
      await el.type(value, { delay: TYPE_DELAY_MS });
    } catch {
      await page.evaluate(
        (sel, val) => {
          const input = document.querySelector(sel);
          if (input instanceof HTMLInputElement) {
            input.focus();
            input.value = val;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          }
        },
        selector,
        value,
      );
    }
  }

  private async submit(page: Page): Promise<void> {
    const btn = await page.$(SUBMIT_SELECTORS);
    if (btn) {
      await btn.click().catch(() => {
        // fall back to Enter below
      });
      return;
    }
    await page.keyboard.press('Enter').catch(() => {
      // Nothing else to try.
    });
  }

  private async collectCookies(page: Page): Promise<SessionCookie[]> {
    try {
      return await page.browserContext().cookies();
    } catch {
      return [];
    }
  }
}
