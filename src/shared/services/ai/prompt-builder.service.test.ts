import { describe, it, expect, beforeEach } from 'vitest';

import { PromptBuilderService } from './prompt-builder.service.js';
import type { IRGAARule } from '@shared/types/rgaa-rules.types.js';
import type { IAxeResult } from '@shared/types/audit.types.js';

// ---------------------------------------------------------------------------
// Helpers & Mocks
// ---------------------------------------------------------------------------

function createMockRule(overrides: Partial<IRGAARule> = {}): IRGAARule {
  return {
    id: '1.1',
    ruleId: 'image-alt',
    title: 'Chaque image a-t-elle une alternative textuelle ?',
    description:
      "Vérifier que chaque image de la page dispose d'un attribut alt pertinent.",
    rgaaReference: 'RGAA 4.1.2 - Critère 1.1',
    wcagReference: '1.1.1',
    theme: 'Images',
    level: 'A',
    applicability: {
      description: 'Toute page contenant des images',
      signals: {
        selectors: ['img', 'svg', 'input[type=image]'],
        minimumCount: 1,
      },
      nonApplicableCases: ['Aucune image présente dans la page'],
    },
    testScenarios: {
      'scenario-1': {
        description: "Vérifier la présence de l'attribut alt",
        tests: [
          {
            id: 'test-1.1.1',
            rgaaTestRef: 'Test 1.1.1',
            description: "L'image a un attribut alt",
            selector: 'img',
            expected: "L'attribut alt est présent",
            severity: 'critical',
          },
        ],
      },
    },
    aiAnalysisConfig: {
      enabled: true,
      systemRole: 'Tu es un expert en accessibilité numérique RGAA 4.1.2.',
      inputs: { dom: true, screenshots: true, ruleMetadata: true },
      analysisPrompt: {
        tasks: [
          'Identifier toutes les images sans alt',
          'Vérifier la pertinence des textes alt existants',
          'Détecter les images décoratives sans role="presentation"',
        ],
        important: [
          'Retourne UNIQUEMENT du JSON valide',
          'Maximum 5 findings par analyse',
        ],
        outputFormat: {
          description: "Format de sortie pour l'analyse",
          strictJsonOnly: true,
          structure: {
            compliant: 'boolean',
            severity: 'none | minor | moderate | serious | critical',
            summary: 'string (max 200 chars)',
            totalElements: 'number',
            findings: 'array',
          },
          findingsFormat: {
            type: 'violation | warning | recommendation',
            element: 'CSS selector or null',
            issue: 'string (max 200 chars)',
            recommendation: 'string',
            wcagReference: 'string or null',
          },
        },
      },
      correctionSuggestions: {
        enabled: true,
        includeCodeExamples: true,
        prioritization: 'severity',
      },
    },
    automatedChecks: ['img[alt]', 'img:not([alt])'],
    manualChecks: ['Vérifier la pertinence du texte alternatif'],
    commonErrors: [
      {
        error: 'Image sans attribut alt',
        example: '<img src="photo.jpg">',
        correction: '<img src="photo.jpg" alt="Description de la photo">',
        explanation:
          'Toute image informative doit avoir un attribut alt décrivant son contenu.',
      },
      {
        error: 'Alt non pertinent',
        example: '<img src="logo.png" alt="image">',
        correction: '<img src="logo.png" alt="Logo de l\'entreprise Acme">',
        explanation:
          "Le texte alternatif doit décrire précisément le contenu de l'image.",
      },
    ],
    resources: [
      'https://www.numerique.gouv.fr/publications/rgaa-accessibilite/methode-rgaa/criteres/#crit-1-1',
    ],
    ...overrides,
  };
}

function createMockAxeResult(
  violations: IAxeResult['violations'] = [],
): IAxeResult {
  return {
    url: 'https://example.com',
    timestamp: '2026-03-30T10:00:00Z',
    testInfo: {
      userAgent: 'Mozilla/5.0',
      viewport: { width: 1920, height: 1080 },
      title: 'Page de test',
    },
    summary: {
      violations: violations.length,
      passes: 5,
      incomplete: 0,
      inapplicable: 2,
    },
    violations,
    passes: [],
    incomplete: [],
    inapplicable: [],
  };
}

const SAMPLE_DOM = `<html>
<head><title>Page Test</title></head>
<body>
  <header>
    <nav>
      <ul>
        <li><a href="/">Accueil</a></li>
        <li><a href="/about">À propos</a></li>
      </ul>
    </nav>
  </header>
  <main>
    <h1>Titre principal</h1>
    <img src="photo.jpg" alt="Une belle photo">
    <img src="decorative.png">
    <form>
      <label for="email">Email</label>
      <input type="email" id="email" name="email">
      <button type="submit">Envoyer</button>
    </form>
    <table>
      <tr><th>Nom</th><th>Âge</th></tr>
      <tr><td>Alice</td><td>30</td></tr>
    </table>
    <video controls><source src="video.mp4" type="video/mp4"><track kind="subtitles" srclang="fr"></video>
    <audio controls><source src="audio.mp3" type="audio/mpeg"></audio>
    <iframe src="https://example.com/embed"></iframe>
    <div onclick="doSomething()">Clickable</div>
    <div role="button" tabindex="0">Fake button</div>
    <div role="dialog">Dialog content</div>
    <a href="#content" class="skip">Aller au contenu</a>
    <div role="navigation">Secondary nav</div>
    <svg><title>Icon</title></svg>
    <input type="image" src="submit.png" alt="Submit">
  </main>
</body>
</html>`;

const SAMPLE_VIOLATIONS: IAxeResult['violations'] = [
  {
    id: 'image-alt',
    impact: 'critical',
    description: 'Images must have alternate text',
    help: 'Images must have alternate text',
    helpUrl: 'https://dequeuniversity.com/rules/axe/4.6/image-alt',
    tags: ['wcag2a', 'wcag111'],
    nodes: [
      {
        html: '<img src="decorative.png">',
        target: ['img:nth-child(2)'],
        failureSummary:
          'Fix any of the following: Element does not have an alt attribute',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptBuilderService', () => {
  let service: PromptBuilderService;

  beforeEach(() => {
    service = new PromptBuilderService();
  });

  // =========================================================================
  // buildSystemPrompt
  // =========================================================================
  describe('buildSystemPrompt', () => {
    it('should build a system prompt using the new format (structure/findingsFormat)', () => {
      const rule = createMockRule();
      const prompt = service.buildSystemPrompt(rule);

      expect(prompt).toContain(
        'Tu es un expert en accessibilité numérique RGAA 4.1.2.',
      );
      expect(prompt).toContain(
        '**Règle RGAA à analyser** : 1.1 - Chaque image a-t-elle une alternative textuelle ?',
      );
      expect(prompt).toContain('**Référence WCAG** : 1.1.1');
      expect(prompt).toContain('**Niveau** : A');
      expect(prompt).toContain('1. Identifier toutes les images sans alt');
      expect(prompt).toContain(
        '2. Vérifier la pertinence des textes alt existants',
      );
      expect(prompt).toContain(
        '3. Détecter les images décoratives sans role="presentation"',
      );
      expect(prompt).toContain('"compliant"');
      expect(prompt).toContain('"severity"');
      expect(prompt).toContain('**Format des findings**');
      expect(prompt).toContain('Maximum 5 findings par analyse');
      expect(prompt).toContain(
        'Tu dois retourner **UNIQUEMENT** un objet JSON valide',
      );
    });

    it('should use config.systemRole', () => {
      const rule = createMockRule();
      const prompt = service.buildSystemPrompt(rule);

      expect(prompt).toContain(
        'Tu es un expert en accessibilité numérique RGAA 4.1.2.',
      );
    });

    it('should fallback to empty string when no systemRole is defined', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          enabled: true,
          analysisPrompt: {
            tasks: ['Analyser'],
            outputFormat: {
              structure: { result: 'string' },
              findingsFormat: { type: 'string' },
            },
          },
        },
      });
      const prompt = service.buildSystemPrompt(rule);

      // Prompt starts with empty systemRole followed by two newlines
      expect(prompt).toMatch(/^\s*\n/);
    });

    it('should throw when analysisPrompt is missing', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          enabled: true,
          analysisPrompt: undefined,
        },
      });

      expect(() => service.buildSystemPrompt(rule)).toThrow(
        'Rule 1.1: analysisPrompt missing',
      );
    });

    it('should throw when outputFormat is missing', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          enabled: true,
          analysisPrompt: {
            tasks: ['Analyser'],
            outputFormat: undefined,
          },
        },
      });

      expect(() => service.buildSystemPrompt(rule)).toThrow(
        'Rule 1.1: outputFormat missing',
      );
    });

    it('should throw when structure is missing', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          enabled: true,
          analysisPrompt: {
            tasks: ['Analyser'],
            outputFormat: {
              findingsFormat: { type: 'string' },
            },
          },
        },
      });

      expect(() => service.buildSystemPrompt(rule)).toThrow(
        'Rule 1.1: structure missing in outputFormat',
      );
    });

    it('should throw when findingsFormat is missing', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          enabled: true,
          analysisPrompt: {
            tasks: ['Analyser'],
            outputFormat: {
              structure: { result: 'string' },
            },
          },
        },
      });

      expect(() => service.buildSystemPrompt(rule)).toThrow(
        'Rule 1.1: findingsFormat missing in outputFormat',
      );
    });

    it('should handle missing wcagReference and level gracefully', () => {
      const rule = createMockRule({ wcagReference: null, level: null });
      const prompt = service.buildSystemPrompt(rule);

      expect(prompt).toContain('**Référence WCAG** : ');
      expect(prompt).toContain('**Niveau** : ');
    });

    it('should handle empty tasks array', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          ...createMockRule().aiAnalysisConfig,
          analysisPrompt: {
            ...createMockRule().aiAnalysisConfig.analysisPrompt,
            tasks: [],
          },
        },
      });
      const prompt = service.buildSystemPrompt(rule);

      expect(prompt).toContain('**Tâches** :\n');
    });

    it('should read important from analysisPrompt', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          enabled: true,
          analysisPrompt: {
            systemRole: 'Expert',
            tasks: ['Analyser'],
            important: ['Ne retourne que du JSON', 'Pas de markdown'],
            outputFormat: {
              structure: { result: 'string' },
              findingsFormat: { type: 'string' },
              // No important here - should fall back to analysisPrompt.important
            },
          },
        },
      });
      const prompt = service.buildSystemPrompt(rule);

      expect(prompt).toContain('- Ne retourne que du JSON');
      expect(prompt).toContain('- Pas de markdown');
    });

    it('should default important to empty array when neither location has it', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          enabled: true,
          analysisPrompt: {
            tasks: ['Analyser'],
            outputFormat: {
              structure: { result: 'string' },
              findingsFormat: { type: 'string' },
            },
          },
        },
      });
      const prompt = service.buildSystemPrompt(rule);

      // important section should be present but empty
      expect(prompt).toContain('**\u26A0\uFE0F IMPORTANT** :\n');
    });
  });

  // =========================================================================
  // buildBatchSystemPrompt
  // =========================================================================
  describe('buildBatchSystemPrompt', () => {
    it('should build a batch system prompt for multiple rules', () => {
      const rules = [
        createMockRule({
          id: '1.1',
          ruleId: 'image-alt',
          title: 'Alternative textuelle',
        }),
        createMockRule({
          id: '1.2',
          ruleId: 'image-decorative',
          title: 'Image décorative',
          wcagReference: '1.1.1',
          level: 'A',
        }),
      ];
      const prompt = service.buildBatchSystemPrompt(rules, 'Images');

      expect(prompt).toContain(
        'Tu es un expert en accessibilité numérique RGAA 4.1.2.',
      );
      expect(prompt).toContain('2 règles RGAA de la thématique "Images"');
      expect(prompt).toContain('### Règle 1.1 - Alternative textuelle');
      expect(prompt).toContain('### Règle 1.2 - Image décorative');
      expect(prompt).toContain('ruleId: "image-alt"');
      expect(prompt).toContain('ruleId: "image-decorative"');
      expect(prompt).toContain('"image-alt", "image-decorative"');
      expect(prompt).toContain('exactement 2 entrées');
      expect(prompt).toContain('exactement 2 objets');
      expect(prompt).toContain('FORMAT DE RÉPONSE JSON STRICT');
      expect(prompt).toContain('Maximum 3 findings par règle');
      expect(prompt).toContain('UNIQUEMENT du JSON valide');
    });

    it('should include task details for each rule', () => {
      const rule = createMockRule();
      const prompt = service.buildBatchSystemPrompt([rule], 'Images');

      expect(prompt).toContain('Tâches:');
      expect(prompt).toContain('1. Identifier toutes les images sans alt');
      expect(prompt).toContain(
        '2. Vérifier la pertinence des textes alt existants',
      );
    });

    it('should include non-applicable cases when applicability is defined', () => {
      const rule = createMockRule();
      const prompt = service.buildBatchSystemPrompt([rule], 'Images');

      expect(prompt).toContain(
        'Non applicable si: Aucune image présente dans la page',
      );
    });

    it('should handle rules without applicability', () => {
      const rule = createMockRule({ applicability: undefined });
      const prompt = service.buildBatchSystemPrompt([rule], 'Images');

      expect(prompt).not.toContain('Non applicable si:');
    });

    it('should handle rules with empty tasks', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          ...createMockRule().aiAnalysisConfig,
          analysisPrompt: {
            ...createMockRule().aiAnalysisConfig.analysisPrompt,
            tasks: [],
          },
        },
      });
      const prompt = service.buildBatchSystemPrompt([rule], 'Images');

      expect(prompt).toContain('Tâches:\n');
    });

    it('should handle rules without analysisPrompt.tasks', () => {
      const rule = createMockRule({
        aiAnalysisConfig: {
          enabled: true,
          analysisPrompt: {
            outputFormat: {
              structure: { result: 'string' },
              findingsFormat: { type: 'string' },
            },
          },
        },
      });
      const prompt = service.buildBatchSystemPrompt([rule], 'Images');

      // tasks defaults to [] via nullish coalescing
      expect(prompt).toContain('Tâches:\n');
    });

    it('should handle a single rule', () => {
      const rule = createMockRule();
      const prompt = service.buildBatchSystemPrompt([rule], 'Images');

      expect(prompt).toContain('1 règles RGAA de la thématique "Images"');
      expect(prompt).toContain('exactement 1 entrées');
    });

    it('should show WCAG reference and level for each rule', () => {
      const rule = createMockRule({ wcagReference: '4.1.2', level: 'AA' });
      const prompt = service.buildBatchSystemPrompt([rule], 'Formulaires');

      expect(prompt).toContain('WCAG: 4.1.2');
      expect(prompt).toContain('Niveau: AA');
    });

    it('should default WCAG to N/A and level to A when null', () => {
      const rule = createMockRule({ wcagReference: null, level: null });
      const prompt = service.buildBatchSystemPrompt([rule], 'Images');

      expect(prompt).toContain('WCAG: N/A');
      expect(prompt).toContain('Niveau: A');
    });
  });

  // =========================================================================
  // buildBatchUserPrompt
  // =========================================================================
  describe('buildBatchUserPrompt', () => {
    it('should build a complete batch user prompt', () => {
      const rules = [
        createMockRule({ id: '1.1', ruleId: 'image-alt', title: 'Alt texte' }),
        createMockRule({
          id: '1.2',
          ruleId: 'image-decorative',
          title: 'Image décorative',
        }),
      ];
      const axeResult = createMockAxeResult(SAMPLE_VIOLATIONS);
      const prompt = service.buildBatchUserPrompt(rules, SAMPLE_DOM, axeResult);

      expect(prompt).toContain('# Analyse RGAA - 2 règles');
      expect(prompt).toContain('## Règles à analyser');
      expect(prompt).toContain('- image-alt: Alt texte');
      expect(prompt).toContain('- image-decorative: Image décorative');
      expect(prompt).toContain('## Erreurs courantes à détecter');
      expect(prompt).toContain('[image-alt] Image sans attribut alt');
      expect(prompt).toContain('## DOM de la page (extrait)');
      expect(prompt).toContain('## Violations Axe-Core détectées');
      expect(prompt).toContain('## Instructions');
      expect(prompt).toContain('2 entrées)');
    });

    it('should include screenshot section when screenshot is provided', () => {
      const rules = [createMockRule()];
      const axeResult = createMockAxeResult();
      const prompt = service.buildBatchUserPrompt(
        rules,
        SAMPLE_DOM,
        axeResult,
        'base64...',
      );

      expect(prompt).toContain("## Capture d'écran de la page");
      expect(prompt).toContain("capture d'écran complète est jointe");
    });

    it('should NOT include screenshot section when screenshot is absent', () => {
      const rules = [createMockRule()];
      const axeResult = createMockAxeResult();
      const prompt = service.buildBatchUserPrompt(rules, SAMPLE_DOM, axeResult);

      expect(prompt).not.toContain("Capture d'écran");
    });

    it('should truncate long DOM in batch prompt', () => {
      const rules = [createMockRule()];
      const axeResult = createMockAxeResult();
      const longDOM = 'y'.repeat(15000);
      const prompt = service.buildBatchUserPrompt(rules, longDOM, axeResult);

      expect(prompt).toContain('... [CONTENU TRONQUÉ POUR IA] ...');
      expect(prompt).not.toContain('y'.repeat(15000));
    });

    it('should truncate long Axe results in batch prompt', () => {
      const rules = [createMockRule()];
      const manyViolations: IAxeResult['violations'] = Array.from(
        { length: 50 },
        (_, i) => ({
          id: `rule-${i.toString()}`,
          impact: 'serious' as const,
          description: 'B'.repeat(100),
          help: 'Help text',
          helpUrl: 'https://example.com',
          tags: ['wcag2a'],
          nodes: [{ html: '<div>test</div>', target: ['div'] }],
        }),
      );
      const axeResult = createMockAxeResult(manyViolations);
      const prompt = service.buildBatchUserPrompt(
        rules,
        '<html></html>',
        axeResult,
      );

      expect(prompt).toContain('... [CONTENU TRONQUÉ POUR IA] ...');
    });

    it('should handle empty DOM', () => {
      const rules = [createMockRule()];
      const axeResult = createMockAxeResult();
      const prompt = service.buildBatchUserPrompt(rules, '', axeResult);

      expect(prompt).toContain('```html\n\n```');
    });

    it('should aggregate common errors from all rules', () => {
      const rule1 = createMockRule({
        ruleId: 'rule-a',
        commonErrors: [
          {
            error: 'Erreur A',
            example: '',
            correction: '',
            explanation: 'Explication A',
          },
        ],
      });
      const rule2 = createMockRule({
        ruleId: 'rule-b',
        commonErrors: [
          {
            error: 'Erreur B',
            example: '',
            correction: '',
            explanation: 'Explication B',
          },
        ],
      });
      const axeResult = createMockAxeResult();
      const prompt = service.buildBatchUserPrompt(
        [rule1, rule2],
        SAMPLE_DOM,
        axeResult,
      );

      expect(prompt).toContain('[rule-a] Erreur A: Explication A');
      expect(prompt).toContain('[rule-b] Erreur B: Explication B');
    });

    // -----------------------------------------------------------------------
    // Theme extraction via buildBatchUserPrompt (tests extractThemeElements)
    // -----------------------------------------------------------------------
    describe('theme-based element extraction (extractThemeElements)', () => {
      it('should extract image elements for "Images" theme', () => {
        const rules = [createMockRule({ theme: 'Images' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).toContain('## Images détectés dans la page');
        expect(prompt).toContain('<img src="photo.jpg" alt="Une belle photo">');
        expect(prompt).toContain('<img src="decorative.png">');
        expect(prompt).toContain('<svg>');
        expect(prompt).toContain('<input type="image"');
      });

      it('should extract link elements for "Liens" theme', () => {
        const rules = [createMockRule({ theme: 'Liens' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).toContain('## Liens <a> détectés dans la page');
        expect(prompt).toContain('<a href="/">Accueil</a>');
        expect(prompt).toContain('<a href="/about">À propos</a>');
      });

      it('should extract form elements for "Formulaires" theme', () => {
        const rules = [createMockRule({ theme: 'Formulaires' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).toContain(
          '## Éléments de formulaire détectés dans la page',
        );
        expect(prompt).toContain(
          '<input type="email" id="email" name="email">',
        );
        expect(prompt).toContain('<label for="email">Email</label>');
        expect(prompt).toContain('<button type="submit">Envoyer</button>');
      });

      it('should extract table elements for "Tableaux" theme', () => {
        const rules = [createMockRule({ theme: 'Tableaux' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).toContain('## Tableaux détectés dans la page');
        expect(prompt).toContain('<table>');
        expect(prompt).toContain('</table>');
      });

      it('should extract heading elements for "Structuration" theme', () => {
        const rules = [
          createMockRule({ theme: "Structuration de l'information" }),
        ];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).toContain('## Titres h1-h6 détectés dans la page');
        expect(prompt).toContain('<h1>Titre principal</h1>');
      });

      it('should extract multimedia elements for "Multimédia" theme', () => {
        const rules = [createMockRule({ theme: 'Multimédia' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).toContain(
          '## Éléments multimédia détectés dans la page',
        );
        expect(prompt).toContain('<video controls>');
        expect(prompt).toContain('<audio controls>');
        expect(prompt).toContain('<source src="video.mp4"');
        expect(prompt).toContain('<track kind="subtitles"');
        expect(prompt).toContain('<iframe src="https://example.com/embed">');
      });

      it('should extract navigation elements for "Navigation" theme', () => {
        const rules = [createMockRule({ theme: 'Navigation' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).toContain(
          '## Éléments de navigation détectés dans la page',
        );
        expect(prompt).toContain('<nav>');
        expect(prompt).toContain('role="navigation"');
        expect(prompt).toContain('Aller au contenu');
      });

      it('should extract interactive elements for "Scripts" theme', () => {
        const rules = [createMockRule({ theme: 'Scripts' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).toContain(
          '## Éléments interactifs détectés dans la page',
        );
        expect(prompt).toContain('onclick="doSomething()"');
        expect(prompt).toContain('role="button"');
        expect(prompt).toContain('role="dialog"');
        expect(prompt).toContain('tabindex="0"');
      });

      it('should return no theme section for unrecognized theme', () => {
        const rules = [createMockRule({ theme: 'ThèmeInconnu' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        // Should not contain any theme-specific extraction section
        expect(prompt).not.toContain('détectés dans la page');
        expect(prompt).not.toContain('extraction complète du DOM');
      });

      it('should return no theme section when DOM has no matching elements', () => {
        const rules = [createMockRule({ theme: 'Tableaux' })];
        const axeResult = createMockAxeResult();
        const domWithoutTables =
          '<html><body><p>No tables here</p></body></html>';
        const prompt = service.buildBatchUserPrompt(
          rules,
          domWithoutTables,
          axeResult,
        );

        expect(prompt).not.toContain('## Tableaux détectés dans la page');
      });

      it('should use theme from first rule for extraction', () => {
        const rules = [
          createMockRule({ theme: 'Images' }),
          createMockRule({ theme: 'Liens' }),
        ];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        // Only Images extraction should occur (from rules[0].theme)
        expect(prompt).toContain('## Images détectés dans la page');
        expect(prompt).not.toContain('## Liens <a> détectés');
      });

      it('should handle empty theme gracefully', () => {
        const rules = [createMockRule({ theme: '' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).not.toContain('détectés dans la page');
      });

      it('should extract elements from the full DOM before truncation', () => {
        // Create a DOM that is larger than 12000 chars, where the matching elements
        // are at the END (beyond the truncation point)
        const padding = `<div>${'a'.repeat(13000)}</div>`;
        const domWithLateImages = `${padding}<img src="late.png" alt="Late image">`;
        const rules = [createMockRule({ theme: 'Images' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          domWithLateImages,
          axeResult,
        );

        // The theme extraction should still find the image even though it is beyond 12000 chars
        expect(prompt).toContain('## Images détectés dans la page');
        expect(prompt).toContain('<img src="late.png" alt="Late image">');

        // But the truncated DOM section should NOT contain this image (it's past 12000 chars)
        expect(prompt).toContain('... [CONTENU TRONQUÉ POUR IA] ...');
      });

      it('should limit number of extracted elements per type', () => {
        // Create a DOM with more than 50 images (the limit for img elements)
        const manyImages = Array.from(
          { length: 60 },
          (_, i) =>
            `<img src="img${i.toString()}.png" alt="Image ${i.toString()}">`,
        ).join('\n');
        const dom = `<html><body>${manyImages}</body></html>`;
        const rules = [createMockRule({ theme: 'Images' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(rules, dom, axeResult);

        // Should show element count. img elements capped at 50, no SVG or input[type=image]
        expect(prompt).toContain('50 éléments');
      });

      it('should truncate individual table elements to 3000 chars', () => {
        const bigTable =
          `<table>` + `<tr><td>${'Z'.repeat(4000)}</td></tr>` + `</table>`;
        // Put padding BEFORE the table so the DOM truncation at 12000 hides it,
        // then the extracted theme element section is the only place it can appear
        const dom = `<html><body>${'<p>P</p>'.repeat(2000)}${bigTable}</body></html>`;
        const rules = [createMockRule({ theme: 'Tableaux' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(rules, dom, axeResult);

        expect(prompt).toContain('## Tableaux détectés dans la page');
        // The extracted table element should be truncated to 3000 chars via substring
        // so the full 4000 Z's should not appear anywhere in the prompt
        expect(prompt).not.toContain('Z'.repeat(4000));
        // But some Z's should still appear in the truncated extraction
        expect(prompt).toContain('Z'.repeat(100));
      });

      it('should truncate individual nav elements to 1000 chars', () => {
        const bigNav =
          `<nav>` + `<a href="#">${'N'.repeat(1500)}</a>` + `</nav>`;
        // Put padding BEFORE the nav so the DOM truncation at 12000 hides the nav content
        const dom = `<html><body>${'<p>P</p>'.repeat(2000)}${bigNav}</body></html>`;
        const rules = [createMockRule({ theme: 'Navigation' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(rules, dom, axeResult);

        expect(prompt).toContain(
          '## Éléments de navigation détectés dans la page',
        );
        // The nav element should be truncated to 1000 chars
        expect(prompt).not.toContain('N'.repeat(1500));
        // But the first portion should still appear
        expect(prompt).toContain('N'.repeat(100));
      });

      it('should handle case-insensitive theme matching', () => {
        const rules = [createMockRule({ theme: 'IMAGES' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(
          rules,
          SAMPLE_DOM,
          axeResult,
        );

        expect(prompt).toContain('## Images détectés dans la page');
      });

      it('should truncate individual link elements to 500 chars', () => {
        const bigLink = `<a href="/page">${'L'.repeat(600)}</a>`;
        const dom = `<html><body>${'<p>P</p>'.repeat(2000)}${bigLink}</body></html>`;
        const rules = [createMockRule({ theme: 'Liens' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(rules, dom, axeResult);

        expect(prompt).toContain('## Liens <a> détectés dans la page');
        // The link element should be truncated to 500 chars + truncation marker
        expect(prompt).not.toContain('L'.repeat(600));
        expect(prompt).toContain('... [TRONQUÉ]');
      });

      it('should truncate individual SVG elements to 1000 chars', () => {
        const bigSvg = `<svg>` + `<path d="${'M'.repeat(1500)}"/>` + `</svg>`;
        const dom = `<html><body>${'<p>P</p>'.repeat(2000)}${bigSvg}</body></html>`;
        const rules = [createMockRule({ theme: 'Images' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(rules, dom, axeResult);

        expect(prompt).toContain('## Images détectés dans la page');
        expect(prompt).not.toContain('M'.repeat(1500));
        expect(prompt).toContain('... [TRONQUÉ]');
      });

      it('should limit total theme elements to 15000 chars budget', () => {
        // Create 30 links each of ~600 chars (over 500 maxContentLength limit).
        // After truncation at 500 chars + marker, each is ~514 chars.
        // 30 * 514 = 15420 > 15000 budget, so some will be trimmed.
        const links = Array.from(
          { length: 30 },
          (_, i) => `<a href="/p${i.toString()}">${'X'.repeat(600)}</a>`,
        ).join('\n');
        const dom = `<html><body>${links}</body></html>`;
        const rules = [createMockRule({ theme: 'Liens' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(rules, dom, axeResult);

        // Should contain the truncation comment due to budget limit
        expect(prompt).toContain('éléments supplémentaires tronqués');
      });

      it('should respect custom domLimit and axeLimit options', () => {
        const rules = [createMockRule({ theme: 'Images' })];
        const longDom = 'x'.repeat(15000);
        const axeResult = createMockAxeResult(SAMPLE_VIOLATIONS);
        const prompt = service.buildBatchUserPrompt(
          rules,
          longDom,
          axeResult,
          undefined,
          { domLimit: 5000, axeLimit: 2000 },
        );

        // DOM should be truncated at 5000 chars, not the default 12000
        expect(prompt).toContain('... [CONTENU TRONQUÉ POUR IA] ...');
        // The truncated DOM content should be limited to 5000 chars
        const domSection = prompt.split('## DOM de la page')[1] ?? '';
        // Should not contain 12000 x's
        expect(domSection).not.toContain('x'.repeat(12000));
      });

      it('should limit links count to 30', () => {
        // Add padding so the DOM section is truncated and won't show links beyond index ~20
        const padding = `<div>${'a'.repeat(13000)}</div>`;
        const manyLinks = Array.from(
          { length: 40 },
          (_, i) => `<a href="/l${i.toString()}">Link ${i.toString()}</a>`,
        ).join('\n');
        const dom = `<html><body>${padding}${manyLinks}</body></html>`;
        const rules = [createMockRule({ theme: 'Liens' })];
        const axeResult = createMockAxeResult();
        const prompt = service.buildBatchUserPrompt(rules, dom, axeResult);

        // Theme extraction should find links (they are extracted from full DOM)
        expect(prompt).toContain('## Liens <a> détectés dans la page');
        // Link 29 (0-indexed) should be present in theme extraction
        expect(prompt).toContain('Link 29');
        // Link 30 should NOT be present (extraction capped at 30)
        expect(prompt).not.toContain('Link 30');
      });
    });
  });

  // =========================================================================
  // extractElementContext
  // =========================================================================
  describe('extractElementContext', () => {
    it('should extract context around a found element', () => {
      const dom = '<div><p>Some text here</p><img src="test.jpg"></div>';
      const result = service.extractElementContext(dom, '<img src="test.jpg">');

      expect(result).toContain('<img src="test.jpg">');
      expect(result).toContain('</p>'); // context before
    });

    it('should return not-found message when element is absent', () => {
      const dom = '<div><p>Hello</p></div>';
      const result = service.extractElementContext(dom, '<span>Missing</span>');

      expect(result).toContain('not found in the DOM');
    });

    it('should use custom context radius', () => {
      const before = 'A'.repeat(500);
      const after = 'B'.repeat(500);
      const dom = `${before}<target/>${after}`;
      const result = service.extractElementContext(dom, '<target/>', 50);

      // Should capture at most 50 chars before and 50 after
      expect(result.length).toBeLessThanOrEqual(50 + '<target/>'.length + 50);
    });

    it('should escape regex special characters in the selector', () => {
      const dom = '<div class="test[1]">content</div>';
      const result = service.extractElementContext(dom, 'test[1]');

      expect(result).toContain('test[1]');
    });

    it('should handle regex errors gracefully', () => {
      // An extremely pathological input should be caught by the try/catch
      const dom = '<div>text</div>';
      // We can't easily force a regex error with escapeRegex in place,
      // but we can verify the method does not throw
      const result = service.extractElementContext(dom, '');

      expect(typeof result).toBe('string');
    });

    it('should use default contextRadius of 200', () => {
      const before = 'X'.repeat(300);
      const after = 'Y'.repeat(300);
      const dom = `${before}MARKER${after}`;
      const result = service.extractElementContext(dom, 'MARKER');

      // Context captured: up to 200 chars before + MARKER + up to 200 chars after
      expect(result.length).toBeLessThanOrEqual(200 + 'MARKER'.length + 200);
      expect(result).toContain('MARKER');
    });
  });

  // =========================================================================
  // truncate (tested via public methods)
  // =========================================================================
  describe('truncate behavior (via public methods)', () => {
    it('should not truncate DOM shorter than 12000 chars', () => {
      const rules = [createMockRule()];
      const axeResult = createMockAxeResult();
      const shortDOM = `<html>${'a'.repeat(100)}</html>`;
      const prompt = service.buildBatchUserPrompt(rules, shortDOM, axeResult);

      expect(prompt).not.toContain('CONTENU TRONQUÉ');
      expect(prompt).toContain(shortDOM);
    });

    it('should truncate DOM at exactly 12000 + 1 chars', () => {
      const rules = [createMockRule()];
      const axeResult = createMockAxeResult();
      const dom = 'x'.repeat(12001);
      const prompt = service.buildBatchUserPrompt(rules, dom, axeResult);

      expect(prompt).toContain('... [CONTENU TRONQUÉ POUR IA] ...');
    });

    it('should not truncate DOM of exactly 12000 chars', () => {
      const rules = [createMockRule()];
      const axeResult = createMockAxeResult();
      const dom = 'x'.repeat(12000);
      const prompt = service.buildBatchUserPrompt(rules, dom, axeResult);

      expect(prompt).not.toContain('CONTENU TRONQUÉ');
    });

    it('should handle null/undefined-like empty string', () => {
      const rules = [createMockRule()];
      const axeResult = createMockAxeResult();
      const prompt = service.buildBatchUserPrompt(rules, '', axeResult);

      expect(prompt).not.toContain('CONTENU TRONQUÉ');
    });
  });
});
