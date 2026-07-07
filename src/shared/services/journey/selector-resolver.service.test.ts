import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { SelectorResolverService } from './selector-resolver.service.js';

const TEST_BUSINESS_SELECTORS = {
  clickableSelectors: ['[data-ajax-code]', '[data-ajax]'],
  containerClasses: ['menu-folder'],
  containerAttributes: [{ name: 'data-menu-type', value: 'submenu' }],
  stableAttributes: ['data-ajax-code'],
  ajaxTriggerAttributes: ['data-ajax', 'data-ajax-code'],
};

/** Clickable query produced by the service with TEST_BUSINESS_SELECTORS. */
const CLICKABLE_QUERY =
  'a, button, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="menuitemcheckbox"], [role="menuitemradio"], [data-action], [data-target], [data-ajax-code], [data-ajax]';

function createMockPage() {
  return {
    evaluate: vi.fn().mockResolvedValue(undefined),
    $$: vi.fn().mockResolvedValue([]),
    hover: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SelectorResolverService', () => {
  const service = new SelectorResolverService();

  describe('detectNonStandardSyntax', () => {
    it('returns null for standard CSS selectors', () => {
      expect(service.detectNonStandardSyntax('#btn')).toBeNull();
      expect(service.detectNonStandardSyntax('.class')).toBeNull();
      expect(
        service.detectNonStandardSyntax('button[data-action="x"]'),
      ).toBeNull();
      expect(service.detectNonStandardSyntax('a:hover')).toBeNull();
    });

    it('detects :visible pseudo-class', () => {
      expect(service.detectNonStandardSyntax('button:visible')).not.toBeNull();
    });

    it('detects :hidden pseudo-class', () => {
      expect(service.detectNonStandardSyntax('div:hidden')).not.toBeNull();
    });

    it('detects :icon-text()', () => {
      expect(
        service.detectNonStandardSyntax('button:icon-text(search)'),
      ).not.toBeNull();
    });

    it('detects :text()', () => {
      expect(
        service.detectNonStandardSyntax('span:text(hello)'),
      ).not.toBeNull();
    });
  });

  describe('cleanupBaldrTargets', () => {
    it('calls page.evaluate to remove data-baldr-target attributes', async () => {
      const page = createMockPage();
      await service.cleanupBaldrTargets(page as never);
      expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('handles page navigation gracefully', async () => {
      const page = createMockPage();
      page.evaluate.mockRejectedValueOnce(new Error('page navigated'));
      // Should not throw
      await service.cleanupBaldrTargets(page as never);
    });
  });

  describe('resolveTextBasedSelector', () => {
    it('returns selector as-is when no :has-text/:contains', async () => {
      const page = createMockPage();
      const result = await service.resolveTextBasedSelector(
        page as never,
        '#btn',
      );
      expect(result).toBe('#btn');
    });

    it('returns selector as-is when targetText is undefined', async () => {
      const page = createMockPage();
      // This won't actually match the regex without the targetText
      const result = await service.resolveTextBasedSelector(
        page as never,
        'button.class',
      );
      expect(result).toBe('button.class');
    });

    it('resolves :has-text() to data-baldr-target', async () => {
      const page = createMockPage();
      // cleanup call
      page.evaluate.mockResolvedValueOnce(undefined);
      // resolve call returns true
      page.evaluate.mockResolvedValueOnce(true);
      const result = await service.resolveTextBasedSelector(
        page as never,
        'button:has-text("Accept")',
      );
      expect(result).toMatch(/\[data-baldr-target="baldr-\w+"\]/);
    });

    it('resolves :contains() to data-baldr-target', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce(undefined);
      page.evaluate.mockResolvedValueOnce(true);
      const result = await service.resolveTextBasedSelector(
        page as never,
        'a:contains("Click")',
      );
      expect(result).toMatch(/\[data-baldr-target="baldr-\w+"\]/);
    });

    it('returns original selector when no unique match found', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce(undefined);
      page.evaluate.mockResolvedValueOnce(false); // 0 or >1 match
      const result = await service.resolveTextBasedSelector(
        page as never,
        'button:has-text("Submit")',
      );
      expect(result).toBe('button:has-text("Submit")');
    });

    it('returns original selector on error', async () => {
      const page = createMockPage();
      page.evaluate.mockRejectedValueOnce(new Error('page closed'));
      const result = await service.resolveTextBasedSelector(
        page as never,
        'button:has-text("OK")',
      );
      expect(result).toBe('button:has-text("OK")');
    });

    it('returns selector when base selector is empty after removal', async () => {
      const page = createMockPage();
      const result = await service.resolveTextBasedSelector(
        page as never,
        ':has-text("test")',
      );
      expect(result).toBe(':has-text("test")');
    });
  });

  describe('validateSelector', () => {
    it('returns invalid for syntax errors', async () => {
      const page = createMockPage();
      page.$$.mockRejectedValueOnce(new Error('Invalid selector'));
      const result = await service.validateSelector(page as never, '[invalid');
      expect(result.ok).toBe(false);
      expect(result.type).toBe('AI_SELECTOR_INVALID');
    });

    it('returns not found when no elements match', async () => {
      const page = createMockPage();
      page.$$.mockResolvedValueOnce([]);
      const result = await service.validateSelector(
        page as never,
        '#nonexistent',
      );
      expect(result.ok).toBe(false);
      expect(result.type).toBe('AI_SELECTOR_NOT_FOUND');
    });

    it('returns ambiguous when multiple elements match', async () => {
      const page = createMockPage();
      page.$$.mockResolvedValueOnce([{}, {}, {}]);
      const result = await service.validateSelector(page as never, '.btn');
      expect(result.ok).toBe(false);
      expect(result.type).toBe('AI_SELECTOR_AMBIGUOUS');
      expect(result.reason).toContain('3');
    });

    it('returns OK for visible unique element', async () => {
      const page = createMockPage();
      page.$$.mockResolvedValueOnce([{}]);
      page.evaluate.mockResolvedValueOnce({
        exists: true,
        visible: true,
        disabled: false,
      });
      const result = await service.validateSelector(page as never, '#btn');
      expect(result.ok).toBe(true);
      expect(result.reason).toBe('OK');
    });

    it('returns disabled for disabled elements', async () => {
      const page = createMockPage();
      page.$$.mockResolvedValueOnce([{}]);
      page.evaluate.mockResolvedValueOnce({
        exists: true,
        visible: true,
        disabled: true,
      });
      const result = await service.validateSelector(page as never, '#btn');
      expect(result.ok).toBe(false);
      expect(result.type).toBe('AI_ELEMENT_DISABLED');
    });

    it('accepts hidden but clickable element', async () => {
      const page = createMockPage();
      page.$$.mockResolvedValueOnce([{}]);
      page.evaluate.mockResolvedValueOnce({
        exists: true,
        visible: false,
        disabled: false,
        isClickableEvenIfHidden: true,
      });
      const result = await service.validateSelector(
        page as never,
        'a[href="/page"]',
      );
      expect(result.ok).toBe(true);
      expect(result.reason).toContain('hidden but clickable');
    });

    it('returns not visible for hidden non-clickable element', async () => {
      const page = createMockPage();
      page.$$.mockResolvedValueOnce([{}]);
      page.evaluate
        .mockResolvedValueOnce({
          exists: true,
          visible: false,
          disabled: false,
          isClickableEvenIfHidden: false,
        })
        // hoverAncestorsAndRevalidate: get ancestor tags
        .mockResolvedValueOnce([]);
      const result = await service.validateSelector(page as never, '#hidden');
      expect(result.ok).toBe(false);
      expect(result.type).toBe('AI_ELEMENT_NOT_VISIBLE');
    });

    it('returns not found when element disappears after querySelector', async () => {
      const page = createMockPage();
      page.$$.mockResolvedValueOnce([{}]);
      page.evaluate.mockResolvedValueOnce({ exists: false });
      const result = await service.validateSelector(page as never, '#gone');
      expect(result.ok).toBe(false);
      expect(result.type).toBe('AI_SELECTOR_NOT_FOUND');
    });

    it('accepts element revealed by ancestor hover', async () => {
      const page = createMockPage();
      page.$$.mockResolvedValueOnce([{}]);
      page.evaluate
        .mockResolvedValueOnce({
          exists: true,
          visible: false,
          disabled: false,
          isClickableEvenIfHidden: false,
        })
        // hoverAncestorsAndRevalidate: get ancestor tags
        .mockResolvedValueOnce(['tag1'])
        // visibility check after hover
        .mockResolvedValueOnce(true)
        // cleanup
        .mockResolvedValueOnce(undefined);
      const result = await service.validateSelector(
        page as never,
        '#submenu-item',
      );
      expect(result.ok).toBe(true);
      expect(result.reason).toContain('after ancestor hover');
    });
  });

  describe('overrideContainerToLeaf', () => {
    it('returns null when element is not a container', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce(null);
      const result = await service.overrideContainerToLeaf(
        page as never,
        '#regular-elem',
        'target text',
      );
      expect(result).toBeNull();
    });

    it('returns leaf selector when container override found', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce('[data-testid="leaf"]');
      const result = await service.overrideContainerToLeaf(
        page as never,
        '#menu-container',
        'Menu Item',
      );
      expect(result).toBe('[data-testid="leaf"]');
    });

    it('returns null on error', async () => {
      const page = createMockPage();
      page.evaluate.mockRejectedValueOnce(new Error('page closed'));
      const result = await service.overrideContainerToLeaf(
        page as never,
        '#menu',
        'item',
      );
      expect(result).toBeNull();
    });
  });

  describe('verifyTargetText', () => {
    it('returns true when element contains target text', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce(true);
      const result = await service.verifyTargetText(
        page as never,
        '#btn',
        'Submit',
      );
      expect(result).toBe(true);
    });

    it('returns false when element does not contain target text', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce(false);
      const result = await service.verifyTargetText(
        page as never,
        '#btn',
        'Other',
      );
      expect(result).toBe(false);
    });

    it('returns true on error (best-effort)', async () => {
      const page = createMockPage();
      page.evaluate.mockRejectedValueOnce(new Error('page closed'));
      const result = await service.verifyTargetText(page as never, '#btn', 'X');
      expect(result).toBe(true);
    });
  });

  describe('getChosenElementDetails', () => {
    it('returns element text content', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce('Button Text');
      const result = await service.getChosenElementDetails(
        page as never,
        '#btn',
      );
      expect(result).toBe('Button Text');
    });

    it('returns <empty> for empty text', async () => {
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce('');
      const result = await service.getChosenElementDetails(
        page as never,
        '#btn',
      );
      expect(result).toBe('<empty>');
    });

    it('returns <unknown> on error', async () => {
      const page = createMockPage();
      page.evaluate.mockRejectedValueOnce(new Error('page closed'));
      const result = await service.getChosenElementDetails(
        page as never,
        '#btn',
      );
      expect(result).toBe('<unknown>');
    });
  });
});

/**
 * These tests differ from the stub-based tests above: instead of stubbing
 * the return value of page.evaluate, they make page.evaluate EXECUTE the callback
 * in Node with fake DOM globals, so the browser-side logic itself is covered.
 */

interface FakeElementOpts {
  textContent?: string;
  attributes?: Record<string, string>;
  tagName?: string;
  classList?: string[];
  value?: string;
  style?: Record<string, string>;
  rect?: { width: number; height: number };
  parentElement?: FakeElement | null;
}

class FakeElement {
  textContent: string;
  tagName: string;
  value: string;
  parentElement: FakeElement | null;
  private attrs: Map<string, string>;
  private _classList: Set<string>;
  private _style: Record<string, string>;
  private _rect: { width: number; height: number };

  constructor(opts: FakeElementOpts = {}) {
    this.textContent = opts.textContent ?? '';
    this.tagName = opts.tagName ?? 'DIV';
    this.value = opts.value ?? '';
    this.parentElement = opts.parentElement ?? null;
    this.attrs = new Map(Object.entries(opts.attributes ?? {}));
    this._classList = new Set(opts.classList ?? []);
    this._style = opts.style ?? {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
    };
    this._rect = opts.rect ?? { width: 100, height: 20 };
  }

  get id(): string {
    return this.attrs.get('id') ?? '';
  }

  get classList(): { contains: (c: string) => boolean } {
    const fromAttr = (this.attrs.get('class') ?? '')
      .split(/\s+/)
      .filter(Boolean);
    const all = new Set([...this._classList, ...fromAttr]);
    return { contains: (c: string) => all.has(c) };
  }

  get attributes(): { name: string; value: string }[] {
    return Array.from(this.attrs.entries()).map(([name, value]) => ({
      name,
      value,
    }));
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  getBoundingClientRect(): { width: number; height: number } {
    return this._rect;
  }

  get computedStyle(): Record<string, string> {
    return this._style;
  }
}

/** A page whose evaluate actually runs the callback in Node. */
function createExecPage() {
  return {
    evaluate: vi.fn(async (fn: unknown, ...args: unknown[]) =>
      typeof fn === 'function'
        ? await (fn as (...a: unknown[]) => unknown)(...args)
        : undefined,
    ),
    $$: vi.fn().mockResolvedValue([{}]),
    hover: vi.fn().mockResolvedValue(undefined),
  };
}

function installDom(
  selectorMap: Record<string, FakeElement | null>,
  selectorAllMap: Record<string, FakeElement[]> = {},
): void {
  const fakeDocument = {
    querySelector: (sel: string): FakeElement | null =>
      sel in selectorMap ? (selectorMap[sel] ?? null) : null,
    querySelectorAll: (sel: string): FakeElement[] => selectorAllMap[sel] ?? [],
  };
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: (el: FakeElement) => el.computedStyle,
  });
  vi.stubGlobal('getComputedStyle', (el: FakeElement) => el.computedStyle);
  vi.stubGlobal('CSS', {
    escape: (s: string) => s,
  });
}

describe('SelectorResolverService — DOM callback execution', () => {
  const service = new SelectorResolverService();
  const businessService = new SelectorResolverService(TEST_BUSINESS_SELECTORS);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('cleanupBaldrTargets callback', () => {
    it('removes data-baldr-target from each matching element', async () => {
      const a = new FakeElement({ attributes: { 'data-baldr-target': 'x' } });
      const b = new FakeElement({ attributes: { 'data-baldr-target': 'y' } });
      installDom({}, { '[data-baldr-target]': [a, b] });
      const page = createExecPage();
      await service.cleanupBaldrTargets(page as never);
      expect(a.hasAttribute('data-baldr-target')).toBe(false);
      expect(b.hasAttribute('data-baldr-target')).toBe(false);
    });
  });

  describe('resolveTextBasedSelector callback', () => {
    it('tags the unique exact-text match and returns its selector', async () => {
      const match = new FakeElement({ textContent: 'Accept' });
      const other = new FakeElement({ textContent: 'Decline' });
      installDom({}, { button: [match, other] });
      const page = createExecPage();
      const result = await service.resolveTextBasedSelector(
        page as never,
        'button:has-text("Accept")',
      );
      expect(result).toMatch(/^\[data-baldr-target="baldr-\w+"\]$/);
      expect(match.getAttribute('data-baldr-target')).toBeTruthy();
    });

    it('falls back to a contains match when no exact match exists', async () => {
      const match = new FakeElement({ textContent: 'Please Accept now' });
      installDom({}, { button: [match] });
      const page = createExecPage();
      const result = await service.resolveTextBasedSelector(
        page as never,
        'button:contains("accept")',
      );
      expect(result).toMatch(/^\[data-baldr-target="baldr-\w+"\]$/);
    });

    it('returns original selector when multiple elements match', async () => {
      const a = new FakeElement({ textContent: 'Accept' });
      const b = new FakeElement({ textContent: 'Accept' });
      installDom({}, { button: [a, b] });
      const page = createExecPage();
      const result = await service.resolveTextBasedSelector(
        page as never,
        'button:has-text("Accept")',
      );
      expect(result).toBe('button:has-text("Accept")');
    });

    it('returns original selector when zero elements match', async () => {
      installDom({}, { button: [new FakeElement({ textContent: 'Nope' })] });
      const page = createExecPage();
      const result = await service.resolveTextBasedSelector(
        page as never,
        'button:has-text("Missing")',
      );
      expect(result).toBe('button:has-text("Missing")');
    });

    it('returns the original selector when the resolve evaluate throws (catch)', async () => {
      installDom({}, {});
      const page = createExecPage();
      // first evaluate = cleanupBaldrTargets (ok), second = resolve (throws)
      page.evaluate
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('detached frame'));
      const result = await service.resolveTextBasedSelector(
        page as never,
        'button:has-text("Boom")',
      );
      expect(result).toBe('button:has-text("Boom")');
    });
  });

  describe('validateSelector checks callback', () => {
    it('flags a visible, enabled, unique element as OK', async () => {
      const node = new FakeElement({
        tagName: 'DIV',
        rect: { width: 50, height: 10 },
      });
      installDom({ '#ok': node });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      const res = await service.validateSelector(page as never, '#ok');
      expect(res.ok).toBe(true);
      expect(res.reason).toBe('OK');
    });

    it('detects a disabled element via the disabled attribute', async () => {
      const node = new FakeElement({ attributes: { disabled: '' } });
      installDom({ '#dis': node });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      const res = await service.validateSelector(page as never, '#dis');
      expect(res.ok).toBe(false);
      expect(res.type).toBe('AI_ELEMENT_DISABLED');
    });

    it('detects aria-disabled=true', async () => {
      const node = new FakeElement({
        attributes: { 'aria-disabled': 'true' },
      });
      installDom({ '#ad': node });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      const res = await service.validateSelector(page as never, '#ad');
      expect(res.type).toBe('AI_ELEMENT_DISABLED');
    });

    it('accepts a hidden anchor with href as clickable-even-if-hidden', async () => {
      const node = new FakeElement({
        tagName: 'A',
        attributes: { href: '/page' },
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        rect: { width: 0, height: 0 },
      });
      installDom({ 'a.hidden': node });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      const res = await service.validateSelector(page as never, 'a.hidden');
      expect(res.ok).toBe(true);
      expect(res.reason).toContain('hidden but clickable');
    });

    it('accepts a hidden element with a clickable role', async () => {
      const node = new FakeElement({
        tagName: 'SPAN',
        attributes: { role: 'menuitem' },
        style: { display: 'none', visibility: 'visible', opacity: '1' },
      });
      installDom({ '#role': node });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      const res = await service.validateSelector(page as never, '#role');
      expect(res.ok).toBe(true);
    });

    it('attempts ancestor hover for hidden, non-clickable elements', async () => {
      // hidden non-clickable node; no ancestors -> hover yields nothing
      const node = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        parentElement: null,
      });
      installDom({ '#hid': node });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      const res = await service.validateSelector(page as never, '#hid');
      expect(res.ok).toBe(false);
      expect(res.type).toBe('AI_ELEMENT_NOT_VISIBLE');
    });
  });

  describe('hoverAncestorsAndRevalidate callback (via validateSelector)', () => {
    it('reveals the target after hovering an ancestor menu trigger', async () => {
      // ancestor is a BUTTON (menu trigger). The target becomes visible
      // on the post-hover visibility evaluate.
      const ancestor = new FakeElement({ tagName: 'BUTTON' });
      const node = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        parentElement: ancestor,
      });

      // The post-hover visibility check queries the SAME selector (#sub) but
      // by then the node should look visible. We use a getter-backed style.
      let revealed = false;
      const visibleStyle: Record<string, string> = {
        get display() {
          return revealed ? 'block' : 'none';
        },
        visibility: 'visible',
        opacity: '1',
      };
      const node2 = new FakeElement({
        tagName: 'SPAN',
        parentElement: ancestor,
      });
      Object.defineProperty(node2, 'computedStyle', {
        get: () => visibleStyle,
      });
      Object.defineProperty(node2, 'getBoundingClientRect', {
        value: () => ({ width: 10, height: 10 }),
      });

      // First validate-check uses node (hidden). The ancestor-tag-collection
      // and the post-hover check use the document map; we swap the node to
      // node2 and mark revealed once hover happened.
      const selMap: Record<string, FakeElement | null> = { '#sub': node };
      const docAll: Record<string, FakeElement[]> = {
        '[data-baldr-hover]': [],
      };
      installDom(selMap, docAll);

      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      page.hover.mockImplementation(async () => {
        revealed = true;
        selMap['#sub'] = node2;
      });

      const res = await service.validateSelector(page as never, '#sub');
      expect(page.hover).toHaveBeenCalled();
      expect(res.ok).toBe(true);
      expect(res.reason).toContain('after ancestor hover');
    });

    it('collects ancestor menu triggers across multiple criteria', async () => {
      // aria-haspopup ancestor + class-based menu ancestor
      const grand = new FakeElement({
        tagName: 'DIV',
        attributes: { class: 'main-menu' },
      });
      const parent = new FakeElement({
        tagName: 'DIV',
        attributes: { 'aria-haspopup': 'true' },
        parentElement: grand,
      });
      const node = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        parentElement: parent,
      });
      const selMap: Record<string, FakeElement | null> = { '#m': node };
      installDom(selMap, { '[data-baldr-hover]': [] });

      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      // hover never reveals -> stays hidden
      const res = await service.validateSelector(page as never, '#m');
      // two ancestors tagged -> two hover attempts
      expect(page.hover).toHaveBeenCalledTimes(2);
      expect(res.type).toBe('AI_ELEMENT_NOT_VISIBLE');
      // both ancestors should have been tagged then cleaned up
      expect(parent.hasAttribute('data-baldr-hover')).toBe(true);
      expect(grand.hasAttribute('data-baldr-hover')).toBe(true);
    });
  });

  describe('overrideContainerToLeaf callback', () => {
    it('returns null when the chosen node is not a container', async () => {
      const node = new FakeElement({ tagName: 'DIV' });
      installDom({ '#x': node });
      const page = createExecPage();
      const res = await service.overrideContainerToLeaf(
        page as never,
        '#x',
        'Item',
      );
      expect(res).toBeNull();
    });

    it('returns the stable selector of the single leaf for a submenu container', async () => {
      const container = new FakeElement({
        attributes: { 'data-menu-type': 'submenu' },
      });
      const leaf = new FakeElement({
        tagName: 'A',
        textContent: 'My Item',
        attributes: { 'data-testid': 'leaf-1' },
      });
      installDom(
        { '#c': container },
        {
          [CLICKABLE_QUERY]: [leaf],
        },
      );
      const page = createExecPage();
      const res = await businessService.overrideContainerToLeaf(
        page as never,
        '#c',
        'My Item',
      );
      expect(res).toBe('[data-testid="leaf-1"]');
    });

    it('disambiguates multiple leaves by document uniqueness', async () => {
      const container = new FakeElement({
        attributes: { 'aria-haspopup': 'true' },
      });
      const leafA = new FakeElement({
        tagName: 'A',
        textContent: 'Pay',
        attributes: { 'data-action': 'pay-1' },
      });
      const leafB = new FakeElement({
        tagName: 'A',
        textContent: 'Pay',
        attributes: { 'data-action': 'pay-2' },
      });
      const allSel = CLICKABLE_QUERY;
      installDom(
        { '#c': container },
        {
          [allSel]: [leafA, leafB],
          // unique-in-document check: only pay-2 is unique
          '[data-action="pay-1"]': [leafA, leafB],
          '[data-action="pay-2"]': [leafB],
        },
      );
      const page = createExecPage();
      const res = await businessService.overrideContainerToLeaf(
        page as never,
        '#c',
        'Pay',
      );
      expect(res).toBe('[data-action="pay-2"]');
    });

    it('returns null when no leaf has a stable selector', async () => {
      const container = new FakeElement({ attributes: { role: 'menu' } });
      const leaf = new FakeElement({ tagName: 'A', textContent: 'Item' });
      const allSel = CLICKABLE_QUERY;
      installDom({ '#c': container }, { [allSel]: [leaf] });
      const page = createExecPage();
      const res = await businessService.overrideContainerToLeaf(
        page as never,
        '#c',
        'Item',
      );
      expect(res).toBeNull();
    });

    it('builds a selector from a generic data-*-code attribute', async () => {
      const container = new FakeElement({
        attributes: { class: 'menu-folder' },
      });
      const leaf = new FakeElement({
        tagName: 'A',
        textContent: 'Open',
        attributes: { 'data-ajax-code': 'ABC' },
      });
      const allSel = CLICKABLE_QUERY;
      installDom({ '#c': container }, { [allSel]: [leaf] });
      const page = createExecPage();
      const res = await businessService.overrideContainerToLeaf(
        page as never,
        '#c',
        'Open',
      );
      expect(res).toBe('[data-ajax-code="ABC"]');
    });

    it('returns null when the container has no matching leaf text', async () => {
      const container = new FakeElement({ attributes: { role: 'menubar' } });
      const allSel = CLICKABLE_QUERY;
      installDom({ '#c': container }, { [allSel]: [] });
      const page = createExecPage();
      const res = await businessService.overrideContainerToLeaf(
        page as never,
        '#c',
        'Nothing',
      );
      expect(res).toBeNull();
    });
  });

  describe('validateSelector — node disappears in checks callback', () => {
    it('returns NOT_FOUND when querySelector yields null inside the checks callback', async () => {
      // $$ found one element, but by the time the checks evaluate runs the
      // node is gone -> { exists: false }.
      installDom({ '#gone': null });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      const res = await service.validateSelector(page as never, '#gone');
      expect(res.ok).toBe(false);
      expect(res.type).toBe('AI_SELECTOR_NOT_FOUND');
    });
  });

  describe('overrideContainerToLeaf — null/contains branches', () => {
    it('returns null when the chosen node does not exist', async () => {
      installDom({ '#missing': null });
      const page = createExecPage();
      const res = await service.overrideContainerToLeaf(
        page as never,
        '#missing',
        'Item',
      );
      expect(res).toBeNull();
    });

    it('uses the contains fallback when no leaf matches exactly', async () => {
      const container = new FakeElement({ attributes: { role: 'menu' } });
      const leaf = new FakeElement({
        tagName: 'A',
        textContent: 'Go to Settings Page',
        attributes: { 'data-testid': 'settings' },
      });
      const allSel = CLICKABLE_QUERY;
      installDom({ '#c': container }, { [allSel]: [leaf] });
      const page = createExecPage();
      const res = await businessService.overrideContainerToLeaf(
        page as never,
        '#c',
        'settings',
      );
      expect(res).toBe('[data-testid="settings"]');
    });

    it('returns null when multiple leaves remain non-unique', async () => {
      const container = new FakeElement({ attributes: { role: 'menu' } });
      const leafA = new FakeElement({
        tagName: 'A',
        textContent: 'Pay',
        attributes: { 'data-action': 'dup' },
      });
      const leafB = new FakeElement({
        tagName: 'A',
        textContent: 'Pay',
        attributes: { 'data-action': 'dup' },
      });
      const allSel = CLICKABLE_QUERY;
      installDom(
        { '#c': container },
        { [allSel]: [leafA, leafB], '[data-action="dup"]': [leafA, leafB] },
      );
      const page = createExecPage();
      const res = await businessService.overrideContainerToLeaf(
        page as never,
        '#c',
        'Pay',
      );
      expect(res).toBeNull();
    });
  });

  describe('hoverAncestorsAndRevalidate — empty / no-trigger cases', () => {
    it('returns NOT_VISIBLE when the target has no ancestors', async () => {
      const node = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        parentElement: null,
      });
      installDom({ '#x': node });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      const res = await service.validateSelector(page as never, '#x');
      expect(res.type).toBe('AI_ELEMENT_NOT_VISIBLE');
      expect(page.hover).not.toHaveBeenCalled();
    });

    it('skips ancestors that are not menu triggers', async () => {
      const plainParent = new FakeElement({ tagName: 'DIV' });
      const node = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        parentElement: plainParent,
      });
      installDom({ '#x': node });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      const res = await service.validateSelector(page as never, '#x');
      // no triggers tagged -> no hover
      expect(page.hover).not.toHaveBeenCalled();
      expect(res.type).toBe('AI_ELEMENT_NOT_VISIBLE');
    });

    it('recognises an anchor-with-href and role=menuitem ancestor as triggers', async () => {
      const linkAncestor = new FakeElement({
        tagName: 'A',
        attributes: { href: '/x', role: 'menuitem' },
      });
      const node = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        parentElement: linkAncestor,
      });
      installDom({ '#x': node }, { '[data-baldr-hover]': [] });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      await service.validateSelector(page as never, '#x');
      expect(page.hover).toHaveBeenCalledTimes(1);
      expect(linkAncestor.hasAttribute('data-baldr-hover')).toBe(true);
    });
  });

  describe('overrideContainerToLeaf — generic data-*-code attribute', () => {
    it('builds a selector from a generic data-xxx-id attribute', async () => {
      const container = new FakeElement({ attributes: { role: 'menu' } });
      const leaf = new FakeElement({
        tagName: 'A',
        textContent: 'Open',
        attributes: { 'data-widget-id': 'W42' },
      });
      const allSel = CLICKABLE_QUERY;
      installDom(
        { '#c': container },
        { [allSel]: [leaf], '[data-widget-id="W42"]': [leaf] },
      );
      const page = createExecPage();
      const res = await businessService.overrideContainerToLeaf(
        page as never,
        '#c',
        'Open',
      );
      expect(res).toBe('[data-widget-id="W42"]');
    });
  });

  describe('overrideContainerToLeaf — isUniqueInDocument catch', () => {
    it('treats a selector as non-unique when querySelectorAll throws', async () => {
      const container = new FakeElement({ attributes: { role: 'menu' } });
      const leafA = new FakeElement({
        tagName: 'A',
        textContent: 'Pay',
        attributes: { 'data-action': 'a' },
      });
      const leafB = new FakeElement({
        tagName: 'A',
        textContent: 'Pay',
        attributes: { 'data-action': 'b' },
      });
      const allSel = CLICKABLE_QUERY;
      const fakeDocument = {
        querySelector: (sel: string) => (sel === '#c' ? container : null),
        querySelectorAll: (sel: string): FakeElement[] => {
          if (sel === allSel) return [leafA, leafB];
          // both uniqueness checks throw -> isUniqueInDocument returns false
          throw new Error('bad selector');
        },
      };
      vi.stubGlobal('document', fakeDocument);
      vi.stubGlobal('CSS', { escape: (s: string) => s });
      const page = createExecPage();
      const res = await businessService.overrideContainerToLeaf(
        page as never,
        '#c',
        'Pay',
      );
      expect(res).toBeNull();
    });
  });

  describe('hoverAncestorsAndRevalidate — role/hover/cleanup branches', () => {
    it('returns [] when the target selector resolves to null (no hover)', async () => {
      // checks callback runs against a hidden node; the ancestor-collection
      // callback then queries the SAME selector but it is now gone -> [].
      const hidden = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        parentElement: new FakeElement({ tagName: 'BUTTON' }),
      });
      const selMap: Record<string, FakeElement | null> = { '#g': hidden };
      installDom(selMap, { '[data-baldr-hover]': [] });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      // make node vanish right after the visibility checks callback
      let calls = 0;
      page.evaluate.mockImplementation(
        async (fn: unknown, ...args: unknown[]) => {
          calls++;
          if (calls === 2) selMap['#g'] = null; // before ancestor collection
          return typeof fn === 'function'
            ? await (fn as (...a: unknown[]) => unknown)(...args)
            : undefined;
        },
      );
      const res = await service.validateSelector(page as never, '#g');
      expect(page.hover).not.toHaveBeenCalled();
      expect(res.type).toBe('AI_ELEMENT_NOT_VISIBLE');
    });

    it('recognises role=button ancestors and continues when hover throws', async () => {
      const ancestor = new FakeElement({
        tagName: 'DIV',
        attributes: { role: 'button' },
      });
      const node = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        parentElement: ancestor,
      });
      installDom({ '#h': node }, { '[data-baldr-hover]': [ancestor] });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      page.hover.mockRejectedValueOnce(new Error('not hoverable'));
      const res = await service.validateSelector(page as never, '#h');
      expect(page.hover).toHaveBeenCalledTimes(1);
      // hover threw -> continue -> no reveal -> not visible
      expect(res.type).toBe('AI_ELEMENT_NOT_VISIBLE');
      // cleanup forEach should have run on the tagged ancestor
      expect(ancestor.hasAttribute('data-baldr-hover')).toBe(false);
    });

    it('returns NOT_VISIBLE when the ancestor-collection evaluate throws (catch)', async () => {
      const node = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
      });
      installDom({ '#e': node });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      let calls = 0;
      page.evaluate.mockImplementation(
        async (fn: unknown, ...args: unknown[]) => {
          calls++;
          if (calls === 2) throw new Error('frame detached during collection');
          return typeof fn === 'function'
            ? await (fn as (...a: unknown[]) => unknown)(...args)
            : undefined;
        },
      );
      const res = await service.validateSelector(page as never, '#e');
      expect(res.type).toBe('AI_ELEMENT_NOT_VISIBLE');
      expect(page.hover).not.toHaveBeenCalled();
    });

    it('post-hover visibility check returns false when the node is gone', async () => {
      const ancestor = new FakeElement({ tagName: 'BUTTON' });
      const node = new FakeElement({
        tagName: 'SPAN',
        style: { display: 'none', visibility: 'visible', opacity: '1' },
        parentElement: ancestor,
      });
      const selMap: Record<string, FakeElement | null> = { '#p': node };
      installDom(selMap, { '[data-baldr-hover]': [ancestor] });
      const page = createExecPage();
      page.$$.mockResolvedValueOnce([{}]);
      page.hover.mockImplementation(async () => {
        selMap['#p'] = null; // node disappears before post-hover check
      });
      const res = await service.validateSelector(page as never, '#p');
      expect(res.type).toBe('AI_ELEMENT_NOT_VISIBLE');
      // cleanup removed the hover marker
      expect(ancestor.hasAttribute('data-baldr-hover')).toBe(false);
    });
  });

  describe('verifyTargetText callback', () => {
    it('matches against textContent', async () => {
      const node = new FakeElement({ textContent: 'Submit Form' });
      installDom({ '#b': node });
      const page = createExecPage();
      const res = await service.verifyTargetText(page as never, '#b', 'submit');
      expect(res).toBe(true);
    });

    it('matches against aria-label', async () => {
      const node = new FakeElement({
        attributes: { 'aria-label': 'Close dialog' },
      });
      installDom({ '#b': node });
      const page = createExecPage();
      const res = await service.verifyTargetText(page as never, '#b', 'close');
      expect(res).toBe(true);
    });

    it('matches against title attribute', async () => {
      const node = new FakeElement({ attributes: { title: 'Help center' } });
      installDom({ '#b': node });
      const page = createExecPage();
      const res = await service.verifyTargetText(page as never, '#b', 'help');
      expect(res).toBe(true);
    });

    it('returns false when no field matches', async () => {
      const node = new FakeElement({ textContent: 'Other' });
      installDom({ '#b': node });
      const page = createExecPage();
      const res = await service.verifyTargetText(page as never, '#b', 'nope');
      expect(res).toBe(false);
    });

    it('returns false when the node does not exist', async () => {
      installDom({ '#b': null });
      const page = createExecPage();
      const res = await service.verifyTargetText(page as never, '#b', 'x');
      expect(res).toBe(false);
    });
  });

  describe('getChosenElementDetails callback', () => {
    it('returns trimmed textContent', async () => {
      const node = new FakeElement({ textContent: '  Hello   World  ' });
      installDom({ '#b': node });
      const page = createExecPage();
      const res = await service.getChosenElementDetails(page as never, '#b');
      expect(res).toBe('Hello World');
    });

    it('falls back to aria-label when textContent is empty', async () => {
      const node = new FakeElement({
        textContent: '',
        attributes: { 'aria-label': 'Aria text' },
      });
      installDom({ '#b': node });
      const page = createExecPage();
      const res = await service.getChosenElementDetails(page as never, '#b');
      expect(res).toBe('Aria text');
    });

    it('truncates long text to 80 chars with ellipsis', async () => {
      const long = 'a'.repeat(120);
      const node = new FakeElement({ textContent: long });
      installDom({ '#b': node });
      const page = createExecPage();
      const res = await service.getChosenElementDetails(page as never, '#b');
      expect(res).toHaveLength(81); // 80 chars + ellipsis
      expect(res.endsWith('…')).toBe(true);
    });

    it('returns marker when element not found', async () => {
      installDom({ '#b': null });
      const page = createExecPage();
      const res = await service.getChosenElementDetails(page as never, '#b');
      expect(res).toBe('<element not found>');
    });
  });
});
