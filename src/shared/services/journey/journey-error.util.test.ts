import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  JourneyError,
  categorizeJourneyError,
  getSuggestions,
  buildActionError,
} from './journey-error.util.js';

describe('JourneyError', () => {
  it('creates error with type and message', () => {
    const err = new JourneyError('AUTH_FAILED', 'Login failed');
    expect(err.type).toBe('AUTH_FAILED');
    expect(err.message).toBe('Login failed');
    expect(err.name).toBe('JourneyError');
  });

  it('stores optional properties', () => {
    const cause = new Error('root');
    const err = new JourneyError('AI_PARSING', 'bad', {
      attemptedSelector: '#btn',
      aiConfidenceScore: 75,
      cause,
    });
    expect(err.attemptedSelector).toBe('#btn');
    expect(err.aiConfidenceScore).toBe(75);
    expect(err.cause).toBe(cause);
  });

  it('defaults optional properties to undefined', () => {
    const err = new JourneyError('UNKNOWN', 'test');
    expect(err.attemptedSelector).toBeUndefined();
    expect(err.aiConfidenceScore).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});

describe('categorizeJourneyError', () => {
  it('returns JourneyError type when error is JourneyError', () => {
    const err = new JourneyError('AUTH_FAILED', 'Login failed');
    const result = categorizeJourneyError(err, 'other');
    expect(result.type).toBe('AUTH_FAILED');
    expect(result.details).toBe('Login failed');
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it('detects BROWSER_CRASH from protocol error', () => {
    const err = new Error('Protocol error: session closed');
    const result = categorizeJourneyError(err, 'other');
    expect(result.type).toBe('BROWSER_CRASH');
  });

  it('detects BROWSER_CRASH from target closed', () => {
    const result = categorizeJourneyError(new Error('Target closed'), 'other');
    expect(result.type).toBe('BROWSER_CRASH');
  });

  it('detects BROWSER_CRASH from browser disconnected', () => {
    const result = categorizeJourneyError(
      new Error('browser has disconnected'),
      'other',
    );
    expect(result.type).toBe('BROWSER_CRASH');
  });

  it('detects NAVIGATION_POST_ACTION for timeout in navigation context', () => {
    const result = categorizeJourneyError(
      new Error('Navigation timeout exceeded'),
      'navigation',
    );
    expect(result.type).toBe('NAVIGATION_POST_ACTION');
  });

  it('detects ACTION_EXECUTION for timeout in non-navigation context', () => {
    const result = categorizeJourneyError(
      new Error('Timeout exceeded'),
      'action',
    );
    expect(result.type).toBe('ACTION_EXECUTION');
  });

  it('detects AI_ELEMENT_NOT_VISIBLE from node detached', () => {
    const result = categorizeJourneyError(
      new Error('Node is detached from document'),
      'other',
    );
    expect(result.type).toBe('AI_ELEMENT_NOT_VISIBLE');
  });

  it('detects AI_ELEMENT_NOT_VISIBLE from not visible', () => {
    const result = categorizeJourneyError(
      new Error('Element not visible'),
      'other',
    );
    expect(result.type).toBe('AI_ELEMENT_NOT_VISIBLE');
  });

  it('returns AUTH_FAILED for auth context', () => {
    const result = categorizeJourneyError(new Error('failed'), 'auth');
    expect(result.type).toBe('AUTH_FAILED');
  });

  it('returns AUTH_FAILED for auth-related message', () => {
    const result = categorizeJourneyError(
      new Error('authentification error'),
      'other',
    );
    expect(result.type).toBe('AUTH_FAILED');
  });

  it('returns AUTH_FAILED for login-related message', () => {
    const result = categorizeJourneyError(
      new Error('login page not found'),
      'other',
    );
    expect(result.type).toBe('AUTH_FAILED');
  });

  it('returns COOKIE_BANNER for cookies context', () => {
    const result = categorizeJourneyError(new Error('banner'), 'cookies');
    expect(result.type).toBe('COOKIE_BANNER');
  });

  it('returns AI_PARSING for parsing context', () => {
    const result = categorizeJourneyError(new Error('bad json'), 'parsing');
    expect(result.type).toBe('AI_PARSING');
  });

  it('returns NAVIGATION_BLOCK for navigation context', () => {
    const result = categorizeJourneyError(
      new Error('page not reachable'),
      'navigation',
    );
    expect(result.type).toBe('NAVIGATION_BLOCK');
  });

  it('returns AI_SELECTOR_NOT_FOUND for selector context', () => {
    const result = categorizeJourneyError(new Error('no match'), 'selector');
    expect(result.type).toBe('AI_SELECTOR_NOT_FOUND');
  });

  it('returns ACTION_EXECUTION for action context', () => {
    const result = categorizeJourneyError(new Error('click failed'), 'action');
    expect(result.type).toBe('ACTION_EXECUTION');
  });

  it('returns UNKNOWN for other context with generic error', () => {
    const result = categorizeJourneyError(new Error('something'), 'other');
    expect(result.type).toBe('UNKNOWN');
  });

  it('handles non-Error values', () => {
    const result = categorizeJourneyError('string error', 'other');
    expect(result.type).toBe('UNKNOWN');
    expect(result.details).toBe('string error');
  });
});

describe('getSuggestions', () => {
  const types = [
    'VALIDATION_BODY',
    'AUTH_FAILED',
    'NAVIGATION_BLOCK',
    'AI_PARSING',
    'AI_SELECTOR_NOT_FOUND',
    'AI_SELECTOR_INVALID',
    'AI_SELECTOR_AMBIGUOUS',
    'AI_ELEMENT_NOT_VISIBLE',
    'AI_ELEMENT_DISABLED',
    'ACTION_EXECUTION',
    'NAVIGATION_POST_ACTION',
    'COOKIE_BANNER',
    'AXE_FAILED',
    'AI_ANALYSIS',
    'TOKEN_BUDGET',
    'BROWSER_CRASH',
    'UNKNOWN',
  ] as const;

  for (const type of types) {
    it(`returns non-empty suggestions for ${type}`, () => {
      const suggestions = getSuggestions(type);
      expect(suggestions).toBeInstanceOf(Array);
      expect(suggestions.length).toBeGreaterThan(0);
    });
  }

  it('returns UNKNOWN suggestions for unrecognized type', () => {
    const suggestions = getSuggestions('NONEXISTENT' as never);
    expect(suggestions.length).toBeGreaterThan(0);
  });
});

describe('buildActionError', () => {
  const createMockPage = (opts: { closed?: boolean } = {}) =>
    ({
      isClosed: () => opts.closed ?? false,
      screenshot: vi.fn().mockResolvedValue('base64screenshot'),
      content: vi
        .fn()
        .mockResolvedValue('<html><body><p>test</p></body></html>'),
    }) as never;

  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/test-workspace');
  });

  it('builds error result with all fields', async () => {
    const page = createMockPage();
    const result = await buildActionError({
      blockIndex: 0,
      actionIndex: 1,
      blockUrl: 'https://example.com',
      action: 'click button',
      parsedActionType: 'click',
      err: new Error('click failed'),
      page,
      context: 'action',
      debugCapture: true,
    });

    expect(result.blockIndex).toBe(0);
    expect(result.actionIndex).toBe(1);
    expect(result.blockUrl).toBe('https://example.com');
    expect(result.action).toBe('click button');
    expect(result.parsedActionType).toBe('click');
    expect(result.type).toBe('ACTION_EXECUTION');
    expect(result.message).toBe('click failed');
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.timestamp).toBeDefined();
    expect(result.errorScreenshot).toBe('base64screenshot');
    expect(result.domAtError).toContain('test');
  });

  it('handles null page gracefully', async () => {
    const result = await buildActionError({
      blockIndex: 0,
      actionIndex: 0,
      blockUrl: 'https://example.com',
      action: 'test',
      err: new Error('fail'),
      page: null,
      context: 'other',
    });
    expect(result.errorScreenshot).toBeUndefined();
    expect(result.domAtError).toBeUndefined();
  });

  it('handles closed page gracefully', async () => {
    const page = createMockPage({ closed: true });
    const result = await buildActionError({
      blockIndex: 0,
      actionIndex: 0,
      blockUrl: 'https://example.com',
      action: 'test',
      err: new Error('fail'),
      page,
      context: 'other',
      debugCapture: true,
    });
    expect(result.errorScreenshot).toBeUndefined();
  });

  it('extracts JourneyError properties', async () => {
    const err = new JourneyError('AI_PARSING', 'bad selector', {
      attemptedSelector: '#btn',
      aiConfidenceScore: 80,
    });
    const result = await buildActionError({
      blockIndex: 0,
      actionIndex: 0,
      blockUrl: 'https://example.com',
      action: 'test',
      err,
      page: null,
      context: 'parsing',
    });
    expect(result.attemptedSelector).toBe('#btn');
    expect(result.aiConfidenceScore).toBe(80);
  });

  it('handles screenshot failure gracefully', async () => {
    const page = {
      isClosed: () => false,
      screenshot: vi.fn().mockRejectedValue(new Error('screenshot failed')),
      content: vi.fn().mockResolvedValue('<html></html>'),
    } as never;
    const result = await buildActionError({
      blockIndex: 0,
      actionIndex: 0,
      blockUrl: 'https://example.com',
      action: 'test',
      err: new Error('fail'),
      page,
      context: 'other',
      debugCapture: true,
    });
    expect(result.errorScreenshot).toBeUndefined();
  });

  it('handles content failure gracefully', async () => {
    const page = {
      isClosed: () => false,
      screenshot: vi.fn().mockResolvedValue('base64'),
      content: vi.fn().mockRejectedValue(new Error('content failed')),
    } as never;
    const result = await buildActionError({
      blockIndex: 0,
      actionIndex: 0,
      blockUrl: 'https://example.com',
      action: 'test',
      err: new Error('fail'),
      page,
      context: 'other',
      debugCapture: true,
    });
    expect(result.errorScreenshot).toBe('base64');
    expect(result.domAtError).toBeUndefined();
  });

  it('truncates large DOM content', async () => {
    const longHtml = `<html>${'x'.repeat(60000)}</html>`;
    const page = {
      isClosed: () => false,
      screenshot: vi.fn().mockResolvedValue('base64'),
      content: vi.fn().mockResolvedValue(longHtml),
    } as never;
    const result = await buildActionError({
      blockIndex: 0,
      actionIndex: 0,
      blockUrl: 'https://example.com',
      action: 'test',
      err: new Error('fail'),
      page,
      context: 'other',
      debugCapture: true,
    });
    expect(result.domAtError).toContain('[TRUNCATED]');
  });

  it('strips script and style tags from DOM', async () => {
    const htmlWithScripts =
      '<html><script>alert(1)</script><style>body{}</style><p>content</p></html>';
    const page = {
      isClosed: () => false,
      screenshot: vi.fn().mockResolvedValue('base64'),
      content: vi.fn().mockResolvedValue(htmlWithScripts),
    } as never;
    const result = await buildActionError({
      blockIndex: 0,
      actionIndex: 0,
      blockUrl: 'https://example.com',
      action: 'test',
      err: new Error('fail'),
      page,
      context: 'other',
      debugCapture: true,
    });
    expect(result.domAtError).not.toContain('alert');
    expect(result.domAtError).not.toContain('body{}');
    expect(result.domAtError).toContain('content');
  });

  it('handles non-Error err values', async () => {
    const result = await buildActionError({
      blockIndex: 0,
      actionIndex: 0,
      blockUrl: 'https://example.com',
      action: 'test',
      err: 'string error',
      page: null,
      context: 'other',
    });
    expect(result.message).toBe('string error');
  });

  describe('debug capture gating', () => {
    const prev = process.env['BALDR_DEBUG_ERROR_CAPTURE'];
    afterEach(() => {
      if (prev === undefined) delete process.env['BALDR_DEBUG_ERROR_CAPTURE'];
      else process.env['BALDR_DEBUG_ERROR_CAPTURE'] = prev;
    });

    it('does NOT capture screenshot/DOM nor touch the page by default (flag off)', async () => {
      delete process.env['BALDR_DEBUG_ERROR_CAPTURE'];
      const screenshot = vi.fn().mockResolvedValue('base64');
      const content = vi.fn().mockResolvedValue('<html></html>');
      const page = {
        isClosed: () => false,
        screenshot,
        content,
      } as never;

      const result = await buildActionError({
        blockIndex: 0,
        actionIndex: 0,
        blockUrl: 'https://example.com',
        action: 'test',
        err: new Error('fail'),
        page,
        context: 'other',
      });

      expect(result.errorScreenshot).toBeUndefined();
      expect(result.domAtError).toBeUndefined();
      // Page must not be touched at all -> nothing written to disk either.
      expect(screenshot).not.toHaveBeenCalled();
      expect(content).not.toHaveBeenCalled();
    });

    it('does NOT capture when debugCapture: false even if env is on', async () => {
      process.env['BALDR_DEBUG_ERROR_CAPTURE'] = 'true';
      const screenshot = vi.fn().mockResolvedValue('base64');
      const content = vi.fn().mockResolvedValue('<html></html>');
      const page = { isClosed: () => false, screenshot, content } as never;

      const result = await buildActionError({
        blockIndex: 0,
        actionIndex: 0,
        blockUrl: 'https://example.com',
        action: 'test',
        err: new Error('fail'),
        page,
        context: 'other',
        debugCapture: false,
      });

      expect(result.errorScreenshot).toBeUndefined();
      expect(result.domAtError).toBeUndefined();
      expect(screenshot).not.toHaveBeenCalled();
    });

    it('captures when env BALDR_DEBUG_ERROR_CAPTURE=true and no explicit flag', async () => {
      process.env['BALDR_DEBUG_ERROR_CAPTURE'] = 'true';
      const page = createMockPage();
      const result = await buildActionError({
        blockIndex: 0,
        actionIndex: 0,
        blockUrl: 'https://example.com',
        action: 'test',
        err: new Error('fail'),
        page,
        context: 'other',
      });
      expect(result.errorScreenshot).toBe('base64screenshot');
      expect(result.domAtError).toContain('test');
    });

    it('strips value of password and sensitive inputs from the captured DOM', async () => {
      const html =
        '<html><body>' +
        '<input type="password" name="pwd" value="SuperSecret123" />' +
        '<input type="text" name="card-number" value="4111111111111111" />' +
        '<input type="text" id="user-token" value="abc.def.ghi" />' +
        '<input type="text" name="firstName" value="Jean" />' +
        '</body></html>';
      const page = {
        isClosed: () => false,
        screenshot: vi.fn().mockResolvedValue('base64'),
        content: vi.fn().mockResolvedValue(html),
      } as never;

      const result = await buildActionError({
        blockIndex: 0,
        actionIndex: 0,
        blockUrl: 'https://example.com',
        action: 'test',
        err: new Error('fail'),
        page,
        context: 'other',
        debugCapture: true,
      });

      expect(result.domAtError).toBeDefined();
      // Sensitive values stripped.
      expect(result.domAtError).not.toContain('SuperSecret123');
      expect(result.domAtError).not.toContain('4111111111111111');
      expect(result.domAtError).not.toContain('abc.def.ghi');
      // Non-sensitive value preserved.
      expect(result.domAtError).toContain('Jean');
    });
  });
});
