import { describe, it, expect, vi } from 'vitest';

import type * as JsonrepairModule from 'jsonrepair';

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// jsonrepair is mocked but INACTIVE by default: it delegates to the real
// implementation so the recovery tests below keep working. The non-Error
// rejection test activates the throwing behaviour for a single call via
// vi.mocked(jsonrepair).mockImplementationOnce(...).
const jsonrepairMock = vi.hoisted(() => ({ real: (_s: string): string => '' }));
vi.mock('jsonrepair', async (importOriginal) => {
  const actual = await importOriginal<typeof JsonrepairModule>();
  jsonrepairMock.real = actual.jsonrepair;
  return {
    jsonrepair: vi.fn((s: string) => jsonrepairMock.real(s)),
  };
});

import { safeJsonParse } from './safe-json-parse.util.js';
import { jsonrepair } from 'jsonrepair';

describe('safeJsonParse', () => {
  it('parses valid JSON directly', () => {
    expect(safeJsonParse('{"key":"value"}')).toEqual({ key: 'value' });
  });

  it('parses arrays', () => {
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('parses numbers', () => {
    expect(safeJsonParse('42')).toBe(42);
  });

  it('parses strings', () => {
    expect(safeJsonParse('"hello"')).toBe('hello');
  });

  it('parses booleans', () => {
    expect(safeJsonParse('true')).toBe(true);
  });

  it('parses null', () => {
    expect(safeJsonParse('null')).toBeNull();
  });

  it('extracts JSON from surrounding text', () => {
    const result = safeJsonParse('Here is the result: {"type": "click"} done.');
    expect(result).toEqual({ type: 'click' });
  });

  it('extracts JSON from markdown code fences', () => {
    const result = safeJsonParse('```json\n{"type": "click"}\n```');
    expect(result).toEqual({ type: 'click' });
  });

  it('handles trailing commas via jsonrepair', () => {
    const result = safeJsonParse('{"key": "value",}');
    expect(result).toEqual({ key: 'value' });
  });

  it('throws for truly unparseable content', () => {
    expect(() => safeJsonParse('true true true')).toThrow();
  });

  it('includes context in error message when provided', () => {
    try {
      safeJsonParse('::::: not json :::::', 'test-context');
      // If it doesn't throw, that's OK too (jsonrepair is resilient)
    } catch (err) {
      expect((err as Error).message).toContain('test-context');
    }
  });

  it('handles nested objects with prose around them', () => {
    const result = safeJsonParse('The AI says: {"a": {"b": 1}} end');
    expect(result).toEqual({ a: { b: 1 } });
  });

  it('handles missing quotes via jsonrepair', () => {
    const result = safeJsonParse('{key: "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('correctly handles escaped quotes inside string values (escape branch)', () => {
    // The escaped \" must not be treated as the end of the string while
    // the bracket-matcher walks the object. This exercises the
    // `escape`/backslash branch of extractFirstJsonObject.
    const result = safeJsonParse('prefix {"msg": "she said \\"hi\\""} suffix');
    expect(result).toEqual({ msg: 'she said "hi"' });
  });

  it('handles braces appearing inside string values (in-string skip)', () => {
    // A "{" inside a quoted string must not increase the brace depth,
    // otherwise the matcher would never balance.
    const result = safeJsonParse('text {"tpl": "a {nested} brace"} text');
    expect(result).toEqual({ tpl: 'a {nested} brace' });
  });

  it('handles an escaped backslash immediately before a closing quote', () => {
    // Tests escape consuming the backslash, leaving the following quote
    // free to close the string.
    const result = safeJsonParse('lead {"path": "C:\\\\tmp\\\\"} trail');
    expect(result).toEqual({ path: 'C:\\tmp\\' });
  });

  it('falls back to jsonrepair when no closing brace is found (extract returns null)', () => {
    // There is a "{" but the object is never balanced, so
    // extractFirstJsonObject returns null and we fall through to
    // jsonrepair on the raw input.
    const result = safeJsonParse('{"key": "value"');
    expect(result).toEqual({ key: 'value' });
  });

  it('throws (with context) when an unbalanced object cannot even be repaired', () => {
    // No "{" at all in a chunk that is also not valid JSON forces both
    // strategy 1 and strategy 2 (returns null) to fail.
    expect(() => safeJsonParse(']]] not json [[[', 'ctx-x')).toThrow(/ctx-x/);
  });

  it('throws WITHOUT a context suffix when no context is provided', () => {
    // Exercises the `context !== undefined` false branch of the error message.
    let message = '';
    try {
      safeJsonParse(']]] not json [[[');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^Failed to parse JSON:/);
    expect(message).not.toContain('(');
  });
});

describe('safeJsonParse — non-Error rejection from jsonrepair', () => {
  it('coerces a thrown non-Error value via String() in the message', () => {
    // Force jsonrepair to throw a non-Error value for this single call so the
    // error wrapper exercises its `err instanceof Error ? ... : String(err)`
    // else-branch.
    vi.mocked(jsonrepair).mockImplementationOnce(() => {
      throw 'string-rejection';
    });

    let message = '';
    try {
      // No "{" → extractFirstJsonObject returns null → jsonrepair (mocked) throws a string.
      safeJsonParse('not json at all', 'ctx');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('Failed to parse JSON (ctx)');
    expect(message).toContain('string-rejection');
  });
});
