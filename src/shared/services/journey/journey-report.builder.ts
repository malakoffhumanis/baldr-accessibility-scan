import { convertToConsolidatedReport } from '@shared/adapters/audit-api.adapter.js';
import type { AIAnalyzerService } from '@shared/services/ai/ai-analyzer.service.js';
import type { ReportGeneratorService } from '@shared/services/report/report-generator.service.js';
import type { ConsolidatedJourneyReport } from '@shared/types/journey-api.types.js';
import { slugifyReportName } from '@shared/utils/report-name.util.js';

import type {
  IJourneyExecutionResult,
  IJourneyReport,
} from './journey-orchestration.types.js';

export type ReportFormat = 'html' | 'json' | 'csv';

/**
 * Builds the final journey report in the requested format.
 *
 * - `json`: direct serialization of the `ConsolidatedJourneyReport`.
 * - `html`: consolidated HTML report enriched by the AI (common problems).
 * - `csv` : currently returns the HTML with a CSV Content-Type
 *           (parity with the historical audit behavior — not fixed here).
 */
export class JourneyReportBuilder {
  constructor(
    private readonly reportGenerator: ReportGeneratorService,
    private readonly aiAnalyzer: AIAnalyzerService,
  ) {}

  async build(
    execResult: IJourneyExecutionResult,
    format: ReportFormat,
    auditName?: string,
  ): Promise<IJourneyReport> {
    // Download name (Content-Disposition) derived from the sanitized audit
    // name, with a safe default when the request omits `name`.
    const base = slugifyReportName(auditName, 'rapport-journey');

    if (format === 'json') {
      return this.buildJson(execResult, auditName, `${base}.json`);
    }

    const commonProblems = await this.aiAnalyzer.analyzeCommonProblems(
      execResult.results,
    );
    const html = await this.reportGenerator.generateConsolidatedHTMLReport(
      execResult.results,
      auditName,
      { dedupeByUrl: false, commonProblems },
    );

    if (format === 'html') {
      return {
        content: html,
        contentType: 'text/html; charset=utf-8',
        filename: `${base}.html`,
      };
    }

    return {
      content: html,
      contentType: 'text/csv; charset=utf-8',
      filename: `${base}.csv`,
    };
  }

  private buildJson(
    execResult: IJourneyExecutionResult,
    auditName: string | undefined,
    filename: string,
  ): IJourneyReport {
    const baseReport = convertToConsolidatedReport(
      execResult.results,
      auditName,
      execResult.durationMs,
    );
    const report: ConsolidatedJourneyReport = {
      ...baseReport,
      journeyUrls: execResult.journeyUrls,
      definedBlocksCount: execResult.definedBlocksCount,
      executedBlocksCount: execResult.executedBlocksCount,
      definedActionsCount: execResult.definedActionsCount,
      executedActionsCount: execResult.executedActionsCount,
      actionErrors: execResult.actionErrors,
      journeyStopped: execResult.journeyStopped,
    };
    return {
      content: JSON.stringify(report, null, 2),
      contentType: 'application/json; charset=utf-8',
      filename,
    };
  }
}
