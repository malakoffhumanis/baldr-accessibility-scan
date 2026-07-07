import type { IAxeResult } from '@shared/types/audit.types.js';

import { mapRulesToThematics } from './rgaa-thematics-mapper.util.js';

/**
 * Accessibility score aggregated across all RGAA thematics.
 *
 * - `score`        : integer percentage 0-100 (compliant / (compliant + nonCompliant))
 * - `compliant`    : satisfied criteria (Axe passes + AI compliant)
 * - `nonCompliant` : criteria in violation
 * - `notApplicable`: 106 - (C + NC), per the RGAA convention
 */
export interface AccessibilityScore {
  score: number;
  compliant: number;
  nonCompliant: number;
  notApplicable: number;
}

export interface AccessibilityLevel {
  label: string;
  color: string;
  icon: string;
}

/**
 * Computes the RGAA accessibility score by merging Axe + AI.
 * Score = (compliant / (compliant + nonCompliant)) × 100. If no criterion is
 * applicable, returns 100 by convention.
 */
export function calculateAccessibilityScore(
  result: IAxeResult,
): AccessibilityScore {
  const stats = mapRulesToThematics(result);

  let totalCompliant = 0;
  let totalNonCompliant = 0;

  Object.values(stats).forEach((thematic) => {
    totalCompliant += thematic.compliant;
    totalNonCompliant += thematic.nonCompliant;
  });

  const total = totalCompliant + totalNonCompliant;
  const score = total === 0 ? 100 : Math.round((totalCompliant / total) * 100);

  const rgaaNonApplicable = 106 - (totalCompliant + totalNonCompliant);

  return {
    score,
    compliant: totalCompliant,
    nonCompliant: totalNonCompliant,
    notApplicable: rgaaNonApplicable,
  };
}

/**
 * Maps a numeric score to a qualitative level (label + color + icon).
 * Thresholds: >=90 Excellent, >=75 Bon, >=60 Moyen, >=40 Faible, otherwise Critique.
 */
export function getAccessibilityLevel(score: number): AccessibilityLevel {
  if (score >= 90) {
    return { label: 'Excellent', color: '#27ae60', icon: '🏆' };
  }
  if (score >= 75) {
    return { label: 'Bon', color: '#2ecc71', icon: '✅' };
  }
  if (score >= 60) {
    return { label: 'Moyen', color: '#f39c12', icon: '⚠️' };
  }
  if (score >= 40) {
    return { label: 'Faible', color: '#e67e22', icon: '⚡' };
  }
  return { label: 'Critique', color: '#e74c3c', icon: '🚨' };
}
