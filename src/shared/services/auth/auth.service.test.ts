import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page, BrowserContext } from 'puppeteer';

import { AuthService } from './auth.service.js';
import type { IAutoAuthConfig } from '@shared/types/auth.types.js';

const { mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  }),
}));

type MockFn = ReturnType<typeof vi.fn>;

const AUTO_CONFIG: IAutoAuthConfig = {
  type: 'auto',
  username: 'jdoe',
  password: 's3cret',
};

function createMockPage(overrides: Record<string, unknown> = {}): Page {
  const cookies = vi.fn().mockResolvedValue([]);
  const setCookie = vi.fn().mockResolvedValue(undefined);
  const browserCtx = { cookies, setCookie } as unknown as BrowserContext;

  return {
    browserContext: vi.fn().mockReturnValue(browserCtx),
    url: vi.fn().mockReturnValue('https://example.com'),
    goto: vi.fn().mockResolvedValue(undefined),
    authenticate: vi.fn().mockResolvedValue(undefined),
    // No login form by default → AutoAuthHandler returns success quickly.
    waitForSelector: vi.fn().mockRejectedValue(new Error('timeout')),
    $: vi.fn().mockResolvedValue(null),
    waitForNavigation: vi.fn().mockResolvedValue(undefined),
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as unknown as Page;
}

describe('AuthService', () => {
  let service: AuthService;
  let page: Page;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthService();
    page = createMockPage();
  });

  describe('authenticate()', () => {
    it('delegates to the auto strategy and answers native popups', async () => {
      const result = await service.authenticate(
        page,
        AUTO_CONFIG,
        'https://example.com',
        'test',
      );
      expect(result).toBe(true);
      expect(page.authenticate as MockFn).toHaveBeenCalledWith({
        username: 'jdoe',
        password: 's3cret',
      });
    });

    it('reuses cookies from a valid existing session (no re-auth)', async () => {
      const sessions = (
        service as unknown as { authSessions: Map<string, unknown> }
      ).authSessions;
      sessions.set('myAuth', {
        cookies: [
          { name: 'session', value: 'abc', domain: '.example.com', path: '/' },
        ],
        authenticated: true,
        timestamp: Date.now(),
      });

      const result = await service.authenticate(
        page,
        AUTO_CONFIG,
        'https://example.com',
        'myAuth',
      );

      expect(result).toBe(true);
      const ctx = (page.browserContext as MockFn)();
      expect(ctx.setCookie).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'session', domain: '.example.com' }),
      );
      // Reused → the strategy never ran (no native auth call).
      expect(page.authenticate as MockFn).not.toHaveBeenCalled();
    });

    it('re-authenticates when the session is expired', async () => {
      const sessions = (
        service as unknown as { authSessions: Map<string, unknown> }
      ).authSessions;
      sessions.set('expiredAuth', {
        cookies: [
          { name: 'old', value: 'c', domain: '.example.com', path: '/' },
        ],
        authenticated: true,
        timestamp: Date.now() - 31 * 60 * 1000,
      });

      await service.authenticate(
        page,
        AUTO_CONFIG,
        'https://example.com',
        'expiredAuth',
      );

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        expect.objectContaining({ authName: 'expiredAuth' }),
        'Session expired, re-authenticating',
      );
    });

    it('re-authenticates when cookie reuse throws', async () => {
      const failPage = createMockPage();
      const ctx = (failPage.browserContext as MockFn)();
      (ctx.setCookie as MockFn).mockRejectedValue(
        new Error('setCookie failed'),
      );

      const sessions = (
        service as unknown as { authSessions: Map<string, unknown> }
      ).authSessions;
      sessions.set('errorAuth', {
        cookies: [{ name: 's', value: 'v', domain: '.example.com', path: '/' }],
        authenticated: true,
        timestamp: Date.now(),
      });

      await service.authenticate(
        failPage,
        AUTO_CONFIG,
        'https://example.com',
        'errorAuth',
      );

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(Error) }),
        'Cookie reuse error, re-authenticating',
      );
    });
  });

  describe('session cookie filtering', () => {
    it('filters out cookies without a string domain when reusing', async () => {
      const sessions = (
        service as unknown as { authSessions: Map<string, unknown> }
      ).authSessions;
      sessions.set('filterTest', {
        cookies: [
          { name: 'good', value: 'v', domain: '.example.com', path: '/' },
          { name: 'bad', value: 'v', domain: undefined, path: '/' },
        ],
        authenticated: true,
        timestamp: Date.now(),
      });

      await service.authenticate(
        page,
        AUTO_CONFIG,
        'https://example.com',
        'filterTest',
      );

      const ctx = (page.browserContext as MockFn)();
      expect(ctx.setCookie).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'good', domain: '.example.com' }),
      );
    });

    it('does not call setCookie when no cookie has a domain', async () => {
      const sessions = (
        service as unknown as { authSessions: Map<string, unknown> }
      ).authSessions;
      sessions.set('noDomainTest', {
        cookies: [{ name: 'c1', value: 'v', path: '/' }],
        authenticated: true,
        timestamp: Date.now(),
      });

      await service.authenticate(
        page,
        AUTO_CONFIG,
        'https://example.com',
        'noDomainTest',
      );

      const ctx = (page.browserContext as MockFn)();
      expect(ctx.setCookie).not.toHaveBeenCalled();
    });
  });

  describe('clearSessions()', () => {
    it('clears all stored sessions', () => {
      const sessions = (
        service as unknown as { authSessions: Map<string, unknown> }
      ).authSessions;
      sessions.set('s1', { cookies: [], authenticated: true, timestamp: 0 });
      sessions.set('s2', { cookies: [], authenticated: true, timestamp: 0 });

      expect(sessions.size).toBe(2);
      service.clearSessions();
      expect(sessions.size).toBe(0);
      expect(mockLoggerInfo).toHaveBeenCalledWith('Sessions cleared');
    });
  });
});
