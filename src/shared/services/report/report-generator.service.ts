import fs from 'fs-extra';
import path from 'path';

import { createLogger } from '@shared/utils/logger.js';
import { slugifyReportName } from '@shared/utils/report-name.util.js';
import type {
  IAxeResult,
  IReportResult,
  ICommonProblemsAnalysis,
  ICommonProblem,
} from '@shared/types/audit.types.js';
import { ReportFormatterService } from './report-formatter.service.js';
import { getAccessibilityLevel } from './accessibility-score.util.js';
import { escapeHtml, levelClass } from './html.util.js';

const logger = createLogger('report-generator');

/**
 * Accessibility report generation service.
 */
export class ReportGeneratorService {
  private reportsDir: string;
  private formatter: ReportFormatterService;

  constructor(reportsDir?: string) {
    this.reportsDir = reportsDir ?? path.join(process.cwd(), 'reports');
    this.formatter = new ReportFormatterService();
  }

  /**
   * Ensures the reports directory exists.
   */
  async ensureReportsDirectory(): Promise<void> {
    await fs.ensureDir(this.reportsDir);
  }

  /**
   * Generates all reports (HTML, JSON, CSV).
   * @param result - Axe analysis result
   * @param formats - Desired formats
   */
  async generateReports(
    result: IAxeResult,
    formats: ('html' | 'json' | 'csv')[] = ['html', 'json'],
  ): Promise<IReportResult> {
    await this.ensureReportsDirectory();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportResult: IReportResult = {
      summary: result.summary,
      aiSummary: result.aiEnrichedResult?.summary,
    };

    logger.info({ formats }, 'Generating reports');

    if (formats.includes('html')) {
      reportResult.htmlPath = await this.generateHTMLReport(
        result,
        `accessibility-report-${timestamp}.html`,
      );
    }

    if (formats.includes('json')) {
      reportResult.jsonPath = await this.generateJSONReport(
        result,
        `accessibility-report-${timestamp}.json`,
      );
    }

    if (formats.includes('csv')) {
      reportResult.csvPath = await this.generateCSVReport(
        result,
        `accessibility-violations-${timestamp}.csv`,
      );
    }

    logger.info(reportResult, 'Reports generated successfully');

    return reportResult;
  }

  /**
   * Generates a detailed HTML report.
   */
  private async generateHTMLReport(
    result: IAxeResult,
    filename: string,
  ): Promise<string> {
    const reportPath = path.join(this.reportsDir, filename);
    const html = this.formatter.formatAsHTML(result);

    await fs.writeFile(reportPath, html, 'utf8');

    logger.info({ reportPath }, 'HTML report generated');
    return reportPath;
  }

  /**
   * Generates a JSON report.
   */
  private async generateJSONReport(
    result: IAxeResult,
    filename: string,
  ): Promise<string> {
    const reportPath = path.join(this.reportsDir, filename);

    await fs.writeJson(reportPath, result, { spaces: 2 });

    logger.info({ reportPath }, 'JSON report generated');
    return reportPath;
  }

  /**
   * Generates a CSV report.
   */
  private async generateCSVReport(
    result: IAxeResult,
    filename: string,
  ): Promise<string> {
    const reportPath = path.join(this.reportsDir, filename);
    const csv = this.formatter.formatAsCSV(result);

    await fs.writeFile(reportPath, csv, 'utf8');

    logger.info({ reportPath }, 'CSV report generated');
    return reportPath;
  }

  /**
   * Prints a summary to the console.
   */
  printSummary(result: IAxeResult): void {
    const byImpact: Record<string, number> = {};
    if (result.violations.length > 0) {
      result.violations.forEach((v) => {
        byImpact[v.impact] = (byImpact[v.impact] ?? 0) + 1;
      });
    }

    logger.info(
      {
        url: result.url,
        title: result.testInfo.title,
        date: new Date(result.timestamp).toLocaleString('fr-FR'),
        violations: result.summary.violations,
        passes: result.summary.passes,
        incomplete: result.summary.incomplete,
        ...(result.violations.length > 0
          ? { violationsByImpact: byImpact }
          : {}),
      },
      'Accessibility test summary',
    );
  }

  /**
   * Generates a consolidated HTML report for several URLs.
   *
   * @param options.dedupeByUrl If true (default), only one result is kept
   *   per distinct URL — suited to /api/v1/audit in multi-URL mode.
   *   If false, all results are kept in order — suited to
   *   /api/v1/journey where several scans may share the same URL
   *   (successive states of an SPA, AJAX search, etc.).
   */
  async generateConsolidatedHTMLReport(
    results: IAxeResult[],
    projectName?: string,
    options?: {
      dedupeByUrl?: boolean;
      commonProblems?: ICommonProblemsAnalysis | null;
    },
  ): Promise<string> {
    const dedupeByUrl = options?.dedupeByUrl ?? true;
    const commonProblems = options?.commonProblems ?? null;

    // Compute global totals
    let totalCompliant = 0;
    let totalNonCompliant = 0;

    // Either deduplicate by URL (multi-URL audit mode), or keep all results
    // in order (journey mode: several scans may share the same URL with a
    // different DOM).
    const uniqueResults = dedupeByUrl
      ? Array.from(new Set(results.map((result) => result.url)))
          .map((url) => results.find((result) => result.url === url))
          .filter((result): result is IAxeResult => result !== undefined)
      : results;

    const pagesHtml = uniqueResults
      .map((result) => {
        // Compute statistics for each page
        const stats = this.formatter.calculateAccessibilityScore(result);
        totalCompliant += stats.compliant;
        totalNonCompliant += stats.nonCompliant;

        // Generate the HTML section for this page
        return this.formatter.formatAsHTMLSection(result);
      })
      .join('\n');

    // Compute the global RGAA score
    const total = totalCompliant + totalNonCompliant;
    const globalScore =
      total === 0 ? 100 : Math.round((totalCompliant / total) * 100);

    const globalSummaryTable =
      this.formatter.generateGlobalSummaryTable(uniqueResults);

    const commonProblemsHtml = this.renderCommonProblemsSection(commonProblems);

    const globalLevel = getAccessibilityLevel(globalScore);

    const htmlContent = `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rapport d'Accessibilité Consolidé${projectName != null && projectName !== '' ? ` - ${projectName}` : ''}</title>
    ${this.formatter.getHTMLStyles()}
    <style>
        /* Styles for the scroll buttons */
        .scroll-buttons {
            position: fixed;
            bottom: 30px;
            right: 30px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 1000;
        }
        .scroll-btn {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: #4338ca;
            color: white;
            border: none;
            cursor: pointer;
            font-size: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
            transition: all 0.3s;
            opacity: 0;
            visibility: hidden;
        }
        .scroll-btn.visible {
            opacity: 1;
            visibility: visible;
        }
        .scroll-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 16px rgba(79, 70, 229, 0.6);
        }
        .scroll-btn:active {
            transform: scale(0.95);
        }
        .scroll-btn:focus-visible {
            outline: 3px solid #005fcc;
            outline-offset: 2px;
        }
        /* Global RGAA score in the header: colour kept via a level-coloured
           badge with dark text (>= 4.56:1) instead of coloured text on blue. */
        .global-score {
            display: inline-block;
            font-size: 1.25em;
            font-weight: bold;
            background: var(--level-color, #0066cc);
            color: #1a1a1a;
            padding: 4px 14px;
            border-radius: 14px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
        }
        /* "Common problems" section (accessible red variant) */
        .page-summary-danger {
            background: #b02a1e;
        }
        .page-summary-danger:hover {
            background: #96281b;
        }
        .page-score-danger {
            --level-color: #c0392b;
            color: #ffffff;
        }
        .common-intro {
            margin-bottom: 20px;
            font-size: 1.05em;
            color: #555;
        }
    </style>
    <script>
        document.addEventListener('DOMContentLoaded', function() {
            // Handle clicks on anchor links
            document.querySelectorAll('a[href^="#page-"]').forEach(function(link) {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    const targetId = this.getAttribute('href').substring(1);
                    const targetElement = document.getElementById(targetId);

                    if (targetElement && targetElement.tagName === 'DETAILS') {
                        // Open the details by forcing the attribute
                        targetElement.setAttribute('open', '');

                        // Scroll to the element with a slight delay to let the animation play
                        setTimeout(function() {
                            targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 100);
                    }
                });
            });

            // Scroll buttons handling
            const scrollToTopBtn = document.getElementById('scrollToTop');
            const scrollToBottomBtn = document.getElementById('scrollToBottom');

            // Show/hide the buttons based on the scroll position
            window.addEventListener('scroll', function() {
                const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                const scrollHeight = document.documentElement.scrollHeight;
                const clientHeight = document.documentElement.clientHeight;

                // Show the "up" button once scrolled more than 300px
                if (scrollTop > 300) {
                    scrollToTopBtn.classList.add('visible');
                } else {
                    scrollToTopBtn.classList.remove('visible');
                }

                // Show the "down" button when not at the bottom of the page
                if (scrollTop + clientHeight < scrollHeight - 100) {
                    scrollToBottomBtn.classList.add('visible');
                } else {
                    scrollToBottomBtn.classList.remove('visible');
                }
            });

            // Scroll to the top
            scrollToTopBtn.addEventListener('click', function() {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            // Scroll to the bottom
            scrollToBottomBtn.addEventListener('click', function() {
                window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
            });

            // Check the initial position
            window.dispatchEvent(new Event('scroll'));
        });
    </script>
</head>
<body>
    <a href="#main" class="skip-link">Aller au contenu principal</a>
    <div class="container">
        <header class="header">
            <h1><span aria-hidden="true">🛡️</span> Rapport d'Accessibilité Consolidé</h1>
            ${projectName != null && projectName !== '' ? `<h2>${escapeHtml(projectName)}</h2>` : ''}
            <p><strong>Généré le:</strong> ${new Date().toLocaleString('fr-FR')}</p>
            <p><strong>Nombre de pages:</strong> ${String(uniqueResults.length)}</p>
            <p><strong>Score RGAA Global:</strong> <span class="global-score ${levelClass(globalScore)}">${String(globalScore)}% — ${globalLevel.label}</span></p>
            <div class="ai-disclaimer" role="status">
                <div class="ai-disclaimer-icon" aria-hidden="true">🤖</div>
                <div class="ai-disclaimer-text">
                    Rapport indicatif généré partiellement (à confirmer) via un système d'intelligence artificielle sur la base des informations que vous avez fournies.
                </div>
            </div>
        </header>

        <main id="main">
            ${globalSummaryTable}

            ${commonProblemsHtml}

            ${pagesHtml}
        </main>
    </div>

    <!-- Fixed scroll buttons -->
    <div class="scroll-buttons">
        <button id="scrollToTop" class="scroll-btn" aria-label="Retour en haut de page">
            <span aria-hidden="true">▲</span>
        </button>
        <button id="scrollToBottom" class="scroll-btn" aria-label="Aller en bas de page">
            <span aria-hidden="true">▼</span>
        </button>
    </div>
</body>
</html>`;

    // Automatically save the report to the reports/ directory. The filename
    // base comes from the (sanitized) audit name; the timestamp keeps it
    // unique so two audits sharing a name never overwrite each other.
    await this.ensureReportsDirectory();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = slugifyReportName(projectName, 'accessibility-report');
    const filename = `${base}-${timestamp}.html`;
    const filepath = path.join(this.reportsDir, filename);

    await fs.writeFile(filepath, htmlContent, 'utf-8');
    logger.info({ filepath }, 'Consolidated HTML report saved');

    return htmlContent;
  }

  /** "Common problems" HTML section — empty string if analysis is missing/empty. */
  private renderCommonProblemsSection(
    analysis: ICommonProblemsAnalysis | null,
  ): string {
    if (!analysis || analysis.problems.length === 0) {
      return '';
    }

    const problemsHtml = analysis.problems
      .map((p, idx) => this.renderCommonProblemBlock(p, idx + 1))
      .join('\n');

    const count = analysis.problems.length;

    return `
        <details class="page-section" id="problemes-communs" open>
          <summary class="page-summary page-summary-danger">
            <span class="page-summary-title"><span aria-hidden="true">⚠️</span> Problèmes communs à toutes les pages</span>
            <span class="page-summary-stats">
              <span class="page-score page-score-danger">
                ${String(count)} ${count > 1 ? 'problèmes' : 'problème'}
              </span>
            </span>
          </summary>
          <div class="page-content">
            <p class="common-intro">
              Synthèse générée par IA des problèmes d'accessibilité <strong>récurrents sur l'ensemble des ${String(analysis.basedOnPages)} pages</strong> auditées. Leur correction aura un impact global sur l'accessibilité du site.
            </p>
${problemsHtml}
          </div>
        </details>
`;
  }

  /** HTML block for a common problem (escaped AI content). */
  private renderCommonProblemBlock(
    p: ICommonProblem,
    position: number,
  ): string {
    const escape = (s: string): string =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const severityClass =
      p.severity === 'critical'
        ? 'violation-critical'
        : p.severity === 'serious'
          ? 'violation-serious'
          : p.severity === 'moderate'
            ? 'violation-moderate'
            : 'violation-minor';

    const impactClass =
      p.severity === 'critical'
        ? 'impact-critical'
        : p.severity === 'serious'
          ? 'impact-serious'
          : p.severity === 'moderate'
            ? 'impact-moderate'
            : 'impact-minor';

    const rgaaList = p.rgaaCriteria
      .map((c) => `<strong>${escape(c)}</strong>`)
      .join(', ');
    const wcagList = p.wcagReferences.map((w) => escape(w)).join(', ');

    const codeBlock =
      p.codeExample != null && p.codeExample !== ''
        ? `\n                <div class="node">${escape(p.codeExample)}</div>`
        : '';

    return `
            <div class="violation ${severityClass}">
                <div class="violation-header">
                    <span class="impact ${impactClass}">${escape(p.severity)}</span>
                    ${String(position)}. ${escape(p.title)}
                </div>${rgaaList ? `\n                <p><strong>Critères RGAA :</strong> ${rgaaList}</p>` : ''}${wcagList ? `\n                <p><strong>Référence WCAG :</strong> ${wcagList}</p>` : ''}
                <p><strong>Description :</strong> ${escape(p.description)}</p>
                <p><strong>Recommandation :</strong> ${escape(p.recommendation)}</p>${codeBlock}
            </div>`;
  }

  /**
   * Generates a consolidated CSV report for several URLs.
   */
  generateConsolidatedCSVReport(results: IAxeResult[]): string {
    const csvRows: (string | null)[][] = [
      [
        'URL',
        'Titre',
        'Violation ID',
        'Impact',
        'Description',
        'Sélecteur',
        'HTML',
        'Help URL',
        'Tags',
      ],
    ];

    results.forEach((result) => {
      result.violations.forEach((violation) => {
        violation.nodes.forEach((node) => {
          const targetStr = Array.isArray(node.target)
            ? node.target.join(', ')
            : node.target;

          csvRows.push([
            result.url,
            result.testInfo.title,
            violation.id,
            violation.impact,
            violation.description,
            targetStr,
            node.html,
            violation.helpUrl,
            violation.tags.join(', '),
          ]);
        });
      });
    });

    return csvRows
      .map((row) =>
        row.map((cell) => `"${(cell ?? '').replace(/"/g, '""')}"`).join(','),
      )
      .join('\n');
  }
}
