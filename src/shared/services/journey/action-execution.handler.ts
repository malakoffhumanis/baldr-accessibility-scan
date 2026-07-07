import type { Page } from 'puppeteer';

import type { BrowserService } from '@shared/services/browser/browser.service.js';
import { createLogger } from '@shared/utils/logger.js';
import {
  validateUrlSsrf,
  validateUrlSsrfResolved,
} from '@shared/utils/ssrf-guard.util.js';

import type {
  ActionExecutorService,
  ExecutionContext,
  ExecutorStep,
} from './action-executor.service.js';
import type {
  ActionNavigation,
  ParsedAction,
  ActionParserService,
} from './action-parser.service.js';
import type { CookieBannerService } from './cookie-banner.service.js';
import { JourneyError } from './journey-error.util.js';
import {
  descriptionImpliesNavigation,
  isHrefNavigable,
  resolveUrl,
  waitForUrlChange,
} from './journey.util.js';

const logger = createLogger('action-execution-handler');

const URL_CHANGE_TIMEOUT_NAV_MS = 15000;
const URL_CHANGE_TIMEOUT_DEFAULT_MS = 3000;
const AJAX_NETWORK_IDLE_MS = 500;
const AJAX_NETWORK_IDLE_TIMEOUT_MS = 8000;
const AJAX_URL_CHANGE_TIMEOUT_MS = 1000;
const FALLBACK_GOTO_TIMEOUT_MS = 30000;
const MENU_REPLAY_HOVER_DELAY_MS = 200;
const MAX_MENU_CHAIN_LENGTH = 5;

interface ExecuteActionArgs {
  blockIndex: number;
  actionIndex: number;
  actionStr: string;
  blockUrl: string;
  page: Page;
  execContext: ExecutionContext;
  analysisType: 'static' | 'intel' | 'full';
  specificRules: string[] | undefined;
  onScan: () => Promise<void>;
}

/**
 * Executes the individual actions of a journey.
 *
 * Dispatcher: depending on the type produced by the parser (built-in scan/cookies/
 * wait/auth or AI navigation), delegates to the appropriate branch. For
 * navigation actions, manages menu chains, the agentic retry on a click with
 * no effect, and the `page.goto(href)` fallback.
 */
export class ActionExecutionHandler {
  constructor(
    private readonly browserService: BrowserService,
    private readonly actionExecutor: ActionExecutorService,
    private readonly actionParser: ActionParserService,
    private readonly cookieBanner: CookieBannerService,
  ) {}

  /**
   * Executes an action already identified by its index. `onScan` is called
   * when the action is of type 'scan' — the orchestrator provides the callback
   * to add the result to its scan list.
   */
  async execute(args: ExecuteActionArgs): Promise<void> {
    const {
      blockIndex,
      actionIndex,
      actionStr,
      blockUrl,
      page,
      execContext,
      onScan,
    } = args;

    await this.replayMenuChain(page, execContext);

    const parsed: ParsedAction = await this.actionParser.parse(actionStr, page);

    logger.info(
      {
        blockIndex,
        actionIndex,
        actionStr,
        type: parsed.type,
        currentUrl: page.url(),
        menuChainSize: execContext.menuTriggerChain.length,
      },
      'Executing parsed action',
    );

    if (parsed.type === 'scan') {
      await onScan();
      return;
    }

    if (parsed.type === 'cookies') {
      const clickedSelector = await this.cookieBanner.accept(page);
      if (clickedSelector === null) {
        logger.warn({}, 'No cookie banner detected by heuristics');
      }
      execContext.menuTriggerChain = [];
      return;
    }

    if (parsed.type === 'wait') {
      await new Promise((r) => setTimeout(r, parsed.delayMs));
      return;
    }

    if (parsed.type === 'waitForReady') {
      await this.browserService.waitForPageReady(page);
      return;
    }

    if (parsed.type === 'auth') {
      await this.executeAuthAction(page, parsed.key, blockUrl, execContext);
      return;
    }

    // Navigation action (ActionNavigation : click/hover/type/etc.)
    const previousNavUrl = page.url();
    await this.executeNavigationAction(page, parsed, execContext, actionStr);
    const urlAfterNav = page.url();

    if (previousNavUrl !== urlAfterNav) {
      execContext.menuTriggerChain = [];
    } else if (parsed.type === 'click' || parsed.type === 'hover') {
      if (execContext.menuTriggerChain.length < MAX_MENU_CHAIN_LENGTH) {
        execContext.menuTriggerChain.push(parsed.selector);
      }
    }
  }

  /**
   * Replays the hovers of the current menu chain. On sites with submenus that
   * depend on the parent's :hover, the chain must be re-hovered before each
   * action to keep the submenus open.
   */
  private async replayMenuChain(
    page: Page,
    context: ExecutionContext,
  ): Promise<void> {
    if (context.menuTriggerChain.length === 0) return;
    logger.info(
      {
        chain: context.menuTriggerChain,
        size: context.menuTriggerChain.length,
      },
      'Replaying menu chain (keeping submenus open)',
    );
    for (const sel of context.menuTriggerChain) {
      try {
        await page.hover(sel);
        await new Promise((r) => setTimeout(r, MENU_REPLAY_HOVER_DELAY_MS));
      } catch (err) {
        logger.warn(
          {
            selector: sel,
            err: err instanceof Error ? err.message : String(err),
          },
          'Replay hover failed (best-effort), continuing chain',
        );
      }
    }
  }

  private async executeAuthAction(
    page: Page,
    key: string,
    blockUrl: string,
    execContext: ExecutionContext,
  ): Promise<void> {
    const currentUrl = page.url();
    const targetUrl =
      currentUrl === 'about:blank' || currentUrl === '' ? blockUrl : currentUrl;
    await this.browserService.navigateToUrl(page, targetUrl, {
      url: targetUrl,
      auth: key,
    });
    await this.browserService.waitForPageReady(page);
    logger.info(
      { key, urlBefore: currentUrl, urlAfter: page.url() },
      'Authentication triggered via action',
    );
    execContext.menuTriggerChain = [];
  }

  /**
   * Executes a navigation action (click/hover/type/etc.) with:
   *   1. Click preparation (rewriting target=_blank, reading href)
   *   2. Puppeteer execution
   *   3. Systematic check of the URL change
   *   4. AJAX case: wait for network-idle then re-check the URL
   *   5. Fallback `page.goto(href)` if the URL is unchanged and the href is navigable
   *   6. Agentic retry if the navigation intent is clear
   *   7. Otherwise accept as DOM-local (submenu, in-place AJAX)
   */
  private async executeNavigationAction(
    page: Page,
    action: ActionNavigation,
    execContext: ExecutionContext,
    originalActionStr?: string,
    retryAllowed = true,
  ): Promise<void> {
    const previousUrl = page.url();
    const isClick =
      action.type === 'click' ||
      action.type === 'doubleClick' ||
      action.type === 'rightClick';

    let elementInfo: {
      href: string;
      target: string;
      text: string;
      isAjaxTrigger: boolean;
    } | null = null;
    if (isClick && action.selector) {
      elementInfo = await this.prepareClick(page, action.selector);
      logger.info(
        { selector: action.selector, ...elementInfo },
        'Click target prepared (target _blank → _self)',
      );
    }

    const puppeteerStep: ExecutorStep = {
      type: action.type,
      ...(action.value !== undefined ? { value: action.value } : {}),
    };

    let actionError: unknown = null;
    try {
      await this.actionExecutor.execute(
        page,
        puppeteerStep,
        action.selector,
        execContext,
      );
      logger.info(
        { type: action.type, urlAfterImmediate: page.url() },
        'Action executed without exception',
      );
    } catch (err) {
      actionError = err;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Action threw exception, checking URL/href',
      );
    }

    const hadActionError = Boolean(actionError);

    if (!isClick) {
      if (hadActionError) {
        throw actionError instanceof Error
          ? actionError
          : new Error(JSON.stringify(actionError));
      }
      await this.browserService.waitForPageReady(page);
      return;
    }

    const urlTimeoutMs =
      action.waitForNavigation === true
        ? URL_CHANGE_TIMEOUT_NAV_MS
        : URL_CHANGE_TIMEOUT_DEFAULT_MS;
    const urlChanged = await waitForUrlChange(page, previousUrl, urlTimeoutMs);

    if (urlChanged) {
      logger.info(
        { urlBefore: previousUrl, urlAfter: page.url() },
        'Navigation confirmed by URL change',
      );
      await this.browserService.waitForPageReady(page);
      return;
    }

    if (elementInfo?.isAjaxTrigger === true) {
      await this.handleAjaxTrigger(page, action.selector, previousUrl);
      return;
    }

    if (
      elementInfo !== null &&
      isHrefNavigable(elementInfo.href, previousUrl)
    ) {
      const targetUrl = resolveUrl(elementInfo.href, previousUrl);
      logger.warn(
        { originalHref: elementInfo.href, targetUrl },
        'Fallback: direct navigation via page.goto(href)',
      );
      // SSRF guard on the fallback navigation (incl. DNS / anti-rebinding).
      const ssrfErr = await validateUrlSsrfResolved(targetUrl);
      if (ssrfErr !== null) {
        throw new JourneyError(
          'NAVIGATION_BLOCK',
          `Fallback navigation to "${targetUrl}" blocked (SSRF): ${ssrfErr}`,
        );
      }
      try {
        await page.goto(targetUrl, {
          waitUntil: 'networkidle2',
          timeout: FALLBACK_GOTO_TIMEOUT_MS,
        });
        // Redirect guard: re-validate the final URL after the navigation.
        const finalErr = validateUrlSsrf(page.url());
        if (finalErr !== null) {
          throw new JourneyError(
            'NAVIGATION_BLOCK',
            `Fallback navigation redirected to a blocked internal URL "${page.url()}" (SSRF): ${finalErr}`,
          );
        }
        await this.browserService.waitForPageReady(page);
        return;
      } catch (err) {
        if (err instanceof JourneyError) throw err;
        throw new JourneyError(
          'NAVIGATION_POST_ACTION',
          `Click had no effect and fallback page.goto("${targetUrl}") failed: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }

    if (hadActionError && action.waitForNavigation === true) {
      throw new JourneyError(
        'ACTION_EXECUTION',
        `Action ${action.type} failed and no navigation detected: ${actionError instanceof Error ? actionError.message : JSON.stringify(actionError)}`,
        { cause: actionError, attemptedSelector: action.selector },
      );
    }

    const navIntent =
      action.waitForNavigation === true ||
      descriptionImpliesNavigation(originalActionStr);
    if (retryAllowed && navIntent) {
      const retried = await this.tryAgenticRetry(
        page,
        action,
        execContext,
        originalActionStr,
        previousUrl,
      );
      if (retried) return;
    }

    logger.warn(
      {
        type: action.type,
        selector: action.selector,
        actionStr: originalActionStr,
        urlUnchanged: previousUrl,
      },
      'Click without URL change — considered DOM-local (submenu, AJAX, toggle). Continuing.',
    );
    await this.browserService.waitForPageReady(page);
  }

  /**
   * AJAX trigger case: wait for the network, then check whether the URL
   * changed anyway (some SPAs do a pushState after the XHR).
   */
  private async handleAjaxTrigger(
    page: Page,
    selector: string,
    previousUrl: string,
  ): Promise<void> {
    logger.info({ selector }, 'AJAX trigger detected — waiting network-idle');
    try {
      await page.waitForNetworkIdle({
        idleTime: AJAX_NETWORK_IDLE_MS,
        timeout: AJAX_NETWORK_IDLE_TIMEOUT_MS,
      });
    } catch {
      // Best-effort
    }
    const urlChangedAfterAjax =
      page.url() !== previousUrl ||
      (await waitForUrlChange(page, previousUrl, AJAX_URL_CHANGE_TIMEOUT_MS));
    if (urlChangedAfterAjax) {
      logger.info(
        { urlBefore: previousUrl, urlAfter: page.url() },
        'Navigation confirmed after AJAX',
      );
    } else {
      logger.info(
        { urlBefore: previousUrl },
        'AJAX completed (URL unchanged) — content likely updated in-place',
      );
    }
    await this.browserService.waitForPageReady(page);
  }

  /**
   * Agentic retry: asks the AI to re-plan given the current page state
   * (typically: click inside a dropdown menu that has opened).
   * Returns true if a replacement action was executed, false otherwise.
   */
  private async tryAgenticRetry(
    page: Page,
    action: ActionNavigation,
    execContext: ExecutionContext,
    originalActionStr: string | undefined,
    previousUrl: string,
  ): Promise<boolean> {
    logger.warn(
      {
        urlUnchanged: previousUrl,
        actionStr: originalActionStr,
        initialSelector: action.selector,
      },
      'Click had no navigation effect — agentic retry via AI',
    );
    const replan = await this.actionParser.replanAfterNoEffect(page, {
      originalActionStr: originalActionStr ?? '',
      previousAction: action,
      urlBefore: previousUrl,
    });
    if (replan !== null && replan.type !== 'skip') {
      logger.info(
        {
          replanType: replan.type,
          replanSelector: replan.selector,
          replanReasoning: replan.reasoning,
        },
        'AI corrective plan received, re-executing',
      );
      await this.executeNavigationAction(
        page,
        replan,
        execContext,
        originalActionStr,
        false, // retryAllowed=false → caps replan to 1 attempt (no recursion)
      );
      return true;
    }
    logger.warn(
      { actionStr: originalActionStr },
      'Agentic retry: AI did not propose a fix (skip)',
    );
    return false;
  }

  /**
   * Pre-click: retrieves href, target, text and detects whether the element is
   * an AJAX trigger. Rewrites `target=_blank` to `_self` to avoid opening a
   * new tab outside the test context.
   */
  private async prepareClick(
    page: Page,
    selector: string,
  ): Promise<{
    href: string;
    target: string;
    text: string;
    isAjaxTrigger: boolean;
  }> {
    const ajaxAttrs = this.actionParser.businessSelectors.ajaxTriggerAttributes;
    try {
      return await page.evaluate(
        (sel: string, ajaxTriggerAttrs: string[]) => {
          const el = document.querySelector(sel);
          if (el === null) {
            return { href: '', target: '', text: '', isAjaxTrigger: false };
          }
          const target = el.getAttribute('target') ?? '';
          if (target === '_blank') {
            el.setAttribute('target', '_self');
          }
          const href = el.getAttribute('href') ?? '';
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
          const text = (el.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80);
          const isAjaxTrigger =
            el.hasAttribute('data-ajax') ||
            (el.getAttribute('data-action') ?? '').length > 0 ||
            ajaxTriggerAttrs.some((a) => el.hasAttribute(a));
          return { href, target, text, isAjaxTrigger };
        },
        selector,
        ajaxAttrs,
      );
    } catch {
      return { href: '', target: '', text: '', isAjaxTrigger: false };
    }
  }
}
