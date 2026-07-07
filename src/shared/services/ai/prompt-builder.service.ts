import * as cheerio from 'cheerio';

import type { IRGAARule } from '@shared/types/rgaa-rules.types.js';
import type { IAxeResult } from '@shared/types/audit.types.js';

/**
 * Service that builds prompts for the AI
 */
export class PromptBuilderService {
  /**
   * Builds the system prompt for RGAA analysis
   */
  buildSystemPrompt(rule: IRGAARule): string {
    const config = rule.aiAnalysisConfig;

    if (!config.analysisPrompt) {
      throw new Error(`Rule ${rule.id}: analysisPrompt missing`);
    }

    if (!config.analysisPrompt.outputFormat) {
      throw new Error(`Rule ${rule.id}: outputFormat missing`);
    }

    const outputStructure = config.analysisPrompt.outputFormat.structure;
    const findingsFormat = config.analysisPrompt.outputFormat.findingsFormat;
    const important = config.analysisPrompt.important ?? [];

    if (!outputStructure) {
      throw new Error(`Rule ${rule.id}: structure missing in outputFormat`);
    }

    if (!findingsFormat) {
      throw new Error(
        `Rule ${rule.id}: findingsFormat missing in outputFormat`,
      );
    }

    const systemRole = config.systemRole ?? '';

    return `${systemRole}

**Règle RGAA à analyser** : ${rule.id} - ${rule.title}
**Référence WCAG** : ${rule.wcagReference ?? ''}
**Niveau** : ${rule.level ?? ''}

**Tâches** :
${(config.analysisPrompt.tasks ?? []).map((task, i) => `${(i + 1).toString()}. ${task}`).join('\n')}

**Format de sortie JSON STRICT** :
${JSON.stringify(outputStructure, null, 2)}

**Format des findings** :
${JSON.stringify(findingsFormat, null, 2)}

**⚠️ IMPORTANT** :
${important.map((imp) => `- ${imp}`).join('\n')}

Tu dois retourner **UNIQUEMENT** un objet JSON valide, sans texte avant ou après.`;
  }

  /**
   * Builds the user prompt with context
   */
  /**
   * Truncates a string to a maximum length
   */
  private truncate(str: string, maxLength: number): string {
    if (!str || str.length <= maxLength) {
      return str || '';
    }
    return `${str.substring(0, maxLength)}\n\n... [CONTENU TRONQUÉ POUR IA] ...`;
  }

  /**
   * Builds the system prompt for BATCH analysis (several rules of one theme)
   */
  buildBatchSystemPrompt(rules: IRGAARule[], categoryName: string): string {
    const rulesCount = rules.length;
    const ruleIds = rules.map((r) => `"${r.ruleId}"`).join(', ');

    const rulesSummary = rules
      .map((rule) => {
        const tasks = rule.aiAnalysisConfig.analysisPrompt?.tasks ?? [];
        const nonApplicable =
          rule.applicability?.nonApplicableCases.join(', ') ?? '';
        const tasksList = tasks
          .map((t, i) => `  ${(i + 1).toString()}. ${t}`)
          .join('\n');
        return `### Règle ${rule.id} - ${rule.title}
ruleId: "${rule.ruleId}" | WCAG: ${rule.wcagReference ?? 'N/A'} | Niveau: ${rule.level ?? 'A'}
Description: ${rule.description}
Tâches:
${tasksList}${nonApplicable ? `\nNon applicable si: ${nonApplicable}` : ''}`;
      })
      .join('\n\n');

    // Warning-in-doubt is desirable ONLY for Images (avoids false positives on
    // decorative/ambiance illustrations). Every other thematic is strict:
    // objective defects must be violations, so the score is not inflated by
    // warnings that mask real non-conformities.
    const isImagesCategory = categoryName.toLowerCase().includes('image');
    const doubtPolicy = isImagesCategory
      ? `- VIOLATION (type="violation") réservée aux défauts OBJECTIFS vérifiables dans le DOM.
- DOUTE → WARNING : si la conformité dépend d'une APPRÉCIATION ou ne peut pas être tranchée avec certitude, émettre type="warning" (VÉRIFICATION MANUELLE) au lieu d'une violation ferme.
- Ne jamais inventer de violation : en l'absence de défaut objectif, conclure conforme ou émettre un warning.`
      : `- EXIGENCE : tout défaut d'accessibilité OBJECTIF, constaté ou probable d'après le DOM, doit être signalé en type="violation".
- N'utiliser type="warning" QUE pour un point réellement impossible à trancher automatiquement (jugement éditorial humain indispensable) ; ne JAMAIS employer warning pour minorer ou masquer un défaut avéré.
- Ne pas inventer de violation sans indice dans la page ; mais en cas de doute sérieux sur un défaut, privilégier la VIOLATION à l'avertissement.`;

    return `Tu es un expert en accessibilité numérique RGAA 4.1.2.
Analyse la conformité d'une page web pour les ${rulesCount.toString()} règles RGAA de la thématique "${categoryName}".

${rulesSummary}

---

FORMAT DE RÉPONSE JSON STRICT :
Retourne un objet JSON avec un tableau "analyses" contenant exactement ${rulesCount.toString()} entrées (une par règle) :
{
  "analyses": [
    {
      "ruleId": "[identifiant parmi: ${ruleIds}]",
      "compliant": true,
      "severity": "none",
      "summary": "Résumé concis (max 200 chars)",
      "totalElements": 0,
      "findings": [
        {
          "type": "violation",
          "element": "sélecteur CSS ou null",
          "issue": "Description du problème (max 200 chars)",
          "recommendation": "Comment corriger avec exemple HTML",
          "wcagReference": "1.1.1 ou null"
        }
      ]
    }
  ]
}

RÈGLES IMPORTANTES :
- Analyser chaque règle INDÉPENDAMMENT
- DÉTERMINISME : fonder chaque verdict sur des SIGNAUX MÉCANIQUES du DOM (présence/absence d'attributs, rôles, relations entre éléments) plutôt que sur une supposition. À signaux identiques, rendre le même verdict.
${doubtPolicy}
- Maximum 3 findings par règle
- Si règle non applicable : compliant=true, severity="none", findings=[]
- Si conforme : compliant=true, severity="none"
- Le tableau "analyses" doit contenir exactement ${rulesCount.toString()} objets
- Retourner UNIQUEMENT du JSON valide, sans texte ni markdown`;
  }

  /**
   * Builds the user prompt for BATCH analysis
   */
  buildBatchUserPrompt(
    rules: IRGAARule[],
    dom: string,
    axeResults: IAxeResult,
    screenshot?: string,
    options?: { domLimit?: number; axeLimit?: number },
  ): string {
    const domLimit = options?.domLimit ?? 12000;
    const axeLimit = options?.axeLimit ?? 5000;
    const truncatedDOM = this.truncate(dom, domLimit);
    const truncatedAxe = this.truncate(
      JSON.stringify(axeResults.violations, null, 2),
      axeLimit,
    );

    // Extract the relevant elements from the FULL DOM by theme (before truncation)
    const theme = rules[0]?.theme ?? '';
    const themeElements = this.extractThemeElements(dom, theme);

    const rulesList = rules.map((r) => `- ${r.ruleId}: ${r.title}`).join('\n');

    const commonErrorsSummary = rules
      .flatMap((r) =>
        r.commonErrors.map((e) => `[${r.ruleId}] ${e.error}: ${e.explanation}`),
      )
      .join('\n');

    let prompt = `# Analyse RGAA - ${rules.length.toString()} règles

## Règles à analyser
${rulesList}

## Erreurs courantes à détecter
${commonErrorsSummary}
${themeElements}
## DOM de la page (extrait)
\`\`\`html
${truncatedDOM}
\`\`\`

## Violations Axe-Core détectées
\`\`\`json
${truncatedAxe}
\`\`\`
`;

    if (screenshot != null && screenshot !== '') {
      prompt += `\n## Capture d'écran de la page
La capture d'écran complète est jointe à ce message. Utilise-la pour analyser visuellement les éléments de la page.
`;
    }

    prompt += `\n## Instructions
1. Analyser les éléments extraits, le DOM et les violations Axe-Core pour CHAQUE règle listée
2. Déterminer la conformité et générer des findings concrets et actionnables
3. Retourner UNIQUEMENT le JSON avec le tableau "analyses" (${rules.length.toString()} entrées)`;

    return prompt;
  }

  /**
   * Extracts the relevant HTML elements from the full DOM by RGAA theme.
   * Uses cheerio (a real HTML parser) to avoid the false positives of
   * regex/indexOf approaches on comments, nested attributes, etc.
   */
  /** Mapping from theme keywords to their CSS selectors and display label. */
  private static readonly THEME_SELECTOR_MAP: readonly {
    keywords: readonly string[];
    label: string;
    selectors: readonly { css: string; max: number; maxLen?: number }[];
  }[] = [
    {
      keywords: ['image'],
      label: 'Images',
      selectors: [
        { css: 'img', max: 50 },
        { css: 'svg', max: 10, maxLen: 1000 },
        { css: '[type="image"]', max: 10 },
      ],
    },
    {
      keywords: ['lien'],
      label: 'Liens <a>',
      selectors: [{ css: 'a', max: 30, maxLen: 500 }],
    },
    {
      keywords: ['formulair'],
      label: 'Éléments de formulaire',
      selectors: [
        { css: 'input', max: 30 },
        { css: 'select', max: 10 },
        { css: 'textarea', max: 10, maxLen: 500 },
        { css: 'label', max: 20, maxLen: 300 },
        { css: 'button', max: 15, maxLen: 300 },
        { css: 'fieldset', max: 5 },
      ],
    },
    {
      keywords: ['tableau'],
      label: 'Tableaux',
      selectors: [{ css: 'table', max: 5, maxLen: 3000 }],
    },
    {
      keywords: ['structur'],
      label: 'Titres h1-h6',
      selectors: [
        { css: 'h1', max: 10, maxLen: 500 },
        { css: 'h2', max: 10, maxLen: 500 },
        { css: 'h3', max: 10, maxLen: 500 },
        { css: 'h4', max: 10, maxLen: 500 },
        { css: 'h5', max: 10, maxLen: 500 },
        { css: 'h6', max: 10, maxLen: 500 },
      ],
    },
    {
      keywords: ['multim', 'vidéo', 'audio'],
      label: 'Éléments multimédia',
      selectors: [
        { css: 'video', max: 5, maxLen: 1000 },
        { css: 'audio', max: 5, maxLen: 500 },
        { css: 'source', max: 10 },
        { css: 'track', max: 10 },
        { css: 'iframe', max: 5 },
      ],
    },
    {
      keywords: ['navigat'],
      label: 'Éléments de navigation',
      selectors: [
        { css: 'nav', max: 5, maxLen: 1000 },
        { css: '[role="navigation"]', max: 10 },
      ],
    },
    {
      keywords: ['script'],
      label: 'Éléments interactifs',
      selectors: [
        { css: '[onclick]', max: 20 },
        { css: '[role="button"]', max: 5 },
        { css: '[role="link"]', max: 5 },
        { css: '[role="tab"]', max: 5 },
        { css: '[tabindex]', max: 20 },
      ],
    },
  ];

  private extractThemeElements(dom: string, theme: string): string {
    const t = theme.toLowerCase();
    const $ = cheerio.load(dom, { xml: { xmlMode: false } });

    /** Serializes the outerHTML of matched elements, truncated if needed. */
    const collect = (
      selector: string,
      max: number,
      maxContentLength = 0,
    ): string[] => {
      const results: string[] = [];
      $(selector)
        .slice(0, max)
        .each((_, el) => {
          let html = $.html(el);
          if (maxContentLength > 0 && html.length > maxContentLength) {
            html = `${html.substring(0, maxContentLength)}... [TRONQUÉ]`;
          }
          results.push(html);
        });
      return results;
    };

    const match = PromptBuilderService.THEME_SELECTOR_MAP.find((entry) =>
      entry.keywords.some((kw) => t.includes(kw)),
    );
    if (!match) return '';

    const label = match.label;
    let elements: string[] = match.selectors.flatMap((s) =>
      collect(s.css, s.max, s.maxLen ?? 0),
    );

    if (elements.length === 0) return '';

    // Global per-theme budget: limit the total of extracted elements
    const MAX_THEME_ELEMENTS_CHARS = 15000;
    let totalLength = 0;
    const trimmedElements: string[] = [];
    for (const el of elements) {
      if (totalLength + el.length > MAX_THEME_ELEMENTS_CHARS) {
        trimmedElements.push(
          `<!-- ... ${(elements.length - trimmedElements.length).toString()} éléments supplémentaires tronqués -->`,
        );
        break;
      }
      trimmedElements.push(el);
      totalLength += el.length;
    }
    elements = trimmedElements;

    return `\n## ${label} détectés dans la page (${elements.length.toString()} éléments, extraction complète du DOM)\n\`\`\`html\n${elements.join('\n')}\n\`\`\`\n`;
  }

  /**
   * Extracts the context of an element from the DOM
   */
  extractElementContext(
    dom: string,
    selector: string,
    contextRadius = 200,
  ): string {
    try {
      // Search for the element in the DOM
      const regex = new RegExp(
        `(.{0,${contextRadius.toString()}})${this.escapeRegex(selector)}(.{0,${contextRadius.toString()}})`,
        'i',
      );
      const match = dom.match(regex);

      if (match) {
        return match[0];
      }

      return `Element ${selector} not found in the DOM`;
    } catch {
      return `Error extracting context for ${selector}`;
    }
  }

  /**
   * Escapes a string for use in a regex
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
