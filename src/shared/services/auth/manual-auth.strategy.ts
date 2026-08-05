import type { Page } from 'puppeteer';

import type { IManualAuthConfig } from '@shared/types/auth.types.js';
import { createLogger } from '@shared/utils/logger.js';
import { looksLikeLoginUrl } from '@shared/utils/login-url.util.js';

import type {
  AuthResult,
  IAuthStrategy,
  SessionCookie,
} from './auth-strategy.types.js';

const logger = createLogger('auth-strategy-manual');

const NAV_TIMEOUT_MS = 30000;
/** Default max wait for the operator to finish authenticating (5 min). */
export const DEFAULT_MANUAL_TIMEOUT_MS = 300000;
const MIN_MANUAL_TIMEOUT_MS = 10000;
const MAX_MANUAL_TIMEOUT_MS = 1_800_000; // 30 min
const URL_POLL_INTERVAL_MS = 500;
/**
 * The target URL must stay on-target continuously for this long before
 * auto-resume. Prevents resuming on the transient URL flip that occurs mid-SSO
 * (multi-redirect flows like Microsoft 365 / SharePoint briefly show the
 * target URL before the page is actually loaded).
 */
const URL_STABLE_MS = 2500;
/** After a completion signal, give the SPA a moment to finish rendering. */
const SETTLE_IDLE_MS = 800;
const SETTLE_TIMEOUT_MS = 8000;

/** Why the manual wait ended. */
type CompletionReason = 'enter' | 'url' | 'timeout' | 'closed';

/**
 * Interactive "manual" authentication strategy.
 *
 * Opens a visible browser at the login (or target) URL and hands control to a
 * human operator, who authenticates by hand — including any 2FA/MFA step that
 * cannot be automated. BALDR resumes the audit when the operator signals
 * completion:
 *   - by pressing Enter in the terminal (interactive TTY), and/or
 *   - by the browser staying on the audited target URL for a short debounce
 *     window (auto-detection — disabled when `waitForManualConfirm` is set).
 * bounded by a generous timeout.
 *
 * For heavy multi-redirect SSO (Microsoft 365 / SharePoint) prefer
 * `waitForManualConfirm: true` and press Enter once the page is fully rendered:
 * the URL bar shows the target well before the SPA content is ready, so
 * auto-resume can otherwise scan a page that has not finished loading.
 *
 * The obtained cookies are returned to `AuthService` for session reuse, so the
 * operator authenticates only once per journey (when a single root-level auth
 * key is shared by every page).
 *
 * Local / interactive use only: a headless server has no operator, so
 * `BrowserService` forces a visible browser in non-production and rejects this
 * mode in production.
 */
export class ManualAuthHandler implements IAuthStrategy<IManualAuthConfig> {
  async authenticate(
    page: Page,
    config: IManualAuthConfig,
    targetUrl: string,
    authName: string,
  ): Promise<AuthResult> {
    const timeoutMs = clampTimeout(config.timeoutMs);
    const startUrl =
      config.loginUrl != null && config.loginUrl !== ''
        ? config.loginUrl
        : targetUrl;

    const isTty = process.stdin.isTTY;
    // Enter-only mode requires an interactive terminal; without one, keep URL
    // auto-detection as a fallback so the run is not stuck until the timeout.
    const enterOnly = config.waitForManualConfirm === true && isTty;
    if (config.waitForManualConfirm === true && !isTty) {
      logger.warn(
        { authName },
        'waitForManualConfirm requested but no interactive terminal — falling back to URL auto-detection',
      );
      process.stderr.write(
        '\n[baldr] ⚠ waitForManualConfirm ignoré : terminal non interactif.\n' +
          '        Sous Windows, lancez « baldr run <fichier> » dans PowerShell ou cmd\n' +
          '        (la touche Entrée ne fonctionne pas sous Git Bash/MinTTY ni via un pipe).\n' +
          '        Reprise par détection d’URL à la place.\n',
      );
    }
    const urlDetectionEnabled = !enterOnly;
    // If the audited target URL is itself a login/SSO page, the "not a login
    // page" guard must not block resuming on it, nor fail the run on timeout.
    const targetIsLoginLike = looksLikeLoginUrl(targetUrl);

    logger.info(
      { authName, startUrl, targetUrl, timeoutMs, enterOnly, isTty },
      'Manual authentication: opening a visible browser for the operator',
    );

    // Open the starting page. A login flow often redirects to an external IdP,
    // so a navigation error here is not fatal — the operator can still drive
    // the browser by hand. domcontentloaded avoids SPA networkidle hangs.
    await page
      .goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      })
      .catch((err: unknown) => {
        logger.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            startUrl,
          },
          'Initial navigation warning (continuing — operator can navigate manually)',
        );
      });

    this.printInstructions(targetUrl, timeoutMs, { isTty, enterOnly });

    const reason = await this.waitForCompletion(
      page,
      targetUrl,
      timeoutMs,
      urlDetectionEnabled,
      targetIsLoginLike,
    );

    logger.info(
      { authName, reason, currentUrl: safeUrl(page) },
      'Manual authentication: wait finished',
    );

    if (reason === 'closed') {
      logger.error(
        { authName },
        'Manual authentication failed: the page was closed before completion',
      );
      return { success: false };
    }

    if (reason === 'timeout') {
      process.stderr.write(
        `\n[baldr] Manual authentication timed out after ${String(
          Math.round(timeoutMs / 1000),
        )}s.\n`,
      );
      // Best-effort: only fail if the browser is visibly still on a login page
      // (and the audited target isn't itself a login page).
      if (!targetIsLoginLike && looksLikeLoginUrl(safeUrl(page))) {
        logger.error(
          { authName, currentUrl: safeUrl(page) },
          'Manual authentication timed out while still on a login/SSO page',
        );
        return { success: false };
      }
    } else {
      // Completed via Enter or URL: let the SPA finish loading before we hand
      // back, so the audit runs against the fully rendered page (bounded).
      await page
        .waitForNetworkIdle({
          idleTime: SETTLE_IDLE_MS,
          timeout: SETTLE_TIMEOUT_MS,
        })
        .catch(() => undefined);
    }

    return { success: true, cookies: await this.collectCookies(page) };
  }

  /** Prints operator-facing instructions to stderr (stdout may carry the report). */
  private printInstructions(
    targetUrl: string,
    timeoutMs: number,
    mode: { isTty: boolean; enterOnly: boolean },
  ): void {
    const minutes = Math.round(timeoutMs / 60000);
    let howToResume: string;
    if (mode.enterOnly) {
      howToResume =
        "  Quand la page à auditer est ENTIÈREMENT chargée, revenez ici\n  et appuyez sur Entrée pour lancer l'audit.";
    } else if (mode.isTty) {
      howToResume =
        '  Baldr reprend dès que le navigateur reste sur cette page,\n  ou immédiatement si vous appuyez sur Entrée ici (recommandé\n  quand la page est entièrement chargée).';
    } else {
      howToResume =
        '  Baldr reprend dès que le navigateur reste sur cette page.\n  (Terminal non interactif : la touche Entrée est indisponible. Sous Windows,\n   lancez « baldr run <fichier> » dans PowerShell ou cmd — pas Git Bash/MinTTY —\n   et évitez de passer la requête par un pipe.)';
    }
    const lines = [
      '',
      '════════════════════════════════════════════════════════════════════',
      '  BALDR — Authentification manuelle',
      '  Un navigateur vient de s’ouvrir. Authentifiez-vous à la main',
      '  (identifiants, 2FA/MFA, etc.), puis rejoignez la page à auditer :',
      `    ${targetUrl}`,
      howToResume,
      `  Délai maximum : ${String(minutes)} min.`,
      '════════════════════════════════════════════════════════════════════',
      '',
    ];
    process.stderr.write(lines.join('\n'));
  }

  /**
   * Waits until the operator signals completion. Resolves with the reason:
   *  - 'enter'   the operator pressed Enter in the terminal (TTY only);
   *  - 'url'     the browser stayed on the target URL for the debounce window;
   *  - 'timeout' the wait elapsed;
   *  - 'closed'  the page was closed.
   */
  private async waitForCompletion(
    page: Page,
    targetUrl: string,
    timeoutMs: number,
    urlDetectionEnabled: boolean,
    targetIsLoginLike: boolean,
  ): Promise<CompletionReason> {
    return new Promise<CompletionReason>((resolve) => {
      let settled = false;
      const cleanups: (() => void)[] = [];

      const finish = (reason: CompletionReason): void => {
        if (settled) return;
        settled = true;
        for (const cleanup of cleanups) cleanup();
        resolve(reason);
      };

      // 1. Backstop timeout.
      const timer = setTimeout(() => {
        finish('timeout');
      }, timeoutMs);
      cleanups.push(() => {
        clearTimeout(timer);
      });

      // 2. Enter in the terminal (interactive TTY only).
      if (process.stdin.isTTY) {
        const stdin = process.stdin;
        const onData = (): void => {
          finish('enter');
        };
        stdin.resume();
        stdin.once('data', onData);
        cleanups.push(() => {
          stdin.removeListener('data', onData);
          stdin.pause();
        });
      }

      // 3. Poll the browser URL. Auto-resume only once the browser has left the
      //    initial (start) URL AND stayed on the target base URL — not a login
      //    page — continuously for URL_STABLE_MS. The debounce is what stops a
      //    premature resume on the transient URL flip during an SSO redirect
      //    chain (the URL bar shows the target before the SPA has loaded).
      const initialUrl = safeUrl(page);
      let hasLeftInitial = false;
      let onTargetSince: number | null = null;
      const poll = setInterval(() => {
        if (page.isClosed()) {
          finish('closed');
          return;
        }
        const current = safeUrl(page);
        if (current !== initialUrl) hasLeftInitial = true;

        if (!urlDetectionEnabled) return;

        const onTarget =
          hasLeftInitial &&
          isSameBase(current, targetUrl) &&
          (targetIsLoginLike || !looksLikeLoginUrl(current));
        if (!onTarget) {
          onTargetSince = null;
          return;
        }
        onTargetSince ??= Date.now();
        if (Date.now() - onTargetSince >= URL_STABLE_MS) {
          finish('url');
        }
      }, URL_POLL_INTERVAL_MS);
      cleanups.push(() => {
        clearInterval(poll);
      });
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

/** Clamps a caller-supplied timeout into the accepted range, or the default. */
function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs == null || !Number.isFinite(timeoutMs)) {
    return DEFAULT_MANUAL_TIMEOUT_MS;
  }
  return Math.min(
    Math.max(timeoutMs, MIN_MANUAL_TIMEOUT_MS),
    MAX_MANUAL_TIMEOUT_MS,
  );
}

/** Reads the current URL, tolerating a closed page. */
function safeUrl(page: Page): string {
  try {
    return page.url();
  } catch {
    return '';
  }
}

/** True if two URLs share the same scheme+host+path (ignoring query/hash). */
function isSameBase(urlA: string, urlB: string): boolean {
  const base = (u: string): string =>
    ((u.split('#')[0] ?? u).split('?')[0] ?? u).replace(/\/+$/, '');
  return base(urlA) === base(urlB) && urlA !== '';
}
