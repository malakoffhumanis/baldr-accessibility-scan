import { describe, it, expect } from 'vitest';

import type {
  IAIEnrichedResult,
  IAIRuleAnalysis,
  IAxeResult,
  IAxeViolation,
} from '@shared/types/audit.types.js';

import {
  computeGlobalScoring,
  computeSummaryCounts,
  countViolationsByImpact,
  hasAnalysisError,
} from './report-scoring.util.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createResult(overrides: Partial<IAxeResult> = {}): IAxeResult {
  return {
    url: 'https://example.com/page',
    timestamp: '2026-10-28T10:00:00.000Z',
    testInfo: {
      userAgent: 'HeadlessChrome/120',
      viewport: { width: 1920, height: 1080 },
      title: 'Page de test',
    },
    summary: { violations: 0, passes: 0, incomplete: 0, inapplicable: 0 },
    violations: [],
    passes: [],
    incomplete: [],
    inapplicable: [],
    ...overrides,
  };
}

function createViolation(
  overrides: Partial<IAxeViolation> = {},
): IAxeViolation {
  return {
    id: 'image-alt',
    impact: 'critical',
    description: 'Images must have alternate text',
    help: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.8/image-alt',
    tags: ['wcag2a'],
    nodes: [{ html: '<img>', target: ['img'] }],
    ...overrides,
  };
}

function createAnalysis(
  overrides: Partial<IAIRuleAnalysis> = {},
): IAIRuleAnalysis {
  return {
    ruleId: 'link-purpose',
    compliant: true,
    severity: 'minor',
    summary: 'Les liens sont explicites',
    findings: [],
    ...overrides,
  };
}

/** Mixed AI result: 1 compliant, 1 NA (title "aucun…"), 1 advisory-only,
 *  1 non-compliant with 2 violations, 1 error. */
function createMixedAI(): IAIEnrichedResult {
  return {
    ruleAnalyses: [
      createAnalysis({ ruleId: 'link-purpose' }),
      createAnalysis({
        ruleId: 'frame-title',
        summary: 'Aucun cadre dans la page',
      }),
      createAnalysis({
        ruleId: 'form-labels',
        findings: [
          { type: 'warning', issue: 'À vérifier', recommendation: '—' },
        ],
      }),
      createAnalysis({
        ruleId: 'image-alt',
        compliant: false,
        severity: 'critical',
        summary: 'Deux images sans alternative',
        findings: [
          { type: 'violation', issue: 'img 1', recommendation: 'alt' },
          { type: 'violation', issue: 'img 2', recommendation: 'alt' },
          { type: 'recommendation', issue: 'bonus', recommendation: '—' },
        ],
      }),
      createAnalysis({
        ruleId: 'table-headers',
        compliant: false,
        summary: 'Analyse impossible',
        error: 'timeout',
      }),
    ],
    totalRulesAnalyzed: 5,
    summary: { violations: 2, compliant: 1, notApplicable: 2, errors: 1 },
    metadata: {
      model: 'gpt-4o',
      timestamp: '2026-10-28T10:01:00.000Z',
      analysisType: 'full',
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('report-scoring.util', () => {
  describe('hasAnalysisError', () => {
    it('is true only when error is a non-empty string', () => {
      expect(hasAnalysisError(createAnalysis())).toBe(false);
      expect(hasAnalysisError(createAnalysis({ error: '' }))).toBe(false);
      expect(hasAnalysisError(createAnalysis({ error: 'boom' }))).toBe(true);
    });
  });

  describe('computeSummaryCounts', () => {
    it('uses the Axe figures only when there is no AI result', () => {
      const counts = computeSummaryCounts(
        createResult({
          summary: {
            violations: 3,
            passes: 40,
            incomplete: 2,
            inapplicable: 1,
          },
        }),
      );

      expect(counts).toEqual({
        violations: 3,
        passes: 40,
        incomplete: 2,
        aiViolations: 0,
        aiCompliant: 0,
        aiNonCompliant: 0,
        aiNotApplicable: 0,
        aiErrors: 0,
        source: 'axe',
      });
    });

    it('classifies the AI rules like the HTML cards (axe + ai)', () => {
      const counts = computeSummaryCounts(
        createResult({
          summary: {
            violations: 3,
            passes: 40,
            incomplete: 2,
            inapplicable: 1,
          },
          aiEnrichedResult: createMixedAI(),
        }),
      );

      // 1 compliant ; NA = "aucun" + advisory-only + error = 3 ; 2 violations
      expect(counts.aiCompliant).toBe(1);
      expect(counts.aiNonCompliant).toBe(1);
      expect(counts.aiViolations).toBe(2);
      expect(counts.aiNotApplicable).toBe(3);
      expect(counts.aiErrors).toBe(1);
      expect(counts.source).toBe('axe+ai');
      expect(counts.violations).toBe(3 + 2);
      expect(counts.passes).toBe(40 + 1);
      expect(counts.incomplete).toBe(2 + 3);
    });

    it('uses the AI figures only when the page has no Axe test', () => {
      const counts = computeSummaryCounts(
        createResult({ aiEnrichedResult: createMixedAI() }),
      );

      expect(counts.source).toBe('ai');
      expect(counts.violations).toBe(2);
      expect(counts.passes).toBe(1);
      expect(counts.incomplete).toBe(3);
    });
  });

  describe('computeGlobalScoring', () => {
    it('returns 100 / Excellent and 106 NA per page when nothing applies', () => {
      expect(computeGlobalScoring([createResult(), createResult()])).toEqual({
        score: 100,
        level: 'Excellent',
        compliant: 0,
        nonCompliant: 0,
        notApplicable: 212,
        pageCount: 2,
      });
    });

    it('sums C and NC over the pages and rounds the ratio', () => {
      const pass = (id: string) => ({
        id,
        impact: null,
        tags: [],
        description: '',
        help: '',
        helpUrl: '',
        nodes: [],
      });
      const pages = [
        createResult({
          passes: [pass('html-has-lang'), pass('document-title')],
          violations: [createViolation({ id: 'image-alt' })],
        }),
        createResult({
          passes: [pass('link-name')],
          violations: [
            createViolation({ id: 'color-contrast', impact: 'serious' }),
          ],
        }),
      ];

      const scoring = computeGlobalScoring(pages);

      // C = 2 + 1 = 3 ; NC = 1 + 1 = 2 → 60 % ; NA = 103 + 104
      expect(scoring).toEqual({
        score: 60,
        level: 'Moyen',
        compliant: 3,
        nonCompliant: 2,
        notApplicable: 207,
        pageCount: 2,
      });
    });

    it('handles an empty list', () => {
      expect(computeGlobalScoring([])).toEqual({
        score: 100,
        level: 'Excellent',
        compliant: 0,
        nonCompliant: 0,
        notApplicable: 0,
        pageCount: 0,
      });
    });
  });

  describe('countViolationsByImpact', () => {
    it('counts one per violation (rule) and sums the affected nodes', () => {
      const violations = [
        createViolation({ impact: 'critical' }),
        createViolation({
          impact: 'serious',
          nodes: [
            { html: '<a>', target: ['a'] },
            { html: '<a>', target: ['a:nth-child(2)'] },
          ],
        }),
        createViolation({ impact: 'moderate', nodes: [] }),
        createViolation({ impact: 'minor' }),
        createViolation({ impact: 'minor' }),
        // Impact outside the Axe levels (defensive branch)
        createViolation({ impact: 'unknown' as IAxeViolation['impact'] }),
      ];

      expect(countViolationsByImpact(violations)).toEqual({
        byImpact: { critical: 1, serious: 1, moderate: 1, minor: 2, other: 1 },
        affectedNodes: 1 + 2 + 0 + 1 + 1 + 1,
      });
    });

    it('returns zeros for no violation', () => {
      expect(countViolationsByImpact([])).toEqual({
        byImpact: { critical: 0, serious: 0, moderate: 0, minor: 0, other: 0 },
        affectedNodes: 0,
      });
    });
  });
});
