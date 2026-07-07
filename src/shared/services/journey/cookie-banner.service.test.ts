import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/utils/browser-shims.util.js', () => ({
  shimTsxName: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@shared/utils/browser-shims.util.js', () => ({
  shimTsxName: vi.fn().mockResolvedValue(undefined),
}));

import { CookieBannerService } from './cookie-banner.service.js';

function createMockPage(opts: { closed?: boolean } = {}) {
  return {
    isClosed: vi.fn().mockReturnValue(opts.closed ?? false),
    evaluate: vi.fn().mockResolvedValue(false),
  };
}

describe('CookieBannerService', () => {
  const service = new CookieBannerService();

  describe('accept', () => {
    it('returns null when page is closed', async () => {
      const page = createMockPage({ closed: true });
      const result = await service.accept(page as never);
      expect(result).toBeNull();
    });

    it('returns selector when known selector matches (pass 1)', async () => {
      const page = createMockPage();
      // First call to evaluate (tryClick) returns true for the first known selector
      page.evaluate.mockResolvedValueOnce(true);
      const result = await service.accept(page as never);
      expect(result).toBe('#tarteaucitronAllAllowed');
    });

    it('tries all known selectors before moving to pass 2', async () => {
      const page = createMockPage();
      // All known selectors fail (pass 1)
      page.evaluate.mockResolvedValue(false);
      // Pass 2 text search returns no match
      // Pass 3 aggressive search returns no match
      const result = await service.accept(page as never);
      expect(result).toBeNull();
    });

    it('returns selector from text heuristic (pass 2)', async () => {
      const page = createMockPage();
      // All known selectors fail
      page.evaluate.mockResolvedValue(false);
      // Then pass 2 evaluate returns match
      // We need to reset and count: there are 23 known selectors (pass 1 calls tryClick for each)
      // Then pass 2 calls shimTsxName + evaluate, then pass 3 if needed
      let callCount = 0;
      page.evaluate.mockImplementation(async () => {
        callCount++;
        // Known selectors are checked via tryClick (1 evaluate per selector)
        // After all fail, pass 2 has one evaluate call
        if (callCount > 23) {
          // This is the pass 2 evaluate
          return { ok: true, selector: '#accept-btn', text: 'accepter' };
        }
        return false;
      });
      const result = await service.accept(page as never);
      expect(result).toBe('#accept-btn');
    });

    it('returns selector from overlay heuristic (pass 3)', async () => {
      const page = createMockPage();
      let callCount = 0;
      page.evaluate.mockImplementation(async () => {
        callCount++;
        if (callCount > 23 && callCount <= 24) {
          // Pass 2 - no match
          return { ok: false };
        }
        if (callCount > 24) {
          // Pass 3 - match in overlay
          return { ok: true, selector: 'button.accept', text: 'accepter' };
        }
        return false; // pass 1 - known selectors
      });
      const result = await service.accept(page as never);
      expect(result).toBe('button.accept');
    });

    it('returns null when pass 3 finds candidates outside overlay', async () => {
      const page = createMockPage();
      let callCount = 0;
      page.evaluate.mockImplementation(async () => {
        callCount++;
        if (callCount > 23 && callCount <= 24) {
          return { ok: false };
        }
        if (callCount > 24) {
          return { ok: false, candidates: ['button[text="accept"]'] };
        }
        return false;
      });
      const result = await service.accept(page as never);
      expect(result).toBeNull();
    });

    it('handles errors in pass 1 gracefully', async () => {
      const page = createMockPage();
      page.evaluate.mockRejectedValue(new Error('page error'));
      const result = await service.accept(page as never);
      // Should return null since all passes fail
      expect(result).toBeNull();
    });

    it('handles errors in pass 2 gracefully', async () => {
      const page = createMockPage();
      let callCount = 0;
      page.evaluate.mockImplementation(async () => {
        callCount++;
        if (callCount > 23) {
          throw new Error('pass 2 error');
        }
        return false;
      });
      const result = await service.accept(page as never);
      expect(result).toBeNull();
    });

    it('handles errors in pass 3 gracefully', async () => {
      const page = createMockPage();
      let callCount = 0;
      page.evaluate.mockImplementation(async () => {
        callCount++;
        if (callCount > 23 && callCount <= 24) {
          return { ok: false };
        }
        if (callCount > 24) {
          throw new Error('pass 3 error');
        }
        return false;
      });
      const result = await service.accept(page as never);
      expect(result).toBeNull();
    });
  });
});

/**
 * Unlike the tests above (which stub page.evaluate return values), these tests
 * run the browser-side callbacks in Node against a fake DOM so the
 * isVisible / isInBanner / isInOverlay / generateSelector logic is exercised.
 */

interface FakeElOpts {
  tagName?: string;
  id?: string;
  attributes?: Record<string, string>;
  textContent?: string;
  value?: string;
  style?: Record<string, string>;
  rect?: { width: number; height: number };
  parent?: FakeEl | null;
}

class FakeEl {
  tagName: string;
  textContent: string;
  value: string;
  parentElement: FakeEl | null;
  clicked = false;
  private attrs: Map<string, string>;
  style: Record<string, string>;
  private rect: { width: number; height: number };

  constructor(opts: FakeElOpts = {}) {
    this.tagName = opts.tagName ?? 'BUTTON';
    this.textContent = opts.textContent ?? '';
    this.value = opts.value ?? '';
    this.parentElement = opts.parent ?? null;
    this.attrs = new Map(Object.entries(opts.attributes ?? {}));
    if (opts.id !== undefined) this.attrs.set('id', opts.id);
    this.style = opts.style ?? {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      position: 'static',
      zIndex: 'auto',
    };
    this.rect = opts.rect ?? { width: 100, height: 30 };
  }

  get id(): string {
    return this.attrs.get('id') ?? '';
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  getBoundingClientRect(): { width: number; height: number } {
    return this.rect;
  }

  click(): void {
    this.clicked = true;
  }
}

function installDom(
  candidates: FakeEl[],
  querySelectorEl: FakeEl | null = null,
): void {
  const fakeDocument = {
    querySelector: () => querySelectorEl,
    querySelectorAll: () => candidates,
  };
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: (el: FakeEl) => el.style,
  });
  vi.stubGlobal('getComputedStyle', (el: FakeEl) => el.style);
  vi.stubGlobal('CSS', { escape: (s: string) => s });
}

/** A page that EXECUTES evaluate callbacks; pass-1 tryClick always fails. */
function createExecPage() {
  let evalCount = 0;
  const page = {
    isClosed: vi.fn().mockReturnValue(false),
    // tryClick (pass 1) uses document.querySelector which returns null,
    // so it returns false for every known selector; pass 2 & 3 run the
    // real callbacks against the fake querySelectorAll candidates.
    evaluate: vi.fn(
      async (fn: unknown, ...args: unknown[]): Promise<unknown> => {
        evalCount++;
        return typeof fn === 'function'
          ? await (fn as (...a: unknown[]) => unknown)(...args)
          : undefined;
      },
    ),
    get evalCount(): number {
      return evalCount;
    },
  };
  return page;
}

describe('CookieBannerService — DOM callback execution', () => {
  const service = new CookieBannerService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a visible button inside a cookie banner (pass 2)', async () => {
    const banner = new FakeEl({ tagName: 'DIV', id: 'cookie-consent' });
    const btn = new FakeEl({
      tagName: 'BUTTON',
      textContent: 'Tout accepter',
      parent: banner,
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(btn.clicked).toBe(true);
    // generateSelector: no id, no class -> tagName
    expect(result).toBe('button');
  });

  it('generates an id-based selector when the button has an id', async () => {
    const banner = new FakeEl({
      tagName: 'DIV',
      attributes: { class: 'rgpd-banner' },
    });
    const btn = new FakeEl({
      tagName: 'BUTTON',
      id: 'accept-cookies',
      textContent: 'Accepter',
      parent: banner,
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(result).toBe('#accept-cookies');
  });

  it('generates a class-based selector when the button has classes', async () => {
    const banner = new FakeEl({
      tagName: 'DIV',
      attributes: { role: 'dialog consent' },
    });
    const btn = new FakeEl({
      tagName: 'BUTTON',
      attributes: { class: 'btn primary' },
      textContent: 'Accept all',
      parent: banner,
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(result).toBe('button.btn.primary');
  });

  it('skips invisible buttons (display:none) in pass 2', async () => {
    const banner = new FakeEl({ tagName: 'DIV', id: 'cookies' });
    const hidden = new FakeEl({
      tagName: 'BUTTON',
      textContent: 'Accepter',
      parent: banner,
      style: { display: 'none', visibility: 'visible', opacity: '1' },
    });
    installDom([hidden]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(hidden.clicked).toBe(false);
    expect(result).toBeNull();
  });

  it('skips buttons that are not inside a banner container in pass 2', async () => {
    // No banner-hint ancestor -> isInBanner false. Pass 3 also needs an
    // overlay; this button is static so pass 3 ignores it too.
    const btn = new FakeEl({
      tagName: 'BUTTON',
      textContent: 'Accepter',
      parent: null,
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(btn.clicked).toBe(false);
    expect(result).toBeNull();
  });

  it('matches aria-label text inside a banner (pass 2)', async () => {
    const banner = new FakeEl({
      tagName: 'DIV',
      attributes: { 'aria-label': 'gestion des cookies' },
    });
    const btn = new FakeEl({
      tagName: 'BUTTON',
      attributes: { 'aria-label': 'tout autoriser' },
      parent: banner,
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(btn.clicked).toBe(true);
    expect(result).toBe('button');
  });

  it('matches an input[type=submit] value inside a banner (pass 2)', async () => {
    const banner = new FakeEl({ tagName: 'DIV', id: 'didomi-host' });
    const input = new FakeEl({
      tagName: 'INPUT',
      attributes: { type: 'submit' },
      value: 'consent',
      parent: banner,
    });
    installDom([input]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(input.clicked).toBe(true);
  });

  it('falls through to pass 3 and clicks a button inside a fixed overlay', async () => {
    // No banner-hint ancestor (pass 2 misses), but the button sits in a
    // position:fixed overlay (pass 3 hits).
    const overlay = new FakeEl({
      tagName: 'DIV',
      style: {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        position: 'fixed',
        zIndex: 'auto',
      },
    });
    const btn = new FakeEl({
      tagName: 'BUTTON',
      id: 'agree',
      textContent: 'Accept all',
      parent: overlay,
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(btn.clicked).toBe(true);
    expect(result).toBe('#agree');
  });

  it('pass 3 detects overlay via high z-index', async () => {
    const overlay = new FakeEl({
      tagName: 'DIV',
      style: {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        position: 'static',
        zIndex: '9999',
      },
    });
    const btn = new FakeEl({
      tagName: 'BUTTON',
      attributes: { class: 'accept' },
      textContent: 'Accepter',
      parent: overlay,
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(btn.clicked).toBe(true);
    expect(result).toBe('button.accept');
  });

  it('pass 3 ignores accept buttons that are NOT inside an overlay', async () => {
    // matches text but no fixed/sticky/high-z ancestor -> recorded as debug
    // candidate but not clicked.
    const btn = new FakeEl({
      tagName: 'BUTTON',
      textContent: 'Accepter',
      parent: new FakeEl({ tagName: 'DIV' }),
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(btn.clicked).toBe(false);
    expect(result).toBeNull();
  });

  it('pass 3 ignores long labels that merely contain the keyword', async () => {
    // label length >= 50 and not exact -> no match in pass 3 includes branch
    const overlay = new FakeEl({
      tagName: 'DIV',
      style: {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        position: 'fixed',
        zIndex: 'auto',
      },
    });
    const longText =
      'this is a very long paragraph that mentions accept somewhere within it yes';
    const btn = new FakeEl({
      tagName: 'BUTTON',
      textContent: longText,
      parent: overlay,
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(btn.clicked).toBe(false);
    expect(result).toBeNull();
  });

  it('returns null when there are no candidate buttons at all', async () => {
    installDom([]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(result).toBeNull();
  });

  it('clicks a known selector in pass 1 (tryClick callback runs)', async () => {
    // querySelector returns a visible element -> tryClick clicks it and the
    // very first known selector (#tarteaucitronAllAllowed) is returned.
    const el = new FakeEl({ tagName: 'BUTTON' });
    installDom([], el);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(el.clicked).toBe(true);
    expect(result).toBe('#tarteaucitronAllAllowed');
  });

  it('tryClick returns false for a display:none element', async () => {
    // Hidden element via querySelector -> tryClick returns false for every
    // known selector, then pass 2/3 find nothing.
    const el = new FakeEl({
      tagName: 'BUTTON',
      style: {
        display: 'none',
        visibility: 'visible',
        opacity: '1',
        position: 'static',
        zIndex: 'auto',
      },
    });
    installDom([], el);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(el.clicked).toBe(false);
    expect(result).toBeNull();
  });

  it('tryClick returns false for a zero-size element', async () => {
    const el = new FakeEl({ tagName: 'BUTTON', rect: { width: 0, height: 0 } });
    installDom([], el);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(el.clicked).toBe(false);
    expect(result).toBeNull();
  });

  it('pass 3 generates a bare tagName selector for an id-less, class-less button in an overlay', async () => {
    // exercises generateSelector pass-3 fallback (no id, no class)
    const overlay = new FakeEl({
      tagName: 'DIV',
      style: {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        position: 'sticky',
        zIndex: 'auto',
      },
    });
    const btn = new FakeEl({
      tagName: 'BUTTON',
      textContent: 'Accept',
      parent: overlay,
    });
    installDom([btn]);
    const page = createExecPage();
    const result = await service.accept(page as never);
    expect(btn.clicked).toBe(true);
    expect(result).toBe('button');
  });
});
