import { describe, it, expect } from 'vitest';

import {
  getContextLimit,
  estimateTokens,
  computeBudget,
  MODEL_CONTEXT_LIMITS,
  DEFAULT_CONTEXT_LIMIT,
  IMAGE_TOKEN_COST,
  MAX_OUTPUT_TOKENS_HARD_CAP,
  OUTPUT_TOKENS_CONTEXT_RATIO,
  SAFETY_MARGIN_RATIO,
} from './token-budget.util.js';

describe('getContextLimit', () => {
  it('returns exact match for gpt-4o', () => {
    expect(getContextLimit('gpt-4o')).toBe(128000);
  });

  it('returns exact match for gpt-4.1', () => {
    expect(getContextLimit('gpt-4.1')).toBe(1047000);
  });

  it('returns prefix match for claude-based models', () => {
    expect(getContextLimit('claude-3-haiku')).toBe(200000);
    expect(getContextLimit('claude-3-sonnet')).toBe(200000);
  });

  it('returns default for unknown model', () => {
    expect(getContextLimit('unknown-model')).toBe(DEFAULT_CONTEXT_LIMIT);
  });
});

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for falsy value', () => {
    expect(estimateTokens(undefined as unknown as string)).toBe(0);
  });

  it('estimates tokens as length/4 rounded up', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

describe('computeBudget', () => {
  it('computes budget for gpt-4o without image', () => {
    const result = computeBudget('gpt-4o');
    expect(result.contextLimit).toBe(128000);
    expect(result.maxOutputTokens).toBeLessThanOrEqual(
      MAX_OUTPUT_TOKENS_HARD_CAP,
    );
    expect(result.inputBudget).toBeGreaterThan(0);
    expect(result.inputBudget).toBeLessThan(result.contextLimit);
  });

  it('reduces input budget when image is present', () => {
    const noImage = computeBudget('gpt-4o', { hasImage: false });
    const withImage = computeBudget('gpt-4o', { hasImage: true });
    expect(withImage.inputBudget).toBeLessThan(noImage.inputBudget);
    const diff = noImage.inputBudget - withImage.inputBudget;
    // The difference should be roughly IMAGE_TOKEN_COST * (1 - SAFETY_MARGIN_RATIO)
    expect(diff).toBeGreaterThan(0);
  });

  it('caps maxOutputTokens at hard cap', () => {
    const result = computeBudget('gpt-4.1');
    expect(result.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS_HARD_CAP);
  });

  it('applies safety margin', () => {
    const result = computeBudget('gpt-4o');
    const rawInput = result.contextLimit - result.maxOutputTokens;
    expect(result.inputBudget).toBeLessThan(rawInput);
  });
});
