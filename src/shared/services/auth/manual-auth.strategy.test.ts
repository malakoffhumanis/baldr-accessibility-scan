import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Page } from 'puppeteer';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ManualAuthHandler } from './manual-auth.strategy.js';
import type { IManualAuthConfig } from '@shared/types/auth.types.js';

type Mock = ReturnType<typeof vi.fn>;

const COOKIES = [
  { name: 'sid', value: 'x', domain: '.example.com', path: '/' },
];

function makePage(opts: {
  url: Mock;
  goto?: Mock;
  cookies?: Mock;
  isClosed?: Mock;
}): { page: Page; goto: Mock; cookies: Mock } {
  const goto = opts.goto ?? vi.fn().mockResolvedValue(undefined);
  const cookies = opts.cookies ?? vi.fn().mockResolvedValue(COOKIES);
  const isClosed = opts.isClosed ?? vi.fn().mockReturnValue(false);
  const page = {
    goto,
    url: opts.url,
    isClosed,
    waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
    browserContext: () => ({ cookies }),
  } as unknown as Page;
  return { page, goto, cookies };
}

describe('ManualAuthHandler', () => {
  let prevIsTTY: boolean | undefined;
  let handler: ManualAuthHandler;

  beforeEach(() => {
    // Hermetic: force a non-interactive terminal so the URL/timeout paths are
    // exercised deterministically regardless of how the test runner is invoked.
    prevIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
    });
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    handler = new ManualAuthHandler();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: prevIsTTY,
      configurable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens loginUrl first with domcontentloaded', async () => {
    vi.useFakeTimers();
    const { page, goto } = makePage({
      url: vi.fn(() => 'https://sso.example.com/login'),
    });
    const cfg: IManualAuthConfig = {
      type: 'manual',
      loginUrl: 'https://sso.example.com/login',
      timeoutMs: 10000,
    };
    const p = handler.authenticate(page, cfg, 'https://app.example.com/x', 'k');
    await vi.advanceTimersByTimeAsync(10000);
    const res = await p;

    expect(goto).toHaveBeenCalledWith(
      'https://sso.example.com/login',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
    // Stuck on a login page until timeout → reported as failure.
    expect(res.success).toBe(false);
  });

  it('opens the target URL when no loginUrl is given', async () => {
    vi.useFakeTimers();
    const { page, goto } = makePage({
      url: vi.fn(() => 'https://app.example.com/x'),
    });
    const p = handler.authenticate(
      page,
      { type: 'manual', timeoutMs: 10000 },
      'https://app.example.com/x',
      'k',
    );
    await vi.advanceTimersByTimeAsync(10000);
    const res = await p;

    expect(goto).toHaveBeenCalledWith(
      'https://app.example.com/x',
      expect.objectContaining({ waitUntil: 'domcontentloaded' }),
    );
    // Already on the (non-login) target and never navigated away → the initial
    // match must NOT trigger completion; a timeout on a non-login page succeeds.
    expect(res.success).toBe(true);
  });

  it('resumes only after the target URL stays stable (debounce), not on the first match', async () => {
    vi.useFakeTimers();
    const target = 'https://app.example.com/dashboard';
    let n = 0;
    const url = vi.fn(() =>
      n++ === 0 ? 'https://sso.example.com/login' : target,
    );
    const { page, cookies } = makePage({ url });
    let resolved = false;
    const p = handler
      .authenticate(page, { type: 'manual' }, target, 'k')
      .then((r) => {
        resolved = true;
        return r;
      });

    // The URL matches from the first poll (~500ms) but must not resume yet.
    await vi.advanceTimersByTimeAsync(1500);
    expect(resolved).toBe(false);

    // After the debounce window it resumes.
    await vi.advanceTimersByTimeAsync(2500);
    const res = await p;
    expect(res.success).toBe(true);
    expect(res.cookies).toEqual(COOKIES);
    expect(cookies).toHaveBeenCalled();
  });

  it('auto-resumes on a login-like target URL (target-is-login exception)', async () => {
    vi.useFakeTimers();
    // The audited target itself contains a login/SSO segment ("sso"): the
    // "not a login page" guard must NOT block resuming on it.
    const target = 'https://portail.example.com/sso/accueil';
    let n = 0;
    const url = vi.fn(() =>
      n++ === 0 ? 'https://idp.example.com/authorize' : target,
    );
    const { page } = makePage({ url });
    let resolved = false;
    const p = handler
      .authenticate(page, { type: 'manual' }, target, 'k')
      .then((r) => {
        resolved = true;
        return r;
      });

    await vi.advanceTimersByTimeAsync(1500);
    expect(resolved).toBe(false); // debounce not elapsed yet

    await vi.advanceTimersByTimeAsync(2500);
    const res = await p;
    expect(res.success).toBe(true);
  });

  it('fails when the page is closed during the wait', async () => {
    vi.useFakeTimers();
    const { page } = makePage({
      url: vi.fn(() => 'https://sso.example.com/login'),
      isClosed: vi.fn().mockReturnValue(true),
    });
    const p = handler.authenticate(
      page,
      { type: 'manual', timeoutMs: 60000 },
      'https://app.example.com',
      'k',
    );
    await vi.advanceTimersByTimeAsync(600);
    const res = await p;

    expect(res.success).toBe(false);
  });

  it('continues even if the initial navigation fails (operator drives manually)', async () => {
    vi.useFakeTimers();
    const goto = vi.fn().mockRejectedValue(new Error('net::ERR_ABORTED'));
    const target = 'https://app.example.com/home';
    let n = 0;
    const url = vi.fn(() => (n++ === 0 ? 'about:blank' : target));
    const { page } = makePage({ url, goto });
    const p = handler.authenticate(page, { type: 'manual' }, target, 'k');
    await vi.advanceTimersByTimeAsync(3500);
    const res = await p;

    expect(res.success).toBe(true);
  });

  it('resumes immediately when the operator presses Enter (interactive TTY)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    const resumeSpy = vi
      .spyOn(process.stdin, 'resume')
      .mockReturnValue(process.stdin);
    const pauseSpy = vi
      .spyOn(process.stdin, 'pause')
      .mockReturnValue(process.stdin);

    // Never reaches the target by URL → only Enter can end the wait quickly.
    const { page } = makePage({
      url: vi.fn(() => 'https://sso.example.com/login'),
    });
    const p = handler.authenticate(
      page,
      { type: 'manual', timeoutMs: 60000 },
      'https://app.example.com',
      'k',
    );

    // Let the initial navigation + listener attachment settle, then send Enter.
    await new Promise((r) => setTimeout(r, 20));
    process.stdin.emit('data', Buffer.from('\n'));
    const res = await p;

    expect(res.success).toBe(true);
    expect(resumeSpy).toHaveBeenCalled();
    expect(pauseSpy).toHaveBeenCalled();
  });

  it('with waitForManualConfirm, resumes ONLY on Enter — never on a URL match', async () => {
    vi.useFakeTimers();
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    vi.spyOn(process.stdin, 'resume').mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, 'pause').mockReturnValue(process.stdin);

    const target = 'https://app.example.com/dashboard';
    let n = 0;
    // URL leaves the start and lands on the target — would auto-resume if URL
    // detection were enabled.
    const url = vi.fn(() =>
      n++ === 0 ? 'https://sso.example.com/login' : target,
    );
    const { page } = makePage({ url });

    let resolved = false;
    const p = handler
      .authenticate(
        page,
        { type: 'manual', waitForManualConfirm: true, timeoutMs: 60000 },
        target,
        'k',
      )
      .then((r) => {
        resolved = true;
        return r;
      });

    // Well past the URL debounce window: must still be waiting.
    await vi.advanceTimersByTimeAsync(6000);
    expect(resolved).toBe(false);

    // Only Enter ends it.
    process.stdin.emit('data', Buffer.from('\n'));
    await vi.advanceTimersByTimeAsync(50);
    const res = await p;
    expect(res.success).toBe(true);
  });
});
