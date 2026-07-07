import { describe, it, expect } from 'vitest';

import {
  convertResultToAPI,
  convertToConsolidatedReport,
} from './audit-api.adapter';

import type {
  IAxeResult,
  IAxeViolation,
  IAxeNode,
  IAIEnrichedResult,
  IAIAnalysisError,
} from '@shared/types/audit.types.js';

// ═════════════════════════════════════════════════════════════════════════════
// Reusable test data (fixtures)
// ═════════════════════════════════════════════════════════════════════════════

function createAxeNode(overrides: Partial<IAxeNode> = {}): IAxeNode {
  return {
    html: '<img src="photo.jpg">',
    target: ['img.photo'],
    failureSummary: 'The element has no alt attribute',
    ...overrides,
  };
}

function createAxeViolation(
  overrides: Partial<IAxeViolation> = {},
): IAxeViolation {
  return {
    id: 'image-alt',
    impact: 'critical',
    description: 'Images must have alternative text',
    help: 'Images must have an alt attribute',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.8/image-alt',
    tags: ['wcag2a', 'wcag111', 'rgaa'],
    nodes: [createAxeNode()],
    ...overrides,
  };
}

function createAxeResult(overrides: Partial<IAxeResult> = {}): IAxeResult {
  return {
    url: 'https://example.com',
    timestamp: '2026-03-30T10:00:00.000Z',
    testInfo: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      viewport: { width: 1920, height: 1080 },
      title: 'Test page',
    },
    summary: {
      violations: 2,
      passes: 15,
      incomplete: 1,
      inapplicable: 5,
    },
    violations: [createAxeViolation()],
    passes: [],
    incomplete: [],
    inapplicable: [],
    ...overrides,
  };
}

function createAIEnrichedResult(
  overrides: Partial<IAIEnrichedResult> = {},
): IAIEnrichedResult {
  return {
    ruleAnalyses: [
      {
        ruleId: '1.1',
        compliant: false,
        severity: 'critical',
        summary: 'Missing alternative images',
        findings: [
          {
            type: 'violation',
            element: '<img src="photo.jpg">',
            issue: 'Image without alt attribute',
            recommendation: 'Add a descriptive alt attribute',
            wcagReference: '1.1.1',
          },
        ],
      },
      {
        ruleId: '3.1',
        compliant: true,
        severity: 'minor',
        summary: 'Sufficient contrast',
        findings: [],
      },
    ],
    totalRulesAnalyzed: 2,
    summary: {
      violations: 1,
      compliant: 1,
      notApplicable: 0,
      errors: 0,
    },
    metadata: {
      model: 'gpt-4o',
      timestamp: '2026-03-30T10:01:00.000Z',
      analysisType: 'full',
    },
    ...overrides,
  };
}

function createIAAnalysisError(
  overrides: Partial<IAIAnalysisError> = {},
): IAIAnalysisError {
  return {
    message: 'Connection error to the AI API',
    type: 'CONNECTIVITY',
    details: 'ECONNREFUSED 10.0.0.1:443',
    suggestions: [
      'Check network connectivity',
      'Check the proxy configuration',
    ],
    timestamp: '2026-03-30T10:00:30.000Z',
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe('audit-api.adapter', () => {
  // ═════════════════════════════════════════════════════════════════════════
  // convertResultToAPI
  // ═════════════════════════════════════════════════════════════════════════
  describe('convertResultToAPI', () => {
    describe('basic conversion', () => {
      it('should convert a minimal result', () => {
        const result = createAxeResult({ violations: [] });

        const api = convertResultToAPI(result);

        expect(api.url).toBe('https://example.com');
        expect(api.timestamp).toBe('2026-03-30T10:00:00.000Z');
        expect(api.authRequired).toBe(false);
        expect(api.authMethod).toBe('none');
      });

      it('should use the page name when available', () => {
        const result = createAxeResult({ name: 'Home page' });

        const api = convertResultToAPI(result);

        expect(api.pageName).toBe('Home page');
      });

      it('should use the URL as the name when the name is not defined', () => {
        const result = createAxeResult({ name: undefined });

        const api = convertResultToAPI(result);

        expect(api.pageName).toBe('https://example.com');
      });
    });

    describe('auth conversion', () => {
      it('should indicate authentication required when authenticated=true', () => {
        const result = createAxeResult({
          authenticated: true,
          authMethod: 'form',
        });

        const api = convertResultToAPI(result);

        expect(api.authRequired).toBe(true);
        expect(api.authMethod).toBe('form');
      });

      it('should indicate the adfs method', () => {
        const result = createAxeResult({
          authenticated: true,
          authMethod: 'adfs',
        });

        const api = convertResultToAPI(result);

        expect(api.authMethod).toBe('adfs');
      });

      it('should use "none" by default for the auth method', () => {
        const result = createAxeResult({
          authenticated: undefined,
          authMethod: undefined,
        });

        const api = convertResultToAPI(result);

        expect(api.authRequired).toBe(false);
        expect(api.authMethod).toBe('none');
      });
    });

    describe('test information conversion', () => {
      it('should convert the viewport information', () => {
        const result = createAxeResult();

        const api = convertResultToAPI(result);

        expect(api.testInfo.viewport).toEqual({
          width: 1920,
          height: 1080,
        });
      });

      it('should keep the userAgent', () => {
        const result = createAxeResult();

        const api = convertResultToAPI(result);

        expect(api.testInfo.userAgent).toContain('Chrome');
      });

      it('should keep the page title', () => {
        const result = createAxeResult();

        const api = convertResultToAPI(result);

        expect(api.testInfo.pageTitle).toBe('Test page');
      });
    });

    describe('Axe summary conversion', () => {
      it('should convert the summary counters', () => {
        const result = createAxeResult({
          summary: {
            violations: 5,
            passes: 20,
            incomplete: 3,
            inapplicable: 10,
          },
        });

        const api = convertResultToAPI(result);

        expect(api.axeSummary).toEqual({
          violationCount: 5,
          passedCount: 20,
          incompleteCount: 3,
          inapplicableCount: 10,
        });
      });
    });

    describe('violation conversion', () => {
      it('should convert a violation with its DOM nodes', () => {
        const result = createAxeResult({
          violations: [createAxeViolation()],
        });

        const api = convertResultToAPI(result);

        expect(api.violations).toHaveLength(1);
        const violation = api.violations[0];
        expect(violation.id).toBe('image-alt');
        expect(violation.impact).toBe('critical');
        expect(violation.description).toBe('Images must have alternative text');
        expect(violation.help).toBe('Images must have an alt attribute');
        expect(violation.helpUrl).toContain('dequeuniversity.com');
        expect(violation.tags).toEqual(['wcag2a', 'wcag111', 'rgaa']);
      });

      it('should convert the affected DOM elements', () => {
        const result = createAxeResult({
          violations: [createAxeViolation()],
        });

        const api = convertResultToAPI(result);

        const elements = api.violations[0].nodes;
        expect(elements).toHaveLength(1);
        expect(elements[0].html).toBe('<img src="photo.jpg">');
        expect(elements[0].selector).toEqual(['img.photo']);
        expect(elements[0].failureSummary).toBe(
          'The element has no alt attribute',
        );
      });

      it('should convert multiple violations', () => {
        const violation1 = createAxeViolation({ id: 'image-alt' });
        const violation2 = createAxeViolation({
          id: 'color-contrast',
          impact: 'serious',
          description: 'Elements must have sufficient contrast',
          nodes: [
            createAxeNode({
              html: '<p style="color: #ccc">Pale text</p>',
              target: ['p.pale'],
            }),
          ],
        });

        const result = createAxeResult({
          violations: [violation1, violation2],
        });

        const api = convertResultToAPI(result);

        expect(api.violations).toHaveLength(2);
        expect(api.violations[0].id).toBe('image-alt');
        expect(api.violations[1].id).toBe('color-contrast');
      });

      it('should convert a violation with multiple nodes', () => {
        const violation = createAxeViolation({
          nodes: [
            createAxeNode({ html: '<img src="a.jpg">', target: ['img.a'] }),
            createAxeNode({ html: '<img src="b.jpg">', target: ['img.b'] }),
            createAxeNode({ html: '<img src="c.jpg">', target: 'img.c' }),
          ],
        });

        const result = createAxeResult({ violations: [violation] });

        const api = convertResultToAPI(result);

        expect(api.violations[0].nodes).toHaveLength(3);
      });

      it('should handle a node without failureSummary', () => {
        const violation = createAxeViolation({
          nodes: [createAxeNode({ failureSummary: undefined })],
        });

        const result = createAxeResult({ violations: [violation] });

        const api = convertResultToAPI(result);

        expect(api.violations[0].nodes[0].failureSummary).toBeUndefined();
      });

      it('should handle zero violations', () => {
        const result = createAxeResult({ violations: [] });

        const api = convertResultToAPI(result);

        expect(api.violations).toEqual([]);
      });
    });

    describe('AI result conversion', () => {
      it('should not include aiResult when absent', () => {
        const result = createAxeResult({
          aiEnrichedResult: undefined,
        });

        const api = convertResultToAPI(result);

        expect(api.aiResult).toBeUndefined();
      });

      it('should convert a complete AI result', () => {
        const aiResult = createAIEnrichedResult();
        const result = createAxeResult({ aiEnrichedResult: aiResult });

        const api = convertResultToAPI(result);

        expect(api.aiResult).toBeDefined();
        expect(api.aiResult!.rulesAnalyzedCount).toBe(2);
        expect(api.aiResult!.metadata.model).toBe('gpt-4o');
        expect(api.aiResult!.metadata.analysisType).toBe('full');
      });

      it('should convert the AI rule analyses', () => {
        const aiResult = createAIEnrichedResult();
        const result = createAxeResult({ aiEnrichedResult: aiResult });

        const api = convertResultToAPI(result);

        const analyses = api.aiResult!.ruleAnalyses;
        expect(analyses).toHaveLength(2);

        // First rule: non-compliant
        expect(analyses[0].ruleId).toBe('1.1');
        expect(analyses[0].ruleTitle).toBe('Missing alternative images');
        expect(analyses[0].status).toBe('non-compliant');

        // Second rule: compliant
        expect(analyses[1].ruleId).toBe('3.1');
        expect(analyses[1].status).toBe('compliant');
      });

      it('should convert the AI analysis findings', () => {
        const aiResult = createAIEnrichedResult();
        const result = createAxeResult({ aiEnrichedResult: aiResult });

        const api = convertResultToAPI(result);

        const findings = api.aiResult!.ruleAnalyses[0].findings;
        expect(findings).toHaveLength(1);
        expect(findings[0].type).toBe('violation');
        expect(findings[0].element).toBe('<img src="photo.jpg">');
        expect(findings[0].issue).toBe('Image without alt attribute');
        expect(findings[0].recommendation).toBe(
          'Add a descriptive alt attribute',
        );
        expect(findings[0].referenceWCAG).toBe('1.1.1');
      });

      it('should compute the AI summary (violation and compliant counts)', () => {
        const aiResult = createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: '1.1',
              compliant: false,
              severity: 'critical',
              summary: 'Non-compliant',
              findings: [],
            },
            {
              ruleId: '2.1',
              compliant: false,
              severity: 'serious',
              summary: 'Non-compliant',
              findings: [],
            },
            {
              ruleId: '3.1',
              compliant: true,
              severity: 'minor',
              summary: 'Compliant',
              findings: [],
            },
          ],
        });

        const result = createAxeResult({ aiEnrichedResult: aiResult });

        const api = convertResultToAPI(result);

        expect(api.aiResult!.summary.violationCount).toBe(2);
        expect(api.aiResult!.summary.compliantRulesCount).toBe(1);
        expect(api.aiResult!.summary.inapplicableRulesCount).toBe(0);
      });

      it('should have 0 violations when all rules are compliant', () => {
        const aiResult = createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: '1.1',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
          ],
        });

        const result = createAxeResult({ aiEnrichedResult: aiResult });
        const api = convertResultToAPI(result);

        expect(api.aiResult!.summary.violationCount).toBe(0);
        expect(api.aiResult!.summary.compliantRulesCount).toBe(1);
      });

      it('should include the screenshot when available', () => {
        const aiResult = createAIEnrichedResult({
          screenshot: 'base64encodeddata==',
        });
        const result = createAxeResult({ aiEnrichedResult: aiResult });

        const api = convertResultToAPI(result);

        expect(api.aiResult!.screenshot).toBe('base64encodeddata==');
      });

      it('should not include the screenshot when absent', () => {
        const aiResult = createAIEnrichedResult({ screenshot: undefined });
        const result = createAxeResult({ aiEnrichedResult: aiResult });

        const api = convertResultToAPI(result);

        expect(api.aiResult!.screenshot).toBeUndefined();
      });

      it('should include the extracted DOM when available', () => {
        const aiResult = createAIEnrichedResult({
          extractedDOM: '<html><body>...</body></html>',
        });
        const result = createAxeResult({ aiEnrichedResult: aiResult });

        const api = convertResultToAPI(result);

        expect(api.aiResult!.extractedDom).toBe(
          '<html><body>...</body></html>',
        );
      });

      it('should handle a finding without element or wcagReference', () => {
        const aiResult = createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: '1.1',
              compliant: false,
              severity: 'critical',
              summary: 'Test',
              findings: [
                {
                  type: 'warning',
                  issue: 'Problem detected',
                  recommendation: 'Fix it',
                  // element and wcagReference not provided
                },
              ],
            },
          ],
        });

        const result = createAxeResult({ aiEnrichedResult: aiResult });
        const api = convertResultToAPI(result);

        const finding = api.aiResult!.ruleAnalyses[0].findings[0];
        expect(finding.element).toBe('');
        expect(finding.referenceWCAG).toBe('');
      });

      it('should initialize recommendations and wcagReferences as empty arrays', () => {
        const aiResult = createAIEnrichedResult();
        const result = createAxeResult({ aiEnrichedResult: aiResult });

        const api = convertResultToAPI(result);

        for (const analysis of api.aiResult!.ruleAnalyses) {
          expect(analysis.recommendations).toEqual([]);
          expect(analysis.wcagReferences).toEqual([]);
        }
      });

      it('should set confidenceScore to 0', () => {
        const aiResult = createAIEnrichedResult();
        const result = createAxeResult({ aiEnrichedResult: aiResult });

        const api = convertResultToAPI(result);

        for (const analysis of api.aiResult!.ruleAnalyses) {
          expect(analysis.confidenceScore).toBe(0);
        }
      });
    });

    describe('AI error conversion', () => {
      it('should not include aiError when aiAnalysisError is absent', () => {
        const result = createAxeResult({ aiAnalysisError: undefined });

        const api = convertResultToAPI(result);

        expect(api.aiError).toBeUndefined();
      });

      it('should convert an AI error', () => {
        const error = createIAAnalysisError();
        const result = createAxeResult({ aiAnalysisError: error });

        const api = convertResultToAPI(result);

        expect(api.aiError).toBeDefined();
        expect(api.aiError!.message).toBe('Connection error to the AI API');
        expect(api.aiError!.type).toBe('CONNECTIVITY');
        expect(api.aiError!.details).toBe('ECONNREFUSED 10.0.0.1:443');
        expect(api.aiError!.suggestions).toEqual([
          'Check network connectivity',
          'Check the proxy configuration',
        ]);
        expect(api.aiError!.timestamp).toBe('2026-03-30T10:00:30.000Z');
      });

      it('should handle different AI error types', () => {
        const types = [
          'CONFIGURATION',
          'AUTHENTICATION',
          'TIMEOUT',
          'PROXY',
          'DEPLOYMENT',
          'RATE_LIMIT',
          'UNKNOWN',
        ] as const;

        for (const type of types) {
          const error = createIAAnalysisError({ type });
          const result = createAxeResult({ aiAnalysisError: error });

          const api = convertResultToAPI(result);

          expect(api.aiError!.type).toBe(type);
        }
      });

      it('should allow both an aiResult and an aiError', () => {
        const aiResult = createAIEnrichedResult();
        const error = createIAAnalysisError();
        const result = createAxeResult({
          aiEnrichedResult: aiResult,
          aiAnalysisError: error,
        });

        const api = convertResultToAPI(result);

        expect(api.aiResult).toBeDefined();
        expect(api.aiError).toBeDefined();
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // convertToConsolidatedReport
  // ═════════════════════════════════════════════════════════════════════════
  describe('convertToConsolidatedReport', () => {
    it('should create a consolidated report with a single result', () => {
      const results = [createAxeResult()];

      const report = convertToConsolidatedReport(results, 'Audit Test', 1500);

      expect(report.name).toBe('Audit Test');
      expect(report.urlCount).toBe(1);
      expect(report.results).toHaveLength(1);
      expect(report.durationMs).toBe(1500);
    });

    it('should create a consolidated report with multiple results', () => {
      const results = [
        createAxeResult({ url: 'https://example.com' }),
        createAxeResult({ url: 'https://example.com/about' }),
        createAxeResult({ url: 'https://example.com/contact' }),
      ];

      const report = convertToConsolidatedReport(
        results,
        'Multi-page audit',
        5000,
      );

      expect(report.urlCount).toBe(3);
      expect(report.results).toHaveLength(3);
      expect(report.results[0].url).toBe('https://example.com');
      expect(report.results[1].url).toBe('https://example.com/about');
      expect(report.results[2].url).toBe('https://example.com/contact');
    });

    it('should handle an empty results array', () => {
      const report = convertToConsolidatedReport([], 'Empty audit');

      expect(report.urlCount).toBe(0);
      expect(report.results).toEqual([]);
    });

    it('should include an ISO-formatted timestamp', () => {
      const report = convertToConsolidatedReport([createAxeResult()]);

      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should use 0 as the default durationMs', () => {
      const report = convertToConsolidatedReport([createAxeResult()]);

      expect(report.durationMs).toBe(0);
    });

    it('should have an undefined name when not specified', () => {
      const report = convertToConsolidatedReport([createAxeResult()]);

      expect(report.name).toBeUndefined();
    });

    it('should convert each result via convertResultToAPI', () => {
      const aiResult = createAIEnrichedResult();
      const results = [
        createAxeResult({
          name: 'Home',
          aiEnrichedResult: aiResult,
        }),
      ];

      const report = convertToConsolidatedReport(results, 'Audit IA', 3000);

      // Verify the AI conversion went through
      expect(report.results[0].pageName).toBe('Home');
      expect(report.results[0].aiResult).toBeDefined();
      expect(report.results[0].aiResult!.metadata.model).toBe('gpt-4o');
    });
  });
});
