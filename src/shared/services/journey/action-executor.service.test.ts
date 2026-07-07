import path from 'node:path';

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock DNS so navigate's anti-rebinding lookup never hits the network.
// Default: any hostname resolves to a public IP.
const lookupMock = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import {
  ActionExecutorService,
  type ExecutionContext,
  type ExecutorStep,
} from './action-executor.service.js';
import { JourneyError } from './journey-error.util.js';

function createMockPage() {
  const el = {
    click: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    scrollIntoView: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    contentFrame: vi.fn().mockResolvedValue(null),
    uploadFile: vi.fn().mockResolvedValue(undefined),
  };
  const page = {
    waitForSelector: vi.fn().mockResolvedValue(el),
    $$: vi.fn().mockResolvedValue([el]),
    select: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    hover: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    url: vi.fn().mockReturnValue('https://example.com'),
  };
  return { page, el };
}

function createContext(): ExecutionContext {
  return { currentFrame: null, menuTriggerChain: [] };
}

/**
 * Builds an element handle whose `evaluate(fn, ...args)` actually executes the
 * callback against a fake DOM node so the inner browser-side code is covered.
 */
function elWithRealEvaluate(node: unknown) {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    scrollIntoView: vi.fn().mockResolvedValue(undefined),
    contentFrame: vi.fn().mockResolvedValue(null),
    uploadFile: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) =>
      typeof fn === 'function'
        ? (fn as (...a: unknown[]) => unknown)(node, ...args)
        : undefined,
    ),
  };
}

function pageWith(el: unknown) {
  return {
    waitForSelector: vi.fn().mockResolvedValue(el),
    $$: vi.fn().mockResolvedValue([el]),
    select: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn().mockResolvedValue(undefined),
    goForward: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) =>
      typeof fn === 'function'
        ? (fn as (...a: unknown[]) => unknown)(...args)
        : undefined,
    ),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    hover: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    url: vi.fn().mockReturnValue('https://example.com'),
  };
}

/** Minimal fake DOM constructors stubbed onto globals during a test. */
function stubDomGlobals(bodyNode: unknown) {
  class FakeMouseEvent {
    type: string;
    init: unknown;
    constructor(type: string, init: unknown) {
      this.type = type;
      this.init = init;
    }
  }
  vi.stubGlobal('MouseEvent', FakeMouseEvent);
  vi.stubGlobal('Event', class FakeEvent {});
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { body: bodyNode });
}

describe('ActionExecutorService', () => {
  const service = new ActionExecutorService();

  describe('execute — click', () => {
    it('clicks on the element', async () => {
      const { page, el } = createMockPage();
      const step: ExecutorStep = { type: 'click' };
      await service.execute(page as never, step, '#btn', createContext());
      expect(page.waitForSelector).toHaveBeenCalledWith('#btn', {
        timeout: 5000,
      });
      expect(el.click).toHaveBeenCalled();
    });

    it('throws when selector is missing', async () => {
      const { page } = createMockPage();
      await expect(
        service.execute(
          page as never,
          { type: 'click' },
          null,
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });

    it('falls back to DOM click when native click fails', async () => {
      const { page, el } = createMockPage();
      el.click.mockRejectedValueOnce(new Error('intercepted'));
      el.evaluate.mockResolvedValueOnce(undefined);
      await service.execute(
        page as never,
        { type: 'click' },
        '#btn',
        createContext(),
      );
      expect(el.evaluate).toHaveBeenCalled();
    });
  });

  describe('execute — doubleClick', () => {
    it('double clicks on the element', async () => {
      const { page, el } = createMockPage();
      await service.execute(
        page as never,
        { type: 'doubleClick' },
        '#btn',
        createContext(),
      );
      expect(el.click).toHaveBeenCalledWith({ count: 2 });
    });

    it('falls back to DOM click on failure', async () => {
      const { page, el } = createMockPage();
      el.click.mockRejectedValueOnce(new Error('fail'));
      el.evaluate.mockResolvedValueOnce(undefined);
      await service.execute(
        page as never,
        { type: 'doubleClick' },
        '#btn',
        createContext(),
      );
      expect(el.evaluate).toHaveBeenCalled();
    });
  });

  describe('execute — rightClick', () => {
    it('right clicks on the element', async () => {
      const { page, el } = createMockPage();
      await service.execute(
        page as never,
        { type: 'rightClick' },
        '#btn',
        createContext(),
      );
      expect(el.click).toHaveBeenCalledWith({ button: 'right' });
    });

    it('falls back to DOM click on failure', async () => {
      const { page, el } = createMockPage();
      el.click.mockRejectedValueOnce(new Error('fail'));
      el.evaluate.mockResolvedValueOnce(undefined);
      await service.execute(
        page as never,
        { type: 'rightClick' },
        '#btn',
        createContext(),
      );
      expect(el.evaluate).toHaveBeenCalled();
    });
  });

  describe('execute — hover', () => {
    it('hovers over the element', async () => {
      const { page, el } = createMockPage();
      await service.execute(
        page as never,
        { type: 'hover' },
        '#btn',
        createContext(),
      );
      expect(el.hover).toHaveBeenCalled();
    });

    it('falls back to DOM hover on failure', async () => {
      const { page, el } = createMockPage();
      el.hover.mockRejectedValueOnce(new Error('fail'));
      el.evaluate.mockResolvedValueOnce(undefined);
      await service.execute(
        page as never,
        { type: 'hover' },
        '#btn',
        createContext(),
      );
      expect(el.evaluate).toHaveBeenCalled();
    });
  });

  describe('execute — type', () => {
    it('types text into the element', async () => {
      const { page, el } = createMockPage();
      await service.execute(
        page as never,
        { type: 'type', value: 'hello' },
        '#input',
        createContext(),
      );
      expect(el.focus).toHaveBeenCalled();
      expect(el.type).toHaveBeenCalledWith('hello', { delay: 30 });
    });

    it('uses empty string when value is undefined', async () => {
      const { page, el } = createMockPage();
      await service.execute(
        page as never,
        { type: 'type' },
        '#input',
        createContext(),
      );
      expect(el.type).toHaveBeenCalledWith('', { delay: 30 });
    });
  });

  describe('execute — clear', () => {
    it('clears the element', async () => {
      const { page, el } = createMockPage();
      await service.execute(
        page as never,
        { type: 'clear' },
        '#input',
        createContext(),
      );
      expect(el.focus).toHaveBeenCalled();
      expect(el.evaluate).toHaveBeenCalled();
    });
  });

  describe('execute — pressKey', () => {
    it('presses the specified key', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'pressKey', value: 'Enter' },
        null,
        createContext(),
      );
      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
    });
  });

  describe('execute — uploadFile', () => {
    it('uploads file to input element (relative path resolved under cwd)', async () => {
      const { page, el } = createMockPage();
      await service.execute(
        page as never,
        { type: 'uploadFile', value: 'fixtures/file.txt' },
        '#file',
        createContext(),
      );
      // path.resolve normalises separators per-OS (\ on Windows, / on POSIX),
      // matching the production code's path.resolve(baseDir, filePath).
      expect(el.uploadFile).toHaveBeenCalledWith(
        path.resolve(process.cwd(), 'fixtures/file.txt'),
      );
    });

    it('rejects absolute paths (arbitrary file read)', async () => {
      const { page, el } = createMockPage();
      await expect(
        service.execute(
          page as never,
          { type: 'uploadFile', value: '/etc/passwd' },
          '#file',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
      expect(el.uploadFile).not.toHaveBeenCalled();
    });

    it('rejects paths containing ".." (traversal)', async () => {
      const { page, el } = createMockPage();
      await expect(
        service.execute(
          page as never,
          { type: 'uploadFile', value: '../../etc/passwd' },
          '#file',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
      expect(el.uploadFile).not.toHaveBeenCalled();
    });

    it('rejects empty path', async () => {
      const { page } = createMockPage();
      await expect(
        service.execute(
          page as never,
          { type: 'uploadFile', value: '   ' },
          '#file',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });

    it('throws when value is missing', async () => {
      const { page } = createMockPage();
      await expect(
        service.execute(
          page as never,
          { type: 'uploadFile' },
          '#file',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });

    it('throws when element has no uploadFile method', async () => {
      const { page } = createMockPage();
      const noUploadEl = {
        click: vi.fn(),
        hover: vi.fn(),
        scrollIntoView: vi.fn(),
      };
      page.waitForSelector.mockResolvedValueOnce(noUploadEl);
      await expect(
        service.execute(
          page as never,
          { type: 'uploadFile', value: '/tmp/f.txt' },
          '#f',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });
  });

  describe('execute — select', () => {
    it('selects an option', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'select', value: 'opt1' },
        '#sel',
        createContext(),
      );
      expect(page.select).toHaveBeenCalledWith('#sel', 'opt1');
    });

    it('throws when value is missing', async () => {
      const { page } = createMockPage();
      await expect(
        service.execute(
          page as never,
          { type: 'select' },
          '#sel',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });
  });

  describe('execute — check', () => {
    it('clicks unchecked checkbox', async () => {
      const { page, el } = createMockPage();
      el.evaluate.mockResolvedValueOnce(false); // not checked
      await service.execute(
        page as never,
        { type: 'check' },
        '#cb',
        createContext(),
      );
      expect(el.click).toHaveBeenCalled();
    });

    it('skips already checked checkbox', async () => {
      const { page, el } = createMockPage();
      el.evaluate.mockResolvedValueOnce(true); // already checked
      await service.execute(
        page as never,
        { type: 'check' },
        '#cb',
        createContext(),
      );
      expect(el.click).not.toHaveBeenCalled();
    });

    it('throws for non-checkbox element', async () => {
      const { page, el } = createMockPage();
      el.evaluate.mockResolvedValueOnce(null); // not a checkbox
      await expect(
        service.execute(
          page as never,
          { type: 'check' },
          '#div',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });
  });

  describe('execute — uncheck', () => {
    it('clicks checked checkbox', async () => {
      const { page, el } = createMockPage();
      el.evaluate.mockResolvedValueOnce(true); // checked
      await service.execute(
        page as never,
        { type: 'uncheck' },
        '#cb',
        createContext(),
      );
      expect(el.click).toHaveBeenCalled();
    });

    it('skips already unchecked checkbox', async () => {
      const { page, el } = createMockPage();
      el.evaluate.mockResolvedValueOnce(false); // not checked
      await service.execute(
        page as never,
        { type: 'uncheck' },
        '#cb',
        createContext(),
      );
      expect(el.click).not.toHaveBeenCalled();
    });

    it('throws for non-checkbox element', async () => {
      const { page, el } = createMockPage();
      el.evaluate.mockResolvedValueOnce(null); // not a checkbox
      await expect(
        service.execute(
          page as never,
          { type: 'uncheck' },
          '#div',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });
  });

  describe('execute — navigate', () => {
    it('navigates to URL', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'navigate', value: 'https://example.com' },
        null,
        createContext(),
      );
      expect(page.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
    });

    it('throws when value missing', async () => {
      const { page } = createMockPage();
      await expect(
        service.execute(
          page as never,
          { type: 'navigate' },
          null,
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });

    it('blocks navigation to an internal URL (SSRF) before page.goto', async () => {
      const { page } = createMockPage();
      try {
        await service.execute(
          page as never,
          { type: 'navigate', value: 'http://169.254.169.254/latest/' },
          null,
          createContext(),
        );
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(JourneyError);
        expect((err as JourneyError).type).toBe('NAVIGATION_BLOCK');
      }
      expect(page.goto).not.toHaveBeenCalled();
    });

    it('blocks navigation when DNS resolves to a private IP (rebinding)', async () => {
      const { page } = createMockPage();
      lookupMock.mockResolvedValueOnce([{ address: '10.1.2.3', family: 4 }]);
      await expect(
        service.execute(
          page as never,
          { type: 'navigate', value: 'http://rebind.example/' },
          null,
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
      expect(page.goto).not.toHaveBeenCalled();
    });

    it('blocks when navigation redirects to an internal URL (30x)', async () => {
      const { page } = createMockPage();
      // goto succeeds, but the page ends up on an internal URL.
      page.url.mockReturnValue('http://169.254.169.254/latest/meta-data/');
      await expect(
        service.execute(
          page as never,
          { type: 'navigate', value: 'https://example.com/' },
          null,
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
      expect(page.goto).toHaveBeenCalled();
    });
  });

  describe('execute — goBack', () => {
    it('goes back', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'goBack' },
        null,
        createContext(),
      );
      expect(page.goBack).toHaveBeenCalled();
    });
  });

  describe('execute — goForward', () => {
    it('goes forward', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'goForward' },
        null,
        createContext(),
      );
      expect(page.goForward).toHaveBeenCalled();
    });
  });

  describe('execute — reload', () => {
    it('reloads the page', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'reload' },
        null,
        createContext(),
      );
      expect(page.reload).toHaveBeenCalled();
    });
  });

  describe('execute — scrollTo', () => {
    it('scrolls element into view', async () => {
      const { page, el } = createMockPage();
      await service.execute(
        page as never,
        { type: 'scrollTo' },
        '#elem',
        createContext(),
      );
      expect(el.scrollIntoView).toHaveBeenCalled();
    });
  });

  describe('execute — scrollPage', () => {
    it('scrolls down by default', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'scrollPage' },
        null,
        createContext(),
      );
      expect(page.evaluate).toHaveBeenCalled();
    });

    it('scrolls up with direction', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'scrollPage', direction: 'up', pixels: 300 },
        null,
        createContext(),
      );
      expect(page.evaluate).toHaveBeenCalled();
    });
  });

  describe('execute — wait', () => {
    it('waits for the specified delay', async () => {
      const { page } = createMockPage();
      const start = Date.now();
      await service.execute(
        page as never,
        { type: 'wait', delayMs: 50 },
        null,
        createContext(),
      );
      expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    });

    it('defaults to 1000ms', async () => {
      const { page } = createMockPage();
      // Just verify it doesn't throw (we won't wait 1s in tests)
      const promise = service.execute(
        page as never,
        { type: 'wait', delayMs: 10 },
        null,
        createContext(),
      );
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('execute — waitForSelector', () => {
    it('waits for selector to appear', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'waitForSelector' },
        '#elem',
        createContext(),
      );
      expect(page.waitForSelector).toHaveBeenCalledWith('#elem', {
        timeout: 15000,
        visible: true,
      });
    });
  });

  describe('execute — waitForNavigation', () => {
    it('waits for navigation', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'waitForNavigation' },
        null,
        createContext(),
      );
      expect(page.waitForNavigation).toHaveBeenCalled();
    });
  });

  describe('execute — switchToFrame', () => {
    it('switches to iframe', async () => {
      const { page, el } = createMockPage();
      const mockFrame = { name: vi.fn() };
      el.contentFrame.mockResolvedValueOnce(mockFrame);
      const ctx = createContext();
      await service.execute(
        page as never,
        { type: 'switchToFrame' },
        'iframe',
        ctx,
      );
      expect(ctx.currentFrame).toBe(mockFrame);
    });

    it('throws when contentFrame returns null', async () => {
      const { page, el } = createMockPage();
      el.contentFrame.mockResolvedValueOnce(null);
      await expect(
        service.execute(
          page as never,
          { type: 'switchToFrame' },
          'iframe',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });
  });

  describe('execute — switchToMainFrame', () => {
    it('resets current frame to null', async () => {
      const { page } = createMockPage();
      const ctx = createContext();
      ctx.currentFrame = {} as never;
      await service.execute(
        page as never,
        { type: 'switchToMainFrame' },
        null,
        ctx,
      );
      expect(ctx.currentFrame).toBeNull();
    });
  });

  describe('execute — dismissDialog', () => {
    it('waits briefly for dialog handling', async () => {
      const { page } = createMockPage();
      await service.execute(
        page as never,
        { type: 'dismissDialog' },
        null,
        createContext(),
      );
      expect(page.isClosed).toHaveBeenCalled();
    });

    it('throws when page is closed', async () => {
      const { page } = createMockPage();
      page.isClosed.mockReturnValue(true);
      await expect(
        service.execute(
          page as never,
          { type: 'dismissDialog' },
          null,
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });
  });

  describe('execute — with frame context', () => {
    it('uses currentFrame when set', async () => {
      const { page } = createMockPage();
      const frameEl = {
        click: vi.fn().mockResolvedValue(undefined),
        hover: vi.fn().mockResolvedValue(undefined),
        scrollIntoView: vi.fn().mockResolvedValue(undefined),
      };
      const frame = {
        waitForSelector: vi.fn().mockResolvedValue(frameEl),
      };
      const ctx: ExecutionContext = {
        currentFrame: frame as never,
        menuTriggerChain: [],
      };
      await service.execute(page as never, { type: 'click' }, '#btn', ctx);
      expect(frame.waitForSelector).toHaveBeenCalledWith('#btn', {
        timeout: 5000,
      });
    });
  });

  describe('error wrapping', () => {
    it('wraps generic errors into JourneyError', async () => {
      const { page } = createMockPage();
      page.waitForSelector.mockRejectedValueOnce(new Error('timeout'));
      try {
        await service.execute(
          page as never,
          { type: 'click' },
          '#btn',
          createContext(),
        );
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(JourneyError);
        expect((err as JourneyError).type).toBe('ACTION_EXECUTION');
      }
    });

    it('passes through JourneyError as-is', async () => {
      const { page } = createMockPage();
      const original = new JourneyError('AI_SELECTOR_NOT_FOUND', 'not found');
      page.waitForSelector.mockRejectedValueOnce(original);
      try {
        await service.execute(
          page as never,
          { type: 'click' },
          '#btn',
          createContext(),
        );
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBe(original);
      }
    });
  });

  describe('fallback DOM click — context destroyed', () => {
    it('ignores context destroyed errors during DOM click', async () => {
      const { page, el } = createMockPage();
      el.click.mockRejectedValueOnce(new Error('not visible'));
      el.evaluate.mockRejectedValueOnce(
        new Error('Execution context was destroyed'),
      );
      // Should not throw because context destruction means navigation happened
      await service.execute(
        page as never,
        { type: 'click' },
        '#btn',
        createContext(),
      );
    });

    it('throws when both native and DOM click fail with non-context error', async () => {
      const { page, el } = createMockPage();
      el.click.mockRejectedValueOnce(new Error('not visible'));
      el.evaluate.mockRejectedValueOnce(new Error('totally broken'));
      await expect(
        service.execute(
          page as never,
          { type: 'click' },
          '#btn',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });
  });

  describe('fallback DOM hover', () => {
    it('throws when both native and DOM hover fail', async () => {
      const { page, el } = createMockPage();
      el.hover.mockRejectedValueOnce(new Error('not visible'));
      el.evaluate.mockRejectedValueOnce(new Error('DOM hover failed'));
      await expect(
        service.execute(
          page as never,
          { type: 'hover' },
          '#btn',
          createContext(),
        ),
      ).rejects.toThrow(JourneyError);
    });
  });

  describe('scrollIntoView failure is tolerated', () => {
    it('continues even if scrollIntoView fails', async () => {
      const { page, el } = createMockPage();
      el.scrollIntoView.mockRejectedValueOnce(new Error('hidden'));
      await service.execute(
        page as never,
        { type: 'click' },
        '#btn',
        createContext(),
      );
      expect(el.click).toHaveBeenCalled();
    });
  });

  describe('preHover failure is tolerated', () => {
    it('continues even if pre-hover fails', async () => {
      const { page, el } = createMockPage();
      el.hover.mockRejectedValueOnce(new Error('not hoverable'));
      // click should still work
      await service.execute(
        page as never,
        { type: 'click' },
        '#btn',
        createContext(),
      );
      expect(el.click).toHaveBeenCalled();
    });
  });
});

const service = new ActionExecutorService();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fallbackDomClick — browser-side callback execution', () => {
  it('runs the DOM click branch (click) on an HTMLElement', async () => {
    const dispatched: string[] = [];
    class HTMLElementCls {
      getBoundingClientRect() {
        return { left: 10, top: 20, width: 100, height: 40 };
      }
      dispatchEvent(e: { type: string }) {
        dispatched.push(e.type);
        return true;
      }
      click = vi.fn();
    }
    vi.stubGlobal('HTMLElement', HTMLElementCls);
    stubDomGlobals(null);
    const node = new HTMLElementCls();
    const el = elWithRealEvaluate(node);
    el.click.mockRejectedValueOnce(new Error('intercepted'));
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'click' },
      '#btn',
      createContext(),
    );

    expect(dispatched).toEqual(['mouseover', 'mousedown', 'mouseup']);
    expect(node.click).toHaveBeenCalled();
  });

  it('runs the doubleClick DOM branch (two clicks + dblclick)', async () => {
    const dispatched: string[] = [];
    class HTMLElementCls {
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 0, height: 0 };
      }
      dispatchEvent(e: { type: string }) {
        dispatched.push(e.type);
        return true;
      }
      click = vi.fn();
    }
    vi.stubGlobal('HTMLElement', HTMLElementCls);
    stubDomGlobals(null);
    const node = new HTMLElementCls();
    const el = elWithRealEvaluate(node);
    el.click.mockRejectedValueOnce(new Error('fail'));
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'doubleClick' },
      '#btn',
      createContext(),
    );

    expect(dispatched).toContain('dblclick');
    expect(dispatched.filter((t) => t === 'click').length).toBe(2);
  });

  it('runs the rightClick DOM branch (contextmenu)', async () => {
    const dispatched: string[] = [];
    class HTMLElementCls {
      getBoundingClientRect() {
        return { left: 5, top: 5, width: 50, height: 50 };
      }
      dispatchEvent(e: { type: string }) {
        dispatched.push(e.type);
        return true;
      }
      click = vi.fn();
    }
    vi.stubGlobal('HTMLElement', HTMLElementCls);
    stubDomGlobals(null);
    const node = new HTMLElementCls();
    const el = elWithRealEvaluate(node);
    el.click.mockRejectedValueOnce(new Error('fail'));
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'rightClick' },
      '#btn',
      createContext(),
    );

    expect(dispatched).toContain('contextmenu');
  });

  it('throws inside callback when node is not an HTMLElement (DOM click impossible)', async () => {
    // node is a plain object, not instanceof HTMLElement → inner throw
    vi.stubGlobal('HTMLElement', class {});
    stubDomGlobals(null);
    const el = elWithRealEvaluate({});
    el.click.mockRejectedValueOnce(new Error('native fail'));
    const page = pageWith(el);

    await expect(
      service.execute(
        page as never,
        { type: 'click' },
        '#btn',
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });
});

describe('fallbackDomHover — browser-side callback execution', () => {
  it('runs the DOM hover branch walking ancestors up to body', async () => {
    const dispatched: string[] = [];
    class HTMLElementCls {
      parentElement: HTMLElementCls | null = null;
      getBoundingClientRect() {
        return { left: 1, top: 1, width: 10, height: 10 };
      }
      dispatchEvent(e: { type: string }) {
        dispatched.push(e.type);
        return true;
      }
    }
    vi.stubGlobal('HTMLElement', HTMLElementCls);
    const body = new HTMLElementCls();
    const parent = new HTMLElementCls();
    const node = new HTMLElementCls();
    node.parentElement = parent;
    parent.parentElement = body;
    stubDomGlobals(body);
    const el = elWithRealEvaluate(node);
    el.hover.mockRejectedValueOnce(new Error('not hoverable'));
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'hover' },
      '#m',
      createContext(),
    );

    expect(dispatched).toContain('mouseover');
    expect(dispatched).toContain('mousemove');
    // mouseenter dispatched on node + parent (stops at body)
    expect(dispatched.filter((t) => t === 'mouseenter').length).toBe(2);
  });

  it('throws inside hover callback when node is not an HTMLElement', async () => {
    vi.stubGlobal('HTMLElement', class {});
    stubDomGlobals(null);
    const el = elWithRealEvaluate({});
    el.hover.mockRejectedValueOnce(new Error('native hover fail'));
    const page = pageWith(el);

    await expect(
      service.execute(page as never, { type: 'hover' }, '#m', createContext()),
    ).rejects.toThrow(JourneyError);
  });
});

describe('clear — browser-side callback', () => {
  it('clears input value and dispatches input/change events', async () => {
    const events: string[] = [];
    class HTMLInputElementCls {
      value = 'old';
      dispatchEvent(e: { type?: string }) {
        events.push(String(e.type ?? 'evt'));
        return true;
      }
    }
    vi.stubGlobal('HTMLInputElement', HTMLInputElementCls);
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal(
      'Event',
      class FakeEvent {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      },
    );
    vi.stubGlobal('document', {});
    const node = new HTMLInputElementCls();
    const el = elWithRealEvaluate(node);
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'clear' },
      '#i',
      createContext(),
    );

    expect(node.value).toBe('');
  });

  it('clears textContent for a non-input element', async () => {
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('Event', class {});
    const node = { textContent: 'hello' };
    const el = elWithRealEvaluate(node);
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'clear' },
      '#d',
      createContext(),
    );

    expect(node.textContent).toBe('');
  });
});

describe('check / uncheck — browser-side predicate callbacks', () => {
  it('check reads node.checked for a checkbox (already checked → no click)', async () => {
    class HTMLInputElementCls {
      type = 'checkbox';
      checked = true;
    }
    vi.stubGlobal('HTMLInputElement', HTMLInputElementCls);
    const node = new HTMLInputElementCls();
    const el = elWithRealEvaluate(node);
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'check' },
      '#cb',
      createContext(),
    );

    expect(el.click).not.toHaveBeenCalled();
  });

  it('check clicks when checkbox is unchecked', async () => {
    class HTMLInputElementCls {
      type = 'radio';
      checked = false;
    }
    vi.stubGlobal('HTMLInputElement', HTMLInputElementCls);
    const node = new HTMLInputElementCls();
    const el = elWithRealEvaluate(node);
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'check' },
      '#rb',
      createContext(),
    );

    expect(el.click).toHaveBeenCalled();
  });

  it('check returns null for a non-checkbox node → throws', async () => {
    vi.stubGlobal('HTMLInputElement', class {});
    const el = elWithRealEvaluate({ tagName: 'DIV' });
    const page = pageWith(el);

    await expect(
      service.execute(page as never, { type: 'check' }, '#d', createContext()),
    ).rejects.toThrow(JourneyError);
  });

  it('uncheck clicks when checkbox is checked', async () => {
    class HTMLInputElementCls {
      type = 'checkbox';
      checked = true;
    }
    vi.stubGlobal('HTMLInputElement', HTMLInputElementCls);
    const node = new HTMLInputElementCls();
    const el = elWithRealEvaluate(node);
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'uncheck' },
      '#cb',
      createContext(),
    );

    expect(el.click).toHaveBeenCalled();
  });

  it('uncheck returns null for non-checkbox (radio not applicable) → throws', async () => {
    class HTMLInputElementCls {
      type = 'radio';
      checked = true;
    }
    vi.stubGlobal('HTMLInputElement', HTMLInputElementCls);
    const node = new HTMLInputElementCls();
    const el = elWithRealEvaluate(node);
    const page = pageWith(el);

    await expect(
      service.execute(
        page as never,
        { type: 'uncheck' },
        '#rb',
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });
});

describe('scrollPage — browser-side callback', () => {
  it('calls window.scrollBy with positive delta when scrolling down', async () => {
    const scrollBy = vi.fn();
    vi.stubGlobal('window', { scrollBy });
    const el = elWithRealEvaluate({});
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'scrollPage', direction: 'down', pixels: 400 },
      null,
      createContext(),
    );

    expect(scrollBy).toHaveBeenCalledWith({ top: 400, behavior: 'instant' });
  });

  it('uses a negative delta when scrolling up', async () => {
    const scrollBy = vi.fn();
    vi.stubGlobal('window', { scrollBy });
    const el = elWithRealEvaluate({});
    const page = pageWith(el);

    await service.execute(
      page as never,
      { type: 'scrollPage', direction: 'up', pixels: 250 },
      null,
      createContext(),
    );

    expect(scrollBy).toHaveBeenCalledWith({ top: -250, behavior: 'instant' });
  });

  it('wraps scrollPage failure into JourneyError', async () => {
    const el = elWithRealEvaluate({});
    const page = pageWith(el);
    page.evaluate.mockRejectedValueOnce(new Error('eval boom'));

    await expect(
      service.execute(
        page as never,
        { type: 'scrollPage' },
        null,
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });
});

describe('navigation action error wrapping', () => {
  it.each([
    ['navigate', 'goto', { type: 'navigate', value: 'https://x.com' }],
    ['goBack', 'goBack', { type: 'goBack' }],
    ['goForward', 'goForward', { type: 'goForward' }],
    ['reload', 'reload', { type: 'reload' }],
  ] as const)(
    'wraps %s failure into JourneyError',
    async (_name, method, step) => {
      const el = elWithRealEvaluate({});
      const page = pageWith(el);
      (page as Record<string, ReturnType<typeof vi.fn>>)[
        method
      ].mockRejectedValueOnce(new Error('nav fail'));
      await expect(
        service.execute(page as never, step as never, null, createContext()),
      ).rejects.toThrow(JourneyError);
    },
  );
});

describe('pressKey / scrollTo / waitForSelector / waitForNavigation errors', () => {
  it('wraps pressKey failure', async () => {
    const el = elWithRealEvaluate({});
    const page = pageWith(el);
    page.keyboard.press.mockRejectedValueOnce(new Error('key fail'));
    await expect(
      service.execute(
        page as never,
        { type: 'pressKey', value: 'Enter' },
        null,
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });

  it('wraps scrollTo failure when element missing', async () => {
    const page = pageWith(elWithRealEvaluate({}));
    page.waitForSelector.mockResolvedValueOnce(null);
    await expect(
      service.execute(
        page as never,
        { type: 'scrollTo' },
        '#x',
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });

  it('wraps waitForSelector failure', async () => {
    const page = pageWith(elWithRealEvaluate({}));
    page.waitForSelector.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      service.execute(
        page as never,
        { type: 'waitForSelector' },
        '#x',
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });

  it('wraps waitForNavigation failure', async () => {
    const page = pageWith(elWithRealEvaluate({}));
    page.waitForNavigation.mockRejectedValueOnce(new Error('nav timeout'));
    await expect(
      service.execute(
        page as never,
        { type: 'waitForNavigation' },
        null,
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });

  it('wraps type failure when element missing', async () => {
    const page = pageWith(elWithRealEvaluate({}));
    page.waitForSelector.mockResolvedValueOnce(null);
    await expect(
      service.execute(
        page as never,
        { type: 'type', value: 'x' },
        '#i',
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });

  it('wraps select failure when element missing', async () => {
    const page = pageWith(elWithRealEvaluate({}));
    page.waitForSelector.mockResolvedValueOnce(null);
    await expect(
      service.execute(
        page as never,
        { type: 'select', value: 'o' },
        '#s',
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });
});

describe('switchToFrame', () => {
  it('throws JourneyError when iframe handle not found', async () => {
    const page = pageWith(elWithRealEvaluate({}));
    page.waitForSelector.mockResolvedValueOnce(null);
    await expect(
      service.execute(
        page as never,
        { type: 'switchToFrame' },
        'iframe',
        createContext(),
      ),
    ).rejects.toThrow(JourneyError);
  });

  it('wraps a generic waitForSelector error into ACTION_EXECUTION JourneyError', async () => {
    const page = pageWith(elWithRealEvaluate({}));
    page.waitForSelector.mockRejectedValueOnce(new Error('boom'));
    try {
      await service.execute(
        page as never,
        { type: 'switchToFrame' },
        'iframe',
        createContext(),
      );
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(JourneyError);
      expect((err as JourneyError).type).toBe('ACTION_EXECUTION');
    }
  });

  it('rethrows a JourneyError (cross-origin) unchanged', async () => {
    const handle = elWithRealEvaluate({});
    handle.contentFrame = vi.fn().mockResolvedValue(null);
    const page = pageWith(handle);
    page.waitForSelector.mockResolvedValueOnce(handle);
    try {
      await service.execute(
        page as never,
        { type: 'switchToFrame' },
        'iframe',
        createContext(),
      );
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(JourneyError);
      expect((err as JourneyError).type).toBe('ACTION_EXECUTION');
    }
  });
});

describe('element-not-found (!el) branches per action', () => {
  it.each([
    ['doubleClick', { type: 'doubleClick' }, '#x'],
    ['rightClick', { type: 'rightClick' }, '#x'],
    ['hover', { type: 'hover' }, '#x'],
    ['clear', { type: 'clear' }, '#x'],
    ['uploadFile', { type: 'uploadFile', value: 'f.txt' }, '#x'],
    ['check', { type: 'check' }, '#x'],
    ['uncheck', { type: 'uncheck' }, '#x'],
  ] as const)(
    'throws JourneyError when %s finds no element',
    async (_n, step, sel) => {
      const page = pageWith(elWithRealEvaluate({}));
      page.waitForSelector.mockResolvedValueOnce(null);
      await expect(
        service.execute(page as never, step as never, sel, createContext()),
      ).rejects.toThrow(JourneyError);
    },
  );
});

describe('unknown action type — exhaustive default', () => {
  it('throws UNKNOWN JourneyError for an unhandled type', async () => {
    const page = pageWith(elWithRealEvaluate({}));
    try {
      await service.execute(
        page as never,
        { type: 'totallyUnknown' } as never,
        null,
        createContext(),
      );
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(JourneyError);
      expect((err as JourneyError).type).toBe('UNKNOWN');
    }
  });
});
