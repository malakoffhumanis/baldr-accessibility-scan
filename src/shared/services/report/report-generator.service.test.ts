import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    ensureDir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeJson: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }),
}));

import fs from 'fs-extra';
import { ReportGeneratorService } from './report-generator.service.js';
import type {
  IAxeResult,
  IAxeViolation,
  IAxePass,
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

describe('ReportGeneratorService', () => {
  let generator: ReportGeneratorService;

  beforeEach(() => {
    vi.clearAllMocks();
    generator = new ReportGeneratorService();
  });

  // -----------------------------------------------------------------------
  // ensureReportsDirectory
  // -----------------------------------------------------------------------
  describe('ensureReportsDirectory', () => {
    it('should call fs.ensureDir with the reports directory path', async () => {
      await generator.ensureReportsDirectory();

      expect(fs.ensureDir).toHaveBeenCalledTimes(1);
      const calledPath = (fs.ensureDir as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(calledPath).toContain('reports');
    });

    it('should propagate errors from fs.ensureDir', async () => {
      const error = new Error('Permission denied');
      (fs.ensureDir as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error);

      await expect(generator.ensureReportsDirectory()).rejects.toThrow(
        'Permission denied',
      );
    });
  });

  // -----------------------------------------------------------------------
  // generateReports
  // -----------------------------------------------------------------------
  describe('generateReports', () => {
    it('should generate HTML and JSON reports by default', async () => {
      const result = createBaseResult({
        violations: [createViolation()],
        passes: [createPass()],
        summary: { violations: 1, passes: 1, incomplete: 0, inapplicable: 0 },
      });

      const report = await generator.generateReports(result);

      // ensureDir called for reports directory
      expect(fs.ensureDir).toHaveBeenCalled();

      // HTML report: writeFile for HTML
      expect(report.htmlPath).toBeDefined();
      expect(report.htmlPath).toContain('accessibility-report-');
      expect(report.htmlPath).toContain('.html');

      // JSON report: writeJson
      expect(report.jsonPath).toBeDefined();
      expect(report.jsonPath).toContain('accessibility-report-');
      expect(report.jsonPath).toContain('.json');

      // CSV not generated by default
      expect(report.csvPath).toBeUndefined();

      // Summary carried over
      expect(report.summary).toEqual(result.summary);
    });

    it('should generate only HTML report when formats = ["html"]', async () => {
      const result = createBaseResult();

      const report = await generator.generateReports(result, ['html']);

      expect(report.htmlPath).toBeDefined();
      expect(report.jsonPath).toBeUndefined();
      expect(report.csvPath).toBeUndefined();

      // writeFile called for HTML
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const writeCall = (fs.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(writeCall[0]).toContain('.html');
      expect(writeCall[2]).toBe('utf8');
    });

    it('should generate only JSON report when formats = ["json"]', async () => {
      const result = createBaseResult();

      const report = await generator.generateReports(result, ['json']);

      expect(report.htmlPath).toBeUndefined();
      expect(report.jsonPath).toBeDefined();
      expect(report.csvPath).toBeUndefined();

      // writeJson called for JSON
      expect(fs.writeJson).toHaveBeenCalledTimes(1);
      const writeJsonCall = (fs.writeJson as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(writeJsonCall[0]).toContain('.json');
      expect(writeJsonCall[1]).toEqual(result);
      expect(writeJsonCall[2]).toEqual({ spaces: 2 });
    });

    it('should generate only CSV report when formats = ["csv"]', async () => {
      const result = createBaseResult({
        violations: [createViolation()],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const report = await generator.generateReports(result, ['csv']);

      expect(report.htmlPath).toBeUndefined();
      expect(report.jsonPath).toBeUndefined();
      expect(report.csvPath).toBeDefined();
      expect(report.csvPath).toContain('accessibility-violations-');
      expect(report.csvPath).toContain('.csv');

      // writeFile called for CSV
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const writeCall = (fs.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(writeCall[0]).toContain('.csv');
      expect(writeCall[2]).toBe('utf8');
    });

    it('should generate all three report formats when requested', async () => {
      const result = createBaseResult({
        violations: [createViolation()],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      const report = await generator.generateReports(result, [
        'html',
        'json',
        'csv',
      ]);

      expect(report.htmlPath).toBeDefined();
      expect(report.jsonPath).toBeDefined();
      expect(report.csvPath).toBeDefined();
    });

    it('should include aiSummary when AI enriched result is present', async () => {
      const result = createBaseResult({
        aiEnrichedResult: createAIEnrichedResult({
          summary: { violations: 2, compliant: 5, notApplicable: 3, errors: 0 },
        }),
      });

      const report = await generator.generateReports(result, ['html']);

      expect(report.aiSummary).toEqual({
        violations: 2,
        compliant: 5,
        notApplicable: 3,
        errors: 0,
      });
    });

    it('should not include aiSummary when AI enriched result is absent', async () => {
      const result = createBaseResult();

      const report = await generator.generateReports(result, ['html']);

      expect(report.aiSummary).toBeUndefined();
    });

    it('should write valid HTML content for HTML report', async () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            id: 'image-alt',
            impact: 'critical',
            help: 'Images must have alt text',
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      await generator.generateReports(result, ['html']);

      const htmlContent = (fs.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as string;
      expect(htmlContent).toContain('<!DOCTYPE html>');
      expect(htmlContent).toContain('<html lang="fr">');
      expect(htmlContent).toContain('image-alt');
    });

    it('should write valid CSV content for CSV report', async () => {
      const result = createBaseResult({
        violations: [
          createViolation({
            id: 'color-contrast',
            impact: 'serious',
            nodes: [
              {
                html: '<p style="color: grey">low contrast</p>',
                target: ['p.text'],
              },
            ],
          }),
        ],
        summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      await generator.generateReports(result, ['csv']);

      const csvContent = (fs.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as string;
      expect(csvContent).toContain('"URL"');
      expect(csvContent).toContain('"color-contrast"');
      expect(csvContent).toContain('"serious"');
    });

    it('should use timestamped filenames', async () => {
      const result = createBaseResult();

      await generator.generateReports(result, ['html', 'json', 'csv']);

      // All file paths should contain a timestamp pattern
      const htmlPath = (fs.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      // Timestamp format: 2025-06-15T10-30-00-000Z-like
      expect(htmlPath).toMatch(/accessibility-report-\d{4}-\d{2}-\d{2}T/);
    });

    it('should propagate write errors', async () => {
      const result = createBaseResult();
      (fs.writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Disk full'),
      );

      await expect(generator.generateReports(result, ['html'])).rejects.toThrow(
        'Disk full',
      );
    });
  });

  // -----------------------------------------------------------------------
  // generateConsolidatedHTMLReport
  // -----------------------------------------------------------------------
  describe('generateConsolidatedHTMLReport', () => {
    it('should return valid HTML document with consolidated data', async () => {
      const results = [
        createBaseResult({
          url: 'https://example.com/home',
          name: 'Home',
          passes: [createPass({ id: 'html-has-lang' })],
          summary: { violations: 0, passes: 1, incomplete: 0, inapplicable: 0 },
        }),
        createBaseResult({
          url: 'https://example.com/about',
          name: 'About',
          violations: [createViolation({ id: 'image-alt' })],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const html = await generator.generateConsolidatedHTMLReport(results);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain('Consolid\u00e9');
      expect(html).toContain('Home');
      expect(html).toContain('About');
    });

    it('should include project name when provided', async () => {
      const results = [createBaseResult()];

      const html = await generator.generateConsolidatedHTMLReport(
        results,
        'Mon Projet RGAA',
      );

      expect(html).toContain('Mon Projet RGAA');
      expect(html).toContain('<title>');
      expect(html).toContain('Mon Projet RGAA');
    });

    it('should not include project name in title when not provided', async () => {
      const results = [createBaseResult()];

      const html = await generator.generateConsolidatedHTMLReport(results);

      // Title should not have a " - " suffix for project name
      expect(html).toContain(
        "<title>Rapport d'Accessibilit\u00e9 Consolid\u00e9</title>",
      );
    });

    it('should display page count', async () => {
      const results = [
        createBaseResult({ url: 'https://example.com/page1' }),
        createBaseResult({ url: 'https://example.com/page2' }),
        createBaseResult({ url: 'https://example.com/page3' }),
      ];

      const html = await generator.generateConsolidatedHTMLReport(results);

      expect(html).toContain('3');
    });

    it('should calculate and display global RGAA score', async () => {
      const results = [
        createBaseResult({
          url: 'https://example.com/page1',
          passes: [createPass({ id: 'html-has-lang' })],
          violations: [createViolation({ id: 'image-alt' })],
          summary: { violations: 1, passes: 1, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const html = await generator.generateConsolidatedHTMLReport(results);

      // Score should be present in the HTML
      expect(html).toMatch(/\d+%/);
    });

    it('should deduplicate results with the same URL', async () => {
      const results = [
        createBaseResult({
          url: 'https://example.com/same-page',
          name: 'First Scan',
          passes: [createPass({ id: 'html-has-lang' })],
          summary: { violations: 0, passes: 1, incomplete: 0, inapplicable: 0 },
        }),
        createBaseResult({
          url: 'https://example.com/same-page',
          name: 'Second Scan',
          violations: [createViolation({ id: 'image-alt' })],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const html = await generator.generateConsolidatedHTMLReport(results);

      // Only the first result for the duplicate URL should be used
      expect(html).toContain('Nombre de pages:</strong> 1');
    });

    it('should write consolidated report to disk', async () => {
      const results = [createBaseResult()];

      await generator.generateConsolidatedHTMLReport(results);

      // ensureDir + writeFile should both have been called
      expect(fs.ensureDir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      const writeCall = (fs.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0];
      expect(writeCall[0]).toContain('accessibility-report-');
      expect(writeCall[0]).toContain('.html');
      expect(writeCall[2]).toBe('utf-8');
    });

    it('should include scroll buttons in consolidated report', async () => {
      const results = [createBaseResult()];

      const html = await generator.generateConsolidatedHTMLReport(results);

      expect(html).toContain('scrollToTop');
      expect(html).toContain('scrollToBottom');
      expect(html).toContain('scroll-btn');
    });

    it('should include global summary table', async () => {
      const results = [
        createBaseResult({
          url: 'https://example.com/a',
          name: 'Page A',
          passes: [createPass({ id: 'html-has-lang' })],
          summary: { violations: 0, passes: 1, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const html = await generator.generateConsolidatedHTMLReport(results);

      expect(html).toContain('Tableau R\u00e9capitulatif Global');
    });

    it('should handle empty results array', async () => {
      const html = await generator.generateConsolidatedHTMLReport([]);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Nombre de pages:</strong> 0');
      expect(html).toContain('100%'); // 0 conformes + 0 nonConformes => 100
    });

    it('should use green color for high global score', async () => {
      const results = [
        createBaseResult({
          url: 'https://example.com',
          passes: [
            createPass({ id: 'html-has-lang' }),
            createPass({ id: 'document-title' }),
            createPass({ id: 'link-name' }),
            createPass({ id: 'button-name' }),
          ],
          summary: { violations: 0, passes: 4, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const html = await generator.generateConsolidatedHTMLReport(results);

      // Score >= 75 should use green color #27ae60
      expect(html).toContain('#27ae60');
    });
  });

  // -----------------------------------------------------------------------
  // Accessibility (RGAA / WCAG) of the generated reports themselves
  // -----------------------------------------------------------------------
  describe('report accessibility (RGAA / WCAG)', () => {
    it('consolidated report exposes skip link and landmarks', async () => {
      const results = [
        createBaseResult({ url: 'https://example.com/a', name: 'Page A' }),
        createBaseResult({ url: 'https://example.com/b', name: 'Page B' }),
      ];

      const html = await generator.generateConsolidatedHTMLReport(results);

      expect(html).toContain('class="skip-link"');
      expect(html).toContain('href="#main"');
      expect(html).toContain('<main id="main">');
      expect(html).toContain('<header class="header"');
    });

    it('consolidated summary table has caption, scope and description', async () => {
      const html = await generator.generateConsolidatedHTMLReport([
        createBaseResult({ name: 'Page A' }),
      ]);

      expect(html).toContain('<caption>');
      expect(html).toContain('scope="col"');
      expect(html).toContain('scope="colgroup"');
      expect(html).toContain('aria-describedby="recap-desc"');
      expect(html).toContain('id="recap-desc"');
    });

    it('consolidated report uses the AA-contrast palette', async () => {
      const html = await generator.generateConsolidatedHTMLReport([
        createBaseResult({ name: 'Page A' }),
      ]);

      // AA-compliant replacements are present for stat headers / cards
      expect(html).toContain('#1b7a43');
      expect(html).toContain('#c0392b');
      expect(html).toContain('#5d6d7e');
    });

    it('consolidated report defines a visible focus indicator', async () => {
      const html = await generator.generateConsolidatedHTMLReport([
        createBaseResult(),
      ]);

      expect(html).toContain(':focus-visible');
      expect(html).toContain('outline: 3px solid #005fcc');
    });

    it('global score is not conveyed by colour alone', async () => {
      const html = await generator.generateConsolidatedHTMLReport([
        createBaseResult(),
      ]);

      expect(html).toContain('class="global-score');
      // level is spelled out as text next to the score, not colour alone
      expect(html).toContain('% — ');
    });

    it('external links carry rel and a new-window hint', async () => {
      const html = await generator.generateConsolidatedHTMLReport([
        createBaseResult({ url: 'https://example.com/a', name: 'Page A' }),
      ]);

      expect(html).toContain('rel="noopener noreferrer"');
      expect(html).toContain('(nouvelle fenêtre)');
    });

    it('single-page report also exposes landmarks and a table caption', async () => {
      await generator.generateReports(createBaseResult({ name: 'Solo' }), [
        'html',
      ]);

      const writeCall = (
        fs.writeFile as ReturnType<typeof vi.fn>
      ).mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].endsWith('.html'),
      );
      const html = writeCall?.[1] as string;

      expect(html).toContain('class="skip-link"');
      expect(html).toContain('<main id="main">');
      expect(html).toContain('<caption>');
      expect(html).toContain('scope="col"');
    });
  });

  // -----------------------------------------------------------------------
  // generateConsolidatedCSVReport
  // -----------------------------------------------------------------------
  describe('generateConsolidatedCSVReport', () => {
    it('should generate CSV header with correct columns', () => {
      const results: IAxeResult[] = [];

      const csv = generator.generateConsolidatedCSVReport(results);

      const lines = csv.split('\n');
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain('"URL"');
      expect(lines[0]).toContain('"Titre"');
      expect(lines[0]).toContain('"Violation ID"');
      expect(lines[0]).toContain('"Impact"');
      expect(lines[0]).toContain('"Description"');
      expect(lines[0]).toContain('"S\u00e9lecteur"');
      expect(lines[0]).toContain('"HTML"');
      expect(lines[0]).toContain('"Help URL"');
      expect(lines[0]).toContain('"Tags"');
    });

    it('should include violation data from multiple results', () => {
      const results = [
        createBaseResult({
          url: 'https://example.com/page1',
          testInfo: {
            userAgent: 'Chrome',
            viewport: { width: 1920, height: 1080 },
            title: 'Page 1',
          },
          violations: [
            createViolation({
              id: 'image-alt',
              impact: 'critical',
              description: 'Missing alt',
              helpUrl: 'https://example.com/help/1',
              tags: ['wcag2a'],
              nodes: [{ html: '<img src="a.png">', target: ['img.a'] }],
            }),
          ],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
        createBaseResult({
          url: 'https://example.com/page2',
          testInfo: {
            userAgent: 'Chrome',
            viewport: { width: 1920, height: 1080 },
            title: 'Page 2',
          },
          violations: [
            createViolation({
              id: 'color-contrast',
              impact: 'serious',
              description: 'Insufficient contrast',
              helpUrl: 'https://example.com/help/2',
              tags: ['wcag2aa'],
              nodes: [{ html: '<p>text</p>', target: ['p.text'] }],
            }),
          ],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const csv = generator.generateConsolidatedCSVReport(results);

      const lines = csv.split('\n');
      // Header + 2 data rows
      expect(lines.length).toBe(3);
      expect(lines[1]).toContain('"https://example.com/page1"');
      expect(lines[1]).toContain('"Page 1"');
      expect(lines[1]).toContain('"image-alt"');
      expect(lines[2]).toContain('"https://example.com/page2"');
      expect(lines[2]).toContain('"Page 2"');
      expect(lines[2]).toContain('"color-contrast"');
    });

    it('should handle violations with multiple nodes', () => {
      const results = [
        createBaseResult({
          violations: [
            createViolation({
              nodes: [
                { html: '<img src="a.png">', target: ['img.a'] },
                { html: '<img src="b.png">', target: ['img.b'] },
                { html: '<img src="c.png">', target: ['img.c'] },
              ],
            }),
          ],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const csv = generator.generateConsolidatedCSVReport(results);

      const lines = csv.split('\n');
      // Header + 3 data rows (one per node)
      expect(lines.length).toBe(4);
    });

    it('should handle results with no violations', () => {
      const results = [
        createBaseResult({
          url: 'https://example.com/clean',
          violations: [],
        }),
      ];

      const csv = generator.generateConsolidatedCSVReport(results);

      const lines = csv.split('\n');
      // Only header row
      expect(lines.length).toBe(1);
    });

    it('should escape double quotes in CSV cells', () => {
      const results = [
        createBaseResult({
          violations: [
            createViolation({
              description: 'Image "alt" attribute missing',
              nodes: [
                {
                  html: '<img alt="test value">',
                  target: ['img'],
                },
              ],
            }),
          ],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const csv = generator.generateConsolidatedCSVReport(results);

      expect(csv).toContain('""alt""');
      expect(csv).toContain('""test value""');
    });

    it('should handle null impact values by replacing with empty string', () => {
      const results = [
        createBaseResult({
          violations: [
            {
              id: 'test-rule',
              impact: null as unknown as 'minor',
              description: 'Test',
              help: 'Test help',
              helpUrl: 'https://example.com',
              tags: [],
              nodes: [{ html: '<div>', target: ['div'] }],
            },
          ],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const csv = generator.generateConsolidatedCSVReport(results);

      // The null impact should be replaced by empty string via (cell ?? '')
      const lines = csv.split('\n');
      expect(lines.length).toBe(2);
      // Should not throw and should contain empty quoted cell for impact
      expect(lines[1]).toContain('""');
    });

    it('should join array target selectors with comma', () => {
      const results = [
        createBaseResult({
          violations: [
            createViolation({
              nodes: [
                {
                  html: '<div>test</div>',
                  target: ['div.first', 'div.second', 'div.third'],
                },
              ],
            }),
          ],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const csv = generator.generateConsolidatedCSVReport(results);

      expect(csv).toContain('div.first, div.second, div.third');
    });

    it('should handle string target (non-array)', () => {
      const results = [
        createBaseResult({
          violations: [
            createViolation({
              nodes: [
                {
                  html: '<div>test</div>',
                  target: 'div.single-selector',
                },
              ],
            }),
          ],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const csv = generator.generateConsolidatedCSVReport(results);

      expect(csv).toContain('div.single-selector');
    });

    it('should join tags with comma', () => {
      const results = [
        createBaseResult({
          violations: [
            createViolation({
              tags: ['wcag2a', 'wcag111', 'section508'],
              nodes: [{ html: '<img>', target: ['img'] }],
            }),
          ],
          summary: { violations: 1, passes: 0, incomplete: 0, inapplicable: 0 },
        }),
      ];

      const csv = generator.generateConsolidatedCSVReport(results);

      expect(csv).toContain('wcag2a, wcag111, section508');
    });
  });

  // -----------------------------------------------------------------------
  // printSummary
  // -----------------------------------------------------------------------
  describe('printSummary', () => {
    it('should print summary without throwing', () => {
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt', impact: 'critical' }),
          createViolation({ id: 'color-contrast', impact: 'serious' }),
        ],
        passes: [createPass({ id: 'html-has-lang' })],
        summary: { violations: 2, passes: 1, incomplete: 0, inapplicable: 0 },
      });

      expect(() => generator.printSummary(result)).not.toThrow();
    });

    it('should not throw when no violations', () => {
      const result = createBaseResult({
        violations: [],
        summary: { violations: 0, passes: 5, incomplete: 0, inapplicable: 0 },
      });

      expect(() => generator.printSummary(result)).not.toThrow();
    });

    it('should not throw with multiple violation impacts', () => {
      const result = createBaseResult({
        violations: [
          createViolation({ id: 'image-alt', impact: 'critical' }),
          createViolation({ id: 'svg-img-alt', impact: 'critical' }),
          createViolation({ id: 'color-contrast', impact: 'serious' }),
        ],
        summary: { violations: 3, passes: 0, incomplete: 0, inapplicable: 0 },
      });

      expect(() => generator.printSummary(result)).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle result with empty URL', async () => {
      const result = createBaseResult({ url: '' });

      const report = await generator.generateReports(result, ['html']);

      expect(report.htmlPath).toBeDefined();
    });

    it('should handle result with special characters in URL', async () => {
      const result = createBaseResult({
        url: 'https://example.com/page?q=test&lang=fr#section',
      });

      const report = await generator.generateReports(result, ['csv']);

      const csvContent = (fs.writeFile as ReturnType<typeof vi.fn>).mock
        .calls[0][1] as string;
      // URL with special chars should be quoted properly in CSV
      expect(csvContent).toBeDefined();
    });

    it('should handle generateReports with empty formats array', async () => {
      const result = createBaseResult();

      const report = await generator.generateReports(result, []);

      // No formats requested => no files generated
      expect(report.htmlPath).toBeUndefined();
      expect(report.jsonPath).toBeUndefined();
      expect(report.csvPath).toBeUndefined();
      // Still has summary
      expect(report.summary).toBeDefined();
    });

    it('should handle consolidated CSV with many results efficiently', () => {
      // Generate 50 results with varying violations
      const results: IAxeResult[] = Array.from({ length: 50 }, (_, i) =>
        createBaseResult({
          url: `https://example.com/page${String(i)}`,
          testInfo: {
            userAgent: 'Chrome',
            viewport: { width: 1920, height: 1080 },
            title: `Page ${String(i)}`,
          },
          violations:
            i % 3 === 0
              ? [
                  createViolation({
                    id: 'image-alt',
                    nodes: [
                      {
                        html: `<img src="img${String(i)}.png">`,
                        target: ['img'],
                      },
                    ],
                  }),
                ]
              : [],
          summary: {
            violations: i % 3 === 0 ? 1 : 0,
            passes: 0,
            incomplete: 0,
            inapplicable: 0,
          },
        }),
      );

      const csv = generator.generateConsolidatedCSVReport(results);

      const lines = csv.split('\n');
      // Header + 17 data rows (pages 0, 3, 6, ..., 48 => 17 pages with violations)
      expect(lines.length).toBe(18); // 1 header + 17 data rows
    });

    it('should handle consolidated HTML with AI enriched results', async () => {
      const results = [
        createBaseResult({
          url: 'https://example.com/ai-test',
          name: 'AI Test Page',
          passes: [createPass({ id: 'html-has-lang' })],
          summary: { violations: 0, passes: 1, incomplete: 0, inapplicable: 0 },
          aiEnrichedResult: createAIEnrichedResult({
            ruleAnalyses: [
              {
                ruleId: 'form-labels',
                compliant: true,
                severity: 'minor',
                summary: 'All forms are labeled',
                findings: [],
              },
            ],
            totalRulesAnalyzed: 1,
          }),
        }),
      ];

      const html = await generator.generateConsolidatedHTMLReport(
        results,
        'AI Project',
      );

      expect(html).toContain('AI Project');
      expect(html).toContain('AI Test Page');
      expect(html).toContain('<!DOCTYPE html>');
    });
  });

  // -----------------------------------------------------------------------
  // renderCommonProblemsSection / renderCommonProblemBlock (via the
  // consolidated HTML report). Covers the AI "common problems" section.
  // -----------------------------------------------------------------------
  describe('common problems section', () => {
    it('omits the section when commonProblems is null', async () => {
      const html = await generator.generateConsolidatedHTMLReport(
        [createBaseResult()],
        'No Common',
        { commonProblems: null },
      );

      expect(html).not.toContain('id="problemes-communs"');
      expect(html).not.toContain('Problèmes communs');
    });

    it('omits the section when problems array is empty', async () => {
      const html = await generator.generateConsolidatedHTMLReport(
        [createBaseResult()],
        'Empty Common',
        {
          commonProblems: {
            problems: [],
            generatedAt: '2025-06-15T10:30:00.000Z',
            basedOnPages: 3,
          },
        },
      );

      expect(html).not.toContain('id="problemes-communs"');
    });

    it('renders a single common problem with all metadata', async () => {
      const html = await generator.generateConsolidatedHTMLReport(
        [
          createBaseResult({ url: 'https://example.com/a' }),
          createBaseResult({ url: 'https://example.com/b' }),
        ],
        'Common Single',
        {
          commonProblems: {
            problems: [
              {
                title: 'Contraste insuffisant',
                severity: 'serious',
                rgaaCriteria: ['3.2', '3.3'],
                wcagReferences: ['1.4.3'],
                description: 'Le contraste est trop faible.',
                recommendation: 'Augmenter le ratio de contraste.',
                codeExample: '<p style="color:#ccc">texte</p>',
              },
            ],
            generatedAt: '2025-06-15T10:30:00.000Z',
            basedOnPages: 2,
          },
        },
      );

      expect(html).toContain('id="problemes-communs"');
      // Singular wording for a single problem
      expect(html).toContain('1 problème');
      expect(html).not.toContain('1 problèmes');
      // basedOnPages is interpolated
      expect(html).toContain('2 pages');
      // Problem content
      expect(html).toContain('Contraste insuffisant');
      expect(html).toContain('serious');
      expect(html).toContain('Le contraste est trop faible.');
      expect(html).toContain('Augmenter le ratio de contraste.');
      // RGAA + WCAG lists (block-specific labels)
      expect(html).toContain('<strong>Critères RGAA :</strong>');
      expect(html).toContain('3.2');
      expect(html).toContain('<strong>Référence WCAG :</strong>');
      expect(html).toContain('1.4.3');
      // Code example is HTML-escaped (no raw < kept for the snippet)
      expect(html).toContain('&lt;p style=&quot;color:#ccc&quot;&gt;');
    });

    it('uses plural wording and severity classes for several problems', async () => {
      const html = await generator.generateConsolidatedHTMLReport(
        [createBaseResult()],
        'Common Multi',
        {
          commonProblems: {
            problems: [
              {
                title: 'Critique',
                severity: 'critical',
                rgaaCriteria: [],
                wcagReferences: [],
                description: 'desc',
                recommendation: 'reco',
              },
              {
                title: 'Modéré',
                severity: 'moderate',
                rgaaCriteria: [],
                wcagReferences: [],
                description: 'desc',
                recommendation: 'reco',
              },
              {
                title: 'Mineur',
                severity: 'minor',
                rgaaCriteria: [],
                wcagReferences: [],
                description: 'desc',
                recommendation: 'reco',
              },
            ],
            generatedAt: '2025-06-15T10:30:00.000Z',
            basedOnPages: 5,
          },
        },
      );

      // Plural wording for >1 problem
      expect(html).toContain('3 problèmes');
      // Severity-specific CSS classes for each branch
      expect(html).toContain('violation-critical');
      expect(html).toContain('impact-critical');
      expect(html).toContain('violation-moderate');
      expect(html).toContain('impact-moderate');
      expect(html).toContain('violation-minor');
      expect(html).toContain('impact-minor');
      // Numbered positions
      expect(html).toContain('1. Critique');
      expect(html).toContain('2. Modéré');
      expect(html).toContain('3. Mineur');
      // With empty rgaaCriteria/wcagReferences arrays, the common-problem block
      // emits no "Critères RGAA :"/"Référence WCAG :" line for these problems
      // (the empty-array ternary branch). Verified by absence of the bold
      // labels immediately following each problem title.
      expect(html).not.toContain('<strong>Critères RGAA :</strong>');
      expect(html).not.toContain('<strong>Référence WCAG :</strong>');
    });

    it('omits the code block when codeExample is absent', async () => {
      const html = await generator.generateConsolidatedHTMLReport(
        [createBaseResult()],
        'No Code',
        {
          commonProblems: {
            problems: [
              {
                title: 'Sans code',
                severity: 'serious',
                rgaaCriteria: ['1.1'],
                wcagReferences: ['1.1.1'],
                description: 'desc & <b>',
                recommendation: 'reco',
              },
            ],
            generatedAt: '2025-06-15T10:30:00.000Z',
            basedOnPages: 2,
          },
        },
      );

      expect(html).toContain('Sans code');
      // The description ampersand/markup is escaped
      expect(html).toContain('desc &amp; &lt;b&gt;');
      expect(html).toContain('violation-serious');
      expect(html).toContain('impact-serious');
    });
  });
});
