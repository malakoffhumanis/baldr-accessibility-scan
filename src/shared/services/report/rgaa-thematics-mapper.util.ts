import type { IAIRuleAnalysis, IAxeResult } from '@shared/types/audit.types.js';

/**
 * Official list of the 13 RGAA 4.1.2 thematics.
 */
export const RGAA_THEMATICS = [
  { id: 1, name: 'Images' },
  { id: 2, name: 'Cadres' },
  { id: 3, name: 'Couleurs' },
  { id: 4, name: 'Multimédia' },
  { id: 5, name: 'Tableaux' },
  { id: 6, name: 'Liens' },
  { id: 7, name: 'Scripts' },
  { id: 8, name: 'Éléments obligatoires' },
  { id: 9, name: 'Structuration' },
  { id: 10, name: 'Présentation' },
  { id: 11, name: 'Formulaires' },
  { id: 12, name: 'Navigation' },
  { id: 13, name: 'Consultation' },
] as const;

export interface ThematicStats {
  compliant: number;
  nonCompliant: number;
  notApplicable: number;
}

export type ThematicStatsByThematic = Record<number, ThematicStats>;

/**
 * Maps an Axe rule ID to an RGAA thematic ID. `null` if not mappable.
 */
const AXE_RULE_TO_THEMATIC: Record<string, number> = {
  'image-alt': 1,
  'image-redundant-alt': 1,
  'input-image-alt': 1,
  'image-aria-label': 1,
  'object-alt': 1,
  'svg-img-alt': 1,
  'frame-title': 2,
  'frame-title-unique': 2,
  'iframe-title': 2,
  'color-contrast': 3,
  'color-contrast-enhanced': 3,
  'audio-caption': 4,
  'video-caption': 4,
  'video-description': 4,
  'table-duplicate-name': 5,
  'td-headers-attr': 5,
  'th-has-data-cells': 5,
  'table-fake-caption': 5,
  'link-name': 6,
  'identical-links-same-purpose': 6,
  'link-in-text-block': 6,
  'button-name': 7,
  'aria-command-name': 7,
  'aria-input-field-name': 7,
  'document-title': 8,
  'html-has-lang': 8,
  'html-lang-valid': 8,
  'valid-lang': 8,
  'heading-order': 9,
  'page-has-heading-one': 9,
  'landmark-one-main': 9,
  region: 9,
  'definition-list': 10,
  dlitem: 10,
  list: 10,
  listitem: 10,
  label: 11,
  'label-title-only': 11,
  'form-field-multiple-labels': 11,
  'input-button-name': 11,
  bypass: 12,
  'skip-link': 12,
  'landmark-banner-is-top-level': 12,
  'meta-refresh': 13,
  'meta-viewport': 13,
  'aria-hidden-focus': 13,
};

/**
 * Maps an RGAA rule ID (AI side) to a thematic ID. `null` if not mappable.
 * Includes a few aliases commonly returned by the AI (e.g. "navigation",
 * "tableaux", "formulaire").
 */
const RGAA_RULE_TO_THEMATIC: Record<string, number> = {
  // 1 — Images
  'image-alt': 1,
  'image-decorative': 1,
  'image-alt-relevance': 1,
  'image-captcha-purpose': 1,
  'image-captcha': 1,
  'image-complex-description': 1,
  'image-description-relevance': 1,
  'image-text': 1,
  'image-caption': 1,
  'image-vector-text': 1, // legacy alias
  // 2 — Cadres
  'frame-title': 2,
  'frame-title-relevance': 2,
  // 3 — Couleurs
  'color-contrast': 3,
  // 4 — Multimédia
  'media-transcript': 4,
  'media-live-captions': 4,
  'media-audio-description': 4,
  'media-synchronized-captions': 4,
  'media-extended-audio-description': 4,
  'media-sign-language': 4,
  'media-transcript-access': 4,
  'media-non-temporal-alternative': 4,
  'media-relevant-captions': 4,
  'media-audio-control': 4,
  'media-caption-translation-lang': 4,
  'media-controls-keyboard': 4,
  'media-video-only-transcript': 4,
  // 5 — Tableaux
  'table-structure': 5,
  'table-caption': 5,
  'table-headers': 5,
  'table-complex-summary': 5,
  'table-layout-headers': 5,
  'table-no-layout-headers': 5,
  tableaux: 5, // legacy alias
  // 6 — Liens
  'link-purpose': 6,
  liens: 6, // legacy alias
  // 7 — Scripts
  'script-keyboard-controllable': 7,
  'script-no-keyboard-trap': 7,
  'script-keyboard-focus-visible': 7,
  'script-status-messages': 7,
  'script-no-auto-reload': 7,
  // 8 — Éléments obligatoires
  'mandatory-lang-attribute': 8,
  'mandatory-element-validable-code': 8,
  'mandatory-element-language-change': 8,
  'mandatory-element-language-code': 8,
  'mandatory-element-page-title': 8,
  'mandatory-element-deprecated-tags': 8,
  // 9 — Structuration
  'heading-hierarchy': 9,
  'structure-heading-hierarchy': 9,
  'structure-list-usage': 9,
  'structure-citation': 9,
  // 10 — Présentation
  'presentation-information': 10,
  'presentation-no-absolute-units': 10,
  'presentation-linearized-content': 10,
  'presentation-text-resize': 10,
  'presentation-focus-visibility': 10,
  'presentation-contrast-text': 10,
  'presentation-additional-content': 10,
  'presentation-hidden-content': 10,
  presentation: 10, // legacy alias
  // 11 — Formulaires
  'form-labels': 11,
  'form-label-correctly-associated': 11,
  'form-field-grouping': 11,
  'form-input-type-appropriate': 11,
  'form-required-field-indication': 11,
  'form-field-format-indication': 11,
  'form-error-identification': 11,
  formulaire: 11, // legacy alias
  // 12 — Navigation
  'navigation-systems': 12,
  'navigation-skip-links': 12,
  'navigation-page-structure': 12,
  'navigation-breadcrumb': 12,
  'navigation-skip-link-target': 12,
  'navigation-menu-identification': 12,
  'navigation-main-content-identification': 12,
  'focus-order': 12,
  navigation: 12, // legacy alias
  // 13 — Consultation
  'consultation-time-limit-adjustment': 13,
  'consultation-flashing-content': 13,
  'consultation-document-download': 13,
  'consultation-media-alternatives': 13,
  'consultation-no-content-change': 13,
  'consultation-user-settings-storage': 13,
};

export function getThematicFromAxeRule(axeRuleId: string): number | null {
  return AXE_RULE_TO_THEMATIC[axeRuleId] ?? null;
}

export function getThematicFromRGAARuleId(ruleId: string): number | null {
  return RGAA_RULE_TO_THEMATIC[ruleId] ?? null;
}

/**
 * Heuristic: an AI analysis is non-applicable if its summary contains
 * "non applicable", or if it declares itself compliant with no findings and a
 * summary containing "aucun".
 */
export function isNonApplicableAnalysis(analysis: IAIRuleAnalysis): boolean {
  const summaryLower = (analysis.summary || '').toLowerCase();
  return (
    summaryLower.includes('non applicable') ||
    summaryLower.includes('non_applicable') ||
    (summaryLower.includes('aucun') &&
      analysis.compliant &&
      analysis.findings.length === 0)
  );
}

/**
 * Aggregates the rules of an audit result by RGAA thematic, merging the Axe
 * sources (violations + passes) and AI sources (ruleAnalyses), with
 * deduplication (a rule already counted on the Axe side is not counted again
 * on the AI side).
 *
 * AI convention:
 *   - `error` → non-applicable
 *   - `isNonApplicableAnalysis` → non-applicable
 *   - `findings.violation > 0` → as many non-compliant as violations
 *   - `compliant` → 1 compliant
 */
export function mapRulesToThematics(
  result: IAxeResult,
): ThematicStatsByThematic {
  const stats: ThematicStatsByThematic = {};

  RGAA_THEMATICS.forEach((t) => {
    stats[t.id] = { compliant: 0, nonCompliant: 0, notApplicable: 0 };
  });

  const countedRules = new Set<string>();

  result.violations.forEach((violation) => {
    const thematicId = getThematicFromAxeRule(violation.id);

    if (thematicId !== null && stats[thematicId]) {
      stats[thematicId].nonCompliant += 1;
      countedRules.add(`axe-${violation.id}`);
    }
  });

  result.passes.forEach((pass) => {
    const thematicId = getThematicFromAxeRule(pass.id);

    if (thematicId !== null && stats[thematicId]) {
      stats[thematicId].compliant += 1;
      countedRules.add(`axe-${pass.id}`);
    }
  });

  if (result.aiEnrichedResult?.ruleAnalyses) {
    result.aiEnrichedResult.ruleAnalyses.forEach((analysis) => {
      const ruleKey = `ia-${analysis.ruleId}`;

      if (countedRules.has(ruleKey)) {
        return;
      }

      const thematicId = getThematicFromRGAARuleId(analysis.ruleId);

      if (thematicId !== null && stats[thematicId]) {
        const violationCount = analysis.findings.filter(
          (f) => f.type === 'violation',
        ).length;

        if (analysis.error != null && analysis.error !== '') {
          stats[thematicId].notApplicable += 1;
          countedRules.add(ruleKey);
        } else if (isNonApplicableAnalysis(analysis)) {
          stats[thematicId].notApplicable += 1;
          countedRules.add(ruleKey);
        } else if (violationCount > 0) {
          stats[thematicId].nonCompliant += violationCount;
          countedRules.add(ruleKey);
        } else if (analysis.compliant) {
          stats[thematicId].compliant += 1;
          countedRules.add(ruleKey);
        }
      }
    });
  }

  return stats;
}
