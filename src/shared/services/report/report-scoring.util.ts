import type {
  IAIRuleAnalysis,
  IAxeResult,
  IAxeViolation,
} from '@shared/types/audit.types.js';

import {
  calculateAccessibilityScore,
  getAccessibilityLevel,
  type AccessibilityLevelLabel,
} from './accessibility-score.util.js';
import { classifyAiAnalysis } from './rgaa-thematics-mapper.util.js';

export type SummaryCardsSource = 'axe' | 'ai' | 'axe+ai';

export interface SummaryCounts {
  violations: number;
  passes: number;
  incomplete: number;
  aiViolations: number;
  aiCompliant: number;
  aiNonCompliant: number;
  aiNotApplicable: number;
  aiErrors: number;
  source: SummaryCardsSource;
}

export interface GlobalScoring {
  score: number;
  level: AccessibilityLevelLabel;
  compliant: number;
  nonCompliant: number;
  notApplicable: number;
  pageCount: number;
}

export interface ViolationsByImpact {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  other: number;
}

export interface ViolationsByImpactCount {
  byImpact: ViolationsByImpact;
  affectedNodes: number;
}

export function hasAnalysisError(analysis: IAIRuleAnalysis): boolean {
  return analysis.error != null && analysis.error !== '';
}

export function computeSummaryCounts(result: IAxeResult): SummaryCounts {
  const hasAI = result.aiEnrichedResult !== undefined;
  const hasAxe =
    result.summary.violations > 0 ||
    result.summary.passes > 0 ||
    result.summary.incomplete > 0;

  let aiViolations = 0;
  let aiCompliant = 0;
  let aiNonCompliant = 0;
  let aiNotApplicable = 0;
  let aiErrors = 0;

  for (const ruleAnalysis of result.aiEnrichedResult?.ruleAnalyses ?? []) {
    const { kind, violationCount } = classifyAiAnalysis(ruleAnalysis);

    if (hasAnalysisError(ruleAnalysis)) {
      aiErrors++;
    }
    if (kind === 'nonCompliant') {
      aiViolations += violationCount;
      aiNonCompliant++;
    } else if (kind === 'compliant') {
      aiCompliant++;
    } else {
      aiNotApplicable++;
    }
  }

  const ai = {
    aiViolations,
    aiCompliant,
    aiNonCompliant,
    aiNotApplicable,
    aiErrors,
  };

  if (!hasAI) {
    return {
      violations: result.summary.violations,
      passes: result.summary.passes,
      incomplete: result.summary.incomplete,
      ...ai,
      source: 'axe',
    };
  }
  if (!hasAxe) {
    return {
      violations: aiViolations,
      passes: aiCompliant,
      incomplete: aiNotApplicable,
      ...ai,
      source: 'ai',
    };
  }
  return {
    violations: result.summary.violations + aiViolations,
    passes: result.summary.passes + aiCompliant,
    incomplete: result.summary.incomplete + aiNotApplicable,
    ...ai,
    source: 'axe+ai',
  };
}

/**
 * Computes the global RGAA scoring of a set of pages — the exact logic of
 * the consolidated HTML report: C and NC are summed over the pages, the
 * score is `round(C / (C + NC) × 100)` (100 when nothing is applicable),
 * NA is the sum of the per-page NA.
 */
export function computeGlobalScoring(results: IAxeResult[]): GlobalScoring {
  let compliant = 0;
  let nonCompliant = 0;
  let notApplicable = 0;

  for (const result of results) {
    const stats = calculateAccessibilityScore(result);
    compliant += stats.compliant;
    nonCompliant += stats.nonCompliant;
    notApplicable += stats.notApplicable;
  }

  const total = compliant + nonCompliant;
  const score = total === 0 ? 100 : Math.round((compliant / total) * 100);

  return {
    score,
    level: getAccessibilityLevel(score).label,
    compliant,
    nonCompliant,
    notApplicable,
    pageCount: results.length,
  };
}

/**
 * Counts the Axe violations
 */
export function countViolationsByImpact(
  violations: readonly IAxeViolation[],
): ViolationsByImpactCount {
  const byImpact: ViolationsByImpact = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
    other: 0,
  };
  let affectedNodes = 0;

  for (const violation of violations) {
    switch (violation.impact) {
      case 'critical':
        byImpact.critical++;
        break;
      case 'serious':
        byImpact.serious++;
        break;
      case 'moderate':
        byImpact.moderate++;
        break;
      case 'minor':
        byImpact.minor++;
        break;
      default:
        byImpact.other++;
    }
    affectedNodes += violation.nodes.length;
  }

  return { byImpact, affectedNodes };
}
