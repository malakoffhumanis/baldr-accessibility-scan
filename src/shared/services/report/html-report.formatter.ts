import type {
  IAIEnrichedResult,
  IAIRuleAnalysis,
  IAxeResult,
  IAxeViolation,
  IFinding,
  IAIAnalysisError,
} from '@shared/types/audit.types.js';

import {
  calculateAccessibilityScore,
  getAccessibilityLevel,
} from './accessibility-score.util.js';
import { escapeHtml, generatePageId, levelClass } from './html.util.js';
import {
  RGAA_THEMATICS,
  isNonApplicableAnalysis,
  mapRulesToThematics,
} from './rgaa-thematics-mapper.util.js';

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Generates a standalone HTML document (with its styles) for an audit result.
 * Used for single-page reports.
 */
export function formatAsHTML(result: IAxeResult): string {
  return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rapport d'Accessibilité - Axe-Core</title>
    <style>
${MONO_PAGE_STYLES}
    </style>
</head>
<body>
    <a href="#main" class="skip-link">Aller au contenu principal</a>
    <div class="container">
        <header class="header">
            <h1><span aria-hidden="true">🛡️</span> Rapport d'Accessibilité Web ${result.aiEnrichedResult ? '+ <span aria-hidden="true">🤖</span> IA' : ''}</h1>
            <p><strong>Généré le:</strong> ${new Date().toLocaleString('fr-FR')}</p>
            <p><strong>Outil:</strong> Axe-Core ${result.aiEnrichedResult ? `+ IA (${result.aiEnrichedResult.metadata.model})` : 'avec Puppeteer'}</p>
            <div class="ai-disclaimer" role="status">
                <div class="ai-disclaimer-icon" aria-hidden="true">🤖</div>
                <div class="ai-disclaimer-text">
                    Rapport indicatif généré partiellement (à confirmer) via un système d'intelligence artificielle sur la base des informations que vous avez fournies.
                </div>
            </div>
        </header>

        <main id="main">
            ${generateGlobalSummaryTable([result])}

            ${generateRGAAThematicsTable(result)}

            ${generateSummaryCards(result)}

            ${createPageSection(result)}
        </main>
    </div>
</body>
</html>`;
}

/**
 * Formats a result as an HTML section (without head/body/styles).
 * Used for consolidated multi-page reports where the styles are provided
 * once at the top of the document via `getHTMLStyles()`.
 */
export function formatAsHTMLSection(result: IAxeResult): string {
  return createPageSection(result);
}

/**
 * Global summary table displaying a score per page (aggregated RGAA).
 * Used at the top of consolidated reports.
 */
export function generateGlobalSummaryTable(results: IAxeResult[]): string {
  const rows = results
    .map((result) => {
      const { score, compliant, nonCompliant, notApplicable } =
        calculateAccessibilityScore(result);
      const level = getAccessibilityLevel(score);
      const pageId = generatePageId(result.url, result.name);

      return `
        <tr>
          <td class="url-cell">
            <a class="url-cell-link" href="#${pageId}">
              <strong class="url-cell-title">${escapeHtml(result.name ?? result.url)}</strong>
              <div class="url-small">${escapeHtml(result.url)}</div>
            </a>
          </td>
          <td class="score-cell ${levelClass(score)}">
            <div class="score-badge ${levelClass(score)}">
              ${String(score)}
            </div>
            <div class="level-label"><span aria-hidden="true">${level.icon}</span> ${level.label}</div>
          </td>
          <td class="stat-cell conformes-stat">${String(compliant)}</td>
          <td class="stat-cell non-conformes-stat">${String(nonCompliant)}</td>
          <td class="stat-cell non-applicables-stat">${String(notApplicable)}</td>
        </tr>
      `;
    })
    .join('');

  return `
      <div class="global-summary-table" id="recap">
        <h2><span aria-hidden="true">📊</span> Tableau Récapitulatif Global</h2>
        <p id="recap-desc" class="sr-only">Ce tableau présente en colonnes les pages auditées avec leur score RGAA global, puis le détail des critères conformes, non conformes et non applicables.</p>
        <div class="table-wrap">
        <table class="summary-table" aria-describedby="recap-desc">
          <caption>Tableau récapitulatif des scores d'accessibilité RGAA par page auditée</caption>
          <thead>
            <tr>
              <th rowspan="2" scope="col">Page / URL</th>
              <th rowspan="2" scope="col">Score<br/>RGAA<br/><small>(%)</small></th>
              <th colspan="3" scope="colgroup">Critères RGAA (106 règles)</th>
            </tr>
            <tr>
              <th scope="col" class="stat-header-c"><span aria-hidden="true">✅</span> Conformes</th>
              <th scope="col" class="stat-header-nc"><span aria-hidden="true">❌</span> Non Conformes</th>
              <th scope="col" class="stat-header-na"><span aria-hidden="true">➖</span> Non Applicables</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        </div>
      </div>
    `;
}

/**
 * Returns the CSS styles of the consolidated HTML report.
 * Served once at the top of the multi-page document.
 */
export function getHTMLStyles(): string {
  return `
    <style>
${CONSOLIDATED_STYLES}
    </style>
  `;
}

// ===========================================================================
// Internal helpers
// ===========================================================================

function generateRGAAThematicsTable(result: IAxeResult): string {
  const thematicStats = mapRulesToThematics(result);

  const rows = RGAA_THEMATICS.map((thematic) => {
    const stats = thematicStats[thematic.id] ?? {
      compliant: 0,
      nonCompliant: 0,
      notApplicable: 0,
    };

    return `
        <tr>
          <td class="thematic-name">${String(thematic.id)}. ${thematic.name}</td>
          <td class="stat-c">${String(stats.compliant)}</td>
          <td class="stat-nc">${String(stats.nonCompliant)}</td>
          <td class="stat-na">${String(stats.notApplicable)}</td>
        </tr>
      `;
  }).join('');

  return `
      <div class="rgaa-thematics-table" id="thematics">
        <h2><span aria-hidden="true">📋</span> Synthèse par Thématiques RGAA 4.1.2</h2>
        <div class="table-wrap">
        <table class="rgaa-table">
          <caption>Synthèse des critères RGAA par thématique</caption>
          <thead>
            <tr>
              <th scope="col">Thématique</th>
              <th scope="col" class="stat-header-c"><span aria-hidden="true">✅</span> C<br/><small>Conforme</small></th>
              <th scope="col" class="stat-header-nc"><span aria-hidden="true">❌</span> NC<br/><small>Non Conforme</small></th>
              <th scope="col" class="stat-header-na"><span aria-hidden="true">➖</span> NA<br/><small>Non Applicable</small></th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
        </div>
        <div class="rgaa-legend">
          <p><strong>Légende :</strong></p>
          <ul>
            <li><strong>C (Conforme)</strong> : Le critère est respecté</li>
            <li><strong>NC (Non Conforme)</strong> : Le critère n'est pas respecté</li>
            <li><strong>NA (Non Applicable)</strong> : Le critère ne s'applique pas à cette page</li>
          </ul>
        </div>
      </div>
    `;
}

function generateSummaryCards(result: IAxeResult): string {
  const hasAI = !!result.aiEnrichedResult;
  const hasAxe =
    result.summary.violations > 0 ||
    result.summary.passes > 0 ||
    result.summary.incomplete > 0;

  let aiViolations = 0;
  let aiCompliant = 0;
  let aiNotApplicable = 0;

  if (result.aiEnrichedResult?.ruleAnalyses) {
    result.aiEnrichedResult.ruleAnalyses.forEach((ruleAnalysis) => {
      const violationCount = ruleAnalysis.findings.filter(
        (finding) => finding.type === 'violation',
      ).length;

      if (ruleAnalysis.error != null && ruleAnalysis.error !== '') {
        aiNotApplicable++;
      } else if (isNonApplicableAnalysis(ruleAnalysis)) {
        aiNotApplicable++;
      } else if (violationCount > 0) {
        aiViolations += violationCount;
      } else if (ruleAnalysis.compliant) {
        aiCompliant++;
      } else {
        aiNotApplicable++;
      }
    });
  }

  let totalViolations: number;
  let totalPasses: number;
  let totalIncomplete: number;
  let cardsLabel: string;

  if (!hasAI) {
    totalViolations = result.summary.violations;
    totalPasses = result.summary.passes;
    totalIncomplete = result.summary.incomplete;
    cardsLabel = 'Axe-Core';
  } else if (!hasAxe) {
    totalViolations = aiViolations;
    totalPasses = aiCompliant;
    totalIncomplete = aiNotApplicable;
    cardsLabel = 'IA';
  } else {
    totalViolations = result.summary.violations + aiViolations;
    totalPasses = result.summary.passes + aiCompliant;
    totalIncomplete = result.summary.incomplete + aiNotApplicable;
    cardsLabel = 'Totales (Axe + IA)';
  }

  return `
        <div class="summary">
            <div class="summary-card violations">
                <div class="summary-number">${String(totalViolations)}</div>
                <div>${!hasAI ? 'Violations Axe-Core' : !hasAxe ? 'Non Conformes IA' : `Violations ${cardsLabel}`}</div>
            </div>
            <div class="summary-card passes">
                <div class="summary-number">${String(totalPasses)}</div>
                <div>${!hasAI ? 'Tests Réussis Axe-Core' : !hasAxe ? 'Conformes IA' : `Tests Réussis ${cardsLabel}`}</div>
            </div>
            <div class="summary-card incomplete">
                <div class="summary-number">${String(totalIncomplete)}</div>
                <div>${!hasAI ? 'Incomplets Axe-Core' : !hasAxe ? 'Non Applicables IA' : `Incomplets/NA ${cardsLabel}`}</div>
            </div>
        </div>
    `;
}

/**
 * Screenshot section for an audited page (capture at the top of the section).
 * Source in priority order: result.screenshot, then aiEnrichedResult.screenshot.
 * Returns an empty string if no capture is available.
 */
function createScreenshotSection(result: IAxeResult): string {
  const screenshot = result.screenshot ?? result.aiEnrichedResult?.screenshot;
  if (screenshot == null || screenshot.length === 0) return '';
  return `
            <details class="page-screenshot" open>
              <summary class="page-screenshot-summary">
                <span aria-hidden="true">📸</span> Capture d'écran de la page auditée
              </summary>
              <img
                class="page-screenshot-img"
                src="data:image/jpeg;base64,${screenshot}"
                alt="Capture d'écran de ${escapeHtml(result.name ?? result.url)}"
              />
            </details>`;
}

function createPageSection(result: IAxeResult): string {
  const violations = result.violations;
  const { score, compliant, nonCompliant, notApplicable } =
    calculateAccessibilityScore(result);
  const pageId = generatePageId(result.url, result.name);

  const violationsHtml =
    violations.length === 0
      ? '<div class="no-violations">✅ Aucune violation d\'accessibilité détectée !</div>'
      : violations.map((v) => createViolationHTML(v)).join('');

  const summaryCardsHtml = generateSummaryCards(result);

  return `
        <details class="page-section" id="${pageId}">
          <summary class="page-summary">
            <span class="page-summary-title"><span aria-hidden="true">📄</span> ${escapeHtml(result.name ?? result.url)}</span>
            <span class="page-summary-stats">
              <span class="page-score ${levelClass(score)}">
                ${String(score)}%
              </span>
              <span class="page-rgaa-stats">
                <span class="rgaa-count">${String(compliant)} C<span class="sr-only"> conformes</span></span> /
                <span class="rgaa-count">${String(nonCompliant)} NC<span class="sr-only"> non conformes</span></span> /
                <span class="rgaa-count">${String(notApplicable)} NA<span class="sr-only"> non applicables</span></span>
              </span>
            </span>
          </summary>
          <div class="page-content">
            <p><strong>URL:</strong> <a href="${escapeHtml(result.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.url)}<span class="sr-only"> (nouvelle fenêtre)</span></a></p>
            <p><strong>Titre:</strong> ${escapeHtml(result.testInfo.title)}</p>
            <p><strong>Test effectué:</strong> ${new Date(result.timestamp).toLocaleString('fr-FR')}</p>

            ${createScreenshotSection(result)}

            ${summaryCardsHtml}

            ${violationsHtml}

                    ${result.aiEnrichedResult ? createAIEnrichedSection(result.aiEnrichedResult, result.name ?? result.url) : ''}
                    ${result.aiAnalysisError ? createAIErrorSection(result.aiAnalysisError) : ''}
                </div>
            </details>`;
}

function createViolationHTML(violation: IAxeViolation): string {
  const impactClass = `violation-${violation.impact}`;
  const helpUrl = violation.helpUrl
    ? `<p><strong>Plus d'infos:</strong> <a href="${escapeHtml(violation.helpUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(violation.helpUrl)}<span class="sr-only"> (nouvelle fenêtre)</span></a></p>`
    : '';

  const nodesHtml = violation.nodes
    .map((node) => {
      const targetStr = Array.isArray(node.target)
        ? node.target.join(', ')
        : node.target;
      const targetInfo = `<p><strong>Sélecteur:</strong> ${escapeHtml(targetStr)}</p>`;

      return `
                    <div class="node">${escapeHtml(node.html)}</div>
                    ${targetInfo}`;
    })
    .join('');

  return `
            <div class="violation ${impactClass}">
                <h3 class="violation-header">
                    <span class="impact impact-${violation.impact}">${violation.impact}</span>
                    ${escapeHtml(violation.help)}
                </h3>
                <p><strong>ID:</strong> ${escapeHtml(violation.id)}</p>
                <p><strong>Description:</strong> ${escapeHtml(violation.description)}</p>
                <p><strong>Impact:</strong> ${violation.impact}</p>
                <p><strong>Tags:</strong> ${escapeHtml(violation.tags.join(', '))}</p>
                ${helpUrl}

                <h4>Éléments affectés (${violation.nodes.length.toString()}):</h4>
                ${nodesHtml}
            </div>`;
}

function createAIErrorSection(error: IAIAnalysisError): string {
  const typeColors: Record<string, string> = {
    CONFIGURATION: '#e67e22',
    CONNECTIVITY: '#e74c3c',
    AUTHENTICATION: '#c0392b',
    TIMEOUT: '#f39c12',
    PROXY: '#d35400',
    DEPLOYMENT: '#8e44ad',
    RATE_LIMIT: '#f1c40f',
    UNKNOWN: '#95a5a6',
  };

  const typeIcons: Record<string, string> = {
    CONFIGURATION: '⚙️',
    CONNECTIVITY: '🌐',
    AUTHENTICATION: '🔑',
    TIMEOUT: '⏱️',
    PROXY: '🔗',
    DEPLOYMENT: '📦',
    RATE_LIMIT: '🚦',
    UNKNOWN: '❓',
  };

  const color = typeColors[error.type] ?? '#95a5a6';
  const icon = typeIcons[error.type] ?? '❓';

  return `
            <div class="ai-error-section" style="--err-color: ${color};">
                <h2 class="ai-error-title">
                    <span aria-hidden="true">${icon} ⚠️</span> Analyse IA Indisponible
                </h2>

                <div class="ai-error-card">
                    <p>
                        <strong>Type d'erreur:</strong>
                        <span class="ai-error-badge">${escapeHtml(error.type)}</span>
                    </p>
                    <p><strong>Message:</strong> ${escapeHtml(error.message)}</p>
                    <p><strong>Détails:</strong> ${escapeHtml(error.details)}</p>
                    <p class="ai-error-timestamp">
                        <strong>Horodatage:</strong> ${new Date(error.timestamp).toLocaleString('fr-FR')}
                    </p>
                </div>

                <div class="ai-error-suggestions">
                    <h3><span aria-hidden="true">💡</span> Suggestions de résolution</h3>
                    <ul>
                        ${error.suggestions.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
                    </ul>
                </div>

                <p class="ai-error-note">
                    <span aria-hidden="true">⚡</span> <strong>Note:</strong> L'analyse statique Axe-Core a été réalisée avec succès.
                    Seule l'analyse IA enrichie n'a pas pu être exécutée.
                    Utilisez <code>GET /api/v1/health</code> pour diagnostiquer la configuration Azure OpenAI.
                </p>
            </div>
        `;
}

function createAIEnrichedSection(
  aiResult: IAIEnrichedResult,
  pageName?: string,
): string {
  const violationsCount = aiResult.ruleAnalyses.filter(
    (r) => !r.compliant,
  ).length;

  return `
            <div class="ai-section">
                <h2><span aria-hidden="true">🤖</span> Analyse IA Enrichie RGAA${pageName != null && pageName !== '' ? ` — ${escapeHtml(pageName)}` : ''}</h2>
                <div class="ai-metadata">
                    <p><strong>Modèle:</strong> ${escapeHtml(aiResult.metadata.model)}</p>
                    <p><strong>Règles analysées:</strong> ${aiResult.totalRulesAnalyzed.toString()}</p>
                    <p><strong>Non-conformités détectées:</strong> ${violationsCount.toString()}</p>
                    <p><strong>Type d'analyse:</strong> ${escapeHtml(aiResult.metadata.analysisType)}</p>
                </div>

                ${aiResult.ruleAnalyses.map((analysis) => createAIRuleAnalysis(analysis)).join('')}
            </div>
        `;
}

function createAIRuleAnalysis(analysis: IAIRuleAnalysis): string {
  if (analysis.error != null && analysis.error !== '') {
    return `
            <div class="ai-rule-analysis non-compliant">
                <h3>⚠️ ${escapeHtml(analysis.ruleId)}</h3>
                <div class="ai-summary severity-minor">
                    <strong>Erreur d'analyse IA:</strong> ${escapeHtml(analysis.error)}
                </div>
            </div>
        `;
  }

  const summaryLower = (analysis.summary || '').toLowerCase();
  const isNonApplicable =
    summaryLower.includes('non applicable') ||
    summaryLower.includes('non_applicable') ||
    (summaryLower.includes('aucun') &&
      analysis.compliant &&
      analysis.findings.length === 0);

  if (isNonApplicable) {
    return `
            <div class="ai-rule-analysis non-applicable">
                <h3><span aria-hidden="true">➖</span> ${escapeHtml(analysis.ruleId)}</h3>
                <div class="ai-summary ai-summary-na">
                    <strong>Non Applicable</strong><br>
                    ${escapeHtml(analysis.summary)}
                </div>
            </div>
        `;
  }

  const statusIcon = analysis.compliant ? '✅' : '❌';
  const statusClass = analysis.compliant ? 'compliant' : 'non-compliant';
  const severityClass = `severity-${analysis.severity}`;

  return `
            <div class="ai-rule-analysis ${statusClass}">
                <h3>${statusIcon} ${escapeHtml(analysis.ruleId)}</h3>

                <div class="ai-summary ${severityClass}">
                    <strong>Sévérité:</strong> ${escapeHtml(analysis.severity)}<br>
                    <strong>Résumé:</strong> ${escapeHtml(analysis.summary)}
                </div>

                ${analysis.intelligentAnalysis ? createIntelligentAnalysis(analysis.intelligentAnalysis) : ''}

                ${
                  analysis.findings.length > 0
                    ? `
                    <div class="ai-findings">
                        <h4>Constats détaillés:</h4>
                        ${analysis.findings.map((finding) => createAIFinding(finding)).join('')}
                    </div>
                `
                    : ''
                }
            </div>
        `;
}

function createIntelligentAnalysis(intelligentAnalysis: {
  contextualInsights?: string;
  semanticRelevance?: string;
  userImpact?: string;
}): string {
  const contextHtml =
    intelligentAnalysis.contextualInsights != null &&
    intelligentAnalysis.contextualInsights !== ''
      ? `<p><strong>Contexte:</strong> ${escapeHtml(intelligentAnalysis.contextualInsights)}</p>`
      : '';
  const semanticHtml =
    intelligentAnalysis.semanticRelevance != null &&
    intelligentAnalysis.semanticRelevance !== ''
      ? `<p><strong>Pertinence sémantique:</strong> ${escapeHtml(intelligentAnalysis.semanticRelevance)}</p>`
      : '';
  const impactHtml =
    intelligentAnalysis.userImpact != null &&
    intelligentAnalysis.userImpact !== ''
      ? `<p><strong>Impact utilisateur:</strong> ${escapeHtml(intelligentAnalysis.userImpact)}</p>`
      : '';

  return `
            <div class="intelligent-analysis">
                <h4><span aria-hidden="true">🧠</span> Analyse Contextuelle IA</h4>
                ${contextHtml}
                ${semanticHtml}
                ${impactHtml}
            </div>
        `;
}

function createAIFinding(finding: IFinding): string {
  const typeIcons = {
    violation: '🔴',
    warning: '🟡',
    recommendation: '💡',
  };

  const icon = typeIcons[finding.type] || '📌';
  const rgaaHtml =
    finding.rgaaReference != null && finding.rgaaReference !== ''
      ? `<p><strong>Référence RGAA:</strong> ${escapeHtml(finding.rgaaReference)}</p>`
      : '';

  return `
            <div class="ai-finding finding-${finding.type}">
                <p><strong><span aria-hidden="true">${icon}</span> ${escapeHtml(finding.type.toUpperCase())}</strong></p>
                <p><strong>Élément:</strong> <code>${escapeHtml(finding.element ?? 'N/A')}</code></p>
                <p><strong>Problème:</strong> ${escapeHtml(finding.issue)}</p>
                <p><strong>Recommandation:</strong> ${escapeHtml(finding.recommendation)}</p>
                ${rgaaHtml}
            </div>
        `;
}

// ===========================================================================
// CSS styles (two variants: standalone single-page and consolidated multi-page)
// ===========================================================================

const MONO_PAGE_STYLES = `        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            border-bottom: 3px solid #2ecc71;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .summary-card {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            border-left: 4px solid;
        }
        .violations { border-left-color: #e74c3c; }
        .passes { border-left-color: #2ecc71; }
        .incomplete { border-left-color: #f39c12; }
        .summary-number {
            font-size: 2em;
            font-weight: bold;
            color: #2c3e50;
        }
        .violation {
            margin: 20px 0;
            padding: 20px;
            border-left: 4px solid #e74c3c;
            background: #fdf2f2;
            border-radius: 4px;
        }
        .violation-critical { border-left-color: #c0392b; background: #fadbd8; }
        .violation-serious { border-left-color: #e74c3c; background: #fdf2f2; }
        .violation-moderate { border-left-color: #f39c12; background: #fef9e7; }
        .violation-minor { border-left-color: #3498db; background: #ebf3fd; }
        .violation-header {
            font-weight: bold;
            color: #2c3e50;
            margin: 0 0 10px 0;
            font-size: 1.05em;
        }
        .impact {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .impact-critical { background: #c0392b; color: white; }
        .impact-serious { background: #c2410c; color: white; }
        .impact-moderate { background: #f39c12; color: #000; }
        .impact-minor { background: #2471a3; color: white; }
        .node {
            background: #2c3e50;
            color: white;
            padding: 8px 12px;
            margin: 5px 0;
            font-family: monospace;
            font-size: 0.9em;
            border-radius: 4px;
            overflow-x: auto;
        }
        .page-section {
            margin-top: 40px;
            padding-top: 20px;
        }
        .page-title {
            color: #2980b9;
            border-bottom: 1px solid #bdc3c7;
            padding-bottom: 10px;
        }
        .no-violations {
            text-align: center;
            padding: 40px;
            color: #1b7a43;
            font-size: 1.2em;
        }
        .ai-section {
            margin: 30px 0;
            padding: 20px;
            background: #4338ca;
            border-radius: 8px;
            color: white;
        }
        .ai-section h2 {
            margin-top: 0;
            color: white;
        }
        .ai-section-error {
            margin: 30px 0;
            padding: 20px;
            background: #f39c12;
            border-radius: 8px;
            color: white;
        }
        .ai-metadata {
            background: rgba(255,255,255,0.1);
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        .ai-rule-analysis {
            background: white;
            color: #333;
            margin: 15px 0;
            padding: 20px;
            border-radius: 5px;
            border-left: 4px solid #667eea;
        }
        .ai-rule-analysis.non-compliant {
            border-left-color: #e74c3c;
        }
        .ai-rule-analysis.compliant {
            border-left-color: #27ae60;
        }
        .ai-rule-analysis h3 {
            margin-top: 0;
        }
        .ai-summary {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
        }
        .severity-critical {
            border-left: 3px solid #c0392b;
        }
        .severity-serious {
            border-left: 3px solid #e67e22;
        }
        .severity-moderate {
            border-left: 3px solid #f39c12;
        }
        .severity-minor {
            border-left: 3px solid #3498db;
        }
        .intelligent-analysis {
            background: #e8f4f8;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        .intelligent-analysis h4 {
            margin-top: 0;
            color: #2c3e50;
        }
        .ai-findings {
            margin-top: 15px;
        }
        .ai-findings h4 {
            color: #2c3e50;
        }
        .ai-finding {
            background: #fff;
            border: 1px solid #ddd;
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
        }
        .finding-violation {
            border-left: 4px solid #e74c3c;
        }
        .finding-warning {
            border-left: 4px solid #f39c12;
        }
        .finding-recommendation {
            border-left: 4px solid #3498db;
        }
        .error-message {
            color: white;
            font-weight: bold;
        }
        /* Styles for the global summary table */
        .global-summary-table {
            margin: 30px 0;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .global-summary-table h2 {
            margin-top: 0;
            color: #2c3e50;
        }
        .summary-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .summary-table th {
            background: #4338ca;
            color: white;
            padding: 12px;
            text-align: center;
            font-weight: 600;
            font-size: 0.9em;
        }
        .summary-table th.stat-header-c { background: #1b7a43; }
        .summary-table th.stat-header-nc { background: #c0392b; }
        .summary-table th.stat-header-na { background: #5d6d7e; }
        .summary-table td {
            padding: 12px;
            text-align: center;
            border-bottom: 1px solid #e0e0e0;
        }
        .summary-table tbody tr:hover {
            background: #f5f7fa;
        }
        .url-cell {
            text-align: left !important;
            max-width: 300px;
        }
        .url-small {
            font-size: 0.85em;
            color: #5d6d7e;
            margin-top: 4px;
        }
        .score-cell {
            padding: 8px !important;
            background: color-mix(in srgb, var(--level-color, #0066cc) 12%, #ffffff);
        }
        .score-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 60px;
            min-height: 60px;
            padding: 8px;
            box-sizing: border-box;
            line-height: 1.1;
            border-radius: 50%;
            font-size: 1.5em;
            font-weight: bold;
            background: var(--level-color, #0066cc);
            color: #1a1a1a;
            margin-bottom: 5px;
        }
        .level-label {
            font-size: 0.85em;
            font-weight: 600;
        }
        .stat-cell {
            font-weight: 600;
            font-size: 1.1em;
            min-width: 70px;
        }
        .violations-stat {
            color: #c0392b;
        }
        .passes-stat {
            color: #1b7a43;
        }
        .incomplete-stat {
            color: #a05a00;
        }
        .conformes-stat {
            color: #1b7a43;
            font-weight: 700;
        }
        .non-conformes-stat {
            color: #c0392b;
            font-weight: 700;
        }
        .non-applicables-stat {
            color: #5d6d7e;
        }
        .table-legend {
            margin-top: 15px;
            padding: 15px;
            background: white;
            border-left: 4px solid #3498db;
            border-radius: 4px;
        }
        .table-legend strong {
            color: #2c3e50;
        }
        .table-legend ul {
            margin: 10px 0 0 0;
            padding-left: 20px;
        }
        .table-legend li {
            margin: 5px 0;
            color: #555;
        }
        .ai-violations-stat {
            color: #c0392b;
        }
        .ai-compliant-stat {
            color: #16a085;
        }
        .ai-na-stat {
            color: #95a5a6;
        }
        .no-ai {
            color: #95a5a6;
            font-style: italic;
        }
        /* Styles for the RGAA table */
        .rgaa-thematics-table {
            margin: 30px 0;
            padding: 20px;
            background: #ecf0f1;
            border-radius: 8px;
        }
        .rgaa-thematics-table h2 {
            margin-top: 0;
            color: #2c3e50;
        }
        .rgaa-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .rgaa-table th {
            background: #34495e;
            color: white;
            padding: 12px;
            text-align: center;
            font-weight: 600;
        }
        .rgaa-table th.stat-header-c {
            background: #1b7a43;
        }
        .rgaa-table th.stat-header-nc {
            background: #c0392b;
        }
        .rgaa-table th.stat-header-na {
            background: #5d6d7e;
        }
        .rgaa-table td {
            padding: 10px;
            border-bottom: 1px solid #e0e0e0;
            text-align: center;
        }
        .rgaa-table .thematic-name {
            text-align: left;
            font-weight: 500;
        }
        .rgaa-table .stat-c {
            color: #1b7a43;
            font-weight: 600;
        }
        .rgaa-table .stat-nc {
            color: #c0392b;
            font-weight: 600;
        }
        .rgaa-table .stat-na {
            color: #5d6d7e;
        }
        .rgaa-table tbody tr:hover {
            background: #f5f7fa;
        }
        .rgaa-legend {
            margin-top: 15px;
            padding: 15px;
            background: white;
            border-left: 4px solid #3498db;
            border-radius: 4px;
        }
        .rgaa-legend ul {
            margin: 10px 0 0 0;
            padding-left: 20px;
        }
        .rgaa-legend li {
            margin: 5px 0;
        }
        /* ===== Accessibilité (RGAA / WCAG) ===== */
        .skip-link {
            position: absolute;
            left: -9999px;
            top: 0;
            z-index: 1100;
            background: #005fcc;
            color: #fff;
            padding: 10px 16px;
            font-weight: 600;
            border-radius: 0 0 6px 0;
            text-decoration: none;
        }
        .skip-link:focus { left: 0; }
        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0 0 0 0);
            white-space: nowrap;
            border: 0;
        }
        a:focus-visible,
        button:focus-visible,
        summary:focus-visible,
        details:focus-visible,
        [tabindex]:focus-visible {
            outline: 3px solid #005fcc;
            outline-offset: 2px;
        }
        table caption {
            caption-side: top;
            text-align: left;
            font-weight: 600;
            color: #1e293b;
            padding: 8px 4px;
        }
        .ai-disclaimer {
            margin-top: 25px;
            padding: 18px 22px;
            background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
            border: 1px solid #f59e0b;
            border-left: 5px solid #f59e0b;
            border-radius: 8px;
            display: flex;
            align-items: flex-start;
            gap: 14px;
            text-align: left;
        }
        .ai-disclaimer-icon { font-size: 1.5em; line-height: 1; flex-shrink: 0; }
        .ai-disclaimer-text {
            flex: 1;
            color: #78350f;
            font-size: 0.95em;
            line-height: 1.5;
        }
        .url-cell-link {
            display: block;
            padding: 4px 0;
            text-decoration: none;
            color: #1f6391;
        }
        .url-cell-title {
            display: block;
            font-size: 1.05em;
            margin-bottom: 4px;
            color: #1f6391;
        }
        .page-screenshot { margin: 15px 0; }
        .page-screenshot-summary {
            cursor: pointer;
            font-weight: bold;
            padding: 8px 0;
            color: #333;
        }
        .page-screenshot-img {
            max-width: 100%;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-top: 8px;
        }
        .ai-summary-na { background: #ecf0f1; color: #4a5a68; }
        .ai-rule-analysis.non-applicable {
            border-left-color: #5d6d7e;
            background: #f8f9fa;
        }
        .ai-error-section {
            margin: 20px 0;
            padding: 20px;
            border: 2px solid var(--err-color, #95a5a6);
            border-radius: 12px;
            background: #fff;
        }
        .ai-error-title { color: #2c3e50; margin-top: 0; }
        .ai-error-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
            border-left: 4px solid var(--err-color, #95a5a6);
        }
        .ai-error-badge {
            display: inline-block;
            background: #2c3e50;
            color: #fff;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .ai-error-timestamp { color: #555; font-size: 0.85em; }
        .ai-error-suggestions {
            background: #f0f8ff;
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
        }
        .ai-error-suggestions h3 { margin-top: 0; color: #2c3e50; }
        .ai-error-note {
            margin: 10px 0 0 0;
            padding: 10px;
            background: #fff3cd;
            border-radius: 6px;
            font-size: 0.9em;
            color: #664d03;
        }
        /* Collapsible page sections (aligned with the consolidated report) */
        .page-summary {
            background: #4338ca;
            color: white;
            padding: 20px;
            border-radius: 6px;
            cursor: pointer;
            list-style: none;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 600;
            font-size: 1.1em;
            user-select: none;
        }
        .page-summary::-webkit-details-marker { display: none; }
        .page-summary::before {
            content: '▼';
            margin-right: 12px;
            transition: transform 0.3s;
            display: inline-block;
        }
        details[open] .page-summary::before { transform: rotate(-180deg); }
        .page-summary:hover {
            background: #3730a3;
        }
        .page-summary-title { flex: 1; }
        .page-summary-stats { display: flex; align-items: center; gap: 12px; }
        .page-content { padding: 20px 0; }
        .page-score {
            background: var(--level-color, #0066cc);
            color: #1a1a1a;
            padding: 4px 12px;
            border-radius: 12px;
            font-weight: bold;
            margin: 0 8px;
        }
        .page-rgaa-stats { font-size: 0.95em; margin-left: 12px; color: #fff; }
        .rgaa-count { color: #fff; font-weight: 700; }
        /* Level colours carried as classes (no inline styles — RGAA 10.x) */
        .lvl-excellent { --level-color: #27ae60; }
        .lvl-bon { --level-color: #2ecc71; }
        .lvl-moyen { --level-color: #f39c12; }
        .lvl-faible { --level-color: #e67e22; }
        .lvl-critique { --level-color: #e74c3c; }
        /* Responsive data tables: any overflow stays inside the box, the page
           itself never scrolls horizontally; the table keeps its natural size. */
        .table-wrap {
            max-width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }
        /* Long URLs / words wrap instead of forcing horizontal page scroll */
        .page-content { overflow-wrap: anywhere; }
        .page-summary-title { overflow-wrap: anywhere; min-width: 0; }
        .header { overflow-wrap: anywhere; }
        /* Narrow screens (≈320px): keep the page free of horizontal scroll */
        @media (max-width: 480px) {
            body { padding: 8px; }
            .container { padding: 14px; }
            .header { padding: 18px; }
            .summary { gap: 12px; }
            .page-summary { flex-wrap: wrap; gap: 8px; }
            .page-summary-stats { flex-wrap: wrap; }
            .page-content { padding: 12px; }
        }`;

const CONSOLIDATED_STYLES = `        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
            background: #0066cc;
            color: white;
            padding: 30px;
            border-radius: 8px;
            margin-bottom: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0 0 10px 0;
            font-size: 2em;
        }
        .header h2 {
            margin: 10px 0;
            font-size: 1.5em;
            opacity: 0.9;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .summary-card {
            background: #0066cc;
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .summary-card.violations {
            background: #c0392b;
        }
        .summary-card.passes {
            background: #1b7a43;
        }
        .summary-card.incomplete {
            background: #a05a00;
        }
        .summary-number {
            font-size: 3em;
            font-weight: bold;
            margin-bottom: 10px;
        }

        /* Styles for the unified global summary table */
        .global-summary-table {
            margin: 30px 0;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .global-summary-table h2 {
            margin-top: 0;
            color: #2c3e50;
            text-align: center;
        }
        .summary-table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .summary-table th {
            background: #0066cc;
            color: white;
            padding: 12px 8px;
            text-align: center;
            font-weight: 600;
            font-size: 0.9em;
        }
        .summary-table th small {
            display: block;
            font-size: 0.85em;
            opacity: 0.9;
            margin-top: 2px;
        }
        .summary-table th.stat-header-c {
            background: #1b7a43;
        }
        .summary-table th.stat-header-nc {
            background: #c0392b;
        }
        .summary-table th.stat-header-na {
            background: #5d6d7e;
        }
        .summary-table td {
            padding: 12px 8px;
            text-align: center;
            border-bottom: 1px solid #e0e0e0;
        }
        .summary-table tbody tr:hover {
            background: #e8f4f8;
            transition: background 0.2s;
        }
        .url-cell {
            text-align: left !important;
            max-width: 300px;
        }
        .url-cell a {
            display: block;
            padding: 4px 0;
            transition: all 0.2s;
            text-decoration: none;
            color: #1f6391;
        }
        .url-cell a:hover {
            padding-left: 8px;
        }
        .url-cell strong {
            display: block;
            font-size: 1.05em;
            margin-bottom: 4px;
            color: #1f6391;
        }
        .url-small {
            font-size: 0.85em;
            color: #5d6d7e;
            word-break: break-all;
        }
        .score-cell {
            padding: 8px !important;
            min-width: 100px;
            background: color-mix(in srgb, var(--level-color, #0066cc) 12%, #ffffff);
        }
        .score-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 60px;
            min-height: 60px;
            padding: 8px;
            box-sizing: border-box;
            line-height: 1.1;
            border-radius: 50%;
            font-size: 1.5em;
            font-weight: bold;
            background: var(--level-color, #0066cc);
            color: #1a1a1a;
            margin-bottom: 5px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .level-label {
            font-size: 0.85em;
            font-weight: 600;
            color: #2c3e50;
        }
        .stat-cell {
            font-weight: 600;
            font-size: 1.1em;
            min-width: 70px;
        }
        .violations-stat {
            color: #e74c3c;
        }
        .passes-stat {
            color: #27ae60;
        }
        .incomplete-stat {
            color: #f39c12;
        }
        .ai-violations-stat {
            color: #c0392b;
        }
        .ai-compliant-stat {
            color: #16a085;
        }
        .ai-na-stat {
            color: #95a5a6;
        }
        .no-ai {
            color: #95a5a6;
            font-style: italic;
            font-size: 0.9em;
        }
        .page-section {
            border: 2px solid #e0e0e0;
            border-radius: 8px;
            padding: 0;
            margin-bottom: 30px;
            background: #fafafa;
            scroll-margin-top: 20px;
        }
        .page-summary {
            background: #4338ca;
            color: white;
            padding: 20px;
            border-radius: 6px 6px 0 0;
            cursor: pointer;
            list-style: none;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 600;
            font-size: 1.1em;
            transition: all 0.3s;
            user-select: none;
        }
        .page-summary::-webkit-details-marker {
            display: none;
        }
        .page-summary::before {
            content: '▼';
            margin-right: 12px;
            transition: transform 0.3s;
            display: inline-block;
        }
        details[open] .page-summary::before {
            transform: rotate(-180deg);
        }
        .page-summary:hover {
            background: #3730a3;
        }
        .page-summary:focus-visible {
            outline: 3px solid #005fcc;
            outline-offset: 2px;
        }
        .page-summary-title {
            flex: 1;
        }
        .page-summary-stats {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .page-content {
            padding: 20px;
        }
        .page-title {
            color: #667eea;
            margin-top: 0;
        }
        .violation {
            background: white;
            border-left: 4px solid #f5576c;
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 4px;
        }
        .violation-critical {
            border-left-color: #dc2626;
        }
        .violation-serious {
            border-left-color: #ea580c;
        }
        .violation-moderate {
            border-left-color: #eab308;
        }
        .violation-minor {
            border-left-color: #3b82f6;
        }
        .violation-header {
            font-weight: bold;
            margin: 0 0 10px 0;
            font-size: 1.05em;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .impact {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.85em;
            font-weight: bold;
            text-transform: uppercase;
        }
        .impact-critical {
            background: #dc2626;
            color: white;
        }
        .impact-serious {
            background: #c2410c;
            color: white;
        }
        .impact-moderate {
            background: #eab308;
            color: #000;
        }
        .impact-minor {
            background: #2563eb;
            color: white;
        }
        .node {
            background: #2c3e50;
            color: white;
            padding: 8px 12px;
            margin: 5px 0;
            font-family: monospace;
            font-size: 0.9em;
            border-radius: 4px;
            overflow-x: auto;
        }
        .no-violations {
            background: #1b7a43;
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            font-size: 1.2em;
        }
        .ai-section {
            background: #4338ca;
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin-top: 30px;
        }
        .ai-section h2 {
            margin-top: 0;
            color: white;
        }
        .ai-section-error {
            margin: 30px 0;
            padding: 20px;
            background: #f39c12;
            border-radius: 8px;
            color: white;
        }
        .ai-metadata {
            background: rgba(255,255,255,0.1);
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        .ai-rule-analysis {
            background: white;
            color: #333;
            margin: 15px 0;
            padding: 20px;
            border-radius: 5px;
            border-left: 4px solid #667eea;
        }
        .ai-rule-analysis.non-compliant {
            border-left-color: #e74c3c;
        }
        .ai-rule-analysis.compliant {
            border-left-color: #27ae60;
        }
        .ai-rule-analysis h3 {
            margin-top: 0;
        }
        .ai-summary {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin: 10px 0;
        }
        .severity-critical {
            border-left: 3px solid #c0392b;
        }
        .severity-serious {
            border-left: 3px solid #e67e22;
        }
        .severity-moderate {
            border-left: 3px solid #f39c12;
        }
        .severity-minor {
            border-left: 3px solid #3498db;
        }
        .intelligent-analysis {
            background: #e8f4f8;
            padding: 15px;
            border-radius: 5px;
            margin: 15px 0;
        }
        .intelligent-analysis h4 {
            margin-top: 0;
            color: #2c3e50;
        }
        .ai-findings {
            margin-top: 15px;
        }
        .ai-findings h4 {
            color: #2c3e50;
        }
        .ai-finding {
            background: #fff;
            border: 1px solid #ddd;
            padding: 15px;
            margin: 10px 0;
            border-radius: 5px;
        }
        .finding-violation {
            border-left: 4px solid #e74c3c;
        }
        .finding-warning {
            border-left: 4px solid #f39c12;
        }
        .finding-recommendation {
            border-left: 4px solid #3498db;
        }
        .error-message {
            color: white;
            font-weight: bold;
        }
        code {
            background: #f5f5f5;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: 'Courier New', monospace;
        }
        /* ===== Accessibilité (RGAA / WCAG) ===== */
        .skip-link {
            position: absolute;
            left: -9999px;
            top: 0;
            z-index: 1100;
            background: #005fcc;
            color: #fff;
            padding: 10px 16px;
            font-weight: 600;
            border-radius: 0 0 6px 0;
            text-decoration: none;
        }
        .skip-link:focus { left: 0; }
        .sr-only {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0 0 0 0);
            white-space: nowrap;
            border: 0;
        }
        a:focus-visible,
        button:focus-visible,
        summary:focus-visible,
        details:focus-visible,
        [tabindex]:focus-visible {
            outline: 3px solid #005fcc;
            outline-offset: 2px;
        }
        table caption {
            caption-side: top;
            text-align: left;
            font-weight: 600;
            color: #1e293b;
            padding: 8px 4px;
        }
        .ai-disclaimer {
            margin-top: 25px;
            padding: 18px 22px;
            background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
            border: 1px solid #f59e0b;
            border-left: 5px solid #f59e0b;
            border-radius: 8px;
            display: flex;
            align-items: flex-start;
            gap: 14px;
            text-align: left;
        }
        .ai-disclaimer-icon { font-size: 1.5em; line-height: 1; flex-shrink: 0; }
        .ai-disclaimer-text {
            flex: 1;
            color: #78350f;
            font-size: 0.95em;
            line-height: 1.5;
        }
        .page-screenshot { margin: 15px 0; }
        .page-screenshot-summary {
            cursor: pointer;
            font-weight: bold;
            padding: 8px 0;
            color: #333;
        }
        .page-screenshot-img {
            max-width: 100%;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-top: 8px;
        }
        .ai-summary-na { background: #ecf0f1; color: #4a5a68; }
        .ai-rule-analysis.non-applicable {
            border-left-color: #5d6d7e;
            background: #f8f9fa;
        }
        .ai-error-section {
            margin: 20px 0;
            padding: 20px;
            border: 2px solid var(--err-color, #95a5a6);
            border-radius: 12px;
            background: #fff;
        }
        .ai-error-title { color: #2c3e50; margin-top: 0; }
        .ai-error-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
            border-left: 4px solid var(--err-color, #95a5a6);
        }
        .ai-error-badge {
            display: inline-block;
            background: #2c3e50;
            color: #fff;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .ai-error-timestamp { color: #555; font-size: 0.85em; }
        .ai-error-suggestions {
            background: #f0f8ff;
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
        }
        .ai-error-suggestions h3 { margin-top: 0; color: #2c3e50; }
        .ai-error-note {
            margin: 10px 0 0 0;
            padding: 10px;
            background: #fff3cd;
            border-radius: 6px;
            font-size: 0.9em;
            color: #664d03;
        }
        .page-score {
            background: var(--level-color, #0066cc);
            color: #1a1a1a;
            padding: 4px 12px;
            border-radius: 12px;
            font-weight: bold;
            margin: 0 8px;
        }
        .page-rgaa-stats { font-size: 0.95em; margin-left: 12px; color: #fff; }
        .rgaa-count { color: #fff; font-weight: 700; }
        /* Level colours carried as classes (no inline styles — RGAA 10.x) */
        .lvl-excellent { --level-color: #27ae60; }
        .lvl-bon { --level-color: #2ecc71; }
        .lvl-moyen { --level-color: #f39c12; }
        .lvl-faible { --level-color: #e67e22; }
        .lvl-critique { --level-color: #e74c3c; }
        /* Responsive data tables: any overflow stays inside the box, the page
           itself never scrolls horizontally; the table keeps its natural size. */
        .table-wrap {
            max-width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }
        /* Long URLs / words wrap instead of forcing horizontal page scroll */
        .page-content { overflow-wrap: anywhere; }
        .page-summary-title { overflow-wrap: anywhere; min-width: 0; }
        .header { overflow-wrap: anywhere; }
        /* Narrow screens (≈320px): keep the page free of horizontal scroll */
        @media (max-width: 480px) {
            body { padding: 8px; }
            .container { padding: 14px; }
            .header { padding: 18px; }
            .summary { gap: 12px; }
            .page-summary { flex-wrap: wrap; gap: 8px; }
            .page-summary-stats { flex-wrap: wrap; }
            .page-content { padding: 12px; }
        }`;
