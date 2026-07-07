import path from 'node:path';

import type { ElementHandle, Frame, Page } from 'puppeteer';

import { createLogger } from '@shared/utils/logger.js';
import {
  validateUrlSsrf,
  validateUrlSsrfResolved,
} from '@shared/utils/ssrf-guard.util.js';

import { JourneyError } from './journey-error.util.js';

const logger = createLogger('action-executor');

/**
 * Internal executor types (previously exposed in journey-api.types.ts).
 * In journey v2, these types remain used internally to dispatch the
 * Puppeteer actions. The caller (journey.controller / action-parser)
 * builds a minimal `ExecutorStep` object.
 */
export type ExecutorActionType =
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'hover'
  | 'type'
  | 'clear'
  | 'pressKey'
  | 'uploadFile'
  | 'select'
  | 'check'
  | 'uncheck'
  | 'navigate'
  | 'goBack'
  | 'goForward'
  | 'reload'
  | 'scrollTo'
  | 'scrollPage'
  | 'wait'
  | 'waitForSelector'
  | 'waitForNavigation'
  | 'switchToFrame'
  | 'switchToMainFrame'
  | 'dismissDialog';

export type PressedKey =
  | 'Enter'
  | 'Tab'
  | 'Escape'
  | 'Backspace'
  | 'Delete'
  | 'Space'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown';

export interface ExecutorStep {
  type: ExecutorActionType;
  value?: string;
  delayMs?: number;
  direction?: 'up' | 'down';
  pixels?: number;
}

/**
 * Execution state maintained between steps (notably the current frame).
 */
export interface ExecutionContext {
  /** Current frame (null = main page) */
  currentFrame: Frame | null;
  /**
   * Ordered chain of selectors of the last menu triggers (clicks/hovers
   * without a URL change). Replayed as hover before each parse() to keep
   * submenus open during the LLM round-trips (5-10s).
   * Reset on URL change, auth, cookies. Capped at 5 levels.
   */
  menuTriggerChain: string[];
}

/**
 * Service executing the 22 Puppeteer actions.
 * The selector (when required) is already provided by SelectorFinderService.
 */
export class ActionExecutorService {
  /**
   * Executes a step on the page (or current frame).
   * Throws a typed JourneyError on failure.
   */
  async execute(
    page: Page,
    step: ExecutorStep,
    selector: string | null,
    context: ExecutionContext,
  ): Promise<void> {
    const target: Page | Frame = context.currentFrame ?? page;

    logger.info(
      { type: step.type, selector, frame: context.currentFrame !== null },
      'Executing action',
    );

    switch (step.type) {
      case 'click':
        return this.doClick(target, this.requireSelector(selector, 'click'));
      case 'doubleClick':
        return this.doDoubleClick(
          target,
          this.requireSelector(selector, 'doubleClick'),
        );
      case 'rightClick':
        return this.doRightClick(
          target,
          this.requireSelector(selector, 'rightClick'),
        );
      case 'hover':
        return this.doHover(target, this.requireSelector(selector, 'hover'));
      case 'type':
        return this.doType(
          target,
          this.requireSelector(selector, 'type'),
          step.value ?? '',
        );
      case 'clear':
        return this.doClear(target, this.requireSelector(selector, 'clear'));
      case 'pressKey':
        return this.doPressKey(page, step.value as PressedKey);
      case 'uploadFile':
        return this.doUploadFile(
          target,
          this.requireSelector(selector, 'uploadFile'),
          this.requireValue(step.value, 'uploadFile'),
        );
      case 'select':
        return this.doSelect(
          target,
          this.requireSelector(selector, 'select'),
          this.requireValue(step.value, 'select'),
        );
      case 'check':
        return this.doCheck(target, this.requireSelector(selector, 'check'));
      case 'uncheck':
        return this.doUncheck(
          target,
          this.requireSelector(selector, 'uncheck'),
        );
      case 'navigate':
        return this.doNavigate(page, this.requireValue(step.value, 'navigate'));
      case 'goBack':
        return this.doGoBack(page);
      case 'goForward':
        return this.doGoForward(page);
      case 'reload':
        return this.doReload(page);
      case 'scrollTo':
        return this.doScrollTo(
          target,
          this.requireSelector(selector, 'scrollTo'),
        );
      case 'scrollPage':
        return this.doScrollPage(
          page,
          step.direction ?? 'down',
          step.pixels ?? 500,
        );
      case 'wait':
        return this.doWait(step.delayMs ?? 1000);
      case 'waitForSelector':
        return this.doWaitForSelector(
          target,
          this.requireSelector(selector, 'waitForSelector'),
        );
      case 'waitForNavigation':
        return this.doWaitForNavigation(page);
      case 'switchToFrame':
        return this.doSwitchToFrame(
          page,
          this.requireSelector(selector, 'switchToFrame'),
          context,
        );
      case 'switchToMainFrame':
        return this.doSwitchToMainFrame(context);
      case 'dismissDialog':
        return this.doDismissDialog(page);
      default: {
        const exhaustive: never = step.type;
        throw new JourneyError(
          'UNKNOWN',
          `Unhandled action type: ${String(exhaustive)}`,
        );
      }
    }
  }

  // ───────── Mouse ─────────

  private async doClick(target: Page | Frame, selector: string): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found after waitForSelector');
      await this.scrollIntoViewSafe(el);
      await this.preHover(el);
      try {
        await el.click();
      } catch (clickErr) {
        await this.fallbackDomClick(el, selector, 'click', clickErr);
      }
    } catch (err) {
      throw this.wrap(err, 'click', selector);
    }
  }

  private async doDoubleClick(
    target: Page | Frame,
    selector: string,
  ): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      await this.scrollIntoViewSafe(el);
      await this.preHover(el);
      try {
        await el.click({ count: 2 });
      } catch (clickErr) {
        await this.fallbackDomClick(el, selector, 'doubleClick', clickErr);
      }
    } catch (err) {
      throw this.wrap(err, 'doubleClick', selector);
    }
  }

  private async doRightClick(
    target: Page | Frame,
    selector: string,
  ): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      await this.scrollIntoViewSafe(el);
      await this.preHover(el);
      try {
        await el.click({ button: 'right' });
      } catch (clickErr) {
        await this.fallbackDomClick(el, selector, 'rightClick', clickErr);
      }
    } catch (err) {
      throw this.wrap(err, 'rightClick', selector);
    }
  }

  /**
   * Pre-hover before a click: wakes up the :hover pseudo-class and the
   * mouseenter/mouseover listeners, which reveals hover-driven submenus before
   * the click triggers any navigation. Best-effort: if hover fails (e.g.
   * element becomes hidden in the meantime), we proceed to the click.
   */
  private async preHover(el: ElementHandle): Promise<void> {
    try {
      await el.hover();
      await new Promise((resolve) => setTimeout(resolve, 150));
    } catch {
      // best-effort: let the native click take its chance
    }
  }

  /**
   * scrollIntoView that does not throw if the element is hidden or detached.
   */
  private async scrollIntoViewSafe(el: ElementHandle): Promise<void> {
    try {
      await el.scrollIntoView();
    } catch {
      // hidden element: no problem, the DOM click will still work
    }
  }

  /**
   * Fallback: click via DOM (`node.click()` then dispatch of a synthetic
   * MouseEvent as a safety net). Bypasses Puppeteer's visibility checks for
   * hidden elements (SPA submenus, dropdowns, megamenu items, etc.).
   *
   * Tolerates JS context destruction during navigation: if the click triggers
   * a navigation, `evaluate` may throw "Execution context was destroyed" —
   * we ignore it since that is the expected success.
   */
  private async fallbackDomClick(
    el: ElementHandle,
    selector: string,
    actionType: 'click' | 'doubleClick' | 'rightClick',
    nativeErr: unknown,
  ): Promise<void> {
    const errMsg =
      nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
    logger.warn(
      { selector, actionType, nativeErr: errMsg },
      '[ACTION-EXECUTOR] Native Puppeteer click failed, falling back to DOM click',
    );
    try {
      await el.evaluate((node: Element, type: string) => {
        if (!(node instanceof HTMLElement)) {
          throw new Error(
            'Element is not an HTMLElement, DOM click impossible',
          );
        }
        const rect = node.getBoundingClientRect();
        const cx = rect.left + (rect.width || 0) / 2;
        const cy = rect.top + (rect.height || 0) / 2;
        const button = type === 'rightClick' ? 2 : 0;
        const eventInit: MouseEventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          button,
          buttons: button === 2 ? 2 : 1,
          clientX: cx,
          clientY: cy,
        };
        // Full sequence mouseover → mousedown → mouseup → click to wake up
        // the Angular/React/Vue/jQuery handlers that may listen on any of
        // these events.
        node.dispatchEvent(new MouseEvent('mouseover', eventInit));
        node.dispatchEvent(new MouseEvent('mousedown', eventInit));
        node.dispatchEvent(new MouseEvent('mouseup', eventInit));
        if (type === 'click') {
          // node.click() triggers the handlers AND the default action
          // (navigation for <a href>, submission for <button type=submit>).
          node.click();
        } else if (type === 'doubleClick') {
          node.dispatchEvent(new MouseEvent('click', eventInit));
          node.dispatchEvent(new MouseEvent('click', eventInit));
          node.dispatchEvent(new MouseEvent('dblclick', eventInit));
        } else {
          node.dispatchEvent(new MouseEvent('contextmenu', eventInit));
        }
      }, actionType);
    } catch (domErr) {
      const msg = domErr instanceof Error ? domErr.message : String(domErr);
      // Navigation triggered by the DOM click: JS context destroyed, that's OK
      if (
        /context.*destroyed|target closed|frame got detached|navigation/i.test(
          msg,
        )
      ) {
        logger.info(
          { selector, actionType },
          '[ACTION-EXECUTOR] Context destroyed during DOM click — navigation detected, OK',
        );
        return;
      }
      throw new Error(
        `Native click and DOM click both failed. Native: ${errMsg} | DOM: ${msg}`,
        { cause: domErr },
      );
    }
  }

  private async doHover(target: Page | Frame, selector: string): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      await this.scrollIntoViewSafe(el);
      try {
        await el.hover();
      } catch (hoverErr) {
        await this.fallbackDomHover(el, selector, hoverErr);
      }
    } catch (err) {
      throw this.wrap(err, 'hover', selector);
    }
  }

  /**
   * Fallback: hover via DOM dispatch (`mouseover` + `mouseenter` + `mousemove`)
   * for elements hidden or non-clickable on the Puppeteer side (hover-driven
   * megamenu submenus, aria-haspopup items, etc.).
   *
   * The synthetic hover dispatch wakes up the JS listeners and the :hover
   * pseudo-class via the simulated mouse move to the center of the element.
   */
  private async fallbackDomHover(
    el: ElementHandle,
    selector: string,
    nativeErr: unknown,
  ): Promise<void> {
    const errMsg =
      nativeErr instanceof Error ? nativeErr.message : String(nativeErr);
    logger.warn(
      { selector, nativeErr: errMsg },
      '[ACTION-EXECUTOR] Native Puppeteer hover failed, falling back to DOM hover',
    );
    try {
      await el.evaluate((node: Element) => {
        if (!(node instanceof HTMLElement)) {
          throw new Error(
            'Element is not an HTMLElement, DOM hover impossible',
          );
        }
        const rect = node.getBoundingClientRect();
        const cx = rect.left + (rect.width || 0) / 2;
        const cy = rect.top + (rect.height || 0) / 2;
        const eventInit: MouseEventInit = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: cx,
          clientY: cy,
        };
        // Full sequence: mouseover/mouseenter/mousemove to wake up all
        // listener patterns (Angular/React/Vue/jQuery/CSS :hover).
        node.dispatchEvent(new MouseEvent('mouseover', eventInit));
        // mouseenter does not bubble, so we send it on the element AND its
        // ancestors up to the body to simulate a natural mouse pass.
        let cur: Element | null = node;
        while (cur !== null && cur !== document.body) {
          cur.dispatchEvent(
            new MouseEvent('mouseenter', { ...eventInit, bubbles: false }),
          );
          cur = cur.parentElement;
        }
        node.dispatchEvent(new MouseEvent('mousemove', eventInit));
      });
    } catch (domErr) {
      const msg = domErr instanceof Error ? domErr.message : String(domErr);
      throw new Error(
        `Native hover and DOM hover both failed. Native: ${errMsg} | DOM: ${msg}`,
        { cause: domErr },
      );
    }
  }

  // ───────── Keyboard / input ─────────

  private async doType(
    target: Page | Frame,
    selector: string,
    value: string,
  ): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      await el.focus();
      await el.type(value, { delay: 30 });
    } catch (err) {
      throw this.wrap(err, 'type', selector);
    }
  }

  private async doClear(target: Page | Frame, selector: string): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      await el.focus();
      await el.evaluate((node: Element) => {
        if (
          node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement
        ) {
          node.value = '';
          node.dispatchEvent(new Event('input', { bubbles: true }));
          node.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          node.textContent = '';
        }
      });
    } catch (err) {
      throw this.wrap(err, 'clear', selector);
    }
  }

  private async doPressKey(page: Page, key: PressedKey): Promise<void> {
    try {
      await page.keyboard.press(key);
    } catch (err) {
      throw this.wrap(err, 'pressKey', key);
    }
  }

  private async doUploadFile(
    target: Page | Frame,
    selector: string,
    filePath: string,
  ): Promise<void> {
    // Path-traversal / arbitrary-file-read guard. Only allow relative paths
    // that resolve inside the current working directory.
    const safePath = this.resolveSafeUploadPath(filePath);
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      // ElementHandle.uploadFile exists for file inputs
      const inputHandle = el as unknown as {
        uploadFile?: (...paths: string[]) => Promise<void>;
      };
      if (typeof inputHandle.uploadFile !== 'function') {
        throw new Error(
          'Target element is not an input[type=file] and does not support uploadFile',
        );
      }
      await inputHandle.uploadFile(safePath);
    } catch (err) {
      throw this.wrap(err, 'uploadFile', selector);
    }
  }

  /**
   * Validates an upload file path to prevent arbitrary file reads.
   *
   * Rejects: absolute paths, any path containing a `..` segment, and any path
   * resolving outside the current working directory. Returns the absolute,
   * normalized path on success.
   */
  private resolveSafeUploadPath(filePath: string): string {
    if (typeof filePath !== 'string' || filePath.trim() === '') {
      throw new JourneyError(
        'VALIDATION_BODY',
        'uploadFile: file path is required',
      );
    }
    if (path.isAbsolute(filePath)) {
      throw new JourneyError(
        'VALIDATION_BODY',
        `uploadFile: absolute paths are not allowed ("${filePath}")`,
      );
    }
    // Reject any `..` segment (covers ../, ..\, and bare ..).
    const segments = filePath.split(/[\\/]+/);
    if (segments.includes('..')) {
      throw new JourneyError(
        'VALIDATION_BODY',
        `uploadFile: parent-directory traversal ("..") is not allowed ("${filePath}")`,
      );
    }
    const baseDir = process.cwd();
    const resolved = path.resolve(baseDir, filePath);
    const baseWithSep = baseDir.endsWith(path.sep)
      ? baseDir
      : baseDir + path.sep;
    if (resolved !== baseDir && !resolved.startsWith(baseWithSep)) {
      throw new JourneyError(
        'VALIDATION_BODY',
        `uploadFile: path escapes the allowed directory ("${filePath}")`,
      );
    }
    return resolved;
  }

  // ───────── Selection ─────────

  private async doSelect(
    target: Page | Frame,
    selector: string,
    value: string,
  ): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      await target.select(selector, value);
    } catch (err) {
      throw this.wrap(err, 'select', selector);
    }
  }

  private async doCheck(target: Page | Frame, selector: string): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      const isChecked = await el.evaluate((node: Element) => {
        if (
          node instanceof HTMLInputElement &&
          (node.type === 'checkbox' || node.type === 'radio')
        ) {
          return node.checked;
        }
        return null;
      });
      if (isChecked === null) {
        throw new Error('Element is not a checkbox or radio');
      }
      if (!isChecked) {
        await el.click();
      }
    } catch (err) {
      throw this.wrap(err, 'check', selector);
    }
  }

  private async doUncheck(
    target: Page | Frame,
    selector: string,
  ): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      const isChecked = await el.evaluate((node: Element) => {
        if (node instanceof HTMLInputElement && node.type === 'checkbox') {
          return node.checked;
        }
        return null;
      });
      if (isChecked === null) {
        throw new Error(
          'Element is not a checkbox (uncheck is not applicable to radios)',
        );
      }
      if (isChecked) {
        await el.click();
      }
    } catch (err) {
      throw this.wrap(err, 'uncheck', selector);
    }
  }

  // ───────── Navigation ─────────

  private async doNavigate(page: Page, url: string): Promise<void> {
    // SSRF guard: re-validate (incl. DNS resolution / anti-rebinding) before
    // actually navigating — the Zod-level static check is not enough here.
    const ssrfErr = await validateUrlSsrfResolved(url);
    if (ssrfErr !== null) {
      throw new JourneyError(
        'NAVIGATION_BLOCK',
        `Navigation to "${url}" blocked (SSRF): ${ssrfErr}`,
      );
    }
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    } catch (err) {
      throw this.wrap(err, 'navigate', url);
    }
    // Redirect guard: a 30x may have landed us on an internal target.
    this.assertFinalUrlSafe(page, 'navigate');
  }

  /**
   * After a navigation, re-validates the final URL (static check) to catch
   * redirects (30x) toward internal targets (IMDS, localhost, RFC1918, ...).
   * Throws a JourneyError if the final URL is internal.
   */
  private assertFinalUrlSafe(page: Page, actionType: string): void {
    const finalUrl = page.url();
    if (finalUrl === '' || finalUrl === 'about:blank') return;
    const finalErr = validateUrlSsrf(finalUrl);
    if (finalErr !== null) {
      throw new JourneyError(
        'NAVIGATION_BLOCK',
        `Action ${actionType} redirected to a blocked internal URL "${finalUrl}" (SSRF): ${finalErr}`,
      );
    }
  }

  private async doGoBack(page: Page): Promise<void> {
    try {
      await page.goBack({ waitUntil: 'networkidle2', timeout: 30000 });
    } catch (err) {
      throw this.wrap(err, 'goBack');
    }
  }

  private async doGoForward(page: Page): Promise<void> {
    try {
      await page.goForward({ waitUntil: 'networkidle2', timeout: 30000 });
    } catch (err) {
      throw this.wrap(err, 'goForward');
    }
  }

  private async doReload(page: Page): Promise<void> {
    try {
      await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    } catch (err) {
      throw this.wrap(err, 'reload');
    }
  }

  // ───────── Scroll ─────────

  private async doScrollTo(
    target: Page | Frame,
    selector: string,
  ): Promise<void> {
    try {
      const el = await target.waitForSelector(selector, { timeout: 5000 });
      if (!el) throw new Error('Element not found');
      await el.scrollIntoView();
    } catch (err) {
      throw this.wrap(err, 'scrollTo', selector);
    }
  }

  private async doScrollPage(
    page: Page,
    direction: 'up' | 'down',
    pixels: number,
  ): Promise<void> {
    try {
      const delta = direction === 'down' ? pixels : -pixels;
      await page.evaluate((d: number) => {
        window.scrollBy({ top: d, behavior: 'instant' as ScrollBehavior });
      }, delta);
    } catch (err) {
      throw this.wrap(err, 'scrollPage');
    }
  }

  // ───────── Wait ─────────

  private async doWait(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async doWaitForSelector(
    target: Page | Frame,
    selector: string,
  ): Promise<void> {
    try {
      await target.waitForSelector(selector, {
        timeout: 15000,
        visible: true,
      });
    } catch (err) {
      throw this.wrap(err, 'waitForSelector', selector);
    }
  }

  private async doWaitForNavigation(page: Page): Promise<void> {
    try {
      await page.waitForNavigation({
        waitUntil: 'networkidle2',
        timeout: 15000,
      });
    } catch (err) {
      throw this.wrap(err, 'waitForNavigation');
    }
  }

  // ───────── Iframe / dialog ─────────

  private async doSwitchToFrame(
    page: Page,
    selector: string,
    context: ExecutionContext,
  ): Promise<void> {
    try {
      const handle = await page.waitForSelector(selector, { timeout: 5000 });
      if (!handle) throw new Error('iframe not found');
      const frame = await handle.contentFrame();
      if (!frame) {
        throw new JourneyError(
          'ACTION_EXECUTION',
          `Cannot access iframe content (cross-origin?): ${selector}`,
          { attemptedSelector: selector },
        );
      }
      context.currentFrame = frame;
    } catch (err) {
      if (err instanceof JourneyError) throw err;
      throw new JourneyError(
        'ACTION_EXECUTION',
        `switchToFrame failed for "${selector}": ${err instanceof Error ? err.message : String(err)}`,
        { attemptedSelector: selector, cause: err },
      );
    }
  }

  private async doSwitchToMainFrame(context: ExecutionContext): Promise<void> {
    context.currentFrame = null;
    return Promise.resolve();
  }

  private async doDismissDialog(page: Page): Promise<void> {
    // The BrowserService already configures page.on('dialog', d => d.accept())
    // This action is mostly informative; we briefly wait for any pending
    // dialog to be closed.
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (page.isClosed()) {
      throw new JourneyError(
        'BROWSER_CRASH',
        'Page closed during dismissDialog',
      );
    }
    return Promise.resolve();
  }

  // ───────── Helpers ─────────

  private requireSelector(selector: string | null, actionType: string): string {
    if (selector == null || selector === '') {
      throw new JourneyError(
        'AI_SELECTOR_NOT_FOUND',
        `Action ${actionType}: selector required but missing`,
      );
    }
    return selector;
  }

  private requireValue(value: string | undefined, actionType: string): string {
    if (
      value === undefined ||
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive guard: `value` may be `null` at runtime when sourced from parsed LLM JSON
      value === null
    ) {
      throw new JourneyError(
        'VALIDATION_BODY',
        `Action ${actionType}: "value" required`,
      );
    }
    return value;
  }

  private wrap(
    err: unknown,
    actionType: string,
    selector?: string,
  ): JourneyError {
    if (err instanceof JourneyError) return err;
    const msg = err instanceof Error ? err.message : String(err);
    return new JourneyError(
      'ACTION_EXECUTION',
      `Action ${actionType} failed${selector != null && selector !== '' ? ` on "${selector}"` : ''}: ${msg}`,
      { attemptedSelector: selector, cause: err },
    );
  }
}
