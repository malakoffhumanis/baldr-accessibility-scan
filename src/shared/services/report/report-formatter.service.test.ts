import { describe, it, expect, beforeEach } from 'vitest';

import { ReportFormatterService } from './report-formatter.service.js';
import type {
  IAxeResult,
  IAxeViolation,
  IAxePass,
  IAxeIncomplete,
  IAxeInapplicable,
  IAIEnrichedResult,
} from '@shared/types/audit.types.js';

// ---------------------------------------------------------------------------
// Helpers to build realistic mock data
// ---------------------------------------------------------------------------

function createBaseResult(overrides: Partial<IAxeResult> = {}): IAxeResult {
  return {
    url: 'https://example.com/page',
    timestamp: '2025-06-15T10:30:00.000Z',
    testInfo: {
      userAgent: 'HeadlessChrome/120',
      viewport: { width: 1920, height: 1080 },
      title: 'Page de test',
    },
    summary: {
      violations: 0,
      passes: 0,
      incomplete: 0,
      inapplicable: 0,
    },
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
    impact: 'serious',
    description: 'Images must have alternate text',
    help: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/image-alt',
    tags: ['wcag2a', 'wcag111'],
    nodes: [
      {
        html: '<img src="logo.png">',
        target: ['img.logo'],
        failureSummary: 'Fix any of the following: missing alt attribute',
      },
    ],
    ...overrides,
  };
}

function createPass(overrides: Partial<IAxePass> = {}): IAxePass {
  return {
    id: 'html-has-lang',
    impact: null,
    tags: ['wcag2a'],
    description: 'html element has a lang attribute',
    help: '<html> element must have a lang attribute',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/html-has-lang',
    nodes: [],
    ...overrides,
  };
}

function createIncomplete(
  overrides: Partial<IAxeIncomplete> = {},
): IAxeIncomplete {
  return {
    id: 'color-contrast',
    impact: 'serious',
    tags: ['wcag2aa'],
    description: 'Color contrast check incomplete',
    help: 'Elements must have sufficient color contrast',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/color-contrast',
    nodes: [],
    ...overrides,
  };
}

function createAIEnrichedResult(
  overrides: Partial<IAIEnrichedResult> = {},
): IAIEnrichedResult {
  return {
    ruleAnalyses: [],
    totalRulesAnalyzed: 0,
    summary: { violations: 0, compliant: 0, notApplicable: 0, errors: 0 },
    metadata: {
      model: 'gpt-4o',
      timestamp: '2025-06-15T10:30:00.000Z',
      analysisType: 'intel',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReportFormatterService', () => {
  let formatter: ReportFormatterService;

  beforeEach(() => {
    formatter = new ReportFormatterService();
  });

  // -----------------------------------------------------------------------
  // calculateAccessibilityScore
  // -----------------------------------------------------------------------
  describe('calculateAccessibilityScore', () => {
    it('should return 100% when there are no violations and no passes', () => {
      const result = createBaseResult();

      const score = formatter.calculateAccessibilityScore(result);

      // With 0 conformes and 0 nonConformes => total === 0 => score is 100
      expect(score.score).toBe(100);
      expect(score.compliant).toBe(0);
      expect(score.nonCompliant).toBe(0);
      // nonApplicables = 106 - (0 + 0) = 106
      expect(score.notApplicable).toBe(106);
    });

    it('should calculate score from Axe violations and passes mapped to RGAA thematics', () => {
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt' }), // thematic 1
          createViolation({ id: 'color-contrast', impact: 'critical' }), // thematic 3
        ],
        passes: [
          createPass({ id: 'html-has-lang' }), // thematic 8
          createPass({ id: 'document-title' }), // thematic 8
          createPass({ id: 'link-name' }), // thematic 6
        ],
        summary: { violations: 2, passes: 3, incomplete: 0, inapplicable: 0 },
      });

      const score = formatter.calculateAccessibilityScore(result);

      // conformes = 3 (html-has-lang, document-title, link-name)
      // nonConformes = 2 (image-alt, color-contrast)
      expect(score.compliant).toBe(3);
      expect(score.nonCompliant).toBe(2);
      // score = round(3/5 * 100) = 60
      expect(score.score).toBe(60);
      // nonApplicables = 106 - (3 + 2) = 101
      expect(score.notApplicable).toBe(101);
    });

    it('should return 0% when all rules are violations', () => {
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt' }),
          createViolation({ id: 'link-name' }),
        ],
        passes: [],
        summary: { violations: 2, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const score = formatter.calculateAccessibilityScore(result);

      expect(score.score).toBe(0);
      expect(score.compliant).toBe(0);
      expect(score.nonCompliant).toBe(2);
    });

    it('should return 100% when all rules are passes', () => {
      const result = createBaseResult({
        violations: [],
        passes: [
          createPass({ id: 'html-has-lang' }),
          createPass({ id: 'document-title' }),
        ],
        summary: { violations: 0, passes: 2, incomplete: 0, inapplicable: 0 },
      });

      const score = formatter.calculateAccessibilityScore(result);

      expect(score.score).toBe(100);
      expect(score.compliant).toBe(2);
      expect(score.nonCompliant).toBe(0);
    });

    it('should ignore Axe rules that do not map to an RGAA thematic', () => {
      const result = createBaseResult({
        violations: [createViolation({ id: 'unknown-rule-xyz' })],
        passes: [createPass({ id: 'non-existent-rule' })],
        summary: { violations: 1, passes: 1, incomplete: 0, inapplicable: 0 },
      });

      const score = formatter.calculateAccessibilityScore(result);

      // Both rules are unmapped, so 0 conformes and 0 nonConformes => 100
      expect(score.score).toBe(100);
      expect(score.compliant).toBe(0);
      expect(score.nonCompliant).toBe(0);
    });

    it('should include AI rule analyses in score calculation', () => {
      const result = createBaseResult({
        passes: [
          createPass({ id: 'html-has-lang' }), // thematic 8
        ],
        summary: { violations: 0, passes: 1, incomplete: 0, inapplicable: 0 },
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: false,
              severity: 'serious',
              summary: 'Missing labels on input fields',
              findings: [
                {
                  type: 'violation',
                  element: 'input#email',
                  issue: 'Missing label',
                  recommendation: 'Add a label element',
                },
              ],
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      // Axe: 1 conforme (html-has-lang -> thematic 8)
      // IA: 1 violation finding (form-labels -> thematic 11)
      expect(score.compliant).toBe(1);
      expect(score.nonCompliant).toBe(1);
      expect(score.score).toBe(50);
    });

    it('should count AI non-applicable rules correctly', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: true,
              severity: 'minor',
              summary: 'Non applicable - aucun formulaire detecte',
              findings: [],
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      // Non-applicable analysis: does not count as conforme or nonConforme
      expect(score.compliant).toBe(0);
      expect(score.nonCompliant).toBe(0);
      expect(score.score).toBe(100);
    });

    it('should count AI rules with errors as non-applicable', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'color-contrast',
              compliant: false,
              severity: 'serious',
              summary: 'Error during analysis',
              findings: [],
              error: 'Timeout while querying AI model',
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      // Error analysis => non applicable, not counted in score
      expect(score.compliant).toBe(0);
      expect(score.nonCompliant).toBe(0);
      expect(score.score).toBe(100);
    });

    it('should count AI compliant rules as conformes', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: true,
              severity: 'minor',
              summary: 'All form labels are properly set',
              findings: [],
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      expect(score.compliant).toBe(1);
      expect(score.nonCompliant).toBe(0);
      expect(score.score).toBe(100);
    });

    it('should count multiple AI violation findings individually', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: false,
              severity: 'serious',
              summary: 'Multiple violations found',
              findings: [
                {
                  type: 'violation',
                  issue: 'Missing label 1',
                  recommendation: 'Add label',
                },
                {
                  type: 'violation',
                  issue: 'Missing label 2',
                  recommendation: 'Add label',
                },
                {
                  type: 'warning',
                  issue: 'Suboptimal label',
                  recommendation: 'Improve label',
                },
              ],
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      // 2 violation findings (warnings are not counted as violations)
      expect(score.nonCompliant).toBe(2);
      expect(score.compliant).toBe(0);
    });

    it('should detect non-applicable via "non_applicable" keyword in summary', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: true,
              severity: 'minor',
              summary: 'Critere non_applicable pour cette page',
              findings: [],
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      expect(score.compliant).toBe(0);
      expect(score.nonCompliant).toBe(0);
    });

    it('should detect non-applicable via "aucun" keyword with compliant + empty findings', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: true,
              severity: 'minor',
              summary: 'Aucun element de formulaire detecte',
              findings: [],
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      expect(score.compliant).toBe(0);
      expect(score.nonCompliant).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // getAccessibilityLevel (private, tested indirectly via HTML output)
  // -----------------------------------------------------------------------
  describe('getAccessibilityLevel (via generateGlobalSummaryTable)', () => {
    it('should label score >= 90 as Excellent', () => {
      // Create result with many passes and no violations to get a high score
      const result = createBaseResult({
        passes: [
          createPass({ id: 'html-has-lang' }),
          createPass({ id: 'document-title' }),
          createPass({ id: 'html-lang-valid' }),
          createPass({ id: 'valid-lang' }),
          createPass({ id: 'heading-order' }),
          createPass({ id: 'page-has-heading-one' }),
          createPass({ id: 'landmark-one-main' }),
          createPass({ id: 'link-name' }),
          createPass({ id: 'button-name' }),
          createPass({ id: 'label' }),
        ],
        summary: { violations: 0, passes: 10, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.generateGlobalSummaryTable([result]);

      expect(html).toContain('Excellent');
    });

    it('should label score >= 75 and < 90 as Bon', () => {
      // 3 passes + 1 violation = 75%
      const result = createBaseResult({
        violations: [createViolation({ id: 'image-alt' })],
        passes: [
          createPass({ id: 'html-has-lang' }),
          createPass({ id: 'document-title' }),
          createPass({ id: 'link-name' }),
        ],
        summary: { violations: 1, passes: 3, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.generateGlobalSummaryTable([result]);

      expect(html).toContain('Bon');
    });

    it('should label score >= 60 and < 75 as Moyen', () => {
      // 3 conformes + 2 nonConformes = 60%
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt' }),
          createViolation({ id: 'color-contrast' }),
        ],
        passes: [
          createPass({ id: 'html-has-lang' }),
          createPass({ id: 'document-title' }),
          createPass({ id: 'link-name' }),
        ],
        summary: { violations: 2, passes: 3, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.generateGlobalSummaryTable([result]);

      expect(html).toContain('Moyen');
    });

    it('should label score >= 40 and < 60 as Faible', () => {
      // 2 passes + 3 violations = 40%
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt' }),
          createViolation({ id: 'color-contrast' }),
          createViolation({ id: 'link-name' }),
        ],
        passes: [
          createPass({ id: 'html-has-lang' }),
          createPass({ id: 'document-title' }),
        ],
        summary: { violations: 3, passes: 2, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.generateGlobalSummaryTable([result]);

      expect(html).toContain('Faible');
    });

    it('should label score < 40 as Critique', () => {
      // 1 pass + 4 violations = 20%
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt' }),
          createViolation({ id: 'color-contrast' }),
          createViolation({ id: 'link-name' }),
          createViolation({ id: 'button-name' }),
        ],
        passes: [createPass({ id: 'html-has-lang' })],
        summary: { violations: 4, passes: 1, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.generateGlobalSummaryTable([result]);

      expect(html).toContain('Critique');
    });
  });

  // -----------------------------------------------------------------------
  // generateGlobalSummaryTable
  // -----------------------------------------------------------------------
  describe('generateGlobalSummaryTable', () => {
    it('should generate an HTML table with rows for each result', () => {
      const result1 = createBaseResult({
        url: 'https://example.com/page1',
        name: 'Page 1',
        passes: [createPass({ id: 'html-has-lang' })],
        summary: { violations: 0, passes: 1, incomplete: 0, inapplicable: 0 },
      });
      const result2 = createBaseResult({
        url: 'https://example.com/page2',
        name: 'Page 2',
        violations: [createViolation({ id: 'image-alt' })],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.generateGlobalSummaryTable([result1, result2]);

      expect(html).toContain('Tableau R\u00e9capitulatif Global');
      expect(html).toContain('Page 1');
      expect(html).toContain('Page 2');
      expect(html).toContain('<table');
      expect(html).toContain('</table>');
      expect(html).toContain('<thead>');
      expect(html).toContain('<tbody>');
    });

    it('should display URL when name is not provided', () => {
      const result = createBaseResult({
        url: 'https://example.com/my-page',
      });

      const html = formatter.generateGlobalSummaryTable([result]);

      expect(html).toContain('https://example.com/my-page');
    });

    it('should escape HTML characters in page name', () => {
      const result = createBaseResult({
        name: '<script>alert("xss")</script>',
        passes: [createPass({ id: 'html-has-lang' })],
        summary: { violations: 0, passes: 1, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.generateGlobalSummaryTable([result]);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('should generate an anchor link with the page id', () => {
      const result = createBaseResult({
        url: 'https://example.com/page',
        name: 'Accueil',
      });

      const html = formatter.generateGlobalSummaryTable([result]);

      expect(html).toContain('href="#page-accueil"');
    });

    it('should handle empty results array', () => {
      const html = formatter.generateGlobalSummaryTable([]);

      expect(html).toContain('<table');
      expect(html).toContain('</table>');
      // Should have header rows but no data rows
      expect(html).toContain('<thead>');
    });
  });

  // -----------------------------------------------------------------------
  // generateRGAAThematicsTable (private, tested via formatAsHTML)
  // -----------------------------------------------------------------------
  describe('generateRGAAThematicsTable (via formatAsHTML)', () => {
    it('should include all 13 RGAA thematics in the HTML output', () => {
      const result = createBaseResult({
        passes: [createPass({ id: 'html-has-lang' })],
        summary: { violations: 0, passes: 1, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('Images');
      expect(html).toContain('Cadres');
      expect(html).toContain('Couleurs');
      expect(html).toContain('Multim\u00e9dia');
      expect(html).toContain('Tableaux');
      expect(html).toContain('Liens');
      expect(html).toContain('Scripts');
      expect(html).toContain('\u00c9l\u00e9ments obligatoires');
      expect(html).toContain('Structuration');
      expect(html).toContain('Pr\u00e9sentation');
      expect(html).toContain('Formulaires');
      expect(html).toContain('Navigation');
      expect(html).toContain('Consultation');
    });

    it('should map Axe violations to correct RGAA thematics', () => {
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt' }), // thematic 1: Images
          createViolation({ id: 'color-contrast' }), // thematic 3: Couleurs
        ],
        summary: { violations: 2, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTML(result);

      // The HTML contains the RGAA thematics table with stats
      expect(html).toContain('Synth\u00e8se par Th\u00e9matiques RGAA');
    });
  });

  // -----------------------------------------------------------------------
  // formatAsHTML
  // -----------------------------------------------------------------------
  describe('formatAsHTML', () => {
    it('should generate a complete HTML document', () => {
      const result = createBaseResult();

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain('</html>');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
    });

    it('should include Axe violation details in the output', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            id: 'image-alt',
            impact: 'critical',
            help: 'All images must have alt text',
            description: 'Ensures all img elements have alt attributes',
            nodes: [
              {
                html: '<img src="photo.jpg">',
                target: ['.hero > img'],
                failureSummary: 'Fix any of the following: missing alt',
              },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('image-alt');
      expect(html).toContain('impact-critical');
      expect(html).toContain('All images must have alt text');
      expect(html).toContain('&lt;img src=&quot;photo.jpg&quot;&gt;');
    });

    it('should show "no violations" message when there are none', () => {
      const result = createBaseResult();

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('Aucune violation');
    });

    it('should include AI enriched section when available', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: true,
              severity: 'minor',
              summary: 'All form labels are properly set',
              findings: [],
            },
          ],
          totalRulesAnalyzed: 1,
          metadata: {
            model: 'gpt-4o',
            timestamp: '2025-06-15T10:30:00.000Z',
            analysisType: 'intel',
          },
        }),
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('Analyse IA Enrichie RGAA');
      expect(html).toContain('gpt-4o');
      expect(html).toContain('form-labels');
    });

    it('should include IA error section when aiAnalysisError is present', () => {
      const result = createBaseResult({
        aiAnalysisError: {
          message: 'Could not connect to AI service',
          type: 'CONNECTIVITY',
          details: 'Connection refused on port 443',
          suggestions: ['Check network connectivity', 'Verify proxy settings'],
          timestamp: '2025-06-15T10:30:00.000Z',
        },
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('Analyse IA Indisponible');
      expect(html).toContain('CONNECTIVITY');
      expect(html).toContain('Could not connect to AI service');
      expect(html).toContain('Check network connectivity');
      expect(html).toContain('Verify proxy settings');
    });

    it('should include summary cards section', () => {
      const result = createBaseResult({
        violations: [createViolation({ id: 'image-alt' })],
        passes: [createPass({ id: 'html-has-lang' })],
        summary: { violations: 1, passes: 1, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('summary-card violations');
      expect(html).toContain('summary-card passes');
      expect(html).toContain('summary-card incomplete');
    });

    it('should handle violations with multiple nodes', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            id: 'image-alt',
            nodes: [
              { html: '<img src="a.png">', target: ['img.a'] },
              { html: '<img src="b.png">', target: ['img.b'] },
              { html: '<img src="c.png">', target: 'img.c' },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('&lt;img src=&quot;a.png&quot;&gt;');
      expect(html).toContain('&lt;img src=&quot;b.png&quot;&gt;');
      expect(html).toContain('&lt;img src=&quot;c.png&quot;&gt;');
      expect(html).toContain('img.c');
    });

    it('should render AI findings including violation, warning, and recommendation types', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'image-alt',
              compliant: false,
              severity: 'critical',
              summary: 'Issues found',
              findings: [
                {
                  type: 'violation',
                  element: 'img#hero',
                  issue: 'Missing alt',
                  recommendation: 'Add descriptive alt text',
                  wcagReference: 'WCAG 1.1.1',
                  rgaaReference: 'RGAA 4.1 - Critère 1.1',
                },
                {
                  type: 'warning',
                  element: 'img#bg',
                  issue: 'Decorative image without role',
                  recommendation: 'Add role="presentation"',
                },
                {
                  type: 'recommendation',
                  issue: 'Consider using figure elements',
                  recommendation: 'Wrap images in figure with figcaption',
                },
              ],
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('finding-violation');
      expect(html).toContain('finding-warning');
      expect(html).toContain('finding-recommendation');
      // The per-finding reference is now the RGAA criterion, not the WCAG SC.
      expect(html).toContain('Référence RGAA:');
      expect(html).toContain('RGAA 4.1 - Critère 1.1');
      expect(html).not.toContain('Référence WCAG:');
      expect(html).not.toContain('WCAG 1.1.1');
    });

    it('should render intelligent analysis section when present', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'color-contrast',
              compliant: false,
              severity: 'serious',
              summary: 'Contrast issues detected',
              findings: [
                {
                  type: 'violation',
                  issue: 'Low contrast',
                  recommendation: 'Increase contrast',
                },
              ],
              intelligentAnalysis: {
                contextualInsights: 'This page uses a dark theme',
                semanticRelevance: 'High impact on readability',
                userImpact: 'Users with low vision affected',
              },
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('Analyse Contextuelle IA');
      expect(html).toContain('This page uses a dark theme');
      expect(html).toContain('High impact on readability');
      expect(html).toContain('Users with low vision affected');
    });

    it('should render non-applicable AI analysis with grey styling', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: true,
              severity: 'minor',
              summary: 'Non applicable - no forms on page',
              findings: [],
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('Non Applicable');
      expect(html).toContain('#95a5a6'); // grey color for NA
    });

    it('should render AI rule analysis with errors', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: false,
              severity: 'serious',
              summary: 'Could not analyze',
              findings: [],
              error: 'Timeout while querying model',
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain("Erreur d'analyse IA");
      expect(html).toContain('Timeout while querying model');
    });
  });

  // -----------------------------------------------------------------------
  // formatAsCSV
  // -----------------------------------------------------------------------
  describe('formatAsCSV', () => {
    it('should generate CSV with header row', () => {
      const result = createBaseResult();

      const csv = formatter.formatAsCSV(result);

      const lines = csv.split('\n');
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain('"URL"');
      expect(lines[0]).toContain('"Violation ID"');
      expect(lines[0]).toContain('"Impact"');
      expect(lines[0]).toContain('"Description"');
      expect(lines[0]).toContain('"Help URL"');
      expect(lines[0]).toContain('"Tags"');
    });

    it('should include violation data rows', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            id: 'image-alt',
            impact: 'critical',
            description: 'Images must have alt text',
            help: 'Ensure images have alt',
            helpUrl: 'https://example.com/help',
            tags: ['wcag2a', 'wcag111'],
            nodes: [
              {
                html: '<img src="photo.jpg">',
                target: ['img.photo'],
              },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const csv = formatter.formatAsCSV(result);

      const lines = csv.split('\n');
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('"https://example.com/page"');
      expect(lines[1]).toContain('"image-alt"');
      expect(lines[1]).toContain('"critical"');
      expect(lines[1]).toContain('"Images must have alt text"');
      expect(lines[1]).toContain('"img.photo"');
    });

    it('should handle violations with multiple nodes as separate rows', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            nodes: [
              { html: '<img src="a.png">', target: ['img.a'] },
              { html: '<img src="b.png">', target: ['img.b'] },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const csv = formatter.formatAsCSV(result);

      const lines = csv.split('\n');
      // Header + 2 data rows
      expect(lines.length).toBe(3);
    });

    it('should handle null/undefined cells by replacing with empty string', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            nodes: [
              {
                html: '<img>',
                target: ['img'],
              },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const csv = formatter.formatAsCSV(result);

      // All cells should be quoted and present
      const dataRow = csv.split('\n')[1];
      const cells = dataRow.match(/"[^"]*"/g);
      expect(cells).not.toBeNull();
      // 9 columns
      expect(cells!.length).toBe(9);
    });

    it('should escape double quotes in CSV cells', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            description: 'Test with "quotes" inside',
            nodes: [
              {
                html: '<img alt="test">',
                target: ['img'],
              },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const csv = formatter.formatAsCSV(result);

      // Double quotes should be escaped as ""
      expect(csv).toContain('""quotes""');
      expect(csv).toContain('alt=""test""');
    });

    it('should join array target selectors with comma', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            nodes: [
              {
                html: '<div>test</div>',
                target: ['div.first', 'div.second'],
              },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const csv = formatter.formatAsCSV(result);

      expect(csv).toContain('div.first, div.second');
    });

    it('should handle string target selector', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            nodes: [
              {
                html: '<div>test</div>',
                target: 'div.selector',
              },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const csv = formatter.formatAsCSV(result);

      expect(csv).toContain('div.selector');
    });

    it('should produce only header row with no violations', () => {
      const result = createBaseResult();

      const csv = formatter.formatAsCSV(result);

      const lines = csv.split('\n');
      expect(lines.length).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // escapeHtml (private, tested indirectly)
  // -----------------------------------------------------------------------
  describe('escapeHtml (via formatAsHTML)', () => {
    it('should escape < and > characters', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            help: '<script>alert("xss")</script>',
            nodes: [
              {
                html: '<div onclick="alert()">test</div>',
                target: ['div'],
              },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTML(result);

      expect(html).not.toContain('<script>alert("xss")</script>');
      expect(html).toContain(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
      );
    });

    it('should escape ampersand characters', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            help: 'Terms & conditions',
            nodes: [{ html: '<a href="?a=1&b=2">link</a>', target: ['a'] }],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('Terms &amp; conditions');
    });

    it('should escape single quotes', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            help: "It's a test",
            nodes: [{ html: "<div class='test'>text</div>", target: ['div'] }],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('It&#039;s a test');
    });

    it('should handle null/undefined in page name gracefully', () => {
      const result = createBaseResult({
        name: undefined,
        url: 'https://example.com',
      });

      const html = formatter.generateGlobalSummaryTable([result]);

      // Should use URL when name is undefined
      expect(html).toContain('https://example.com');
    });
  });

  // -----------------------------------------------------------------------
  // mapRulesToThematics (private, tested via calculateAccessibilityScore)
  // -----------------------------------------------------------------------
  describe('mapRulesToThematics (via calculateAccessibilityScore)', () => {
    it('should map Axe rules to correct RGAA thematics', () => {
      // Test a variety of Axe rule -> thematic mappings
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt' }), // 1: Images
          createViolation({ id: 'frame-title' }), // 2: Cadres
          createViolation({ id: 'color-contrast' }), // 3: Couleurs
          createViolation({ id: 'video-caption' }), // 4: Multimedia
          createViolation({ id: 'td-headers-attr' }), // 5: Tableaux
          createViolation({ id: 'link-name' }), // 6: Liens
          createViolation({ id: 'button-name' }), // 7: Scripts
          createViolation({ id: 'document-title' }), // 8: Elements obligatoires
          createViolation({ id: 'heading-order' }), // 9: Structuration
          createViolation({ id: 'list' }), // 10: Presentation
          createViolation({ id: 'label' }), // 11: Formulaires
          createViolation({ id: 'bypass' }), // 12: Navigation
          createViolation({ id: 'meta-refresh' }), // 13: Consultation
        ],
        summary: { violations: 13, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const score = formatter.calculateAccessibilityScore(result);

      // 13 nonConformes, 0 conformes => score 0%
      expect(score.nonCompliant).toBe(13);
      expect(score.compliant).toBe(0);
      expect(score.score).toBe(0);
    });

    it('should map IA rule IDs to RGAA thematics', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'image-alt', // thematic 1
              compliant: true,
              severity: 'minor',
              summary: 'All images have alt text',
              findings: [],
            },
            {
              ruleId: 'form-labels', // thematic 11
              compliant: true,
              severity: 'minor',
              summary: 'All forms properly labeled',
              findings: [],
            },
            {
              ruleId: 'navigation', // thematic 12
              compliant: false,
              severity: 'serious',
              summary: 'Navigation issues',
              findings: [
                {
                  type: 'violation',
                  issue: 'Missing skip link',
                  recommendation: 'Add skip link',
                },
              ],
            },
          ],
          totalRulesAnalyzed: 3,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      // 2 conformes (image-alt, form-labels) + 1 nonConforme (navigation violation)
      expect(score.compliant).toBe(2);
      expect(score.nonCompliant).toBe(1);
      expect(score.score).toBe(67); // round(2/3 * 100) = 67
    });

    it('should avoid counting the same IA rule twice', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'form-labels',
              compliant: true,
              severity: 'minor',
              summary: 'OK',
              findings: [],
            },
            // Same ruleId appears again - should only be counted once
            // because it won't re-enter the set
            {
              ruleId: 'form-labels',
              compliant: false,
              severity: 'serious',
              summary: 'Not OK',
              findings: [
                { type: 'violation', issue: 'Missing', recommendation: 'Add' },
              ],
            },
          ],
          totalRulesAnalyzed: 2,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      // First analysis is compliant, second has same ruleId but different key
      // They each get key `ia-form-labels` - the first one is counted, the second is skipped
      expect(score.compliant).toBe(1);
      expect(score.nonCompliant).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // formatAsHTMLSection
  // -----------------------------------------------------------------------
  describe('formatAsHTMLSection', () => {
    it('should generate a details/summary section for a page', () => {
      const result = createBaseResult({
        url: 'https://example.com/test',
        name: 'Test Page',
        passes: [createPass({ id: 'html-has-lang' })],
        summary: { violations: 0, passes: 1, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTMLSection(result);

      expect(html).toContain('<details');
      expect(html).toContain('<summary');
      expect(html).toContain('Test Page');
      expect(html).toContain('page-test-page');
    });

    it('should show violation details in section', () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            id: 'image-alt',
            impact: 'serious',
            nodes: [{ html: '<img>', target: ['img'] }],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTMLSection(result);

      expect(html).toContain('image-alt');
      expect(html).toContain('violation-serious');
    });
  });

  // -----------------------------------------------------------------------
  // getHTMLStyles
  // -----------------------------------------------------------------------
  describe('getHTMLStyles', () => {
    it('should return CSS style block', () => {
      const styles = formatter.getHTMLStyles();

      expect(styles).toContain('<style>');
      expect(styles).toContain('</style>');
      expect(styles).toContain('.container');
      expect(styles).toContain('.header');
      expect(styles).toContain('.violation');
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle result with all arrays empty', () => {
      const result = createBaseResult({
        violations: [],
        passes: [],
        incomplete: [],
        inapplicable: [],
      });

      const html = formatter.formatAsHTML(result);
      const csv = formatter.formatAsCSV(result);
      const score = formatter.calculateAccessibilityScore(result);

      expect(html).toContain('<!DOCTYPE html>');
      expect(csv.split('\n').length).toBe(1);
      expect(score.score).toBe(100);
    });

    it('should handle result with many violations across different impacts', () => {
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt', impact: 'critical' }),
          createViolation({ id: 'color-contrast', impact: 'serious' }),
          createViolation({ id: 'link-name', impact: 'moderate' }),
          createViolation({ id: 'meta-viewport', impact: 'minor' }),
        ],
        summary: { violations: 4, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const html = formatter.formatAsHTML(result);

      expect(html).toContain('impact-critical');
      expect(html).toContain('impact-serious');
      expect(html).toContain('impact-moderate');
      expect(html).toContain('impact-minor');
    });

    it('should handle AI enriched result with no rule analyses', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [],
          totalRulesAnalyzed: 0,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      expect(score.score).toBe(100);
      expect(score.compliant).toBe(0);
      expect(score.nonCompliant).toBe(0);
    });

    it('should handle AI rule with unmapped ruleId', () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          ruleAnalyses: [
            {
              ruleId: 'unknown-rule-xyz',
              compliant: false,
              severity: 'critical',
              summary: 'Issues found',
              findings: [
                {
                  type: 'violation',
                  issue: 'Problem',
                  recommendation: 'Fix it',
                },
              ],
            },
          ],
          totalRulesAnalyzed: 1,
        }),
      });

      const score = formatter.calculateAccessibilityScore(result);

      // Unknown rule => not mapped to any thematic, not counted
      expect(score.compliant).toBe(0);
      expect(score.nonCompliant).toBe(0);
      expect(score.score).toBe(100);
    });
  });
});
