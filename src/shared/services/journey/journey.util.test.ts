import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  normalizeCamelCaseAttributes,
  isOnUrl,
  isSameBasePath,
  descriptionImpliesNavigation,
  detectAuthAtStart,
  isHrefNavigable,
  resolveUrl,
  inferErrorContext,
  waitForUrlChange,
} from './journey.util.js';
import { JourneyError } from './journey-error.util.js';

describe('normalizeCamelCaseAttributes', () => {
  it('converts a single camelCase attribute with quoted value', () => {
    expect(normalizeCamelCaseAttributes('[dataCy="x"]')).toBe('[data-cy="x"]');
  });

  it('converts ariaLabel with single quotes', () => {
    expect(normalizeCamelCaseAttributes("[ariaLabel='Submit']")).toBe(
      "[aria-label='Submit']",
    );
  });

  it('converts multi-word camelCase like dataAjaxCode', () => {
    expect(normalizeCamelCaseAttributes('[dataAjaxCode="ITEM"]')).toBe(
      '[data-ajax-code="ITEM"]',
    );
  });

  it('preserves a compound selector (tag + attribute + class)', () => {
    expect(normalizeCamelCaseAttributes('a[dataCy="link"].external-link')).toBe(
      'a[data-cy="link"].external-link',
    );
  });

  it('converts multiple camelCase attributes in the same selector', () => {
    expect(normalizeCamelCaseAttributes('[dataCy="x"][ariaLabel="y"]')).toBe(
      '[data-cy="x"][aria-label="y"]',
    );
  });

  it('leaves a selector with no attributes untouched', () => {
    expect(normalizeCamelCaseAttributes('#foo .bar')).toBe('#foo .bar');
  });

  it('leaves a kebab-case attribute untouched', () => {
    expect(normalizeCamelCaseAttributes('[data-cy="x"]')).toBe('[data-cy="x"]');
  });

  it('leaves a lowercase attribute untouched (href, name, type...)', () => {
    expect(normalizeCamelCaseAttributes('a[href="#"]')).toBe('a[href="#"]');
    expect(normalizeCamelCaseAttributes('input[name="email"]')).toBe(
      'input[name="email"]',
    );
  });

  it('handles attribute selectors without value', () => {
    expect(normalizeCamelCaseAttributes('[dataLoaded]')).toBe('[data-loaded]');
  });

  it('handles non-equal operators (*=, ^=, $=, ~=, |=)', () => {
    expect(normalizeCamelCaseAttributes('[dataCy*="prefix-"]')).toBe(
      '[data-cy*="prefix-"]',
    );
    expect(normalizeCamelCaseAttributes('[ariaLabel^="Submit"]')).toBe(
      '[aria-label^="Submit"]',
    );
  });

  it('preserves nested pseudo-classes and combinators around the attribute', () => {
    expect(normalizeCamelCaseAttributes('div > a[dataCy="x"]:hover')).toBe(
      'div > a[data-cy="x"]:hover',
    );
  });

  it('handles consecutive uppercase letters (acronyms) reasonably', () => {
    // dataAPIKey → data-a-p-i-key (hyphen between each capital). Not ideal
    // for real acronyms but stays correct for the common AI case, which
    // mostly hallucinates on PascalCase of distinct words
    // (dataAjaxCode, ariaLabelledBy).
    expect(normalizeCamelCaseAttributes('[dataAPIKey="x"]')).toBe(
      '[data-a-p-i-key="x"]',
    );
  });

  it('returns empty string unchanged', () => {
    expect(normalizeCamelCaseAttributes('')).toBe('');
  });
});

describe('isOnUrl', () => {
  const mockPage = (url: string) => ({ url: () => url }) as never;

  it('returns true when URLs match exactly (no hash)', () => {
    expect(
      isOnUrl(mockPage('https://app.com/page'), 'https://app.com/page'),
    ).toBe(true);
  });

  it('ignores trailing slash difference (no hash target)', () => {
    expect(
      isOnUrl(mockPage('https://app.com/page/'), 'https://app.com/page'),
    ).toBe(true);
  });

  it('ignores query params when target has no hash', () => {
    expect(
      isOnUrl(mockPage('https://app.com/page?foo=1'), 'https://app.com/page'),
    ).toBe(true);
  });

  it('ignores page hash when target has no hash', () => {
    expect(
      isOnUrl(mockPage('https://app.com/page#section'), 'https://app.com/page'),
    ).toBe(true);
  });

  it('returns true when target has hash and page matches fully', () => {
    const url = 'https://app.com/index.html#/?id=123&lang=fr';
    expect(isOnUrl(mockPage(url), url)).toBe(true);
  });

  it('returns false when target has hash but page is on base URL only', () => {
    expect(
      isOnUrl(
        mockPage('https://app.com/index.html'),
        'https://app.com/index.html#/?id=123',
      ),
    ).toBe(false);
  });

  it('returns false when target has hash but page has different hash', () => {
    expect(
      isOnUrl(
        mockPage('https://app.com/index.html#/home'),
        'https://app.com/index.html#/?id=123',
      ),
    ).toBe(false);
  });
});

describe('isSameBasePath', () => {
  it('returns true for identical URLs', () => {
    expect(isSameBasePath('https://app.com/page', 'https://app.com/page')).toBe(
      true,
    );
  });

  it('returns true when only hash differs', () => {
    expect(
      isSameBasePath(
        'https://app.com/index.html',
        'https://app.com/index.html#/?id=123',
      ),
    ).toBe(true);
  });

  it('returns true when only query differs', () => {
    expect(
      isSameBasePath('https://app.com/page?a=1', 'https://app.com/page?b=2'),
    ).toBe(true);
  });

  it('returns false when paths differ', () => {
    expect(
      isSameBasePath('https://app.com/page-a', 'https://app.com/page-b'),
    ).toBe(false);
  });

  it('returns false when hosts differ', () => {
    expect(isSameBasePath('https://a.com/page', 'https://b.com/page')).toBe(
      false,
    );
  });
});

describe('descriptionImpliesNavigation', () => {
  it('returns false for undefined', () => {
    expect(descriptionImpliesNavigation(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(descriptionImpliesNavigation('')).toBe(false);
  });

  it('detects "naviger" intent', () => {
    expect(descriptionImpliesNavigation('naviger vers la page accueil')).toBe(
      true,
    );
  });

  it('detects "naviguer" intent', () => {
    expect(descriptionImpliesNavigation('naviguer vers le menu')).toBe(true);
  });

  it('detects "aller à" intent', () => {
    expect(descriptionImpliesNavigation('aller à la page contact')).toBe(true);
  });

  it('detects "aller sur" intent', () => {
    expect(descriptionImpliesNavigation('aller sur la page tarifs')).toBe(true);
  });

  it('detects "ouvrir la page" intent', () => {
    expect(descriptionImpliesNavigation('ouvrir la page utilisateur')).toBe(
      true,
    );
  });

  it('detects "consulter" intent', () => {
    expect(descriptionImpliesNavigation('consulter les résultats')).toBe(true);
  });

  it('detects "accéder" intent', () => {
    expect(descriptionImpliesNavigation('accéder au formulaire')).toBe(true);
  });

  it('detects "cliquer sur le lien" intent', () => {
    expect(descriptionImpliesNavigation('cliquer sur le lien contact')).toBe(
      true,
    );
  });

  it('returns false for non-navigation action', () => {
    expect(
      descriptionImpliesNavigation('cliquer sur le bouton soumettre'),
    ).toBe(false);
  });
});

describe('detectAuthAtStart', () => {
  it('returns true when first significant action is auth', () => {
    expect(detectAuthAtStart(['authentification : adfs'])).toBe(true);
  });

  it('returns true when auth follows wait actions', () => {
    expect(
      detectAuthAtStart(['attendre 2 secondes', 'authentification : form']),
    ).toBe(true);
  });

  it('returns false for non-auth first action', () => {
    expect(
      detectAuthAtStart(['cliquer sur le bouton', 'authentification : adfs']),
    ).toBe(false);
  });

  it('returns false for empty actions', () => {
    expect(detectAuthAtStart([])).toBe(false);
  });
});

describe('isHrefNavigable', () => {
  const currentUrl = 'https://example.com/page';

  it('returns false for empty href', () => {
    expect(isHrefNavigable('', currentUrl)).toBe(false);
  });

  it('returns false for whitespace-only href', () => {
    expect(isHrefNavigable('   ', currentUrl)).toBe(false);
  });

  it('returns false for javascript: href', () => {
    expect(isHrefNavigable('javascript:void(0)', currentUrl)).toBe(false);
  });

  it('returns false for mailto: href', () => {
    expect(isHrefNavigable('mailto:test@example.com', currentUrl)).toBe(false);
  });

  it('returns false for tel: href', () => {
    expect(isHrefNavigable('tel:+123456', currentUrl)).toBe(false);
  });

  it('returns false for bare hash', () => {
    expect(isHrefNavigable('#', currentUrl)).toBe(false);
  });

  it('returns false for hash anchor (not SPA)', () => {
    expect(isHrefNavigable('#section', currentUrl)).toBe(false);
  });

  it('returns true for SPA hash route', () => {
    expect(isHrefNavigable('#/dashboard', currentUrl)).toBe(true);
  });

  it('returns true for different path', () => {
    expect(isHrefNavigable('/other-page', currentUrl)).toBe(true);
  });

  it('returns false for same URL (identity)', () => {
    expect(isHrefNavigable('https://example.com/page', currentUrl)).toBe(false);
  });

  it('returns true for same origin different path', () => {
    expect(isHrefNavigable('https://example.com/other', currentUrl)).toBe(true);
  });

  it('returns true for different origin', () => {
    expect(isHrefNavigable('https://other.com/page', currentUrl)).toBe(true);
  });

  it('returns false for non-http protocol', () => {
    expect(isHrefNavigable('ftp://example.com', currentUrl)).toBe(false);
  });

  it('handles unusual hrefs', () => {
    // Some unusual hrefs may still resolve relative to currentUrl
    expect(typeof isHrefNavigable('not-a-url', currentUrl)).toBe('boolean');
  });

  it('returns true for relative URL to different path', () => {
    expect(isHrefNavigable('../other', currentUrl)).toBe(true);
  });

  it('returns true with different query string', () => {
    expect(isHrefNavigable('/page?q=search', currentUrl)).toBe(true);
  });
});

describe('resolveUrl', () => {
  it('resolves relative URL to absolute', () => {
    expect(resolveUrl('/path', 'https://example.com')).toBe(
      'https://example.com/path',
    );
  });

  it('returns absolute URL as-is', () => {
    expect(resolveUrl('https://other.com/x', 'https://example.com')).toBe(
      'https://other.com/x',
    );
  });

  it('returns href as-is on failure', () => {
    expect(resolveUrl('not valid ::::', 'also invalid ::::')).toBe(
      'not valid ::::',
    );
  });
});

describe('inferErrorContext', () => {
  it('returns parsing for AI_PARSING', () => {
    expect(inferErrorContext(new JourneyError('AI_PARSING', 'x'))).toBe(
      'parsing',
    );
  });

  it('returns selector for selector errors', () => {
    expect(
      inferErrorContext(new JourneyError('AI_SELECTOR_NOT_FOUND', 'x')),
    ).toBe('selector');
    expect(
      inferErrorContext(new JourneyError('AI_SELECTOR_INVALID', 'x')),
    ).toBe('selector');
    expect(
      inferErrorContext(new JourneyError('AI_SELECTOR_AMBIGUOUS', 'x')),
    ).toBe('selector');
    expect(
      inferErrorContext(new JourneyError('AI_ELEMENT_NOT_VISIBLE', 'x')),
    ).toBe('selector');
    expect(
      inferErrorContext(new JourneyError('AI_ELEMENT_DISABLED', 'x')),
    ).toBe('selector');
  });

  it('returns navigation for nav errors', () => {
    expect(
      inferErrorContext(new JourneyError('NAVIGATION_POST_ACTION', 'x')),
    ).toBe('navigation');
    expect(inferErrorContext(new JourneyError('NAVIGATION_BLOCK', 'x'))).toBe(
      'navigation',
    );
  });

  it('returns cookies for COOKIE_BANNER', () => {
    expect(inferErrorContext(new JourneyError('COOKIE_BANNER', 'x'))).toBe(
      'cookies',
    );
  });

  it('returns action for other JourneyError types', () => {
    expect(inferErrorContext(new JourneyError('ACTION_EXECUTION', 'x'))).toBe(
      'action',
    );
    expect(inferErrorContext(new JourneyError('BROWSER_CRASH', 'x'))).toBe(
      'action',
    );
  });

  it('returns other for non-JourneyError', () => {
    expect(inferErrorContext(new Error('generic'))).toBe('other');
    expect(inferErrorContext('string error')).toBe('other');
  });
});

describe('waitForUrlChange', () => {
  it('returns true when URL changes', async () => {
    let callCount = 0;
    const page = {
      isClosed: () => false,
      url: () => {
        callCount++;
        return callCount < 3 ? 'https://old.com' : 'https://new.com';
      },
    };
    const result = await waitForUrlChange(
      page as never,
      'https://old.com',
      5000,
    );
    expect(result).toBe(true);
  });

  it('returns false when page is closed', async () => {
    const page = {
      isClosed: () => true,
      url: () => 'https://old.com',
    };
    const result = await waitForUrlChange(
      page as never,
      'https://old.com',
      500,
    );
    expect(result).toBe(false);
  });

  it('returns false on timeout', async () => {
    const page = {
      isClosed: () => false,
      url: () => 'https://same.com',
    };
    const result = await waitForUrlChange(
      page as never,
      'https://same.com',
      200,
    );
    expect(result).toBe(false);
  });
});
