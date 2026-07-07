import type { Page } from 'puppeteer';

import { createLogger } from '@shared/utils/logger.js';
import { shimTsxName } from '@shared/utils/browser-shims.util.js';

const logger = createLogger('cookie-banner');

/**
 * Heuristic service for accepting common cookie/GDPR banners.
 * Useful because cookie banners are overlays that intercept journey clicks,
 * making navigation fail without an explicit Puppeteer error.
 *
 * 2-pass strategy:
 *   1. Selectors specific to common solutions (Tarteaucitron, Didomi, etc.)
 *   2. Button-text search ("Accepter", "Tout accepter", etc.) inside
 *      containers identified as cookie banners.
 */
export class CookieBannerService {
  /** CSS selectors specific to common consent-management solutions */
  private static readonly KNOWN_SELECTORS: readonly string[] = [
    // Tarteaucitron
    '#tarteaucitronAllAllowed',
    '#tarteaucitronPersonalize2',
    'button#tarteaucitronCloseAlert',
    // Didomi
    '#didomi-notice-agree-button',
    'button[aria-label*="Accepter" i].didomi-components-button',
    // Axeptio
    'button[id^="axeptio_btn_acceptAll"]',
    '.ax-button.ax-accept-all',
    // OneTrust
    '#onetrust-accept-btn-handler',
    '.ot-pc-refuse-all-handler + .save-preference-btn-handler',
    // Cookiebot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    // Quantcast
    '.qc-cmp2-summary-buttons button[mode="primary"]',
    // CookieYes
    '.cky-btn-accept',
    // Iubenda
    '.iubenda-cs-accept-btn',
    // GDPR Cookie Consent
    '.cli_action_button.wt-cli-accept-all-btn',
    '#cookie_action_close_header_reject',
    // TagCommander / Commanders Act (onclick déclenche l'acceptation)
    'a[onclick*="acceptAll" i]',
    'button[onclick*="acceptAll" i]',
    '[onclick*="allowAll" i]',
    // Generic
    'button[id*="accept-all" i]',
    'button[id*="acceptall" i]',
    'button[class*="accept-all" i]',
    'button[data-action*="accept" i]',
  ];

  /** Text keywords for accept buttons (case-insensitive) */
  private static readonly ACCEPT_TEXT_PATTERNS: readonly string[] = [
    'tout accepter',
    'accepter tout',
    'accepter & fermer',
    'tout autoriser',
    'accept all',
    'allow all',
    "j'accepte",
    'jaccepte',
    'accepter',
    'accept',
    'ok, accepter',
    'continuer',
    'consent',
  ];

  /** Keywords for cookie-banner containers, used to narrow the scope */
  private static readonly BANNER_CONTAINER_HINTS: readonly string[] = [
    'cookie',
    'cookies',
    'consent',
    'consentement',
    'rgpd',
    'gdpr',
    'didomi',
    'tarteaucitron',
    'axeptio',
    'onetrust',
    'cookiebot',
    'cookieyes',
    'iubenda',
    'cli-modal',
    'wt-cli',
    'tc-privacy',
    'tc_privacy',
    'popin_tc',
  ];

  /**
   * Attempts to accept the cookie banner on the current page.
   * Returns the clicked selector on success, null otherwise. Never throws.
   */
  async accept(page: Page): Promise<string | null> {
    if (page.isClosed()) return null;

    logger.info('Searching for cookie banner...');

    // Pass 1: known selectors
    for (const selector of CookieBannerService.KNOWN_SELECTORS) {
      try {
        const ok = await this.tryClick(page, selector);
        if (ok) {
          logger.info(
            { selector },
            '[COOKIES] Banner accepted via known selector (pass 1)',
          );
          await this.smallWait(page);
          return selector;
        }
      } catch {
        // ignore and continue
      }
    }

    // Pass 2: text search inside banner containers
    try {
      await shimTsxName(page);

      const result:
        { ok: false } | { ok: true; selector: string; text: string } =
        await page.evaluate(
          (texts: string[], hints: string[]) => {
            function isVisible(el: Element): boolean {
              const style = window.getComputedStyle(el);
              if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                style.opacity === '0'
              ) {
                return false;
              }
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }
            function isInBanner(el: Element): boolean {
              let cur: Element | null = el;
              for (let i = 0; cur !== null && i < 8; i++) {
                const id = (cur.id || '').toLowerCase();
                const cls = (cur.getAttribute('class') ?? '').toLowerCase();
                const role = (cur.getAttribute('role') ?? '').toLowerCase();
                const aria = (
                  cur.getAttribute('aria-label') ?? ''
                ).toLowerCase();
                for (const hint of hints) {
                  if (
                    id.includes(hint) ||
                    cls.includes(hint) ||
                    role.includes(hint) ||
                    aria.includes(hint)
                  ) {
                    return true;
                  }
                }
                cur = cur.parentElement;
              }
              return false;
            }
            function generateSelector(el: Element): string {
              if (el.id) return `#${CSS.escape(el.id)}`;
              const cls = (el.getAttribute('class') ?? '')
                .split(/\s+/)
                .filter(Boolean);
              if (cls.length > 0 && cls[0] !== undefined) {
                return `${el.tagName.toLowerCase()}.${cls.map((c) => CSS.escape(c)).join('.')}`;
              }
              return el.tagName.toLowerCase();
            }

            const candidates = Array.from(
              document.querySelectorAll(
                'button, a, input[type="button"], input[type="submit"], [role="button"]',
              ),
            );
            for (const el of candidates) {
              if (!isVisible(el)) continue;
              if (!isInBanner(el)) continue;
              const text = (el.textContent || '').trim().toLowerCase();
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- garde runtime: .value est typé string mais peut être undefined sur des éléments non-input du DOM réel
              const value = (el as HTMLInputElement).value?.toLowerCase() ?? '';
              const aria = el.getAttribute('aria-label')?.toLowerCase() ?? '';
              const labels = [text, value, aria].filter((t) => t.length > 0);

              for (const pattern of texts) {
                if (
                  labels.some(
                    (label) =>
                      label === pattern ||
                      label.startsWith(pattern) ||
                      label.includes(` ${pattern}`) ||
                      label.includes(`${pattern} `),
                  )
                ) {
                  (el as HTMLElement).click();
                  return {
                    ok: true as const,
                    selector: generateSelector(el),
                    text,
                  };
                }
              }
            }
            return { ok: false as const };
          },
          [...CookieBannerService.ACCEPT_TEXT_PATTERNS],
          [...CookieBannerService.BANNER_CONTAINER_HINTS],
        );

      if (result.ok) {
        logger.info(
          { selector: result.selector, text: result.text },
          '[COOKIES] Banner accepted via text heuristic (pass 2)',
        );
        await this.smallWait(page);
        return result.selector;
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[COOKIES] Error during text search (ignored)',
      );
    }

    // Pass 3: aggressive search — any visible button with accept text,
    // WITHOUT a container constraint. Restriction: only take elements inside
    // a position:fixed/sticky container (typical of cookie overlays).
    try {
      await shimTsxName(page);
      const result3:
        | { ok: false; candidates: string[] }
        | { ok: true; selector: string; text: string } = await page.evaluate(
        (texts: string[]) => {
          function isVisible(el: Element): boolean {
            const style = window.getComputedStyle(el);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              style.opacity === '0'
            ) {
              return false;
            }
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          }
          function isInOverlay(el: Element): boolean {
            let cur: Element | null = el;
            for (let i = 0; cur !== null && i < 10; i++) {
              const style = window.getComputedStyle(cur);
              if (style.position === 'fixed' || style.position === 'sticky') {
                return true;
              }
              const z = parseInt(style.zIndex, 10);
              if (!isNaN(z) && z >= 100) return true;
              cur = cur.parentElement;
            }
            return false;
          }
          function generateSelector(el: Element): string {
            if (el.id !== '') return `#${CSS.escape(el.id)}`;
            const cls = (el.getAttribute('class') ?? '')
              .split(/\s+/)
              .filter(Boolean);
            if (cls.length > 0 && cls[0] !== undefined) {
              return `${el.tagName.toLowerCase()}.${cls.map((c) => CSS.escape(c)).join('.')}`;
            }
            return el.tagName.toLowerCase();
          }
          const candidates = Array.from(
            document.querySelectorAll(
              'button, a, input[type="button"], input[type="submit"], [role="button"]',
            ),
          );
          const debugFound: string[] = [];
          for (const el of candidates) {
            if (!isVisible(el)) continue;
            const text = (el.textContent || '').trim().toLowerCase();
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- garde runtime: .value est typé string mais peut être undefined sur des éléments non-input du DOM réel
            const value = (el as HTMLInputElement).value?.toLowerCase() ?? '';
            const aria = el.getAttribute('aria-label')?.toLowerCase() ?? '';
            const labels = [text, value, aria].filter((t) => t.length > 0);

            for (const pattern of texts) {
              const matches = labels.some(
                (label) =>
                  label === pattern ||
                  (label.length < 50 && label.includes(pattern)),
              );
              if (matches) {
                debugFound.push(
                  `${el.tagName.toLowerCase()}[text="${text.slice(0, 40)}"]`,
                );
                if (isInOverlay(el)) {
                  (el as HTMLElement).click();
                  return {
                    ok: true as const,
                    selector: generateSelector(el),
                    text,
                  };
                }
              }
            }
          }
          return { ok: false as const, candidates: debugFound };
        },
        [...CookieBannerService.ACCEPT_TEXT_PATTERNS],
      );

      if (result3.ok) {
        logger.info(
          { selector: result3.selector, text: result3.text },
          '[COOKIES] Banner accepted via overlay heuristic (aggressive pass 3)',
        );
        await this.smallWait(page);
        return result3.selector;
      }
      logger.info(
        { nonOverlayCandidatesFound: result3.candidates },
        '[COOKIES] No banner detected. Accept buttons found OUTSIDE an overlay (ignored to avoid clicking elsewhere)',
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[COOKIES] Pass 3 error (ignored)',
      );
    }

    return null;
  }

  /** Attempts to click a selector if it exists and is visible. */
  private async tryClick(page: Page, selector: string): Promise<boolean> {
    const result = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      if (el === null) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden')
        return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      (el as HTMLElement).click();
      return true;
    }, selector);
    return result;
  }

  /** Small wait after acceptance to let the banner disappear */
  private async smallWait(page: Page): Promise<void> {
    if (page.isClosed()) return;
    await new Promise((r) => setTimeout(r, 600));
  }
}
