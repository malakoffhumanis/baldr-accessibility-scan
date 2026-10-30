import { convertToConsolidatedReport } from '@shared/adapters/audit-api.adapter.js';
import type { AIAnalyzerService } from '@shared/services/ai/ai-analyzer.service.js';
import type { ReportGeneratorService } from '@shared/services/report/report-generator.service.js';
import type { ConsolidatedJourneyReport } from '@shared/types/journey-api.types.js';
import type {
  ReportFormat,
  ReportFormats,
} from '@shared/types/audit-api.types.js';
import { slugifyReportName } from '@shared/utils/report-name.util.js';

import type {
  IJourneyExecutionResult,
  IJourneyReport,
  JourneyReports,
} from './journey-orchestration.types.js';

export type { ReportFormat };

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

  /** One report per requested format, all from the same execution result. */
  async buildAll(
    execResult: IJourneyExecutionResult,
    formats: ReportFormats,
    auditName?: string,
  ): Promise<JourneyReports> {
    const [firstFormat, ...others] = formats;
    // Sequential: the HTML build calls the AI, no point racing it with the rest.
    const reports: JourneyReports = [
      await this.build(execResult, firstFormat, auditName),
    ];
    for (const format of others) {
      reports.push(await this.build(execResult, format, auditName));
    }
    return reports;
  }

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
