import { describe, it, expect, vi } from 'vitest';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@shared/utils/safe-json-parse.util.js', () => ({
  safeJsonParse: vi.fn((raw: string) => JSON.parse(raw)),
}));

import {
  LLMActionPlannerService,
  extractJsonObject,
  parseLLMResponse,
} from './llm-action-planner.service.js';
import { JourneyError } from './journey-error.util.js';
import type { SelectorValidationResult } from './selector-resolver.service.js';

describe('extractJsonObject', () => {
  it('extracts a simple JSON object', () => {
    expect(extractJsonObject('{"type":"click"}')).toBe('{"type":"click"}');
  });

  it('extracts JSON from surrounding text', () => {
    const result = extractJsonObject(
      'The result is: {"type":"hover","selector":"#btn"} done.',
    );
    expect(result).toBe('{"type":"hover","selector":"#btn"}');
  });

  it('handles nested objects', () => {
    const result = extractJsonObject('{"outer":{"inner":"val"}}');
    expect(result).toBe('{"outer":{"inner":"val"}}');
  });

  it('ignores braces inside strings', () => {
    const result = extractJsonObject('{"key":"value with { and }"}');
    expect(result).toBe('{"key":"value with { and }"}');
  });

  it('handles escaped quotes in strings', () => {
    const result = extractJsonObject('{"key":"val\\"ue"}');
    expect(result).toBe('{"key":"val\\"ue"}');
  });

  it('handles escaped backslashes', () => {
    const result = extractJsonObject('{"path":"C:\\\\Users"}');
    expect(result).toBe('{"path":"C:\\\\Users"}');
  });

  it('returns null when no JSON found', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractJsonObject('')).toBeNull();
  });

  it('returns null for unbalanced braces', () => {
    expect(extractJsonObject('{"key": "value"')).toBeNull();
  });
});

describe('parseLLMResponse', () => {
  it('parses valid JSON response', () => {
    const result = parseLLMResponse(
      '{"type":"click","selector":"#btn","confidenceScore":90}',
    );
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
    expect(result.confidenceScore).toBe(90);
  });

  it('strips markdown code fences', () => {
    const result = parseLLMResponse(
      '```json\n{"type":"hover","selector":".menu"}\n```',
    );
    expect(result.type).toBe('hover');
    expect(result.selector).toBe('.menu');
  });

  it('strips bare code fences', () => {
    const result = parseLLMResponse(
      '```\n{"type":"type","selector":"#input","value":"hello"}\n```',
    );
    expect(result.type).toBe('type');
    expect(result.value).toBe('hello');
  });

  it('throws for invalid JSON', async () => {
    const { safeJsonParse } = vi.mocked(
      await import('@shared/utils/safe-json-parse.util.js'),
    );
    safeJsonParse.mockImplementationOnce(() => {
      throw new Error('invalid');
    });
    expect(() => parseLLMResponse('not json at all')).toThrow(JourneyError);
  });

  it('throws for non-object parsed value', async () => {
    const { safeJsonParse } = vi.mocked(
      await import('@shared/utils/safe-json-parse.util.js'),
    );
    safeJsonParse.mockReturnValueOnce('string value');
    expect(() => parseLLMResponse('"string"')).toThrow(JourneyError);
  });

  it('throws for null parsed value', async () => {
    const { safeJsonParse } = vi.mocked(
      await import('@shared/utils/safe-json-parse.util.js'),
    );
    safeJsonParse.mockReturnValueOnce(null);
    expect(() => parseLLMResponse('null')).toThrow(JourneyError);
  });

  it('throws for invalid action type', () => {
    expect(() =>
      parseLLMResponse('{"type":"invalidAction","selector":"#x"}'),
    ).toThrow(JourneyError);
  });

  it('throws for missing selector', () => {
    expect(() => parseLLMResponse('{"type":"click"}')).toThrow(JourneyError);
  });

  it('throws for empty selector', () => {
    expect(() => parseLLMResponse('{"type":"click","selector":"   "}')).toThrow(
      JourneyError,
    );
  });

  it('clamps confidence score between 0 and 100', () => {
    const result = parseLLMResponse(
      '{"type":"click","selector":"#btn","confidenceScore":150}',
    );
    expect(result.confidenceScore).toBe(100);

    const result2 = parseLLMResponse(
      '{"type":"click","selector":"#btn","confidenceScore":-10}',
    );
    expect(result2.confidenceScore).toBe(0);
  });

  it('defaults confidence score to 50 when not a number', () => {
    const result = parseLLMResponse('{"type":"click","selector":"#btn"}');
    expect(result.confidenceScore).toBe(50);
  });

  it('parses optional fields', () => {
    const result = parseLLMResponse(
      '{"type":"type","selector":"#input","value":"hello","waitForNavigation":true,"reasoning":"Because"}',
    );
    expect(result.value).toBe('hello');
    expect(result.waitForNavigation).toBe(true);
    expect(result.reasoning).toBe('Because');
  });

  it('trims selector whitespace', () => {
    const result = parseLLMResponse('{"type":"click","selector":"  #btn  "}');
    expect(result.selector).toBe('#btn');
  });

  it('accepts all valid action types', () => {
    const validTypes = [
      'click',
      'doubleClick',
      'rightClick',
      'hover',
      'type',
      'select',
      'check',
      'uncheck',
      'pressKey',
      'scrollTo',
    ];
    for (const type of validTypes) {
      const result = parseLLMResponse(`{"type":"${type}","selector":"#x"}`);
      expect(result.type).toBe(type);
    }
  });
});

function makeOpenAI(
  responseJson = '{"type":"click","selector":"#btn","confidenceScore":90}',
) {
  return {
    isReady: vi.fn().mockReturnValue(true),
    getModel: vi.fn().mockReturnValue('gpt-4o'),
    chatCompletion: vi.fn().mockResolvedValue({
      response: responseJson,
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
  };
}

function makeScreenshot(value: string | null = 'base64data') {
  return {
    captureFullPage:
      value === null
        ? vi.fn().mockRejectedValue(new Error('screenshot boom'))
        : vi.fn().mockResolvedValue(value),
  };
}

function makeDomExtractor() {
  return {
    clearCache: vi.fn(),
    extractInteractive: vi.fn().mockResolvedValue([{ tag: 'a', text: 'X' }]),
    serializeWithBudget: vi.fn().mockReturnValue({
      json: '[{"tag":"a","text":"X","idx":1}]',
      includedCount: 1,
      totalCount: 1,
    }),
  };
}

function okValidation(): SelectorValidationResult {
  return { ok: true, reason: 'OK' };
}

function makeResolver(
  overrides: Partial<{
    resolveTextBasedSelector: ReturnType<typeof vi.fn>;
    detectNonStandardSyntax: ReturnType<typeof vi.fn>;
    validateSelector: ReturnType<typeof vi.fn>;
    overrideContainerToLeaf: ReturnType<typeof vi.fn>;
    verifyTargetText: ReturnType<typeof vi.fn>;
    getChosenElementDetails: ReturnType<typeof vi.fn>;
  }> = {},
) {
  return {
    resolveTextBasedSelector:
      overrides.resolveTextBasedSelector ??
      vi.fn(async (_p: unknown, sel: string) => sel),
    detectNonStandardSyntax:
      overrides.detectNonStandardSyntax ?? vi.fn().mockReturnValue(null),
    validateSelector:
      overrides.validateSelector ?? vi.fn().mockResolvedValue(okValidation()),
    overrideContainerToLeaf:
      overrides.overrideContainerToLeaf ?? vi.fn().mockResolvedValue(null),
    verifyTargetText:
      overrides.verifyTargetText ?? vi.fn().mockResolvedValue(true),
    getChosenElementDetails:
      overrides.getChosenElementDetails ??
      vi.fn().mockResolvedValue('chosen text'),
  };
}

function makePage() {
  return {
    $$: vi.fn().mockResolvedValue([{}]),
    url: vi.fn().mockReturnValue('https://example.com'),
  };
}

function build(opts: {
  openai?: ReturnType<typeof makeOpenAI>;
  screenshot?: ReturnType<typeof makeScreenshot>;
  dom?: ReturnType<typeof makeDomExtractor>;
  resolver?: ReturnType<typeof makeResolver>;
}) {
  const openai = opts.openai ?? makeOpenAI();
  const screenshot = opts.screenshot ?? makeScreenshot();
  const dom = opts.dom ?? makeDomExtractor();
  const resolver = opts.resolver ?? makeResolver();
  const service = new LLMActionPlannerService(
    openai as never,
    screenshot as never,
    dom as never,
    resolver as never,
  );
  return { service, openai, screenshot, dom, resolver };
}

const noTarget = (): null => null;

describe('LLMActionPlannerService.planInitial', () => {
  it('throws AI_PARSING when openaiClient is not ready', async () => {
    const openai = makeOpenAI();
    openai.isReady.mockReturnValue(false);
    const { service } = build({ openai });
    await expect(
      service.planInitial(makePage() as never, 'cliquer', noTarget),
    ).rejects.toThrow(JourneyError);
  });

  it('returns the validated action on the happy path (no expected target)', async () => {
    const { service, resolver } = build({});
    const result = await service.planInitial(
      makePage() as never,
      'cliquer sur le bouton',
      noTarget,
    );
    expect(result.type).toBe('click');
    expect(result.selector).toBe('#btn');
    expect(resolver.validateSelector).toHaveBeenCalled();
  });

  it('uses captured screenshot (image attached) when capture succeeds', async () => {
    const { service, openai } = build({});
    await service.planInitial(makePage() as never, 'cliquer', noTarget);
    const messages = openai.chatCompletion.mock.calls[0][0] as {
      role: string;
      content: unknown;
    }[];
    const userContent = messages[1].content as { type: string }[];
    expect(userContent.some((c) => c.type === 'image_url')).toBe(true);
  });

  it('continues without image when screenshot capture fails (captureScreenshotSafe)', async () => {
    const { service, openai } = build({ screenshot: makeScreenshot(null) });
    await service.planInitial(makePage() as never, 'cliquer', noTarget);
    const messages = openai.chatCompletion.mock.calls[0][0] as {
      content: unknown;
    }[];
    const userContent = messages[1].content as { type: string }[];
    expect(userContent.some((c) => c.type === 'image_url')).toBe(false);
  });

  it('rewrites the selector when resolveTextBasedSelector changes it', async () => {
    const resolver = makeResolver({
      resolveTextBasedSelector: vi
        .fn()
        .mockResolvedValue('[data-baldr-target="x"]'),
    });
    const { service } = build({ resolver });
    const result = await service.planInitial(
      makePage() as never,
      'cliquer',
      noTarget,
    );
    expect(result.selector).toBe('[data-baldr-target="x"]');
  });

  it('retries when detectNonStandardSyntax flags the selector, then succeeds', async () => {
    const detect = vi
      .fn()
      .mockReturnValueOnce('bad pseudo-class')
      .mockReturnValue(null);
    const resolver = makeResolver({ detectNonStandardSyntax: detect });
    const { service, openai } = build({ resolver });
    const result = await service.planInitial(
      makePage() as never,
      'cliquer',
      noTarget,
    );
    expect(detect).toHaveBeenCalledTimes(2);
    expect(openai.chatCompletion).toHaveBeenCalledTimes(2);
    expect(result.selector).toBe('#btn');
  });

  it('normalizes camelCase attributes to kebab-case fallback', async () => {
    const openai = makeOpenAI(
      '{"type":"click","selector":"[dataCy=\\"foo\\"]","confidenceScore":80}',
    );
    const page = makePage();
    // original selector matches 0, normalized matches 1
    page.$$.mockResolvedValueOnce([]) // original [dataCy="foo"]
      .mockResolvedValueOnce([{}]); // normalized [data-cy="foo"]
    const { service } = build({ openai });
    const result = await service.planInitial(
      page as never,
      'cliquer',
      noTarget,
    );
    expect(result.selector).toBe('[data-cy="foo"]');
  });

  it('tolerates $$ rejections in the camelCase normalize probes (catch → [])', async () => {
    const openai = makeOpenAI(
      '{"type":"click","selector":"[dataCy=\\"foo\\"]","confidenceScore":80}',
    );
    const page = makePage();
    // Both normalize probes reject → caught into [] → no swap; validate then ok.
    page.$$.mockRejectedValueOnce(new Error('bad original selector')) // original probe
      .mockRejectedValueOnce(new Error('bad normalized selector')) // normalized probe
      .mockResolvedValue([{}]); // validateSelector
    const { service } = build({ openai });
    const result = await service.planInitial(
      page as never,
      'cliquer',
      noTarget,
    );
    expect(result.selector).toBe('[dataCy="foo"]');
  });

  it('keeps the original selector when neither camelCase nor kebab match', async () => {
    const openai = makeOpenAI(
      '{"type":"click","selector":"[dataCy=\\"foo\\"]","confidenceScore":80}',
    );
    const page = makePage();
    // original [dataCy="foo"] → 0, normalized [data-cy="foo"] → 0 (no swap),
    // then validateSelector $$ → 1 (so it still validates the original)
    page.$$.mockResolvedValueOnce([]) // original in normalize block
      .mockResolvedValueOnce([]) // normalized in normalize block
      .mockResolvedValue([{}]); // validateSelector
    const { service } = build({ openai });
    const result = await service.planInitial(
      page as never,
      'cliquer',
      noTarget,
    );
    expect(result.selector).toBe('[dataCy="foo"]');
  });

  it('overrides container to leaf when an expected target is present', async () => {
    const resolver = makeResolver({
      overrideContainerToLeaf: vi
        .fn()
        .mockResolvedValue('[data-ajax-code="LEAF"]'),
      validateSelector: vi.fn().mockResolvedValue(okValidation()),
    });
    const { service } = build({ resolver });
    const result = await service.planInitial(
      makePage() as never,
      'cliquer sur "Consultation"',
      () => 'Consultation',
    );
    expect(result.selector).toBe('[data-ajax-code="LEAF"]');
    expect(resolver.overrideContainerToLeaf).toHaveBeenCalled();
  });

  it('retries when verifyTargetText is false (wrong target chosen)', async () => {
    const verify = vi
      .fn()
      .mockResolvedValueOnce(false) // first attempt: wrong
      .mockResolvedValue(true); // second attempt: ok
    const resolver = makeResolver({
      verifyTargetText: verify,
      getChosenElementDetails: vi.fn().mockResolvedValue('Wrong Element'),
    });
    const { service, openai } = build({ resolver });
    const result = await service.planInitial(
      makePage() as never,
      'cliquer sur "Cible"',
      () => 'Cible',
    );
    expect(verify).toHaveBeenCalledTimes(2);
    expect(openai.chatCompletion).toHaveBeenCalledTimes(2);
    expect(result.type).toBe('click');
  });

  it('throws AI_ELEMENT_DISABLED immediately when validation reports disabled', async () => {
    const resolver = makeResolver({
      validateSelector: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'disabled',
        type: 'AI_ELEMENT_DISABLED',
      }),
    });
    const { service } = build({ resolver });
    await expect(
      service.planInitial(makePage() as never, 'cliquer', noTarget),
    ).rejects.toThrow(JourneyError);
  });

  it('throws AI_ELEMENT_NOT_VISIBLE immediately', async () => {
    const resolver = makeResolver({
      validateSelector: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'not visible',
        type: 'AI_ELEMENT_NOT_VISIBLE',
      }),
    });
    const { service } = build({ resolver });
    await expect(
      service.planInitial(makePage() as never, 'cliquer', noTarget),
    ).rejects.toThrow(/not visible/);
  });

  it('exhausts retries then throws AI_SELECTOR_INVALID', async () => {
    const resolver = makeResolver({
      validateSelector: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'No element matches the selector',
        type: 'AI_SELECTOR_NOT_FOUND',
      }),
    });
    const { service, openai } = build({ resolver });
    await expect(
      service.planInitial(makePage() as never, 'cliquer', noTarget),
    ).rejects.toThrow(/Invalid selector after 3 attempts/);
    expect(openai.chatCompletion).toHaveBeenCalledTimes(3);
  });

  it('wraps an LLM call error into AI_PARSING (callLLM catch)', async () => {
    const openai = makeOpenAI();
    openai.chatCompletion.mockRejectedValue(new Error('network down'));
    const { service } = build({ openai });
    await expect(
      service.planInitial(makePage() as never, 'cliquer', noTarget),
    ).rejects.toThrow(/LLM call failed for action parsing/);
  });

  it('does not attach response_format for non-gpt models', async () => {
    const openai = makeOpenAI();
    openai.getModel.mockReturnValue('claude-3');
    const { service } = build({ openai });
    await service.planInitial(makePage() as never, 'cliquer', noTarget);
    const params = openai.chatCompletion.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(params['response_format']).toBeUndefined();
  });
});

describe('LLMActionPlannerService.planRetry', () => {
  it('returns null when openaiClient is not ready', async () => {
    const openai = makeOpenAI();
    openai.isReady.mockReturnValue(false);
    const { service } = build({ openai });
    const result = await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    expect(result).toBeNull();
  });

  it('returns null when state capture fails (extractInteractive throws)', async () => {
    const dom = makeDomExtractor();
    dom.extractInteractive.mockRejectedValue(new Error('detached'));
    const { service } = build({ dom });
    const result = await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    expect(result).toBeNull();
  });

  it('returns a skip result when the LLM proposes skip', async () => {
    const openai = makeOpenAI('{"type":"skip","reasoning":"sufficient"}');
    const { service } = build({ openai });
    const result = await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    expect(result).toEqual({ type: 'skip', reasoning: 'sufficient' });
  });

  it('returns null when LLM call fails', async () => {
    const openai = makeOpenAI();
    openai.chatCompletion.mockRejectedValue(new Error('timeout'));
    const { service } = build({ openai });
    const result = await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    const openai = makeOpenAI('not-json');
    const { service } = build({ openai });
    const { safeJsonParse } = vi.mocked(
      await import('@shared/utils/safe-json-parse.util.js'),
    );
    safeJsonParse.mockImplementationOnce(() => {
      throw new Error('bad json');
    });
    const result = await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    expect(result).toBeNull();
  });

  it('returns null when parsed object is not an object', async () => {
    const openai = makeOpenAI('123');
    const { service } = build({ openai });
    const { safeJsonParse } = vi.mocked(
      await import('@shared/utils/safe-json-parse.util.js'),
    );
    safeJsonParse.mockReturnValueOnce(123);
    const result = await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    expect(result).toBeNull();
  });

  it('returns null when ActionNavigation parsing fails (invalid type)', async () => {
    const openai = makeOpenAI('{"type":"weird","selector":"#a"}');
    const { service } = build({ openai });
    const result = await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    expect(result).toBeNull();
  });

  it('resolves a text-based selector and returns the validated action', async () => {
    const openai = makeOpenAI(
      '{"type":"click","selector":"a:has-text(\\"X\\")","confidenceScore":90}',
    );
    const resolver = makeResolver({
      resolveTextBasedSelector: vi
        .fn()
        .mockResolvedValue('[data-baldr-target="z"]'),
      validateSelector: vi.fn().mockResolvedValue(okValidation()),
    });
    const { service } = build({ openai, resolver });
    const result = await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    expect(result).not.toBeNull();
    expect((result as { selector: string }).selector).toBe(
      '[data-baldr-target="z"]',
    );
  });

  it('returns null when the proposed selector fails validation', async () => {
    const resolver = makeResolver({
      validateSelector: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'No element matches',
        type: 'AI_SELECTOR_NOT_FOUND',
      }),
    });
    const { service } = build({ resolver });
    const result = await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    expect(result).toBeNull();
  });

  it('attaches response_format json_schema for gpt models in replan', async () => {
    const { service, openai } = build({});
    await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    const params = openai.chatCompletion.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(params['response_format']).toBeDefined();
  });

  it('omits image when screenshot capture fails in replan', async () => {
    const { service, openai } = build({ screenshot: makeScreenshot(null) });
    await service.planRetry(makePage() as never, {
      originalActionStr: 'go',
      previousAction: {
        type: 'click',
        selector: '#a',
        confidenceScore: 80,
        reasoning: '',
      },
      urlBefore: 'https://x.com',
    });
    const messages = openai.chatCompletion.mock.calls[0][0] as {
      content: unknown;
    }[];
    const userContent = messages[1].content as { type: string }[];
    expect(userContent.some((c) => c.type === 'image_url')).toBe(false);
  });
});
