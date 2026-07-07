/**
 * Adapter to convert between internal types and OpenAPI v3-compliant API types.
 * Keeps the internal business logic while exposing a standardized API.
 */

import type {
  IAxeResult,
  IAxeViolation,
  IAxeNode,
  IAIEnrichedResult,
} from '@shared/types/audit.types.js';
import type { IAuthConfig } from '@shared/types/auth.types.js';
import type {
  PageAuditResult,
  AccessibilityViolation,
  DOMElement,
  AuthConfig,
  ConsolidatedAuditReport,
  AIEnrichedResult,
  AuthType,
} from '@shared/types/audit-api.types.js';

/**
 * Normalizes an API-facing AuthConfig (credentials) into its internal
 * IAuthConfig. Single source of truth for the mapping; reused by the journey
 * adapter.
 */
export function normalizeAuthConfig(config: AuthConfig): IAuthConfig {
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
    ruleAnalyses: aiResult.ruleAnalyses.map((analysis) => ({
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
    })),
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
  };
}
