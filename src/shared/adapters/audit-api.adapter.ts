/**
 * Adapter to convert between internal types and OpenAPI v3-compliant API types.
 * Keeps the internal business logic while exposing a standardized API.
 */

import type {
  IAxeResult,
  IAxeViolation,
  IAxeNode,
  IAxePass,
  IAxeIncomplete,
  IAIEnrichedResult,
  IAIRuleAnalysis,
} from '@shared/types/audit.types.js';
import type { IAuthConfig } from '@shared/types/auth.types.js';
import type {
  PageAuditResult,
  AccessibilityViolation,
  DOMElement,
  AuthConfig,
  ConsolidatedAuditReport,
  AIEnrichedResult,
  AIRuleAnalysis,
  AIScoring,
  AuthType,
  AxeRuleOutcome,
  PageScoring,
  ReportScoring,
  ThematicScoring,
} from '@shared/types/audit-api.types.js';
import {
  calculateAccessibilityScore,
  getAccessibilityLevel,
} from '@shared/services/report/accessibility-score.util.js';
import {
  computeGlobalScoring,
  computeSummaryCounts,
  countViolationsByImpact,
  hasAnalysisError,
} from '@shared/services/report/report-scoring.util.js';
import {
  RGAA_THEMATICS,
  classifyAiAnalysis,
  mapRulesToThematics,
} from '@shared/services/report/rgaa-thematics-mapper.util.js';

/**
 * Normalizes an API-facing AuthConfig into its internal IAuthConfig. Single
 * source of truth for the mapping; reused by the journey adapter. Discriminates
 * on `type`: `manual` (interactive, no credentials) vs `auto` (credentials —
 * the default when `type` is omitted).
 */
export function normalizeAuthConfig(config: AuthConfig): IAuthConfig {
  if (config.type === 'manual') {
    return {
      type: 'manual',
      loginUrl: config.loginUrl,
      timeoutMs: config.timeoutMs,
      waitForManualConfirm: config.waitForManualConfirm,
    };
  }
  return {
    type: 'auto',
    username: config.username,
    password: config.password,
    loginUrl: config.loginUrl,
  };
}

/**
 * Converts an internal DOM element into an API element
 * @param node - Axe-Core node
 * @returns DOM element in the API format
 */
function convertDomElement(node: IAxeNode): DOMElement {
  return {
    html: node.html,
    selector: node.target,
    failureSummary: node.failureSummary,
  };
}

/**
 * Converts an internal violation into an API violation
 * @param violation - Axe-Core violation
 * @returns Violation in the API format
 */
function convertViolation(violation: IAxeViolation): AccessibilityViolation {
  return {
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    help: violation.help,
    helpUrl: violation.helpUrl,
    tags: violation.tags,
    nodes: violation.nodes.map(convertDomElement),
  };
}

/**
 * @param outcome - Axe-Core pass or incomplete entry
 * @returns Reduced rule outcome in the API format
 */
function convertRuleOutcome(
  outcome: IAxePass | IAxeIncomplete,
): AxeRuleOutcome {
  return {
    id: outcome.id,
    impact: outcome.impact,
    tags: outcome.tags,
    help: outcome.help,
    nodeCount: outcome.nodes.length,
  };
}

/**
 * @param analysis - Internal AI rule analysis
 * @returns Analysis in the API format
 */
function convertAIRuleAnalysis(analysis: IAIRuleAnalysis): AIRuleAnalysis {
  const { kind, violationCount } = classifyAiAnalysis(analysis);

  return {
    ruleId: analysis.ruleId,
    ruleTitle: analysis.summary,
    status: analysis.compliant ? 'compliant' : 'non-compliant',
    confidenceScore: 0,
    findings: analysis.findings.map((finding) => ({
      type: finding.type,
      element: finding.element ?? '',
      issue: finding.issue,
      recommendation: finding.recommendation,
      referenceWCAG: finding.wcagReference ?? '',
    })),
    recommendations: [],
    wcagReferences: [],
    scoreClass: kind,
    violationCount,
    hasError: hasAnalysisError(analysis),
  };
}

/**
 * Converts an internal AI result into an API result
 * @param aiResult - Internal AI result
 * @returns AI result in the API format
 */
function convertAIResult(aiResult: IAIEnrichedResult): AIEnrichedResult {
  // Compute the summaries
  let violationCount = 0;
  let compliantRulesCount = 0;

  for (const analysis of aiResult.ruleAnalyses) {
    if (!analysis.compliant) {
      violationCount++;
    } else {
      compliantRulesCount++;
    }
  }

  return {
    ruleAnalyses: aiResult.ruleAnalyses.map(convertAIRuleAnalysis),
    rulesAnalyzedCount: aiResult.totalRulesAnalyzed,
    metadata: {
      model: aiResult.metadata.model,
      timestamp: aiResult.metadata.timestamp,
      analysisType: aiResult.metadata.analysisType,
    },
    summary: {
      violationCount,
      compliantRulesCount,
      inapplicableRulesCount: 0,
    },
    screenshot: aiResult.screenshot,
    extractedDom: aiResult.extractedDOM,
  };
}

/**
 * @param result - Internal audit result
 * @returns AI counters, or null when the page has no AI result
 */
function buildAIScoring(result: IAxeResult): AIScoring | null {
  const aiResult = result.aiEnrichedResult;
  if (aiResult === undefined) {
    return null;
  }

  const counts = computeSummaryCounts(result);
  const findings = { violation: 0, warning: 0, recommendation: 0 };
  let nonCompliantDeclared = 0;

  for (const analysis of aiResult.ruleAnalyses) {
    if (!analysis.compliant) {
      nonCompliantDeclared++;
    }
    for (const finding of analysis.findings) {
      findings[finding.type]++;
    }
  }

  return {
    analyzed: aiResult.totalRulesAnalyzed,
    compliant: counts.aiCompliant,
    nonCompliant: counts.aiNonCompliant,
    notApplicable: counts.aiNotApplicable,
    errors: counts.aiErrors,
    nonCompliantDeclared,
    findings,
  };
}

/**
 * Counters per RGAA thematic (13 entries, in the official order), with a
 * thematic score (null when no criterion of the thematic applies).
 * @param result - Internal audit result
 * @returns Thematic counters in the API format
 */
function buildThematicScoring(result: IAxeResult): ThematicScoring[] {
  const stats = mapRulesToThematics(result);

  return RGAA_THEMATICS.map((thematic) => {
    const { compliant, nonCompliant, notApplicable } = stats[thematic.id] ?? {
      compliant: 0,
      nonCompliant: 0,
      notApplicable: 0,
    };
    const total = compliant + nonCompliant;

    return {
      id: thematic.id,
      name: thematic.name,
      compliant,
      nonCompliant,
      notApplicable,
      score: total === 0 ? null : Math.round((compliant / total) * 100),
    };
  });
}

/**
 * @param result - Internal audit result
 * @returns Page scoring in the API format
 */
export function buildPageScoring(result: IAxeResult): PageScoring {
  const { score, compliant, nonCompliant, notApplicable } =
    calculateAccessibilityScore(result);
  const { violations, passes, incomplete, source } =
    computeSummaryCounts(result);
  const { byImpact, affectedNodes } = countViolationsByImpact(
    result.violations,
  );

  return {
    score,
    level: getAccessibilityLevel(score).label,
    compliant,
    nonCompliant,
    notApplicable,
    thematics: buildThematicScoring(result),
    cards: { violations, passes, incomplete, source },
    violationsByImpact: byImpact,
    affectedNodes,
    ai: buildAIScoring(result),
  };
}

/**
 * @param results - Internal audit results
 * @returns Report scoring in the API format
 */
export function buildReportScoring(results: IAxeResult[]): ReportScoring {
  const global = computeGlobalScoring(results);
  const cards = { violations: 0, passes: 0, incomplete: 0 };
  const violationsByImpact = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    other: 0,
  };
  let affectedNodes = 0;

  for (const result of results) {
    const counts = computeSummaryCounts(result);
    cards.violations += counts.violations;
    cards.passes += counts.passes;
    cards.incomplete += counts.incomplete;

    const impact = countViolationsByImpact(result.violations);
    violationsByImpact.critical += impact.byImpact.critical;
    violationsByImpact.serious += impact.byImpact.serious;
    violationsByImpact.moderate += impact.byImpact.moderate;
    violationsByImpact.minor += impact.byImpact.minor;
    violationsByImpact.other += impact.byImpact.other;
    affectedNodes += impact.affectedNodes;
  }

  return {
    ...global,
    cards,
    violationsByImpact,
    affectedNodes,
  };
}

/**
 * Converts an internal audit result into an API result
 * @param result - Internal Axe-Core result
 * @returns Result in the API format
 */
export function convertResultToAPI(result: IAxeResult): PageAuditResult {
  const apiResult: PageAuditResult = {
    pageName: result.name ?? result.url,
    url: result.url,
    timestamp: result.timestamp,
    authRequired: result.authenticated ?? false,
    authMethod: (result.authMethod ?? 'none') as AuthType,
    testInfo: {
      userAgent: result.testInfo.userAgent,
      viewport: {
        width: result.testInfo.viewport.width,
        height: result.testInfo.viewport.height,
      },
      pageTitle: result.testInfo.title,
    },
    axeSummary: {
      violationCount: result.summary.violations,
      passedCount: result.summary.passes,
      incompleteCount: result.summary.incomplete,
      inapplicableCount: result.summary.inapplicable,
    },
    violations: result.violations.map(convertViolation),
    passes: result.passes.map(convertRuleOutcome),
    incomplete: result.incomplete.map(convertRuleOutcome),
    scoring: buildPageScoring(result),
  };

  // Add the AI result if available
  if (result.aiEnrichedResult) {
    apiResult.aiResult = convertAIResult(result.aiEnrichedResult);
  }

  // Add the detailed AI error if present
  if (result.aiAnalysisError) {
    apiResult.aiError = {
      message: result.aiAnalysisError.message,
      type: result.aiAnalysisError.type,
      details: result.aiAnalysisError.details,
      suggestions: result.aiAnalysisError.suggestions,
      timestamp: result.aiAnalysisError.timestamp,
    };
  }

  return apiResult;
}

/**
 * Converts multiple results into a consolidated report
 * @param results - List of audit results
 * @param name - Name of the overall audit
 * @param durationMs - Total duration in milliseconds
 * @returns Consolidated report in the API format
 */
export function convertToConsolidatedReport(
  results: IAxeResult[],
  name?: string,
  durationMs?: number,
): ConsolidatedAuditReport {
  return {
    name,
    timestamp: new Date().toISOString(),
    urlCount: results.length,
    results: results.map(convertResultToAPI),
    durationMs: durationMs ?? 0,
    scoring: buildReportScoring(results),
  };
}
