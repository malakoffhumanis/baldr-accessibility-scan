import type { Page } from 'puppeteer';

import {
  appendClickableSelectors,
  type AttributeMatch,
  buildStableAttributes,
  type BusinessSelectorsConfig,
  EMPTY_BUSINESS_SELECTORS,
} from '@shared/config/business-selectors.config.js';
import { createLogger } from '@shared/utils/logger.js';

const logger = createLogger('selector-resolver');

/** Clickable-candidate base query (universal conventions only). */
const MENU_CANDIDATE_BASE_QUERY =
  'a, button, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="menuitemcheckbox"], [role="menuitemradio"], [data-action], [data-target]';

/**
 * Result of a selector validation against the live page.
 */
export interface SelectorValidationResult {
  ok: boolean;
  reason: string;
  type?:
    | 'AI_SELECTOR_NOT_FOUND'
    | 'AI_SELECTOR_INVALID'
    | 'AI_SELECTOR_AMBIGUOUS'
    | 'AI_ELEMENT_NOT_VISIBLE'
    | 'AI_ELEMENT_DISABLED';
}

/**
 * Service responsible for resolving, normalising, and validating CSS selectors
 * against a live Puppeteer page.
 *
 * Extracted from ActionParserService to provide a single, testable unit for all
 * selector-related logic shared between initial parsing and agentic retries.
 */
export class SelectorResolverService {
  constructor(
    private readonly businessSelectors: BusinessSelectorsConfig = EMPTY_BUSINESS_SELECTORS,
  ) {}

  /**
   * Detects remaining non-standard pseudo-classes after text-based resolution.
   * :has-text() and :contains() are handled by resolveTextBasedSelector and
   * must NOT trigger failure here.
   */
  detectNonStandardSyntax(selector: string): string | null {
    if (/:visible\b|:hidden\b|:icon-text\s*\(|:text\s*\(/i.test(selector)) {
      return 'Non-standard pseudo-class detected. Use only standard W3C CSS';
    }
    return null;
  }

  /**
   * Removes all data-baldr-target attributes from the page DOM.
   * Should be called to avoid stale markers polluting subsequent queries.
   */
  async cleanupBaldrTargets(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        document
          .querySelectorAll('[data-baldr-target]')
          .forEach((el) => el.removeAttribute('data-baldr-target'));
      });
    } catch {
      // Page may have navigated — silently ignore
    }
  }

  /**
   * Resolves selectors containing :has-text("X") or :contains("X") browser-side:
   *   - parses base selector + target text
   *   - finds elements matching the base selector
   *   - filters by textContent (priority: exact match, then contains)
   *   - if ONE unique match: tags with data-baldr-target="<uuid>" and returns
   *     the selector "[data-baldr-target='<uuid>']"
   * If no :has-text/:contains: returns the selector as-is.
   * If multiple or zero matches: returns as-is (downstream validation will fail).
   */
  async resolveTextBasedSelector(
    page: Page,
    selector: string,
  ): Promise<string> {
    const re = /:(?:has-text|contains)\s*\(\s*(['"])(.+?)\1\s*\)/i;
    const match = re.exec(selector);
    if (!match) return selector;

    const targetText = match[2];

    if (targetText === undefined) return selector;
    const baseSelector = selector.replace(re, '').trim();
    if (baseSelector.length === 0) return selector;

    try {
      await this.cleanupBaldrTargets(page);
      const tag = `baldr-${Math.random().toString(36).slice(2, 10)}`;
      const ok = await page.evaluate(
        (base: string, text: string, tagAttr: string) => {
          const elements = Array.from(document.querySelectorAll(base));
          const norm = (s: string): string =>
            s.replace(/\s+/g, ' ').trim().toLowerCase();
          const target = norm(text);
          let matches = elements.filter(
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
            (el) => norm(el.textContent ?? '') === target,
          );
          if (matches.length === 0) {
            matches = elements.filter((el) =>
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
              norm(el.textContent ?? '').includes(target),
            );
          }
          if (matches.length !== 1) return false;
          const el = matches[0];

          if (el == null) return false;
          el.setAttribute('data-baldr-target', tagAttr);
          return true;
        },
        baseSelector,
        targetText,
        tag,
      );
      if (!ok) {
        logger.warn(
          { selector, baseSelector, targetText },
          '[SELECTOR-RESOLVER] resolveTextBased: 0 or >1 match, letting the AI retry',
        );
        return selector;
      }
      return `[data-baldr-target="${tag}"]`;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[SELECTOR-RESOLVER] resolveTextBased: error, letting the AI retry',
      );
      return selector;
    }
  }

  /**
   * Validates a CSS selector against the live page: syntax, uniqueness,
   * visibility, disabled state.
   */
  async validateSelector(
    page: Page,
    selector: string,
  ): Promise<SelectorValidationResult> {
    let elements;
    try {
      elements = await page.$$(selector);
    } catch (err) {
      return {
        ok: false,
        reason: `Syntactically invalid CSS selector: ${err instanceof Error ? err.message : String(err)}`,
        type: 'AI_SELECTOR_INVALID',
      };
    }
    if (elements.length === 0) {
      return {
        ok: false,
        reason: 'No element matches the selector',
        type: 'AI_SELECTOR_NOT_FOUND',
      };
    }
    if (elements.length > 1) {
      return {
        ok: false,
        reason: `${String(elements.length)} elements match the selector (ambiguous)`,
        type: 'AI_SELECTOR_AMBIGUOUS',
      };
    }

    const checks: {
      exists: boolean;
      visible?: boolean;
      disabled?: boolean;
      isClickableEvenIfHidden?: boolean;
    } = await page.evaluate((sel: string) => {
      const node = document.querySelector(sel);
      if (node === null) return { exists: false };
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const visible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0' &&
        rect.width > 0 &&
        rect.height > 0;
      const disabled =
        node.hasAttribute('disabled') ||
        node.getAttribute('aria-disabled') === 'true';
      const tag = node.tagName.toUpperCase();
      const href = node.getAttribute('href') ?? '';
      const role = node.getAttribute('role') ?? '';
      const clickableRoles = [
        'button',
        'menuitem',
        'menuitemcheckbox',
        'menuitemradio',
        'link',
        'tab',
        'option',
      ];
      const isClickableEvenIfHidden =
        (tag === 'A' && href.length > 0) ||
        tag === 'BUTTON' ||
        node.hasAttribute('onclick') ||
        clickableRoles.includes(role);
      return { exists: true, visible, disabled, isClickableEvenIfHidden };
    }, selector);

    if (!checks.exists) {
      return {
        ok: false,
        reason: 'Element not found after querySelector',
        type: 'AI_SELECTOR_NOT_FOUND',
      };
    }
    if (checks.disabled === true) {
      return {
        ok: false,
        reason: 'Element disabled (disabled or aria-disabled=true)',
        type: 'AI_ELEMENT_DISABLED',
      };
    }
    if (checks.visible === false) {
      if (checks.isClickableEvenIfHidden === true) {
        logger.info(
          { selector },
          '[SELECTOR-RESOLVER] Hidden but clickable element — accepted (DOM click bypass)',
        );
        return { ok: true, reason: 'OK (hidden but clickable, DOM click)' };
      }
      const revealed = await this.hoverAncestorsAndRevalidate(page, selector);
      if (revealed) {
        return { ok: true, reason: 'OK (visible after ancestor hover)' };
      }
      return {
        ok: false,
        reason:
          'Element not visible (display:none, visibility:hidden, opacity:0 or zero size). ' +
          'Ancestor hover attempted without success.',
        type: 'AI_ELEMENT_NOT_VISIBLE',
      };
    }
    return { ok: true, reason: 'OK' };
  }

  /**
   * Override container→leaf: if the AI chose a menu container
   * (data-menu-type=submenu, menu-folder, aria-haspopup, role=menu),
   * search the DOM for the unique leaf whose textContent matches
   * `expectedTarget` and has a stable unique attribute. Returns the leaf
   * selector, or null if no override is possible.
   */
  async overrideContainerToLeaf(
    page: Page,
    chosenSelector: string,
    expectedTarget: string,
  ): Promise<string | null> {
    const clickableQuery = appendClickableSelectors(
      MENU_CANDIDATE_BASE_QUERY,
      this.businessSelectors,
    );
    const containerClasses = this.businessSelectors.containerClasses;
    const containerAttributes: AttributeMatch[] =
      this.businessSelectors.containerAttributes;
    const stableNames = buildStableAttributes(this.businessSelectors);

    try {
      const result = await page.evaluate(
        (
          sel: string,
          targetRaw: string,
          query: string,
          ctrClasses: string[],
          ctrAttrs: { name: string; value: string }[],
          stableAttrNames: string[],
        ) => {
          const node = document.querySelector(sel);
          if (node === null) return null;

          const isContainer = (el: Element): boolean =>
            (el.getAttribute('aria-haspopup') ?? '').length > 0 ||
            el.getAttribute('role') === 'menu' ||
            el.getAttribute('role') === 'menubar' ||
            ctrAttrs.some((m) => el.getAttribute(m.name) === m.value) ||
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive DOM guard via page.evaluate
            ctrClasses.some((c) => el.classList?.contains(c) ?? false);

          if (!isContainer(node)) {
            return null;
          }

          const norm = (s: string): string =>
            s.replace(/\s+/g, ' ').trim().toLowerCase();
          const target = norm(targetRaw);
          const all = Array.from(document.querySelectorAll<HTMLElement>(query));

          const exactMatches = all.filter(
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
            (el) => norm(el.textContent ?? '') === target,
          );
          const candidates =
            exactMatches.length > 0
              ? exactMatches
              : // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
                all.filter((el) => norm(el.textContent ?? '').includes(target));

          const leaves = candidates.filter((el) => !isContainer(el));
          if (leaves.length === 0) return null;

          const buildStableSelector = (el: HTMLElement): string | null => {
            for (const a of stableAttrNames) {
              const v = el.getAttribute(a);
              if (v != null && v !== '')
                return `[${a}="${v.replace(/"/g, '\\"')}"]`;
            }
            for (const attr of Array.from(el.attributes)) {
              if (
                /^data-[\w-]+-(?:code|id|action|target|key)$/i.test(
                  attr.name,
                ) &&
                attr.value
              ) {
                return `[${attr.name}="${attr.value.replace(/"/g, '\\"')}"]`;
              }
            }
            return null;
          };

          const isUniqueInDocument = (s: string): boolean => {
            try {
              return document.querySelectorAll(s).length === 1;
            } catch {
              return false;
            }
          };

          if (leaves.length === 1) {
            const leaf = leaves[0];

            if (leaf == null) return null;
            return buildStableSelector(leaf);
          }
          const withUnique = leaves
            .map((el) => ({ el, sel: buildStableSelector(el) }))
            .filter((x) => x.sel !== null && isUniqueInDocument(x.sel));
          if (withUnique.length === 1) {
            return withUnique[0]?.sel ?? null;
          }
          return null;
        },
        chosenSelector,
        expectedTarget,
        clickableQuery,
        containerClasses,
        containerAttributes,
        stableNames,
      );

      return result;
    } catch {
      return null;
    }
  }

  /**
   * Checks that the element targeted by the selector contains the expected
   * text (in textContent, aria-label, or value). Case- and whitespace-tolerant.
   */
  async verifyTargetText(
    page: Page,
    selector: string,
    expectedTarget: string,
  ): Promise<boolean> {
    try {
      const target = expectedTarget.toLowerCase().replace(/\s+/g, ' ').trim();
      return await page.evaluate(
        (sel: string, t: string) => {
          const node = document.querySelector(sel);
          if (node === null) return false;
          const norm = (s: string): string =>
            s.replace(/\s+/g, ' ').trim().toLowerCase();
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
          const txt = norm(node.textContent ?? '');
          const aria = norm(node.getAttribute('aria-label') ?? '');
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive DOM guard via page.evaluate (value may be undefined on non-input nodes at runtime)
          const val = norm((node as HTMLInputElement).value ?? '');
          const title = norm(node.getAttribute('title') ?? '');
          return (
            txt.includes(t) ||
            aria.includes(t) ||
            val.includes(t) ||
            title.includes(t)
          );
        },
        selector,
        target,
      );
    } catch {
      return true;
    }
  }

  /**
   * Gets a summary of the chosen element's text (textContent or aria-label,
   * truncated to 80 chars). Used in retry hints to show the AI its own mistake.
   */
  async getChosenElementDetails(page: Page, selector: string): Promise<string> {
    try {
      const txt = await page.evaluate((sel: string) => {
        const node = document.querySelector(sel);
        if (node === null) return '<element not found>';
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
        const txt = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
        const aria = (node.getAttribute('aria-label') ?? '').trim();
        const main = txt.length > 0 ? txt : aria;
        return main.length > 80 ? `${main.slice(0, 80)}…` : main;
      }, selector);
      return txt || '<empty>';
    } catch {
      return '<unknown>';
    }
  }

  /**
   * When a selector targets a hidden element (submenu, dropdown), attempts to
   * reveal it by hovering ancestor "menu triggers" cumulatively from outer to
   * inner (max 6 levels).
   */
  private async hoverAncestorsAndRevalidate(
    page: Page,
    selector: string,
  ): Promise<boolean> {
    let ancestorTags: string[];
    try {
      ancestorTags = await page.evaluate((sel: string) => {
        const target = document.querySelector(sel);
        if (target === null) return [];
        const isMenuTrigger = (el: Element): boolean => {
          if (
            el.hasAttribute('aria-haspopup') ||
            el.hasAttribute('aria-expanded')
          ) {
            return true;
          }
          const tag = el.tagName.toUpperCase();
          if (tag === 'A' && (el.getAttribute('href') ?? '').length > 0) {
            return true;
          }
          if (tag === 'BUTTON') return true;
          const role = el.getAttribute('role') ?? '';
          if (role === 'menuitem' || role === 'button') return true;
          const cls = (el.getAttribute('class') ?? '').toLowerCase();
          return /menu|submenu|dropdown|launcher|\bnav\b/.test(cls);
        };
        const tags: string[] = [];
        let cur = target.parentElement;
        let depth = 0;
        while (cur !== null && depth < 6) {
          if (isMenuTrigger(cur)) {
            const tag = `baldr-hover-${Math.random().toString(36).slice(2, 10)}`;
            cur.setAttribute('data-baldr-hover', tag);
            tags.push(tag);
          }
          cur = cur.parentElement;
          depth++;
        }
        return tags;
      }, selector);
    } catch {
      return false;
    }

    if (ancestorTags.length === 0) return false;

    const ancestorTagsOuterIn = [...ancestorTags].reverse();
    const totalLevels = ancestorTagsOuterIn.length;

    try {
      for (let i = 0; i < ancestorTagsOuterIn.length; i++) {
        const tag = ancestorTagsOuterIn[i];

        const ancestorSel = `[data-baldr-hover="${tag ?? ''}"]`;
        try {
          await page.hover(ancestorSel);
        } catch {
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));

        const visibleNow: boolean = await page.evaluate((sel: string) => {
          const node = document.querySelector(sel);
          if (node === null) return false;
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0
          );
        }, selector);

        if (visibleNow) {
          logger.info(
            {
              selector,
              level: i + 1,
              total: totalLevels,
              ancestor: ancestorSel,
            },
            `[SELECTOR-RESOLVER] Target revealed after cumulative hover at level ${String(i + 1)}/${String(totalLevels)}`,
          );
          return true;
        }
      }
      return false;
    } finally {
      try {
        await page.evaluate(() => {
          document.querySelectorAll('[data-baldr-hover]').forEach((el) => {
            el.removeAttribute('data-baldr-hover');
          });
        });
      } catch {
        // best-effort cleanup
      }
    }
  }
}
