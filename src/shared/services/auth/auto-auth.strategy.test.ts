import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Page } from 'puppeteer';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { AutoAuthHandler } from './auto-auth.strategy.js';
import { CookieBannerService } from '@shared/services/journey/cookie-banner.service.js';
import type { IAutoAuthConfig } from '@shared/types/auth.types.js';

const CONFIG: IAutoAuthConfig = {
  type: 'auto',
  username: 'jdoe',
  password: 's3cret',
};

function makeElement() {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
  };
}

interface MockPage {
  page: Page;
  fns: {
    authenticate: ReturnType<typeof vi.fn>;
    goto: ReturnType<typeof vi.fn>;
    url: ReturnType<typeof vi.fn>;
    waitForSelector: ReturnType<typeof vi.fn>;
    $: ReturnType<typeof vi.fn>;
    waitForNavigation: ReturnType<typeof vi.fn>;
    cookies: ReturnType<typeof vi.fn>;
    pressEnter: ReturnType<typeof vi.fn>;
  };
}

function createMockPage(opts: {
  url?: string;
  formPresent?: boolean;
  elements?: Record<string, ReturnType<typeof makeElement> | null>;
}): MockPage {
  const cookies = vi.fn().mockResolvedValue([{ name: 'sid', value: 'x' }]);
  const pressEnter = vi.fn().mockResolvedValue(undefined);
  const authenticate = vi.fn().mockResolvedValue(undefined);
  const goto = vi.fn().mockResolvedValue(undefined);
  const url = vi.fn().mockReturnValue(opts.url ?? 'https://app.example.com');
  const waitForNavigation = vi.fn().mockResolvedValue(undefined);
  const formPresent = opts.formPresent === true;
  const waitForSelector = vi
    .fn()
    .mockImplementation(() =>
      formPresent ? Promise.resolve({}) : Promise.reject(new Error('to')),
    );
  const $ = vi.fn().mockImplementation((sel: string) => {
    if (opts.elements && sel in opts.elements) {
      return Promise.resolve(opts.elements[sel]);
    }
    // Default: match username/password selector strings loosely.
    return Promise.resolve(formPresent ? makeElement() : null);
  });

  const page = {
    authenticate,
    goto,
    url,
    waitForSelector,
    $,
    waitForNavigation,
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
    keyboard: { press: pressEnter },
    browserContext: () => ({ cookies }),
    evaluate: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;

  return {
    page,
    fns: {
      authenticate,
      goto,
      url,
      waitForSelector,
      $,
      waitForNavigation,
      cookies,
      pressEnter,
    },
  };
}

describe('AutoAuthHandler', () => {
  let handler: AutoAuthHandler;

  beforeEach(() => {
    handler = new AutoAuthHandler();
  });

  it('always answers native popups via page.authenticate', async () => {
    const { page, fns } = createMockPage({ formPresent: false });
    await handler.authenticate(page, CONFIG, 'https://app.example.com');
    expect(fns.authenticate).toHaveBeenCalledWith({
      username: 'jdoe',
      password: 's3cret',
    });
  });

  it('dismisses a cookie-consent overlay before touching the form', async () => {
    const acceptSpy = vi
      .spyOn(CookieBannerService.prototype, 'accept')
      .mockResolvedValue('#didomi-notice-agree-button');
    const { page } = createMockPage({ formPresent: true });
    await handler.authenticate(page, CONFIG, 'https://app.example.com');
    expect(acceptSpy).toHaveBeenCalledTimes(1);
    acceptSpy.mockRestore();
  });

  it('navigates with domcontentloaded (not networkidle2)', async () => {
    const { page, fns } = createMockPage({ formPresent: false });
    await handler.authenticate(page, CONFIG, 'https://app.example.com');
    expect(fns.goto).toHaveBeenCalledWith(
      'https://app.example.com',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
  });

  it('succeeds (no form) when nothing requires a form login', async () => {
    const { page } = createMockPage({ formPresent: false });
    const result = await handler.authenticate(
      page,
      CONFIG,
      'https://app.example.com',
    );
    expect(result.success).toBe(true);
  });

  it('fills and submits a login form when present', async () => {
    const { page, fns } = createMockPage({ formPresent: true });
    const result = await handler.authenticate(
      page,
      CONFIG,
      'https://app.example.com',
    );
    expect(result.success).toBe(true);
    // The form path collects cookies for session reuse.
    expect(fns.cookies).toHaveBeenCalled();
  });

  it('fails when the navigation lands on a chrome-error page', async () => {
    const { page } = createMockPage({
      url: 'chrome-error://chromewebdata/',
      formPresent: false,
    });
    const result = await handler.authenticate(
      page,
      CONFIG,
      'https://app.example.com',
    );
    expect(result.success).toBe(false);
  });

  it('visits loginUrl first then returns to the target', async () => {
    const { page, fns } = createMockPage({ formPresent: false });
    await handler.authenticate(
      page,
      { ...CONFIG, loginUrl: 'https://login.example.com' },
      'https://app.example.com/dashboard',
    );
    const gotoUrls = fns.goto.mock.calls.map((c) => c[0] as string);
    expect(gotoUrls).toContain('https://login.example.com');
    expect(gotoUrls).toContain('https://app.example.com/dashboard');
  });
});
