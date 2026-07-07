import type { Page } from 'puppeteer';

import { HEURISTIC_WAIT, extractAuthKey } from './action-parser.service.js';
import { JourneyError } from './journey-error.util.js';

export type ErrorContext =
  'parsing' | 'selector' | 'action' | 'navigation' | 'cookies' | 'other';

/**
 * Heuristic: does the natural-language description hint at a navigation
 * intent (as opposed to a simple DOM interaction)? Used to decide whether a
 * click without a URL change should trigger an agentic retry.
 */
export function descriptionImpliesNavigation(actionStr?: string): boolean {
  if (actionStr == null || actionStr === '') return false;
  return /\b(naviger|naviguer|aller\s+(?:à|vers|sur)|ouvrir\s+la\s+page|afficher\s+la\s+page|consulter|acc[ée]der|page\s+\w+|cliquer\s+sur\s+le\s+lien)\b/i.test(
    actionStr,
  );
}

/**
 * Detects whether the first significant action of a block is an auth-as-action
 * (i.e. `authentification : <key>`). Used to defer the initial `goto` when
 * the auth step must itself trigger the navigation.
 */
export function detectAuthAtStart(actions: string[]): boolean {
  for (const a of actions) {
    const trimmed = a.trim();
    if (HEURISTIC_WAIT.test(trimmed)) continue;
    return extractAuthKey(trimmed) !== null;
  }
  return false;
}

/**
 * Compares the page's current URL to the target URL.
 * - If the target contains a fragment (#), compares including the fragment.
 * - Otherwise compares without hash/query (original behavior).
 */
export function isOnUrl(page: Page, targetUrl: string): boolean {
  const targetHasHash = targetUrl.includes('#');

  if (targetHasHash) {
    // SPA deep link: compare full URL (with hash)
    const normFull = (u: string): string => u.replace(/\/$/, '');
    return normFull(page.url()) === normFull(targetUrl);
  }

  // No hash in target: compare base path only
  const normBase = (u: string): string =>
    ((u.split('#')[0] ?? u).split('?')[0] ?? u).replace(/\/$/, '');
  return normBase(page.url()) === normBase(targetUrl);
}

/**
 * Returns true if two URLs share the same base (scheme + host + path),
 * ignoring hash fragments and query strings.
 */
export function isSameBasePath(urlA: string, urlB: string): boolean {
  const normBase = (u: string): string =>
    ((u.split('#')[0] ?? u).split('?')[0] ?? u).replace(/\/$/, '');
  return normBase(urlA) === normBase(urlB);
}

/**
 * Polls the page URL with a timeout. Returns true as soon as the URL
 * changes, false if it stays identical during the window.
 */
export async function waitForUrlChange(
  page: Page,
  previousUrl: string,
  timeoutMs: number,
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (page.isClosed()) return false;
    if (page.url() !== previousUrl) {
      await new Promise((r) => setTimeout(r, 200));
      return true;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * An href is navigable if, resolved absolutely from the current URL, it
 * points to another http(s) page. Excludes javascript:/mailto:/tel:/pure
 * anchors, and hrefs identical to the current URL (= no-op).
 */
export function isHrefNavigable(href: string, currentUrl: string): boolean {
  if (!href || href.trim() === '') return false;
  const trimmed = href.trim();
  if (trimmed.startsWith('javascript:')) return false;
  if (trimmed.startsWith('mailto:')) return false;
  if (trimmed.startsWith('tel:')) return false;
  if (trimmed === '#') return false;
  if (trimmed.startsWith('#') && !trimmed.startsWith('#/')) return false;
  try {
    const target = new URL(trimmed, currentUrl);
    const current = new URL(currentUrl);
    if (target.protocol !== 'http:' && target.protocol !== 'https:')
      return false;
    const sameUrl =
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.search === current.search &&
      target.hash === current.hash;
    return !sameUrl;
  } catch {
    return false;
  }
}

/**
 * Resolves an href (possibly relative) into an absolute URL. Returns the href
 * as-is if resolution fails.
 */
export function resolveUrl(href: string, currentUrl: string): string {
  try {
    return new URL(href, currentUrl).toString();
  } catch {
    return href;
  }
}

/**
 * Converts camelCase attribute names to kebab-case in a CSS selector.
 *
 * LLMs (notably Claude) regularly hallucinate `[dataCy="x"]` instead of
 * `[data-cy="x"]` because they confuse the JS convention (DOM property) with
 * the HTML convention (attribute). This function normalizes ONLY the attribute
 * names inside brackets; the rest of the selector (tags, classes, ids,
 * pseudo-classes) is left intact.
 *
 * Used as a fallback: we first try the selector as produced by the AI, and
 * only if it matches nothing do we try the normalized version. This preserves
 * legitimate camelCase attributes (SVG: viewBox, preserveAspectRatio).
 *
 * Examples:
 *   `[dataCy="x"]`               → `[data-cy="x"]`
 *   `[ariaLabel="Submit"]`       → `[aria-label="Submit"]`
 *   `[dataAjaxCode="ITEM"]`   → `[data-ajax-code="ITEM"]`
 *   `a[dataCy="x"].link`         → `a[data-cy="x"].link`
 *   `[data-cy="x"]` (already OK) → `[data-cy="x"]`
 *   `#foo .bar`                  → `#foo .bar` (nothing to change)
 */
export function normalizeCamelCaseAttributes(selector: string): string {
  return selector.replace(
    /\[([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)(=[^\]]*|\*=[^\]]*|\^=[^\]]*|\$=[^\]]*|~=[^\]]*|\|=[^\]]*)?\]/g,
    (_match, attrName: string, valuePart: string | undefined) => {
      const kebab = attrName.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `[${kebab}${valuePart ?? ''}]`;
    },
  );
}

/**
 * Maps an error (typed or not) to the context category expected by
 * `buildActionError`. Non-`JourneyError` errors fall back to 'other'.
 */
export function inferErrorContext(err: unknown): ErrorContext {
  if (err instanceof JourneyError) {
    switch (err.type) {
      case 'AI_PARSING':
        return 'parsing';
      case 'AI_SELECTOR_NOT_FOUND':
      case 'AI_SELECTOR_INVALID':
      case 'AI_SELECTOR_AMBIGUOUS':
      case 'AI_ELEMENT_NOT_VISIBLE':
      case 'AI_ELEMENT_DISABLED':
        return 'selector';
      case 'NAVIGATION_POST_ACTION':
      case 'NAVIGATION_BLOCK':
        return 'navigation';
      case 'COOKIE_BANNER':
        return 'cookies';
      default:
        return 'action';
    }
  }
  return 'other';
}
