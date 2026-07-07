import type { IAxeResult } from '@shared/types/audit.types.js';

import {
  calculateAccessibilityScore,
  type AccessibilityScore,
} from './accessibility-score.util.js';
import { formatAsCSV } from './csv-report.formatter.js';
import {
  formatAsHTML,
  formatAsHTMLSection,
  generateGlobalSummaryTable,
  getHTMLStyles,
} from './html-report.formatter.js';

/**
 * Facade for report formatting operations.
 *
 * Preserves the legacy API expected by `ReportGeneratorService` and the
 * existing test suite. The actual logic is split across specialized
 * modules:
 *   - `accessibility-score.util`     : RGAA score computation
 *   - `rgaa-thematics-mapper.util`   : rule → thematic mapping
 *   - `html-report.formatter`        : all HTML formatting
 *   - `csv-report.formatter`         : CSV formatting
 *   - `html.util`                    : helpers (escapeHtml, generatePageId)
 */
export class ReportFormatterService {
  calculateAccessibilityScore(result: IAxeResult): AccessibilityScore {
    return calculateAccessibilityScore(result);
  }

  generateGlobalSummaryTable(results: IAxeResult[]): string {
    return generateGlobalSummaryTable(results);
  }

  formatAsHTML(result: IAxeResult): string {
    return formatAsHTML(result);
  }

  formatAsHTMLSection(result: IAxeResult): string {
    return formatAsHTMLSection(result);
  }

  formatAsCSV(result: IAxeResult): string {
    return formatAsCSV(result);
  }

  getHTMLStyles(): string {
    return getHTMLStyles();
  }
}
