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

vi.mock('@shared/utils/lru-cache.util.js', () => ({
  LRUCache: class {
    private _store = new Map<string, unknown>();
    get(key: string) {
      return this._store.get(key);
    }
    set(key: string, value: unknown) {
      this._store.set(key, value);
    }
    clear() {
      this._store.clear();
    }
  },
}));

import {
  DomLiteExtractorService,
  type InteractiveElement,
} from './dom-lite-extractor.service.js';

function createMockPage() {
  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    evaluate: vi.fn().mockResolvedValue([]),
  };
}

describe('DomLiteExtractorService', () => {
  describe('extractInteractive', () => {
    it('calls page.evaluate to extract interactive elements', async () => {
      const service = new DomLiteExtractorService();
      const page = createMockPage();
      const mockElements: InteractiveElement[] = [
        { tag: 'button', text: 'Click me', id: 'btn1', idx: 0 },
        { tag: 'a', href: '/page', text: 'Link', idx: 1 },
      ];
      // First evaluate: scrollHeight
      page.evaluate.mockResolvedValueOnce(1000);
      // Second evaluate: shimTsxName already mocked
      // Third evaluate: the main extraction
      page.evaluate.mockResolvedValueOnce(mockElements);

      const result = await service.extractInteractive(page as never);
      expect(result).toEqual(mockElements);
    });

    it('handles empty page', async () => {
      const service = new DomLiteExtractorService();
      const page = createMockPage();
      page.evaluate.mockResolvedValueOnce(1000); // scrollHeight
      page.evaluate.mockResolvedValueOnce([]); // elements

      const result = await service.extractInteractive(page as never);
      expect(result).toEqual([]);
    });
  });

  describe('serializeWithBudget', () => {
    it('serializes elements to JSON within budget', () => {
      const service = new DomLiteExtractorService();
      const elements: InteractiveElement[] = [
        { tag: 'button', text: 'Click me', id: 'btn1' },
        { tag: 'a', href: '/page', text: 'Link' },
      ];

      const result = service.serializeWithBudget(elements, 10000);
      expect(result.json).toBeDefined();
      expect(result.includedCount).toBeLessThanOrEqual(elements.length);
      expect(result.totalCount).toBe(elements.length);
    });

    it('truncates when elements exceed budget', () => {
      const service = new DomLiteExtractorService();
      const elements: InteractiveElement[] = Array.from(
        { length: 200 },
        (_, i) => ({
          tag: 'button',
          text: `Button ${String(i)} with some longer text to fill up budget quickly`,
          id: `btn${String(i)}`,
          class: `class-${String(i)} extra-class another-class`,
          ariaLabel: `Aria Label for Button ${String(i)}`,
          dataTestid: `test-${String(i)}`,
        }),
      );

      const result = service.serializeWithBudget(elements, 500);
      expect(result.includedCount).toBeLessThan(elements.length);
      expect(result.json.length).toBeLessThanOrEqual(600); // some overhead allowed
    });

    it('handles empty elements array', () => {
      const service = new DomLiteExtractorService();
      const result = service.serializeWithBudget([], 10000);
      expect(result.includedCount).toBe(0);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('clearCache', () => {
    it('clears the cache without error', () => {
      const service = new DomLiteExtractorService();
      expect(() => service.clearCache()).not.toThrow();
    });
  });
});

/* --------------------------------------------------------------------------
 * Minimal but realistic fake-DOM toolkit.
 *
 * The main extraction logic runs inside `page.evaluate(() => { ... })`.
 * To actually COVER that code we make the page mock execute the callback in
 * Node and stub the DOM globals it reads (document / window / getComputedStyle).
 * Each FakeElement exposes exactly the properties/methods the callback uses.
 * ------------------------------------------------------------------------ */

interface FakeElementInit {
  tag: string;
  attrs?: Record<string, string>;
  text?: string;
  value?: string;
  rect?: { top: number; width: number; height: number };
  style?: Partial<{ display: string; visibility: string; opacity: string }>;
  children?: FakeElement[];
}

class FakeElement {
  tagName: string;
  attrs: Record<string, string>;
  textContent: string;
  value?: string;
  rect: { top: number; width: number; height: number };
  style: { display: string; visibility: string; opacity: string };
  children: FakeElement[];
  parentElement: FakeElement | null = null;
  previousElementSibling: FakeElement | null = null;
  scrollHeight = 0;

  constructor(init: FakeElementInit) {
    this.tagName = init.tag.toUpperCase();
    this.attrs = init.attrs ?? {};
    this.textContent = init.text ?? '';
    this.value = init.value;
    this.rect = init.rect ?? { top: 0, width: 10, height: 10 };
    this.style = {
      display: init.style?.display ?? 'block',
      visibility: init.style?.visibility ?? 'visible',
      opacity: init.style?.opacity ?? '1',
    };
    this.children = init.children ?? [];
    for (const child of this.children) child.parentElement = this;
  }

  getAttribute(name: string): string | null {
    return name in this.attrs ? this.attrs[name] : null;
  }

  hasAttribute(name: string): boolean {
    return name in this.attrs;
  }

  get attributes(): { name: string; value: string }[] {
    return Object.entries(this.attrs).map(([name, value]) => ({ name, value }));
  }

  getBoundingClientRect() {
    return this.rect;
  }

  // Returns the first descendant matching one of the comma-separated tags.
  querySelector(sel: string): FakeElement | null {
    const tags = sel.split(',').map((s) => s.trim().toUpperCase());
    const walk = (node: FakeElement): FakeElement | null => {
      for (const c of node.children) {
        if (tags.includes(c.tagName)) return c;
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }
}

/** Links a flat list of siblings via previousElementSibling and parent. */
function asSiblings(parent: FakeElement, siblings: FakeElement[]): void {
  siblings.forEach((el, i) => {
    el.parentElement = parent;
    el.previousElementSibling = i > 0 ? siblings[i - 1] : null;
  });
  parent.children = siblings;
}

function buildFakeDom(opts: {
  matched: FakeElement[];
  body?: FakeElement;
  byId?: Record<string, FakeElement>;
  scrollHeight?: number;
}) {
  const body =
    opts.body ??
    new FakeElement({ tag: 'body', rect: { top: 0, width: 0, height: 0 } });
  const documentElement = { scrollHeight: opts.scrollHeight ?? 2000 };
  const fakeDocument = {
    body,
    documentElement,
    querySelectorAll: vi.fn((_sel: string) => opts.matched),
    getElementById: vi.fn((id: string) => opts.byId?.[id] ?? null),
  };
  return { fakeDocument, body };
}

/** A page whose evaluate runs the callback in Node (incl. the scrollHeight probe). */
function createExecutingPage(
  _scrollHeight: number,
  url = 'https://example.com',
) {
  return {
    url: vi.fn().mockReturnValue(url),
    evaluate: vi.fn(
      async (fn: (...a: unknown[]) => unknown, ...args: unknown[]) =>
        typeof fn === 'function' ? await fn(...args) : undefined,
    ),
  };
}

function stubBrowserGlobals(fakeDocument: unknown) {
  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    scrollY: 0,
    getComputedStyle: (el: FakeElement) => el.style,
  });
  // Some environments read getComputedStyle off the global scope directly.
  vi.stubGlobal('getComputedStyle', (el: FakeElement) => el.style);
}

describe('DomLiteExtractorService — real page.evaluate extraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts a fully-attributed visible button (all enrichment branches)', async () => {
    const heading = new FakeElement({ tag: 'h2', text: '  My   Section  ' });
    const button = new FakeElement({
      tag: 'button',
      text: 'Submit\nthe form',
      attrs: {
        id: 'submit-btn',
        class: 'btn primary',
        name: 'submit',
        type: 'submit',
        role: 'button',
        title: 'Send it',
        'aria-label': 'Submit form',
        'aria-labelledby': 'lbl1 lbl2',
        'aria-describedby': 'desc1',
        'data-testid': 'submit',
        'data-cy': 'submit-cy',
        'data-test': 'submit-test',
        'data-ajax-code': 'ITEM_DETAIL',
      },
      rect: { top: 500, width: 100, height: 30 },
    });

    // Landmark wrapping: nav > section(button) preceded by heading.
    const section = new FakeElement({ tag: 'section', children: [button] });
    asSiblings(new FakeElement({ tag: 'div' }), [heading, section]);
    const nav = new FakeElement({
      tag: 'nav',
      children: [section.parentElement!],
    });
    section.parentElement!.parentElement = nav;

    const lbl1 = new FakeElement({ tag: 'span', text: 'Hello' });
    const lbl2 = new FakeElement({ tag: 'span', text: 'World' });

    const { fakeDocument } = buildFakeDom({
      matched: [button],
      byId: { lbl1, lbl2 },
      scrollHeight: 2000,
    });
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();
    const page = createExecutingPage(2000);
    const result = await service.extractInteractive(page as never);

    expect(result).toHaveLength(1);
    const el = result[0];
    expect(el.tag).toBe('button');
    expect(el.id).toBe('submit-btn');
    expect(el.class).toBe('btn primary');
    expect(el.name).toBe('submit');
    expect(el.type).toBe('submit');
    expect(el.role).toBe('button');
    expect(el.title).toBe('Send it');
    expect(el.text).toBe('Submit the form'); // whitespace collapsed
    expect(el.ariaLabel).toBe('Submit form');
    expect(el.ariaLabelledby).toBe('Hello World'); // resolved via getElementById
    expect(el.ariaDescribedby).toBe('desc1');
    expect(el.dataTestid).toBe('submit');
    expect(el.dataCy).toBe('submit-cy');
    expect(el.dataTest).toBe('submit-test');
    // reserved data-* are excluded; the business attr is kept in dataAttrs
    expect(el.dataAttrs).toContain('data-ajax-code="ITEM_DETAIL"');
    expect(el.dataAttrs).not.toContain('data-testid');
    expect(el.nearestHeading).toBe('My Section');
    expect(el.nearestLandmark).toBe('nav');
    expect(el.visible).toBe(true);
    expect(el.disabled).toBe(false);
    expect(el.position).toBeGreaterThan(0);
    expect(el.position).toBeLessThanOrEqual(1);
    expect(el.idx).toBe(0);
  });

  it('marks elements hidden via display:none and disabled via attributes', async () => {
    const hiddenByDisplay = new FakeElement({
      tag: 'a',
      attrs: { href: '/x' },
      style: { display: 'none', visibility: 'visible', opacity: '1' },
    });
    const hiddenByVisibility = new FakeElement({
      tag: 'a',
      attrs: { href: '/y' },
      style: { display: 'block', visibility: 'hidden', opacity: '1' },
    });
    const hiddenByOpacity = new FakeElement({
      tag: 'a',
      attrs: { href: '/z' },
      style: { display: 'block', visibility: 'visible', opacity: '0' },
    });
    const hiddenByZeroRect = new FakeElement({
      tag: 'a',
      attrs: { href: '/w' },
      rect: { top: 0, width: 0, height: 0 },
    });
    const disabledAttr = new FakeElement({
      tag: 'button',
      text: 'Off',
      attrs: { disabled: '' },
    });
    const ariaDisabled = new FakeElement({
      tag: 'button',
      text: 'Aria off',
      attrs: { 'aria-disabled': 'true' },
    });

    const { fakeDocument } = buildFakeDom({
      matched: [
        hiddenByDisplay,
        hiddenByVisibility,
        hiddenByOpacity,
        hiddenByZeroRect,
        disabledAttr,
        ariaDisabled,
      ],
    });
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();
    const page = createExecutingPage(1500);
    const result = await service.extractInteractive(page as never);

    expect(result.map((e) => e.visible)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
    expect(result[4].disabled).toBe(true); // disabled attribute
    expect(result[5].disabled).toBe(true); // aria-disabled="true"
    // href captured for links
    expect(result[0].href).toBe('/x');
  });

  it('captures input value and truncates long text', async () => {
    const longText = 'x'.repeat(200);
    const input = new FakeElement({
      tag: 'input',
      attrs: { type: 'text', placeholder: 'Enter', alt: 'altv' },
      value: 'typed value',
    });
    const textarea = new FakeElement({ tag: 'textarea', value: 'big' });
    const longButton = new FakeElement({ tag: 'button', text: longText });

    const { fakeDocument } = buildFakeDom({
      matched: [input, textarea, longButton],
    });
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();
    const page = createExecutingPage(1000);
    const result = await service.extractInteractive(page as never);

    expect(result[0].value).toBe('typed value');
    expect(result[0].placeholder).toBe('Enter');
    expect(result[0].alt).toBe('altv');
    expect(result[1].value).toBe('big');
    // text truncated to 120 chars + ellipsis
    expect(result[2].text!.endsWith('…')).toBe(true);
    expect(result[2].text!.length).toBe(121);
  });

  it('never captures the value of password / sensitive inputs', async () => {
    const passwordInput = new FakeElement({
      tag: 'input',
      attrs: { type: 'password', name: 'Password' },
      value: 'SuperSecret123',
    });
    const cardInput = new FakeElement({
      tag: 'input',
      attrs: { type: 'text', name: 'card-number' },
      value: '4111111111111111',
    });
    const tokenById = new FakeElement({
      tag: 'input',
      attrs: { type: 'text', id: 'csrf-token' },
      value: 'tok-abc',
    });
    const byAutocomplete = new FakeElement({
      tag: 'input',
      attrs: { type: 'text', autocomplete: 'current-password' },
      value: 'pw-from-autocomplete',
    });
    const safeInput = new FakeElement({
      tag: 'input',
      attrs: { type: 'text', name: 'firstName' },
      value: 'Jean',
    });

    const { fakeDocument } = buildFakeDom({
      matched: [passwordInput, cardInput, tokenById, byAutocomplete, safeInput],
    });
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();
    const page = createExecutingPage(1000);
    const result = await service.extractInteractive(page as never);

    // Sensitive fields: value omitted, other attributes preserved.
    expect(result[0].value).toBeUndefined();
    expect(result[0].type).toBe('password');
    expect(result[1].value).toBeUndefined();
    expect(result[2].value).toBeUndefined();
    expect(result[3].value).toBeUndefined();
    // Non-sensitive field keeps its value.
    expect(result[4].value).toBe('Jean');
  });

  it('filters reserved/dynamic/oversized data-* and caps dataAttrs at 6 pairs', async () => {
    const attrs: Record<string, string> = {
      'data-baldr-target': 'reserved',
      'data-uuid': 'abcdef0123456789abcdef', // dynamic hash → filtered
      'data-empty': '', // empty → filtered
      'data-long': 'y'.repeat(90), // >80 → filtered
      'data-a': '1',
      'data-b': '2',
      'data-c': '3',
      'data-d': '4',
      'data-e': '5',
      'data-f': '6',
      'data-g': '7', // 7th valid → dropped by the cap of 6
    };
    const el = new FakeElement({
      tag: 'div',
      attrs: { ...attrs, role: 'button' },
    });
    const { fakeDocument } = buildFakeDom({ matched: [el] });
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();
    const page = createExecutingPage(1000);
    const result = await service.extractInteractive(page as never);

    const dataAttrs = result[0].dataAttrs!;
    const pairs = dataAttrs.split(' ');
    expect(pairs).toHaveLength(6);
    expect(dataAttrs).not.toContain('data-baldr-target');
    expect(dataAttrs).not.toContain('data-uuid');
    expect(dataAttrs).not.toContain('data-empty');
    expect(dataAttrs).not.toContain('data-long');
    expect(dataAttrs).not.toContain('data-g');
    expect(dataAttrs).toContain('data-a="1"');
  });

  it('finds a heading nested inside a previous sibling and a role-based landmark', async () => {
    const nestedHeadingHolder = new FakeElement({
      tag: 'div',
      children: [new FakeElement({ tag: 'h3', text: 'Nested Title' })],
    });
    const target = new FakeElement({ tag: 'button', text: 'Go' });
    const container = new FakeElement({
      tag: 'div',
      attrs: { role: 'navigation' },
    });
    asSiblings(container, [nestedHeadingHolder, target]);

    const { fakeDocument } = buildFakeDom({ matched: [target] });
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();
    const page = createExecutingPage(1000);
    const result = await service.extractInteractive(page as never);

    expect(result[0].nearestHeading).toBe('Nested Title');
    expect(result[0].nearestLandmark).toBe('navigation'); // role-based
  });

  it('handles missing document.body (bodyHeight fallback to 0) and empty aria-labelledby', async () => {
    const el = new FakeElement({
      tag: 'a',
      attrs: { href: '/h', 'aria-labelledby': 'missing-id' },
      text: 'Link',
    });
    const fakeDocument = {
      body: null,
      documentElement: { scrollHeight: 0 },
      querySelectorAll: vi.fn(() => [el]),
      getElementById: vi.fn(() => null), // referenced id not found
    };
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();
    const page = createExecutingPage(0);
    const result = await service.extractInteractive(page as never);

    expect(result[0].tag).toBe('a');
    // aria-labelledby resolved to '' (no matching element) → property omitted
    expect(result[0].ariaLabelledby).toBeUndefined();
    // docHeight clamps to 1 via Math.max, position computed without throwing
    expect(typeof result[0].position).toBe('number');
  });

  it('returns cached result on a second call with identical key (cache hit branch)', async () => {
    const el = new FakeElement({ tag: 'button', text: 'Once' });
    const { fakeDocument } = buildFakeDom({ matched: [el], scrollHeight: 777 });
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();

    const page1 = createExecutingPage(777);
    const first = await service.extractInteractive(page1 as never);
    expect(first).toHaveLength(1);

    // Same url + scrollHeight → cache hit, callback not re-run.
    const page2 = createExecutingPage(777);
    const second = await service.extractInteractive(page2 as never);
    expect(second).toBe(first);
    // Only the scrollHeight probe ran on the second call (no extraction).
    expect(page2.evaluate).toHaveBeenCalledTimes(1);
  });

  it('walks past a non-heading previous sibling before finding the heading', async () => {
    // First previous sibling is a plain div with no h1-h6 (neither itself nor
    // nested) → the inner loop must advance to the next previous sibling.
    const plainPrev = new FakeElement({ tag: 'div', text: 'no heading here' });
    const headingPrev = new FakeElement({ tag: 'h1', text: 'Top Heading' });
    const target = new FakeElement({ tag: 'button', text: 'Act' });
    const container = new FakeElement({ tag: 'div' });
    // order: headingPrev, plainPrev, target → walking back from target hits
    // plainPrev (no heading, nested null) then headingPrev (match).
    asSiblings(container, [headingPrev, plainPrev, target]);

    const { fakeDocument } = buildFakeDom({ matched: [target] });
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();
    const page = createExecutingPage(1000);
    const result = await service.extractInteractive(page as never);
    expect(result[0].nearestHeading).toBe('Top Heading');
  });

  it('handles a data-* attribute whose value is undefined (nullish fallback)', async () => {
    const el = new FakeElement({ tag: 'div', attrs: { role: 'button' } });
    // Inject an attribute object whose value is undefined to exercise `?? ''`.
    Object.defineProperty(el, 'attributes', {
      get() {
        return [{ name: 'data-x', value: undefined }];
      },
    });
    const { fakeDocument } = buildFakeDom({ matched: [el] });
    stubBrowserGlobals(fakeDocument);

    const service = new DomLiteExtractorService();
    const page = createExecutingPage(1000);
    const result = await service.extractInteractive(page as never);
    // undefined → '' → length 0 → filtered out, so no dataAttrs.
    expect(result[0].dataAttrs).toBeUndefined();
  });

  it('wraps and rethrows extraction errors', async () => {
    const service = new DomLiteExtractorService();
    const page = {
      url: vi.fn().mockReturnValue('https://err.example'),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(123) // scrollHeight probe
        .mockRejectedValueOnce(new Error('boom')), // main extraction fails
    };
    await expect(service.extractInteractive(page as never)).rejects.toThrow(
      /Lite DOM extraction failed: boom/,
    );
  });

  it('wraps a non-Error rejection using String() (else branch)', async () => {
    const service = new DomLiteExtractorService();
    const page = {
      url: vi.fn().mockReturnValue('https://err2.example'),
      evaluate: vi
        .fn()
        .mockResolvedValueOnce(99) // scrollHeight probe
        .mockRejectedValueOnce('plain string failure'), // non-Error thrown
    };
    await expect(service.extractInteractive(page as never)).rejects.toThrow(
      /Lite DOM extraction failed: plain string failure/,
    );
  });
});

describe('DomLiteExtractorService — hasStableSelector via serializeWithBudget ordering', () => {
  it('orders visible, then hidden-stable, then hidden-other', () => {
    const service = new DomLiteExtractorService();
    const elements: InteractiveElement[] = [
      { tag: 'a', visible: false, disabled: false, idx: 0 }, // hidden-other
      { tag: 'button', visible: true, disabled: false, id: 'v', idx: 1 }, // visible
      {
        tag: 'div',
        visible: false,
        disabled: false,
        dataAttrs: 'data-ajax-code="X"',
        idx: 2,
      }, // hidden-stable via business attr regex
      {
        tag: 'span',
        visible: true,
        disabled: true, // disabled → not "visible" bucket
        dataTestid: 'ts',
        idx: 3,
      }, // hidden-stable via dataTestid
    ];

    const { json, totalCount } = service.serializeWithBudget(elements, 100000);
    const parsed = JSON.parse(json) as InteractiveElement[];
    expect(totalCount).toBe(4);
    // first: the only visible+enabled element
    expect(parsed[0].idx).toBe(1);
    // next two: hidden-stable (idx 2 and 3 in some order before hidden-other)
    const stableIdx = [parsed[1].idx, parsed[2].idx].sort();
    expect(stableIdx).toEqual([2, 3]);
    // last: hidden-other
    expect(parsed[3].idx).toBe(0);
  });

  it('treats dataAttrs without a recognized business pattern as hidden-other', () => {
    const service = new DomLiteExtractorService();
    const elements: InteractiveElement[] = [
      {
        tag: 'div',
        visible: false,
        disabled: false,
        dataAttrs: 'data-misc="plain"', // does not match STABLE_DATA_ATTR_RE
        idx: 0,
      },
      { tag: 'button', visible: true, disabled: false, idx: 1 },
    ];
    const { json } = service.serializeWithBudget(elements, 100000);
    const parsed = JSON.parse(json) as InteractiveElement[];
    // visible first, then the non-stable hidden one
    expect(parsed[0].idx).toBe(1);
    expect(parsed[1].idx).toBe(0);
  });
});

describe('DomLiteExtractorService — filterToViewport', () => {
  it('keeps only visible, enabled elements', () => {
    const service = new DomLiteExtractorService();
    const elements: InteractiveElement[] = [
      { tag: 'a', visible: true, disabled: false, idx: 0 },
      { tag: 'a', visible: false, disabled: false, idx: 1 },
      { tag: 'a', visible: true, disabled: true, idx: 2 },
    ];
    const kept = service.filterToViewport(elements);
    expect(kept.map((e) => e.idx)).toEqual([0]);
  });
});
