import { describe, it, expect } from 'vitest';

import {
  AXE_RULE_CATALOG,
  buildBaselineProblems,
  extractFirstJsonObject,
} from './common-problems-catalog.js';

describe('AXE_RULE_CATALOG', () => {
  it('contains all expected rule keys', () => {
    const expectedKeys = [
      'color-contrast',
      'image-alt',
      'label',
      'link-name',
      'button-name',
      'heading-order',
      'region',
      'document-title',
      'html-has-lang',
      'aria-required-attr',
      'aria-valid-attr-value',
      'list',
      'duplicate-id',
      'frame-title',
      'bypass',
    ];
    for (const key of expectedKeys) {
      expect(AXE_RULE_CATALOG).toHaveProperty(key);
    }
  });

  it('each entry has required fields', () => {
    for (const [, entry] of Object.entries(AXE_RULE_CATALOG)) {
      expect(entry.title).toBeDefined();
      expect(entry.severity).toBeDefined();
      expect(entry.rgaaCriteria).toBeInstanceOf(Array);
      expect(entry.wcagReferences).toBeInstanceOf(Array);
      expect(entry.description).toBeDefined();
      expect(entry.recommendation).toBeDefined();
    }
  });
});

describe('buildBaselineProblems', () => {
  it('returns problems for known Axe rules', () => {
    const result = buildBaselineProblems(
      [
        {
          id: 'color-contrast',
          pageCount: 3,
          occurrences: 10,
          description: 'Contrast issue',
        },
      ],
      [],
      5,
    );
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Contraste de couleur insuffisant');
    expect(result[0].description).toContain('3 / 5');
    expect(result[0].description).toContain('10 occurrences');
  });

  it('returns generic problems for unknown rules', () => {
    const result = buildBaselineProblems(
      [
        {
          id: 'custom-rule',
          pageCount: 2,
          occurrences: 5,
          description: 'Custom desc',
          rgaaTags: ['RGAA4-1.1'],
          wcagTags: ['wcag111'],
        },
      ],
      [],
      3,
    );
    expect(result).toHaveLength(1);
    expect(result[0].description).toContain('2 / 3');
    expect(result[0].rgaaCriteria).toContain('1.1');
    expect(result[0].wcagReferences).toContain('1.11');
  });

  it('handles AI recurring rules with Axe mapping', () => {
    const result = buildBaselineProblems(
      [],
      [
        {
          id: 'image-alt',
          pageCount: 2,
          occurrences: 8,
        },
      ],
      4,
    );
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe(
      'Images sans alternative textuelle pertinente',
    );
  });

  it('handles AI rules with indirect mapping', () => {
    const result = buildBaselineProblems(
      [],
      [
        {
          id: 'form-labels',
          pageCount: 2,
          occurrences: 3,
        },
      ],
      4,
    );
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe(
      'Champs de formulaire sans étiquette accessible',
    );
  });

  it('deduplicates between Axe and AI rules', () => {
    const result = buildBaselineProblems(
      [{ id: 'color-contrast', pageCount: 3, occurrences: 10 }],
      [{ id: 'color-contrast', pageCount: 2, occurrences: 5 }],
      5,
    );
    expect(result).toHaveLength(1);
  });

  it('deduplicates AI rules mapped to same Axe key', () => {
    const result = buildBaselineProblems(
      [{ id: 'image-alt', pageCount: 3, occurrences: 10 }],
      [{ id: 'image-text', pageCount: 2, occurrences: 5 }],
      5,
    );
    expect(result).toHaveLength(1);
  });

  it('returns empty array for no recurring rules', () => {
    const result = buildBaselineProblems([], [], 5);
    expect(result).toHaveLength(0);
  });

  it('handles rules without description or tags', () => {
    const result = buildBaselineProblems(
      [{ id: 'unknown-rule', pageCount: 2, occurrences: 3 }],
      [],
      3,
    );
    expect(result).toHaveLength(1);
    expect(result[0].title).toContain('unknown-rule');
  });

  it('handles zero occurrences', () => {
    const result = buildBaselineProblems(
      [{ id: 'color-contrast', pageCount: 2, occurrences: 0 }],
      [],
      3,
    );
    expect(result).toHaveLength(1);
    expect(result[0].description).not.toContain('occurrences');
  });
});

describe('extractFirstJsonObject', () => {
  it('extracts simple JSON object', () => {
    const result = extractFirstJsonObject('{"key": "value"}');
    expect(result).toBe('{"key": "value"}');
  });

  it('extracts JSON from prose', () => {
    const result = extractFirstJsonObject(
      'Here is the result: {"type": "click"}',
    );
    expect(result).toBe('{"type": "click"}');
  });

  it('extracts JSON from markdown code fence', () => {
    const result = extractFirstJsonObject('```json\n{"type": "click"}\n```');
    expect(result).toBe('{"type": "click"}');
  });

  it('handles nested objects', () => {
    const result = extractFirstJsonObject('{"a": {"b": "c"}}');
    expect(result).toBe('{"a": {"b": "c"}}');
  });

  it('handles strings with escaped quotes', () => {
    const result = extractFirstJsonObject('{"key": "value with \\"quotes\\""}');
    expect(result).toBe('{"key": "value with \\"quotes\\""}');
  });

  it('handles braces inside strings', () => {
    const result = extractFirstJsonObject('{"key": "value with { and }"}');
    expect(result).toBe('{"key": "value with { and }"}');
  });

  it('returns null for text without JSON', () => {
    expect(extractFirstJsonObject('no json here')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractFirstJsonObject('')).toBeNull();
  });

  it('returns null for unbalanced braces', () => {
    expect(extractFirstJsonObject('{"key": "value"')).toBeNull();
  });

  it('handles escaped backslashes in strings', () => {
    const result = extractFirstJsonObject('{"path": "C:\\\\Users\\\\test"}');
    expect(result).toBe('{"path": "C:\\\\Users\\\\test"}');
  });
});
