import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock DNS so the fallback-goto anti-rebinding lookup never hits the network.
const lookupMock = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import { ActionExecutionHandler } from './action-execution.handler.js';
import { JourneyError } from './journey-error.util.js';
import type { ExecutionContext } from './action-executor.service.js';

const TEST_BUSINESS_SELECTORS = {
  clickableSelectors: ['[data-ajax-code]', '[data-ajax]'],
  containerClasses: ['menu-folder'],
  containerAttributes: [{ name: 'data-menu-type', value: 'submenu' }],
  stableAttributes: ['data-ajax-code'],
  ajaxTriggerAttributes: ['data-ajax', 'data-ajax-code'],
};

function createMockPage() {
  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    hover: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({
      href: '',
      target: '',
      text: '',
      isAjaxTrigger: false,
    }),
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
  };
}

function createMockDeps() {
  return {
    browserService: {
      waitForPageReady: vi.fn().mockResolvedValue(undefined),
      navigateToUrl: vi.fn().mockResolvedValue(undefined),
    },
    actionExecutor: {
      execute: vi.fn().mockResolvedValue(undefined),
    },
    actionParser: {
      parse: vi.fn().mockResolvedValue({ type: 'scan' }),
      replanAfterNoEffect: vi.fn().mockResolvedValue(null),
      businessSelectors: TEST_BUSINESS_SELECTORS,
    },
    cookieBanner: {
      accept: vi.fn().mockResolvedValue(null),
    },
  };
}

function createContext(): ExecutionContext {
  return { currentFrame: null, menuTriggerChain: [] };
}

function createBaseArgs(
  page: ReturnType<typeof createMockPage>,
  overrides = {},
) {
  return {
    blockIndex: 0,
    actionIndex: 0,
    actionStr: 'scan the page',
    blockUrl: 'https://example.com',
    page: page as never,
    execContext: createContext(),
    analysisType: 'static' as const,
    specificRules: undefined,
    onScan: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeHandler(deps: ReturnType<typeof createMockDeps>) {
  return new ActionExecutionHandler(
    deps.browserService as never,
    deps.actionExecutor as never,
    deps.actionParser as never,
    deps.cookieBanner as never,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ActionExecutionHandler', () => {
  describe('execute — scan action', () => {
    it('calls onScan for scan actions', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({ type: 'scan' });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      const args = createBaseArgs(page);

      await handler.execute(args);

      expect(args.onScan).toHaveBeenCalled();
      expect(deps.actionExecutor.execute).not.toHaveBeenCalled();
    });
  });

  describe('execute — cookies action', () => {
    it('calls cookieBanner.accept and resets menu chain', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({ type: 'cookies' });
      deps.cookieBanner.accept.mockResolvedValueOnce('#accept-btn');
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      const execContext = createContext();
      execContext.menuTriggerChain = ['#menu1'];
      const args = createBaseArgs(page, { execContext });

      await handler.execute(args);

      expect(deps.cookieBanner.accept).toHaveBeenCalledWith(page);
      expect(execContext.menuTriggerChain).toEqual([]);
    });

    it('logs warning when no cookie banner is detected', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({ type: 'cookies' });
      deps.cookieBanner.accept.mockResolvedValueOnce(null);
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      const args = createBaseArgs(page);

      await handler.execute(args);

      expect(deps.cookieBanner.accept).toHaveBeenCalled();
    });
  });

  describe('execute — wait action', () => {
    it('waits for specified delay', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'wait',
        delayMs: 50,
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      const args = createBaseArgs(page);

      await handler.execute(args);

      expect(deps.actionExecutor.execute).not.toHaveBeenCalled();
    });
  });

  describe('execute — waitForReady action', () => {
    it('delegates to browserService.waitForPageReady', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({ type: 'waitForReady' });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      const args = createBaseArgs(page);

      await handler.execute(args);

      expect(deps.browserService.waitForPageReady).toHaveBeenCalledWith(page);
    });
  });

  describe('execute — auth action', () => {
    it('navigates and authenticates, resets menu chain', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'auth',
        key: 'adfs',
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      const execContext = createContext();
      execContext.menuTriggerChain = ['#menu'];
      const args = createBaseArgs(page, { execContext });

      await handler.execute(args);

      expect(deps.browserService.navigateToUrl).toHaveBeenCalled();
      expect(deps.browserService.waitForPageReady).toHaveBeenCalled();
      expect(execContext.menuTriggerChain).toEqual([]);
    });

    it('uses blockUrl when page is on about:blank', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'auth',
        key: 'form',
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      page.url.mockReturnValue('about:blank');
      const args = createBaseArgs(page, { blockUrl: 'https://target.com' });

      await handler.execute(args);

      expect(deps.browserService.navigateToUrl).toHaveBeenCalledWith(
        page,
        'https://target.com',
        expect.objectContaining({ url: 'https://target.com', auth: 'form' }),
      );
    });
  });

  describe('execute — navigation action (click)', () => {
    it('executes click and waits for page ready on URL change', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: '#link',
        confidenceScore: 90,
        reasoning: 'test',
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      let urlCallCount = 0;
      page.url.mockImplementation(() => {
        urlCallCount++;
        return urlCallCount <= 2
          ? 'https://example.com'
          : 'https://example.com/new';
      });
      const args = createBaseArgs(page);

      await handler.execute(args);

      expect(deps.actionExecutor.execute).toHaveBeenCalled();
    });

    it('resets menu chain on URL change', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: '#link',
        confidenceScore: 90,
        reasoning: '',
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      // Simulate URL change
      let callNum = 0;
      page.url.mockImplementation(() => {
        callNum++;
        return callNum <= 3 ? 'https://old.com' : 'https://new.com';
      });
      const execContext = createContext();
      execContext.menuTriggerChain = ['#menu1'];
      const args = createBaseArgs(page, { execContext });

      await handler.execute(args);

      expect(execContext.menuTriggerChain).toEqual([]);
    });

    it('adds to menu chain on click without URL change', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: '#submenu',
        confidenceScore: 90,
        reasoning: '',
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      // URL never changes
      page.url.mockReturnValue('https://example.com');
      page.evaluate.mockResolvedValue({
        href: '',
        target: '',
        text: '',
        isAjaxTrigger: false,
      });
      const execContext = createContext();
      const args = createBaseArgs(page, { execContext });

      await handler.execute(args);

      expect(execContext.menuTriggerChain).toContain('#submenu');
    });
  });

  describe('execute — non-click navigation actions', () => {
    it('throws on error for non-click actions (type)', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'type',
        selector: '#input',
        value: 'hello',
        confidenceScore: 90,
        reasoning: '',
      });
      deps.actionExecutor.execute.mockRejectedValueOnce(
        new Error('type failed'),
      );
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      const args = createBaseArgs(page);

      await expect(handler.execute(args)).rejects.toThrow('type failed');
    });

    it('waits for page ready on hover without URL change', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'hover',
        selector: '#menu',
        confidenceScore: 90,
        reasoning: '',
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      page.url.mockReturnValue('https://same.com');
      const execContext = createContext();
      const args = createBaseArgs(page, { execContext });

      await handler.execute(args);

      // hover should be added to menu chain
      expect(execContext.menuTriggerChain).toContain('#menu');
    });
  });

  describe('menu chain replay', () => {
    it('replays hover on menu chain entries before action', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({ type: 'scan' });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      const execContext = createContext();
      execContext.menuTriggerChain = ['#menu1', '#menu2'];
      const args = createBaseArgs(page, { execContext });

      await handler.execute(args);

      expect(page.hover).toHaveBeenCalledWith('#menu1');
      expect(page.hover).toHaveBeenCalledWith('#menu2');
    });

    it('continues chain replay even if one hover fails', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({ type: 'scan' });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      page.hover.mockRejectedValueOnce(new Error('hover failed'));
      const execContext = createContext();
      execContext.menuTriggerChain = ['#menu1', '#menu2'];
      const args = createBaseArgs(page, { execContext });

      await handler.execute(args);

      expect(page.hover).toHaveBeenCalledTimes(2);
    });

    it('skips replay when menu chain is empty', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({ type: 'scan' });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      const args = createBaseArgs(page);

      await handler.execute(args);

      expect(page.hover).not.toHaveBeenCalled();
    });
  });

  describe('AJAX trigger handling', () => {
    it('waits for network idle on AJAX trigger', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: '#ajax-btn',
        confidenceScore: 90,
        reasoning: '',
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      page.url.mockReturnValue('https://example.com');
      page.evaluate.mockResolvedValue({
        href: '',
        target: '',
        text: 'Load more',
        isAjaxTrigger: true,
      });
      const args = createBaseArgs(page);

      await handler.execute(args);

      expect(page.waitForNetworkIdle).toHaveBeenCalled();
      expect(deps.browserService.waitForPageReady).toHaveBeenCalled();
    });
  });

  describe('fallback goto', () => {
    it('falls back to page.goto when href is navigable and URL unchanged', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: 'a#link',
        confidenceScore: 90,
        reasoning: '',
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      page.url.mockReturnValue('https://example.com');
      page.evaluate.mockResolvedValue({
        href: '/other-page',
        target: '',
        text: 'Other',
        isAjaxTrigger: false,
      });
      const args = createBaseArgs(page);

      await handler.execute(args);

      expect(page.goto).toHaveBeenCalledWith(
        'https://example.com/other-page',
        expect.objectContaining({ waitUntil: 'networkidle2' }),
      );
    });

    it('throws when fallback goto fails', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: 'a#link',
        confidenceScore: 90,
        reasoning: '',
      });
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      page.url.mockReturnValue('https://example.com');
      page.evaluate.mockResolvedValue({
        href: '/other',
        target: '',
        text: 'Other',
        isAjaxTrigger: false,
      });
      page.goto.mockRejectedValueOnce(new Error('goto failed'));
      const args = createBaseArgs(page);

      await expect(handler.execute(args)).rejects.toThrow(JourneyError);
    });

    it('blocks the fallback goto when href points to an internal URL (SSRF)', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: 'a#link',
        confidenceScore: 90,
        reasoning: '',
      });
      const handler = makeHandler(deps);
      const page = createMockPage();
      page.url.mockReturnValue('https://example.com');
      page.evaluate.mockResolvedValue({
        href: 'http://169.254.169.254/latest/meta-data/',
        target: '',
        text: 'IMDS',
        isAjaxTrigger: false,
      });
      const args = createBaseArgs(page);

      await expect(handler.execute(args)).rejects.toThrow(JourneyError);
      expect(page.goto).not.toHaveBeenCalled();
    });

    it('blocks the fallback goto when DNS resolves to a private IP', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: 'a#link',
        confidenceScore: 90,
        reasoning: '',
      });
      const handler = makeHandler(deps);
      const page = createMockPage();
      page.url.mockReturnValue('https://example.com');
      page.evaluate.mockResolvedValue({
        href: 'https://rebind.example/page',
        target: '',
        text: 'Other',
        isAjaxTrigger: false,
      });
      lookupMock.mockResolvedValueOnce([{ address: '10.0.0.9', family: 4 }]);
      const args = createBaseArgs(page);

      await expect(handler.execute(args)).rejects.toThrow(JourneyError);
      expect(page.goto).not.toHaveBeenCalled();
    });

    it('blocks when the fallback goto redirects to an internal URL (30x)', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: 'a#link',
        confidenceScore: 90,
        reasoning: '',
      });
      const handler = makeHandler(deps);
      const page = createMockPage();
      // href is public & same-origin (URL stays unchanged → triggers fallback
      // goto). After goto resolves, the page lands on an internal URL.
      let landedInternal = false;
      page.url.mockImplementation(() =>
        landedInternal ? 'http://127.0.0.1:8080/admin' : 'https://example.com',
      );
      page.goto.mockImplementationOnce(async () => {
        landedInternal = true;
        return undefined;
      });
      page.evaluate.mockResolvedValue({
        href: '/other-page',
        target: '',
        text: 'Other',
        isAjaxTrigger: false,
      });
      const args = createBaseArgs(page);

      await expect(handler.execute(args)).rejects.toThrow(JourneyError);
      expect(page.goto).toHaveBeenCalled();
    });
  });

  describe('agentic retry', () => {
    it('attempts agentic retry when AI returns null', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: '#btn',
        confidenceScore: 90,
        reasoning: '',
        waitForNavigation: true,
      });
      deps.actionParser.replanAfterNoEffect.mockResolvedValueOnce(null);
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      page.url.mockReturnValue('https://example.com');
      page.evaluate.mockResolvedValue({
        href: '',
        target: '',
        text: '',
        isAjaxTrigger: false,
      });
      const args = createBaseArgs(page, {
        actionStr: 'naviguer vers la page contact',
      });

      await handler.execute(args);

      expect(deps.actionParser.replanAfterNoEffect).toHaveBeenCalled();
      expect(deps.browserService.waitForPageReady).toHaveBeenCalled();
    }, 20000);
  });

  describe('action error + waitForNavigation', () => {
    it('throws when action fails and navigation expected, with navigable href fallback fails', async () => {
      const deps = createMockDeps();
      deps.actionParser.parse.mockResolvedValueOnce({
        type: 'click',
        selector: '#btn',
        confidenceScore: 90,
        reasoning: '',
        waitForNavigation: true,
      });
      deps.actionExecutor.execute.mockRejectedValueOnce(
        new Error('click intercepted'),
      );
      const handler = new ActionExecutionHandler(
        deps.browserService as never,
        deps.actionExecutor as never,
        deps.actionParser as never,
        deps.cookieBanner as never,
      );
      const page = createMockPage();
      page.url.mockReturnValue('https://example.com');
      // Return a navigable href so it tries goto which we make fail
      page.evaluate.mockResolvedValue({
        href: '/other',
        target: '',
        text: '',
        isAjaxTrigger: false,
      });
      page.goto.mockRejectedValueOnce(new Error('goto failed'));
      const args = createBaseArgs(page);

      await expect(handler.execute(args)).rejects.toThrow(JourneyError);
    }, 20000);
  });
});

describe('ActionExecutionHandler — action error + waitForNavigation, no navigable href', () => {
  it('throws ACTION_EXECUTION when action fails, nav expected, href not navigable', async () => {
    const deps = createMockDeps();
    deps.actionParser.parse.mockResolvedValueOnce({
      type: 'click',
      selector: '#btn',
      confidenceScore: 90,
      reasoning: '',
      waitForNavigation: true,
    });
    deps.actionExecutor.execute.mockRejectedValueOnce(
      new Error('click intercepted'),
    );
    const handler = makeHandler(deps);
    const page = createMockPage();
    page.isClosed.mockReturnValue(true);
    page.url.mockReturnValue('https://example.com');
    // href empty → not navigable → reaches the actionError + waitForNavigation throw
    page.evaluate.mockResolvedValue({
      href: '',
      target: '',
      text: '',
      isAjaxTrigger: false,
    });
    const args = createBaseArgs(page);

    try {
      await handler.execute(args);
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(JourneyError);
      expect((err as JourneyError).type).toBe('ACTION_EXECUTION');
    }
  }, 20000);
});

describe('ActionExecutionHandler — agentic retry with corrective plan', () => {
  it('executes the AI corrective plan and returns (retried=true)', async () => {
    const deps = createMockDeps();
    deps.actionParser.parse.mockResolvedValueOnce({
      type: 'click',
      selector: '#parent-menu',
      confidenceScore: 90,
      reasoning: '',
    });
    // AI proposes a corrective click on the leaf
    deps.actionParser.replanAfterNoEffect.mockResolvedValueOnce({
      type: 'click',
      selector: '#leaf-item',
      confidenceScore: 88,
      reasoning: 'click the leaf',
    });
    const handler = makeHandler(deps);
    const page = createMockPage();
    page.isClosed.mockReturnValue(true);
    // URL never changes → triggers retry path; actionStr implies navigation
    page.url.mockReturnValue('https://example.com');
    page.evaluate.mockResolvedValue({
      href: '',
      target: '',
      text: '',
      isAjaxTrigger: false,
    });
    const args = createBaseArgs(page, {
      actionStr: 'naviguer vers la page Contact',
    });

    await handler.execute(args);

    expect(deps.actionParser.replanAfterNoEffect).toHaveBeenCalled();
    // The corrective plan re-invokes the executor (2 executions total)
    expect(deps.actionExecutor.execute).toHaveBeenCalledTimes(2);
    expect(deps.actionExecutor.execute).toHaveBeenLastCalledWith(
      page,
      expect.objectContaining({ type: 'click' }),
      '#leaf-item',
      expect.anything(),
    );
  }, 20000);
});

describe('ActionExecutionHandler — AJAX trigger with URL change after XHR', () => {
  it('confirms navigation when URL changes after the AJAX network idle', async () => {
    const deps = createMockDeps();
    deps.actionParser.parse.mockResolvedValueOnce({
      type: 'click',
      selector: '#ajax',
      confidenceScore: 90,
      reasoning: '',
    });
    const handler = makeHandler(deps);
    const page = createMockPage();
    page.isClosed.mockReturnValue(true);
    page.evaluate.mockResolvedValue({
      href: '',
      target: '',
      text: 'Load',
      isAjaxTrigger: true,
    });
    // URL stays constant through the immediate waitForUrlChange (so the AJAX
    // branch is taken), and only flips once waitForNetworkIdle has run.
    let ajaxDone = false;
    page.waitForNetworkIdle.mockImplementation(async () => {
      ajaxDone = true;
    });
    page.url.mockImplementation(() =>
      ajaxDone ? 'https://example.com/after-ajax' : 'https://example.com',
    );
    const args = createBaseArgs(page);

    await handler.execute(args);

    expect(page.waitForNetworkIdle).toHaveBeenCalled();
    expect(deps.browserService.waitForPageReady).toHaveBeenCalled();
  }, 20000);
});

describe('ActionExecutionHandler — prepareClick browser-side callback', () => {
  it('runs the prepareClick evaluate callback (rewrites _blank → _self, reads href)', async () => {
    const deps = createMockDeps();
    deps.actionParser.parse.mockResolvedValueOnce({
      type: 'click',
      selector: 'a#link',
      confidenceScore: 90,
      reasoning: '',
    });
    const handler = makeHandler(deps);
    const page = createMockPage();
    page.isClosed.mockReturnValue(true);
    page.url.mockReturnValue('https://example.com');

    // Fake element with attribute map exercised by the real callback
    const attrs: Record<string, string> = {
      target: '_blank',
      href: '/other',
      'data-ajax-code': '',
    };
    const fakeEl = {
      getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
      setAttribute: (n: string, v: string) => {
        attrs[n] = v;
      },
      hasAttribute: (n: string) => n in attrs,
      textContent: '  Other  Link  ',
    };
    vi.stubGlobal('document', {
      querySelector: (_sel: string) => fakeEl,
    });
    // page.evaluate executes the callback against the fake document
    page.evaluate.mockImplementation(async (fn: unknown, ...a: unknown[]) =>
      typeof fn === 'function'
        ? (fn as (...x: unknown[]) => unknown)(...a)
        : undefined,
    );
    // goto succeeds (href navigable, URL unchanged → fallback goto)
    const args = createBaseArgs(page);

    await handler.execute(args);

    // _blank was rewritten to _self by the callback
    expect(attrs['target']).toBe('_self');
    // isAjaxTrigger=true (data-ajax-code present) → AJAX path taken
    expect(page.waitForNetworkIdle).toHaveBeenCalled();
  }, 20000);

  it('prepareClick returns empty info when querySelector finds nothing', async () => {
    const deps = createMockDeps();
    deps.actionParser.parse.mockResolvedValueOnce({
      type: 'click',
      selector: '#missing',
      confidenceScore: 90,
      reasoning: '',
    });
    const handler = makeHandler(deps);
    const page = createMockPage();
    page.isClosed.mockReturnValue(true);
    page.url.mockReturnValue('https://example.com');
    vi.stubGlobal('document', { querySelector: () => null });
    page.evaluate.mockImplementation(async (fn: unknown, ...a: unknown[]) =>
      typeof fn === 'function'
        ? (fn as (...x: unknown[]) => unknown)(...a)
        : undefined,
    );
    const execContext = createContext();
    const args = createBaseArgs(page, { execContext });

    await handler.execute(args);

    // No href/ajax → DOM-local, added to menu chain
    expect(execContext.menuTriggerChain).toContain('#missing');
  }, 20000);

  it('prepareClick swallows evaluate errors and returns empty info', async () => {
    const deps = createMockDeps();
    deps.actionParser.parse.mockResolvedValueOnce({
      type: 'click',
      selector: '#err',
      confidenceScore: 90,
      reasoning: '',
    });
    const handler = makeHandler(deps);
    const page = createMockPage();
    page.isClosed.mockReturnValue(true);
    page.url.mockReturnValue('https://example.com');
    page.evaluate.mockRejectedValueOnce(new Error('evaluate failed'));
    const execContext = createContext();
    const args = createBaseArgs(page, { execContext });

    await handler.execute(args);

    expect(execContext.menuTriggerChain).toContain('#err');
  }, 20000);
});
