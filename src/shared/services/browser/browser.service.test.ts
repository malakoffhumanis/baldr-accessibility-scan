import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'puppeteer';
import type {
  IFormAuthConfig,
  IADFSAuthConfig,
} from '@shared/types/auth.types.js';

// Use vi.hoisted so mock fns exist before vi.mock hoisting
const {
  mockAuthenticate,
  mockClearSessions,
  mockBrowserClose,
  mockBrowserNewPage,
  mockBrowserOn,
  mockLaunch,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockClearSessions: vi.fn(),
  mockBrowserClose: vi.fn(),
  mockBrowserNewPage: vi.fn(),
  mockBrowserOn: vi.fn(),
  mockLaunch: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../auth/auth.service.js', () => ({
  AuthService: function MockAuthService() {
    this.authenticate = mockAuthenticate;
    this.clearSessions = mockClearSessions;
  },
}));

vi.mock('puppeteer', () => ({
  default: { launch: mockLaunch },
  __esModule: true,
}));

import { BrowserService } from './browser.service';

// Page mock helpers
const mockPageFns = {
  setViewport: vi.fn().mockResolvedValue(undefined),
  setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
  setDefaultNavigationTimeout: vi.fn(),
  setDefaultTimeout: vi.fn(),
  on: vi.fn(),
  goto: vi.fn().mockResolvedValue(undefined),
  url: vi.fn().mockReturnValue('https://example.com'),
  title: vi.fn().mockResolvedValue('Test Page'),
  evaluate: vi.fn().mockResolvedValue('Mozilla/5.0'),
  viewport: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
  isClosed: vi.fn().mockReturnValue(false),
  close: vi.fn().mockResolvedValue(undefined),
  waitForFunction: vi.fn().mockResolvedValue(undefined),
};
const mockPage = mockPageFns as unknown as Page;

const formAuth: IFormAuthConfig = {
  type: 'form',
  loginUrl: 'https://example.com/login',
  email: 'u@e.com',
  password: 'p',
  selectors: { email: '#e', password: '#p', submit: '#s' },
};

const adfsAuth: IADFSAuthConfig = {
  type: 'adfs',
  loginUrl: 'https://adfs.example.com',
  username: 'u',
  password: 'p',
  email: 'u@e.com',
};

function setupBrowserMock(connected = true): void {
  const browser = {
    connected,
    newPage: mockBrowserNewPage.mockResolvedValue(mockPage),
    close: mockBrowserClose,
    on: mockBrowserOn,
  };
  mockLaunch.mockResolvedValue(browser);
}

describe('BrowserService', () => {
  let service: BrowserService;

  beforeEach(() => {
    vi.clearAllMocks();
    setupBrowserMock();
    mockAuthenticate.mockResolvedValue(true);
    mockPageFns.setViewport.mockResolvedValue(undefined);
    mockPageFns.setExtraHTTPHeaders.mockResolvedValue(undefined);
    mockPageFns.url.mockReturnValue('https://example.com');
    mockPageFns.title.mockResolvedValue('Test Page');
    mockPageFns.evaluate.mockResolvedValue('Mozilla/5.0');
    mockPageFns.viewport.mockReturnValue({ width: 1920, height: 1080 });
    mockPageFns.isClosed.mockReturnValue(false);
    mockPageFns.goto.mockResolvedValue(undefined);
    mockPageFns.close.mockResolvedValue(undefined);
    mockPageFns.waitForFunction.mockResolvedValue(undefined);
    mockBrowserClose.mockResolvedValue(undefined);
    service = new BrowserService();
  });

  describe('setAuthConfigs', () => {
    it('should store auth configurations', () => {
      service.setAuthConfigs({ myAuth: formAuth });
      expect(service.getStatus().hasAuthConfigs).toBe(true);
    });

    it('should handle empty configs', () => {
      service.setAuthConfigs({});
      expect(service.getStatus().hasAuthConfigs).toBe(false);
    });
  });

  describe('launch', () => {
    it('should launch a browser', async () => {
      const browser = await service.launch();
      expect(browser).toBeDefined();
      expect(mockBrowserOn).toHaveBeenCalledWith(
        'disconnected',
        expect.any(Function),
      );
    });

    it('should reuse connected browser', async () => {
      const b1 = await service.launch();
      const b2 = await service.launch();
      expect(b1).toBe(b2);
    });
  });

  describe('createPage', () => {
    it('should create page with default viewport', async () => {
      const page = await service.createPage({ url: 'https://example.com' });
      expect(page).toBeDefined();
      expect(mockPageFns.setViewport).toHaveBeenCalledWith({
        width: 1920,
        height: 1080,
      });
      expect(mockPageFns.setDefaultNavigationTimeout).toHaveBeenCalledWith(
        60000,
      );
    });

    it('should create page with custom viewport', async () => {
      await service.createPage({
        url: 'https://example.com',
        viewport: { width: 375, height: 812 },
      });
      expect(mockPageFns.setViewport).toHaveBeenCalledWith({
        width: 375,
        height: 812,
      });
    });
  });

  describe('navigateToUrl', () => {
    it('should navigate without auth', async () => {
      await service.navigateToUrl(mockPage, 'https://example.com');
      expect(mockPageFns.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'networkidle2',
        timeout: 30000,
      });
    });

    it('should throw when auth config missing', async () => {
      await expect(
        service.navigateToUrl(mockPage, 'https://example.com', {
          url: 'https://example.com',
          auth: 'unknown',
        }),
      ).rejects.toThrow("Auth configuration 'unknown' not found");
    });

    it('should authenticate with valid config', async () => {
      service.setAuthConfigs({ myAuth: formAuth });
      mockPageFns.url.mockReturnValue('https://example.com/dashboard');

      await service.navigateToUrl(mockPage, 'https://example.com', {
        url: 'https://example.com',
        auth: 'myAuth',
      });
      expect(mockAuthenticate).toHaveBeenCalled();
    });

    it('should throw when still on login page', async () => {
      service.setAuthConfigs({ myAuth: formAuth });
      mockPageFns.url.mockReturnValue('https://example.com/login');

      await expect(
        service.navigateToUrl(mockPage, 'https://example.com', {
          url: 'https://example.com',
          auth: 'myAuth',
        }),
      ).rejects.toThrow('Still on authentication page after login');
    });

    it('should detect adfs page after auth', async () => {
      service.setAuthConfigs({ myAuth: adfsAuth });
      mockPageFns.url.mockReturnValue('https://adfs.example.com/adfs/ls');

      await expect(
        service.navigateToUrl(mockPage, 'https://example.com', {
          url: 'https://example.com',
          auth: 'myAuth',
        }),
      ).rejects.toThrow('Still on authentication page after login');
    });

    it('should throw when auth fails', async () => {
      mockAuthenticate.mockResolvedValueOnce(false);
      service.setAuthConfigs({ myAuth: formAuth });

      await expect(
        service.navigateToUrl(mockPage, 'https://example.com', {
          url: 'https://example.com',
          auth: 'myAuth',
        }),
      ).rejects.toThrow("Authentication 'myAuth' failed");
    });

    it('should throw when navigation fails', async () => {
      mockPageFns.goto.mockRejectedValueOnce(new Error('timeout'));
      await expect(
        service.navigateToUrl(mockPage, 'https://broken.com'),
      ).rejects.toThrow('Failed to load URL');
    });
  });

  describe('waitForPageReady', () => {
    it('should wait for ready state', async () => {
      await service.waitForPageReady(mockPage);
      expect(mockPageFns.waitForFunction).toHaveBeenCalled();
    });

    it('should handle timeout gracefully', async () => {
      mockPageFns.waitForFunction.mockRejectedValueOnce(new Error('timeout'));
      await service.waitForPageReady(mockPage);
    });
  });

  describe('closePage', () => {
    it('should close open page', async () => {
      await service.createPage({ url: 'https://example.com' });
      await service.closePage(mockPage);
      expect(mockPageFns.close).toHaveBeenCalled();
    });

    it('should skip closed page', async () => {
      mockPageFns.isClosed.mockReturnValue(true);
      mockPageFns.close.mockClear();
      await service.closePage(mockPage);
      expect(mockPageFns.close).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('should close browser and reset', async () => {
      await service.launch();
      await service.close();
      expect(service.getStatus().activePagesCount).toBe(0);
      expect(mockClearSessions).toHaveBeenCalled();
    });

    it('should handle no browser', async () => {
      await service.close();
    });

    it('should handle close error', async () => {
      await service.launch();
      mockBrowserClose.mockRejectedValueOnce(new Error('err'));
      await service.close();
      expect(service.getStatus().activePagesCount).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('should return initial status', () => {
      const s = service.getStatus();
      expect(s.isRunning).toBe(false);
      expect(s.activePagesCount).toBe(0);
    });

    it('should reflect running after launch', async () => {
      await service.launch();
      expect(service.getStatus().isRunning).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Additional branch coverage
  // -------------------------------------------------------------------------
  describe('launch — reconnection & launch args', () => {
    it('closes and replaces a disconnected browser on relaunch', async () => {
      // First launch returns a disconnected browser
      const disconnected = {
        connected: false,
        newPage: mockBrowserNewPage,
        close: mockBrowserClose,
        on: mockBrowserOn,
      };
      const fresh = {
        connected: true,
        newPage: mockBrowserNewPage,
        close: mockBrowserClose,
        on: mockBrowserOn,
      };
      mockLaunch
        .mockResolvedValueOnce(disconnected)
        .mockResolvedValueOnce(fresh);

      const b1 = await service.launch();
      expect(b1).toBe(disconnected);

      // Relaunch: existing browser is disconnected -> cleanup path closes it
      const b2 = await service.launch();
      expect(mockBrowserClose).toHaveBeenCalled();
      expect(b2).toBe(fresh);
    });

    it('swallows errors when closing a disconnected browser', async () => {
      const disconnected = {
        connected: false,
        newPage: mockBrowserNewPage,
        close: mockBrowserClose,
        on: mockBrowserOn,
      };
      const fresh = {
        connected: true,
        newPage: mockBrowserNewPage,
        close: mockBrowserClose,
        on: mockBrowserOn,
      };
      mockLaunch
        .mockResolvedValueOnce(disconnected)
        .mockResolvedValueOnce(fresh);
      mockBrowserClose.mockRejectedValueOnce(new Error('close failed'));

      await service.launch();
      const b2 = await service.launch();
      expect(b2).toBe(fresh);
    });

    it('adds insecure flags when BALDR_ALLOW_INSECURE=true', async () => {
      const prev = process.env['BALDR_ALLOW_INSECURE'];
      process.env['BALDR_ALLOW_INSECURE'] = 'true';
      try {
        const svc = new BrowserService({
          browser: { headless: true },
          env: 'development',
        });
        await svc.launch();
        const args = mockLaunch.mock.calls[0][0].args as string[];
        expect(args).toContain('--disable-web-security');
        expect(args).toContain('--ignore-certificate-errors');
      } finally {
        if (prev === undefined) delete process.env['BALDR_ALLOW_INSECURE'];
        else process.env['BALDR_ALLOW_INSECURE'] = prev;
      }
    });

    it('IGNORES insecure flags in production even when BALDR_ALLOW_INSECURE=true', async () => {
      const prev = process.env['BALDR_ALLOW_INSECURE'];
      process.env['BALDR_ALLOW_INSECURE'] = 'true';
      try {
        const svc = new BrowserService({
          browser: { headless: true },
          env: 'production',
        });
        await svc.launch();
        const args = mockLaunch.mock.calls[0][0].args as string[];
        expect(args).not.toContain('--disable-web-security');
        expect(args).not.toContain('--ignore-certificate-errors');
      } finally {
        if (prev === undefined) delete process.env['BALDR_ALLOW_INSECURE'];
        else process.env['BALDR_ALLOW_INSECURE'] = prev;
      }
    });

    it('adds proxy-server flag when a proxy url is configured', async () => {
      const svc = new BrowserService({
        browser: { headless: true, proxy: { url: 'http://proxy:8080' } },
        env: 'development',
      });
      await svc.launch();
      const args = mockLaunch.mock.calls[0][0].args as string[];
      expect(args).toContain('--proxy-server=http://proxy:8080');
    });

    it('passes executablePath through to puppeteer when set', async () => {
      const svc = new BrowserService({
        browser: {
          headless: 'new' as never,
          executablePath: '/usr/bin/chrome',
        },
        env: 'production',
      });
      await svc.launch();
      const opts = mockLaunch.mock.calls[0][0] as Record<string, unknown>;
      expect(opts['executablePath']).toBe('/usr/bin/chrome');
    });

    it('resets state when the disconnected event handler fires', async () => {
      await service.launch();
      // Grab the registered 'disconnected' callback and invoke it
      const call = mockBrowserOn.mock.calls.find(
        (c) => c[0] === 'disconnected',
      );
      expect(call).toBeDefined();
      const handler = call![1] as () => void;
      handler();
      expect(service.getStatus().isRunning).toBe(false);
      expect(service.getStatus().activePagesCount).toBe(0);
    });
  });

  describe('createPage — dialog auto-accept', () => {
    it('registers a dialog handler that accepts dialogs', async () => {
      const accept = vi.fn().mockResolvedValue(undefined);
      await service.createPage({ url: 'https://example.com' });

      const dialogCall = mockPageFns.on.mock.calls.find(
        (c) => c[0] === 'dialog',
      );
      expect(dialogCall).toBeDefined();
      const handler = dialogCall![1] as (d: unknown) => void;
      handler({ type: () => 'alert', message: () => 'hi', accept });
      expect(accept).toHaveBeenCalled();
    });
  });

  describe('waitForPageReady — inner predicates', () => {
    it('evaluates the readyState and spinner predicates passed to waitForFunction', async () => {
      const predicates: (() => unknown)[] = [];
      mockPageFns.waitForFunction.mockImplementation((fn: () => unknown) => {
        predicates.push(fn);
        return Promise.resolve(undefined);
      });

      // Stub the browser globals the predicates rely on
      const g = globalThis as unknown as {
        document?: unknown;
        window?: unknown;
      };
      const prevDoc = g.document;
      const prevWin = g.window;
      g.document = {
        readyState: 'complete',
        querySelectorAll: () => [{}],
      };
      g.window = {
        getComputedStyle: () => ({ display: 'none' }),
      };

      try {
        await service.waitForPageReady(mockPage);
        expect(predicates.length).toBeGreaterThanOrEqual(2);
        // readyState predicate -> true
        expect(predicates[0]()).toBe(true);
        // spinner predicate -> every spinner hidden -> true
        expect(predicates[1]()).toBe(true);
      } finally {
        g.document = prevDoc;
        g.window = prevWin;
      }
    });

    it('logs a warning when the spinner wait rejects', async () => {
      // First waitForFunction (readyState) resolves, second (spinners) rejects
      mockPageFns.waitForFunction
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('spinner timeout'));

      await service.waitForPageReady(mockPage);
      // Reaching here without throwing means the .catch branch was taken
      expect(mockPageFns.waitForFunction).toHaveBeenCalledTimes(2);
    });
  });

  describe('closePage — error path', () => {
    it('swallows errors thrown while closing a page', async () => {
      mockPageFns.isClosed.mockReturnValue(false);
      mockPageFns.close.mockRejectedValueOnce(new Error('cannot close'));
      await expect(service.closePage(mockPage)).resolves.toBeUndefined();
    });
  });
});
