import type { Page } from 'puppeteer';

import { createLogger } from '@shared/utils/logger.js';
import { shimTsxName } from '@shared/utils/browser-shims.util.js';
import { LRUCache } from '@shared/utils/lru-cache.util.js';

const logger = createLogger('dom-lite-extractor');

/**
 * Regex detecting "stable" business `data-*` attributes within the
 * `dataAttrs` string of an InteractiveElement. Covers common patterns:
 * - data-action, data-target, data-key, data-id-* (Bootstrap, jQuery, etc.)
 * - data-*-code, data-*-id, data-*-action, data-*-target, data-*-key
 *   (business frameworks: data-ajax-code, data-test-id, data-route-key, etc.)
 * Used to boost hidden leaves that can be targeted via a unique attribute
 * selector without requiring visual menu navigation.
 */
const STABLE_DATA_ATTR_RE =
  /\bdata-[\w-]*(?:-(?:code|action|target|key|id)|-?(?:action|target|key))="[^"]+"/i;

/**
 * Compact representation of an interactive element for the LLM.
 * JSON output ~10x denser than raw HTML.
 */
export interface InteractiveElement {
  /** HTML tag (button, a, input, etc.) */
  tag: string;
  /** id attribute (if present) */
  id?: string;
  /** class attribute (if present) */
  class?: string;
  /** name attribute (if present) */
  name?: string;
  /** type attribute (input, button) */
  type?: string;
  /** role attribute (ARIA) */
  role?: string;
  /** href attribute (a) */
  href?: string;
  /** value attribute (input) */
  value?: string;
  /** placeholder attribute */
  placeholder?: string;
  /** alt attribute (img, area) */
  alt?: string;
  /** title attribute */
  title?: string;
  /** Element text (≤120 chars, trimmed, single line) */
  text?: string;
  /** aria-label */
  ariaLabel?: string;
  /** aria-labelledby (resolved to text when possible) */
  ariaLabelledby?: string;
  /** aria-describedby */
  ariaDescribedby?: string;
  /** data-testid (high priority for selector) */
  dataTestid?: string;
  /** data-cy (Cypress) */
  dataCy?: string;
  /** data-test (generic) */
  dataTest?: string;
  /**
   * All other stable data-* attributes (data-*, data-action,
   * data-target, data-id, etc.) serialized as `data-name="value"` pairs.
   * Lets the AI target elements by framework-specific attribute
   * (e.g. a business framework uses data-ajax-code="ITEM_DETAIL").
   * Filters out values that are too long (>80) or clearly dynamic.
   */
  dataAttrs?: string;
  /** Nearest heading (h1-h6) */
  nearestHeading?: string;
  /** Landmark containing the element (nav/main/header/footer/aside) */
  nearestLandmark?: string;
  /** Visible on screen? (display, visibility, viewport) */
  visible: boolean;
  /** Disabled? (disabled or aria-disabled=true) */
  disabled: boolean;
  /** Approximate position in the page (0=top, 1=bottom) */
  position?: number;
  /** Generated unique index (for selector traceability) */
  idx: number;
}

/**
 * Service extracting a lightweight DOM focused on interactive elements.
 * Used by the SelectorFinderService to minimize the tokens sent to the LLM.
 */
export class DomLiteExtractorService {
  /** Cache keyed by url + scrollHeight to avoid re-extracting identical DOM */
  private readonly domCache = new LRUCache<InteractiveElement[]>({
    maxSize: 16,
    ttlMs: 5 * 60 * 1000, // 5 min TTL
  });

  /**
   * Invalidates the DOM cache. Call after any user interaction (click, type, etc.)
   * that may have changed the DOM without changing the URL or scroll height.
   */
  clearCache(): void {
    this.domCache.clear();
  }
  /**
   * Extracts the interactive elements of the current page.
   * Everything runs browser-side via page.evaluate (zero round-trip).
   */
  async extractInteractive(page: Page): Promise<InteractiveElement[]> {
    // Build cache key from URL + scroll height
    const url = page.url();
    const scrollHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    const cacheKey = `${url}|${String(scrollHeight)}`;

    const cached = this.domCache.get(cacheKey);
    if (cached) {
      logger.debug({ cacheKey }, 'DOM cache hit — skipping re-extraction');
      return cached;
    }

    logger.info('Extracting interactive lite DOM');

    try {
      // tsx (dev mode) wraps serialized functions with __name(fn, "label").
      // That function does not exist browser-side → we inject a no-op shim
      // before the main evaluate.
      await shimTsxName(page);

      const elements: InteractiveElement[] = await page.evaluate(() => {
        const SELECTORS = [
          'button',
          'a[href]',
          'input',
          'select',
          'textarea',
          '[role="button"]',
          '[role="link"]',
          '[role="menuitem"]',
          '[role="tab"]',
          '[role="checkbox"]',
          '[role="radio"]',
          '[role="switch"]',
          '[role="option"]',
          '[tabindex]:not([tabindex="-1"])',
          '[onclick]',
          // Very common test/automation conventions on modern apps
          // (Cypress, Cegedim, etc.) — captures interactive divs/spans without an ARIA role
          '[data-cy]',
          '[data-testid]',
          '[data-test]',
          'iframe',
          'label',
          'summary',
          'details',
        ].join(',');

        const bodyHeight =
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- garde runtime: document.body peut être null avant parsing complet du DOM
          document.body !== null ? document.body.scrollHeight : 0;
        const docHeight = Math.max(
          document.documentElement.scrollHeight,
          bodyHeight,
          1,
        );

        function truncate(s: string | null, n: number): string {
          if (s === null || s === '') return '';
          const cleaned = s.replace(/\s+/g, ' ').trim();
          return cleaned.length > n ? `${cleaned.substring(0, n)}…` : cleaned;
        }

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
          if (rect.width === 0 || rect.height === 0) return false;
          return true;
        }

        function isDisabled(el: Element): boolean {
          if (el.hasAttribute('disabled')) return true;
          const aria = el.getAttribute('aria-disabled');
          if (aria === 'true') return true;
          return false;
        }

        function findNearestHeading(el: Element): string {
          let cur: Element | null = el;
          while (cur !== null && cur !== document.body) {
            let prev: Element | null = cur.previousElementSibling;
            while (prev !== null) {
              if (/^H[1-6]$/.test(prev.tagName)) {
                return truncate(prev.textContent, 100);
              }
              const nestedHeading = prev.querySelector('h1,h2,h3,h4,h5,h6');
              if (nestedHeading !== null) {
                return truncate(nestedHeading.textContent, 100);
              }
              prev = prev.previousElementSibling;
            }
            cur = cur.parentElement;
          }
          return '';
        }

        function findNearestLandmark(el: Element): string {
          let cur: Element | null = el;
          while (cur !== null && cur !== document.body) {
            const tag = cur.tagName.toLowerCase();
            if (
              tag === 'nav' ||
              tag === 'main' ||
              tag === 'header' ||
              tag === 'footer' ||
              tag === 'aside'
            ) {
              return tag;
            }
            const role = cur.getAttribute('role');
            if (
              role === 'navigation' ||
              role === 'main' ||
              role === 'banner' ||
              role === 'contentinfo' ||
              role === 'complementary'
            ) {
              return role;
            }
            cur = cur.parentElement;
          }
          return '';
        }

        function resolveAriaLabelledby(el: Element): string {
          const ids = el.getAttribute('aria-labelledby');
          if (ids === null) return '';
          const parts: string[] = [];
          for (const id of ids.split(/\s+/)) {
            const ref = document.getElementById(id);
            if (ref !== null) parts.push(truncate(ref.textContent, 80));
          }
          return parts.join(' ');
        }

        const result: InteractiveElement[] = [];
        const matched = Array.from(document.querySelectorAll(SELECTORS));

        let idx = 0;
        for (const el of matched) {
          const tag = el.tagName.toLowerCase();
          const rect = el.getBoundingClientRect();
          const absoluteTop = rect.top + window.scrollY;
          const position =
            docHeight > 0
              ? Math.min(1, Math.max(0, absoluteTop / docHeight))
              : 0;

          const item: InteractiveElement = {
            tag,
            visible: isVisible(el),
            disabled: isDisabled(el),
            position: Number(position.toFixed(3)),
            idx: idx++,
          };

          const id = el.getAttribute('id');
          if (id != null && id !== '') item.id = id;
          const cls = el.getAttribute('class');
          if (cls != null && cls !== '') item.class = truncate(cls, 200);
          const name = el.getAttribute('name');
          if (name != null && name !== '') item.name = name;
          const type = el.getAttribute('type');
          if (type != null && type !== '') item.type = type;
          const role = el.getAttribute('role');
          if (role != null && role !== '') item.role = role;
          const href = el.getAttribute('href');
          if (href != null && href !== '') item.href = truncate(href, 150);
          const value = (el as HTMLInputElement).value;
          if (value && (tag === 'input' || tag === 'textarea')) {
            // Never capture the value of sensitive fields: password inputs,
            // or any field whose name/id/autocomplete hints at a credential
            // (password, secret, token, card number, cvv, ssn...).
            const SENSITIVE_RE =
              /pass(word)?|secret|token|cvv|cvc|card(num)?|cc-?num|credit|ssn|social/i;
            const fieldType = (type ?? '').toLowerCase();
            const autocomplete = el.getAttribute('autocomplete') ?? '';
            const isSensitive =
              fieldType === 'password' ||
              SENSITIVE_RE.test(name ?? '') ||
              SENSITIVE_RE.test(id ?? '') ||
              SENSITIVE_RE.test(autocomplete);
            if (!isSensitive) {
              item.value = truncate(value, 80);
            }
          }
          const placeholder = el.getAttribute('placeholder');
          if (placeholder != null && placeholder !== '')
            item.placeholder = truncate(placeholder, 80);
          const alt = el.getAttribute('alt');
          if (alt != null && alt !== '') item.alt = truncate(alt, 100);
          const title = el.getAttribute('title');
          if (title != null && title !== '') item.title = truncate(title, 100);

          const text = truncate(el.textContent, 120);
          if (text) item.text = text;

          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel != null && ariaLabel !== '')
            item.ariaLabel = truncate(ariaLabel, 120);
          const ariaLabelledby = resolveAriaLabelledby(el);
          if (ariaLabelledby) item.ariaLabelledby = ariaLabelledby;
          const ariaDescribedby = el.getAttribute('aria-describedby');
          if (ariaDescribedby != null && ariaDescribedby !== '')
            item.ariaDescribedby = ariaDescribedby;

          const dataTestid = el.getAttribute('data-testid');
          if (dataTestid != null && dataTestid !== '')
            item.dataTestid = dataTestid;
          const dataCy = el.getAttribute('data-cy');
          if (dataCy != null && dataCy !== '') item.dataCy = dataCy;
          const dataTest = el.getAttribute('data-test');
          if (dataTest != null && dataTest !== '') item.dataTest = dataTest;

          // Capture the other stable data-* attributes (data-*, data-action, etc.)
          // so the AI can use them as unique selectors.
          const RESERVED = new Set([
            'data-testid',
            'data-cy',
            'data-test',
            'data-baldr-target',
            'data-baldr-hover',
          ]);
          const pairs: string[] = [];
          for (const attr of Array.from(el.attributes)) {
            if (!attr.name.startsWith('data-')) continue;
            if (RESERVED.has(attr.name)) continue;
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- garde runtime: attr.value est typé string mais peut être undefined sur des Attr issus du DOM réel
            const v = attr.value ?? '';
            if (v.length === 0 || v.length > 80) continue;
            // Filter out visibly dynamic values (UUID, long hash)
            if (/^[a-f0-9]{16,}$/i.test(v)) continue;
            pairs.push(`${attr.name}="${v}"`);
            if (pairs.length >= 6) break;
          }
          if (pairs.length > 0) item.dataAttrs = pairs.join(' ');

          const heading = findNearestHeading(el);
          if (heading) item.nearestHeading = heading;
          const landmark = findNearestLandmark(el);
          if (landmark) item.nearestLandmark = landmark;

          result.push(item);
        }

        return result;
      });

      logger.info(
        { count: elements.length },
        'Lite DOM extracted successfully',
      );
      this.domCache.set(cacheKey, elements);
      return elements;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, 'Lite DOM extraction failed');
      throw new Error(`Lite DOM extraction failed: ${msg}`, { cause: err });
    }
  }

  /**
   * Indicates whether an element has a stable selector (id, data-testid/cy/test,
   * or a recognized business attribute via `dataAttrs`). Used to boost hidden
   * AJAX leaves (e.g. `data-ajax-code="ITEM_DETAIL"`) above the
   * other hidden elements in the serialization: the LLM thus sees the stable
   * targets even when a submenu is not visually open.
   */
  private hasStableSelector(e: InteractiveElement): boolean {
    if (
      (e.id != null && e.id !== '') ||
      (e.dataTestid != null && e.dataTestid !== '') ||
      (e.dataCy != null && e.dataCy !== '') ||
      (e.dataTest != null && e.dataTest !== '')
    ) {
      return true;
    }
    if (e.dataAttrs == null || e.dataAttrs === '') return false;
    return STABLE_DATA_ATTR_RE.test(e.dataAttrs);
  }

  /**
   * Serializes the elements into compact JSON.
   * 3-level sort: visible → hidden-stable → hidden-other. Hidden AJAX leaves
   * with a stable attribute bubble up into the LLM context even when the list
   * is truncated by the token budget.
   */
  serializeWithBudget(
    elements: InteractiveElement[],
    maxChars: number,
  ): {
    json: string;
    truncated: boolean;
    includedCount: number;
    totalCount: number;
  } {
    const visible = elements.filter((e) => e.visible && !e.disabled);
    const hiddenStable = elements.filter(
      (e) => (!e.visible || e.disabled) && this.hasStableSelector(e),
    );
    const hiddenOther = elements.filter(
      (e) => (!e.visible || e.disabled) && !this.hasStableSelector(e),
    );
    const ordered = [...visible, ...hiddenStable, ...hiddenOther];

    const included: InteractiveElement[] = [];
    let json = '';
    for (const el of ordered) {
      const candidate = JSON.stringify([...included, el]);
      if (candidate.length > maxChars && included.length > 0) {
        json = JSON.stringify(included);
        return {
          json,
          truncated: true,
          includedCount: included.length,
          totalCount: ordered.length,
        };
      }
      included.push(el);
      json = candidate;
    }
    return {
      json,
      truncated: included.length < ordered.length,
      includedCount: included.length,
      totalCount: ordered.length,
    };
  }

  /**
   * Level 3 (ultimate fallback): keeps only the elements visible in the viewport.
   */
  filterToViewport(elements: InteractiveElement[]): InteractiveElement[] {
    return elements.filter((e) => e.visible && !e.disabled);
  }
}
