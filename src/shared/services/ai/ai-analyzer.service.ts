import * as cheerio from 'cheerio';
import type { Page } from 'puppeteer';
import { z } from 'zod';

import { createLogger } from '@shared/utils/logger.js';
import {
  getContextLimit,
  estimateTokens,
  MAX_OUTPUT_TOKENS_HARD_CAP,
  OUTPUT_TOKENS_CONTEXT_RATIO,
} from '@shared/utils/token-budget.util.js';
import { safeJsonParse } from '@shared/utils/safe-json-parse.util.js';
import { RULE_ANALYSIS_SCHEMA } from './llm-schemas.js';
import type {
  IRGAARule,
  IAIRuleAnalysis,
} from '@shared/types/rgaa-rules.types.js';
import type {
  IAxeResult,
  IAIEnrichedResult,
  ICommonProblemsAnalysis,
  ICommonProblem,
} from '@shared/types/audit.types.js';

import { OpenAIClientService } from './openai-client.service.js';
import type { IOpenAIClientConfig } from './openai-client.service.js';
import { PromptBuilderService } from './prompt-builder.service.js';
import {
  buildBaselineProblems,
  extractFirstJsonObject,
} from './common-problems-catalog.js';
import { ScreenshotService } from '@shared/services/screenshot/screenshot.service.js';

const logger = createLogger('ai-analyzer');

// ─── Zod schemas for LLM response validation ────────────────────────────────

const findingSchema = z.object({
  type: z.enum(['violation', 'warning', 'recommendation']).catch('violation'),
  element: z.string().optional(),
  issue: z.string().catch(''),
  recommendation: z.string().catch(''),
  wcagReference: z.string().optional(),
  rgaaReference: z.string().optional(),
});

const aiRuleAnalysisSchema = z
  .object({
    ruleId: z.string(),
    compliant: z.boolean().optional(),
    conclusion: z.string().optional(),
    severity: z
      .enum(['critical', 'serious', 'moderate', 'minor'])
      .catch('minor'),
    summary: z.string().catch(''),
    totalElements: z.number().int().optional(),
    findings: z.array(findingSchema).catch([]),
    intelligentAnalysis: z
      .object({
        contextualInsights: z.string().optional(),
        semanticRelevance: z.string().optional(),
        userImpact: z.string().optional(),
      })
      .optional(),
    error: z.string().optional(),
  })
  .transform((item): IAIRuleAnalysis => {
    // Normalize legacy "conclusion" field to boolean "compliant"
    const compliant =
      item.compliant ?? (item.conclusion === 'conforme' ? true : false);
    const { conclusion: _unused, ...rest } = item;
    return { ...rest, compliant, findings: rest.findings };
  });

const batchResponseSchema = z.object({
  analyses: z.array(aiRuleAnalysisSchema),
});

/**
 * Configuration required by AIAnalyzerService.
 *
 * The `openaiClient` / `screenshotService` fields enable dependency injection:
 * when provided, those shared instances are reused (the composition root and
 * the CLI inject the same OpenAIClientService used by the orchestration layer,
 * so a single LRU cache is shared instead of duplicating clients). When they
 * are omitted, fresh instances are created from the remaining config — kept as
 * a non-breaking fallback for standalone usage (e.g. health check, tests).
 */
export interface IAIAnalyzerConfig {
  llmProvider?: IOpenAIClientConfig['llmProvider'];
  proxy?: IOpenAIClientConfig['proxy'];
  env?: IOpenAIClientConfig['env'];
  contextLimit?: number;
  /** Injected shared OpenAI client (takes precedence over llmProvider/proxy/env). */
  openaiClient?: OpenAIClientService;
  /** Injected shared screenshot service. */
  screenshotService?: ScreenshotService;
}

/**
 * AI analysis service for RGAA rules
 */
export class AIAnalyzerService {
  private openaiClient: OpenAIClientService;
  private promptBuilder: PromptBuilderService;
  private screenshotService: ScreenshotService;
  private readonly contextLimitOverride: number | undefined;

  constructor(config?: IAIAnalyzerConfig) {
    this.openaiClient =
      config?.openaiClient ??
      new OpenAIClientService(
        config?.env !== undefined
          ? {
              llmProvider: config.llmProvider,
              proxy: config.proxy,
              env: config.env,
            }
          : undefined,
      );
    this.promptBuilder = new PromptBuilderService();
    this.screenshotService =
      config?.screenshotService ?? new ScreenshotService();
    this.contextLimitOverride = config?.contextLimit;
    logger.info('AIAnalyzerService created');
  }

  /**
   * Full analysis with enriched AI.
   * The screenshot is ALWAYS captured.
   */
  async analyzeWithAI(
    page: Page,
    axeResults: IAxeResult,
    rules: IRGAARule[],
  ): Promise<IAIEnrichedResult> {
    logger.info({ rulesCount: rules.length }, 'Starting enriched AI analysis');

    // Strict availability check
    if (!this.isAvailable()) {
      throw new Error(
        'AI service not configured. Check LLM_PROVIDER_API_KEY and LLM_PROVIDER_ENDPOINT.',
      );
    }

    logger.info('[OK] AI service checked and ready');

    try {
      // 1. DOM extraction
      const dom = await this.screenshotService.extractDOM(page);

      // 2. Capture screenshot only for vision-capable models
      const modelName = this.openaiClient.getModel();
      const isVisionCapable = this.isVisionModel(modelName);
      let screenshot: string | undefined;
      if (isVisionCapable) {
        logger.info('Capturing screenshot (vision model detected)...');
        screenshot = await this.screenshotService.captureFullPage(page);
        logger.info('Screenshot captured successfully');
      } else {
        logger.info(
          { model: modelName },
          'Skipping screenshot (text-only model)',
        );
      }

      // 3. Filter rules with a valid AI config
      const validRules = rules.filter(
        (rule) =>
          rule.aiAnalysisConfig.enabled &&
          rule.aiAnalysisConfig.analysisPrompt?.tasks != null &&
          rule.aiAnalysisConfig.analysisPrompt.tasks.length > 0,
      );

      const skippedCount = rules.length - validRules.length;
      if (skippedCount > 0) {
        logger.info(
          { skippedCount },
          'Rules without a complete AI config, skip',
        );
      }

      // 4. Group by theme, analyze with limited concurrency
      const rulesByTheme = this.groupRulesByTheme(validRules);
      const themeEntries = Object.entries(rulesByTheme);
      logger.info(
        { themeCount: themeEntries.length, ruleCount: validRules.length },
        'AI analysis by theme (max 3 concurrent)',
      );

      const themeResults = await this.runWithConcurrencyLimit(
        themeEntries.map(
          ([theme, themeRules]) =>
            () =>
              this.analyzeRulesBatch(
                theme,
                themeRules,
                dom,
                axeResults,
                screenshot,
              ),
        ),
        3,
      );

      const ruleAnalyses: IAIRuleAnalysis[] = [];
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      for (let i = 0; i < themeResults.length; i++) {
        const result = themeResults[i];
        const entry = themeEntries[i];

        if (result == null || entry == null) continue;
        const [theme, themeRules] = entry;
        if (result.status === 'fulfilled') {
          ruleAnalyses.push(...result.value.analyses);
          if (result.value.usage) {
            totalPromptTokens += result.value.usage.prompt_tokens;
            totalCompletionTokens += result.value.usage.completion_tokens;
          }
        } else {
          const errorMessage =
            result.reason instanceof Error
              ? result.reason.message
              : 'Erreur inconnue';
          logger.error(
            { theme, error: errorMessage },
            'AI thematic batch failed',
          );
          for (const rule of themeRules) {
            ruleAnalyses.push({
              ruleId: rule.ruleId,
              compliant: false,
              severity: 'critical',
              summary: `Erreur analyse IA batch: ${errorMessage}`,
              findings: [],
              error: errorMessage,
            });
          }
        }
      }

      logger.info(
        { analyzedCount: ruleAnalyses.length },
        'AI analysis completed successfully',
      );

      // Compute AI statistics
      const summary = {
        violations: ruleAnalyses.filter(
          (r) => !r.compliant && (r.error == null || r.error === ''),
        ).length,
        compliant: ruleAnalyses.filter((r) => r.compliant).length,
        notApplicable: 0,
        errors: ruleAnalyses.filter((r) => r.error != null && r.error !== '')
          .length,
      };

      return {
        ruleAnalyses,
        totalRulesAnalyzed: ruleAnalyses.length,
        summary,
        metadata: {
          model: this.openaiClient.getModel(),
          timestamp: new Date().toISOString(),
          analysisType: 'full',
          tokenUsage:
            totalPromptTokens > 0
              ? {
                  promptTokens: totalPromptTokens,
                  completionTokens: totalCompletionTokens,
                  totalTokens: totalPromptTokens + totalCompletionTokens,
                }
              : undefined,
        },
        screenshot,
        extractedDOM: dom,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Global AI analysis failed');
      throw new Error(`AI analysis failed: ${errorMessage}`, { cause: error });
    }
  }

  /**
   * Groups rules by theme (rule.theme field)
   */
  private groupRulesByTheme(rules: IRGAARule[]): Record<string, IRGAARule[]> {
    const groups: Record<string, IRGAARule[]> = {};
    for (const rule of rules) {
      const theme = rule.theme;
      groups[theme] ??= [];
      groups[theme].push(rule);
    }
    return groups;
  }

  /**
   * Analyzes a group of rules from the same theme in a single AI call
   */
  private async analyzeRulesBatch(
    theme: string,
    rules: IRGAARule[],
    dom: string,
    axeResults: IAxeResult,
    screenshot?: string,
  ): Promise<{
    analyses: IAIRuleAnalysis[];
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }> {
    logger.info({ theme, rulesCount: rules.length }, 'Thematic batch analysis');

    const systemPrompt = this.promptBuilder.buildBatchSystemPrompt(
      rules,
      theme,
    );

    const modelName = this.openaiClient.getModel();
    const isOpenAIModel = modelName.includes('gpt');

    // The Images theme is the only verdict that depends on actually *seeing*
    // small/inline images (photo vs texture, text-in-image, chart vs flourish).
    // Use high-fidelity vision for it; keep low detail for the other themes to
    // contain token cost.
    const isImagesTheme = theme.toLowerCase().includes('image');
    const screenshotDetail: 'high' | 'low' = isImagesTheme ? 'high' : 'low';

    const contextLimit = this.getContextLimit();
    const maxTokensForOutput = Math.min(
      MAX_OUTPUT_TOKENS_HARD_CAP,
      Math.floor(contextLimit * OUTPUT_TOKENS_CONTEXT_RATIO),
    );

    const generationParams: Record<string, unknown> = {
      temperature: 0,
      max_tokens: maxTokensForOutput,
      seed: 42,
    };
    if (isOpenAIModel) {
      generationParams['response_format'] = {
        type: 'json_schema',
        json_schema: RULE_ANALYSIS_SCHEMA,
      };
    }

    // Build the user prompt with budget check
    let userPrompt = this.promptBuilder.buildBatchUserPrompt(
      rules,
      dom,
      axeResults,
      screenshot,
    );

    // Token budget estimation and reduction if necessary.
    // 'low' detail is a flat ~85 tokens; 'high' tiles the image (512px tiles),
    // so budget conservatively to avoid under-estimating and overflowing context.
    const hasScreenshot = screenshot != null && screenshot !== '';
    const imageTokens = hasScreenshot
      ? screenshotDetail === 'high'
        ? 2000
        : 85
      : 0;
    const availableForInput = contextLimit - maxTokensForOutput;
    let estimatedInputTokens =
      estimateTokens(systemPrompt) + estimateTokens(userPrompt) + imageTokens;

    if (estimatedInputTokens > availableForInput * 0.9) {
      const reductionFactor = (availableForInput * 0.8) / estimatedInputTokens;
      const reducedDomLimit = Math.max(
        2000,
        Math.floor(12000 * reductionFactor),
      );
      const reducedAxeLimit = Math.max(
        1000,
        Math.floor(5000 * reductionFactor),
      );

      logger.warn(
        {
          theme,
          estimatedInputTokens,
          availableForInput,
          reducedDomLimit,
          reducedAxeLimit,
        },
        'Prompt exceeds token budget, reducing content',
      );

      userPrompt = this.promptBuilder.buildBatchUserPrompt(
        rules,
        dom,
        axeResults,
        screenshot,
        { domLimit: reducedDomLimit, axeLimit: reducedAxeLimit },
      );

      estimatedInputTokens =
        estimateTokens(systemPrompt) + estimateTokens(userPrompt) + imageTokens;
    }

    logger.info(
      {
        theme,
        estimatedInputTokens,
        contextLimit,
        maxTokensForOutput,
      },
      'Estimated token budget for the batch',
    );

    // Build the user content: text + real base64 image if available
    const userMessage =
      screenshot != null && screenshot !== ''
        ? {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: userPrompt },
              {
                type: 'image_url' as const,
                image_url: {
                  url: `data:image/jpeg;base64,${screenshot}`,
                  detail: screenshotDetail,
                },
              },
            ],
          }
        : { role: 'user' as const, content: userPrompt };

    const response = await this.openaiClient.chatCompletion(
      [{ role: 'system', content: systemPrompt }, userMessage],
      generationParams,
      { timeout: 180000 },
    );

    const analyses = this.parseBatchAnalyses(response.response, theme, rules);

    // Theme-conditional finding policy: Images lenient (decorative doubt ->
    // warning), every other thematic strict (warnings -> violations).
    if (isImagesTheme) {
      this.downgradeDoubtfulViolations(analyses, dom, (q, sel) =>
        this.isDecorativeImageDoubt(q, sel),
      );
    } else {
      this.promoteWarningsToViolations(analyses);
    }

    logger.info({ theme, count: analyses.length }, 'Thematic batch analysis');
    return { analyses, usage: response.usage };
  }

  /**
   * Cleans, parses and validates the raw batch response, then flags any rule
   * the model omitted as non-compliant (never silently compliant).
   */
  private parseBatchAnalyses(
    rawText: string,
    theme: string,
    rules: IRGAARule[],
  ): IAIRuleAnalysis[] {
    let rawResponse = rawText.trim();
    if (rawResponse.startsWith('```')) {
      rawResponse = rawResponse
        .replace(/^```(?:json)?\s*\n?/, '')
        .replace(/\n?```\s*$/, '');
    }

    let jsonObj: unknown;
    try {
      jsonObj = safeJsonParse(rawResponse, `batch theme "${theme}"`);
    } catch (parseErr) {
      throw new Error(
        `Non-JSON batch response for theme "${theme}": ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        { cause: parseErr },
      );
    }

    const parsed = batchResponseSchema.safeParse(jsonObj);
    if (!parsed.success) {
      throw new Error(
        `Invalid batch response for theme "${theme}": ${parsed.error.message}`,
      );
    }

    const analyses = parsed.data.analyses;

    // Flag rules absent from the LLM response as non-compliant.
    const returnedIds = new Set(analyses.map((a) => a.ruleId));
    for (const rule of rules) {
      if (!returnedIds.has(rule.ruleId)) {
        logger.warn(
          { ruleId: rule.ruleId, theme },
          'Rule absent from batch response — marked as non-compliant',
        );
        analyses.push({
          ruleId: rule.ruleId,
          compliant: false,
          severity: 'critical',
          summary: 'Rule not returned by LLM model — requires manual review',
          findings: [],
          error: 'not_returned_by_model',
        });
      }
    }

    // Enrich every finding with the deterministic RGAA reference of its rule
    // (source of truth: the rule metadata). This drives the "Référence RGAA"
    // line shown per finding in the HTML report, independently of the WCAG
    // reference the LLM may have guessed.
    const ruleByRuleId = new Map(rules.map((r) => [r.ruleId, r]));
    for (const analysis of analyses) {
      const rgaaReference = ruleByRuleId.get(analysis.ruleId)?.rgaaReference;
      if (rgaaReference == null || rgaaReference === '') continue;
      for (const finding of analysis.findings) {
        finding.rgaaReference = rgaaReference;
      }
    }

    return analyses;
  }

  /**
   * Strict policy for non-Images themes: every "warning" becomes a "violation"
   * (the user wants no soft warnings outside Images). A rule with any promoted
   * finding is marked non-compliant.
   */
  private promoteWarningsToViolations(analyses: IAIRuleAnalysis[]): void {
    for (const analysis of analyses) {
      let changed = false;
      for (const finding of analysis.findings) {
        if (finding.type === 'warning') {
          finding.type = 'violation';
          changed = true;
        }
      }
      if (changed) analysis.compliant = false;
    }
  }

  /**
   * Deterministic safeguard shared by themes whose verdict has a subjective
   * edge. For each AI "violation" whose target element (resolved against the
   * real DOM) satisfies `isDoubtful`, the finding is downgraded to a "warning"
   * prefixed with a manual-review note. When a rule's only violations are
   * downgraded, its compliance is recomputed from the remaining violations.
   *
   * Resolving the LLM's selector against the actual DOM is what makes this
   * deterministic: the outcome no longer depends on sampling noise.
   */
  private downgradeDoubtfulViolations(
    analyses: IAIRuleAnalysis[],
    dom: string,
    isDoubtful: (
      $: ReturnType<typeof cheerio.load>,
      selector: string,
    ) => boolean,
  ): void {
    const $ = cheerio.load(dom, { xml: { xmlMode: false } });
    const NOTE = '[À vérifier manuellement] ';

    for (const analysis of analyses) {
      let downgraded = false;
      for (const finding of analysis.findings) {
        if (finding.type !== 'violation') continue;
        const selector = finding.element?.trim();
        if (selector == null || selector === '') continue;

        let doubtful = false;
        try {
          doubtful = isDoubtful($, selector);
        } catch {
          // Selector not understood by cheerio (e.g. unsupported pseudo-class):
          // cannot verify, so leave the finding untouched (doubtful stays false).
        }
        if (!doubtful) continue;

        finding.type = 'warning';
        if (!finding.issue.startsWith(NOTE)) {
          finding.issue = `${NOTE}${finding.issue}`;
        }
        downgraded = true;
      }

      if (downgraded) {
        analysis.compliant = !analysis.findings.some(
          (f) => f.type === 'violation',
        );
      }
    }
  }

  /**
   * Images doubt: the selector resolves only to images carrying an EXPLICIT
   * decorative declaration (alt="" present, aria-hidden="true", or
   * role="presentation"/"none") and none is a functional image-link/button.
   * Respecting the author's decorative declaration avoids false positives on
   * ambiance/hero illustrations; functional image-links stay hard violations.
   */
  private isDecorativeImageDoubt(
    $: ReturnType<typeof cheerio.load>,
    selector: string,
  ): boolean {
    const els = $(selector).toArray();
    if (els.length === 0) return false;

    const allDecorative = els.every((el) => {
      const $el = $(el);
      const role = $el.attr('role');
      return (
        $el.attr('alt')?.trim() === '' ||
        $el.attr('aria-hidden') === 'true' ||
        role === 'presentation' ||
        role === 'none'
      );
    });
    const anyFunctional = els.some((el) => {
      const $el = $(el);
      return $el.is('a, button') || $el.closest('a, button').length > 0;
    });
    return allDecorative && !anyFunctional;
  }

  /**
   * Returns the context limit of the current model
   */
  private getContextLimit(): number {
    if (this.contextLimitOverride != null && this.contextLimitOverride > 0) {
      return this.contextLimitOverride;
    }
    return getContextLimit(this.openaiClient.getModel());
  }

  /**
   * Determines if the model supports vision (image inputs).
   * GPT-4o, GPT-4.1, and Claude models support vision.
   */
  private isVisionModel(modelName: string): boolean {
    const lower = modelName.toLowerCase();
    return (
      lower.includes('gpt-4o') ||
      lower.includes('gpt-4.1') ||
      lower.includes('gpt-4-vision') ||
      lower.includes('claude')
    );
  }

  /**
   * Runs tasks with a concurrency limit, returning PromiseSettledResult[].
   */
  private async runWithConcurrencyLimit<T>(
    tasks: (() => Promise<T>)[],
    limit: number,
  ): Promise<PromiseSettledResult<T>[]> {
    const results: PromiseSettledResult<T>[] = Array.from<
      PromiseSettledResult<T>
    >({ length: tasks.length }).fill({
      status: 'rejected',
      reason: new Error('not executed'),
    });
    let index = 0;

    async function worker(): Promise<void> {
      while (index < tasks.length) {
        const i = index++;
        const task = tasks[i];

        if (task == null) continue;
        try {
          const value = await task();
          results[i] = { status: 'fulfilled', value };
        } catch (reason) {
          results[i] = { status: 'rejected', reason };
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
    );
    return results;
  }

  /** Identifies recurring RGAA problems (≥ 2 pages): catalog skeleton + AI enrichment. */
  async analyzeCommonProblems(
    results: IAxeResult[],
  ): Promise<ICommonProblemsAnalysis> {
    const generatedAt = new Date().toISOString();

    if (results.length < 2) {
      return {
        problems: [],
        generatedAt,
        basedOnPages: results.length,
        error:
          'Au moins 2 pages requises pour identifier des problèmes communs',
      };
    }

    // Index used as a unique identifier: in a journey, several scans can share the same URL/title.
    const pageIdOf = (idx: number): string => `p${String(idx)}`;

    const axeAggregation = new Map<
      string,
      {
        rule: string;
        impact: string;
        pages: Set<string>;
        total: number;
        tags: string[];
      }
    >();
    results.forEach((r, idx) => {
      for (const v of r.violations) {
        const existing = axeAggregation.get(v.id) ?? {
          rule: v.help,
          impact: v.impact,
          pages: new Set<string>(),
          total: 0,
          tags: v.tags,
        };
        existing.pages.add(pageIdOf(idx));
        existing.total += v.nodes.length;
        axeAggregation.set(v.id, existing);
      }
    });

    const aiAggregation = new Map<
      string,
      {
        ruleId: string;
        severity: string;
        summary: string;
        issues: string[];
        pages: Set<string>;
      }
    >();
    results.forEach((r, idx) => {
      if (!r.aiEnrichedResult) return;
      for (const ra of r.aiEnrichedResult.ruleAnalyses) {
        if (ra.compliant) continue;
        const existing = aiAggregation.get(ra.ruleId) ?? {
          ruleId: ra.ruleId,
          severity: ra.severity,
          summary: ra.summary,
          issues: [],
          pages: new Set<string>(),
        };
        existing.pages.add(pageIdOf(idx));
        for (const f of ra.findings) {
          if (f.type === 'violation' && f.issue) {
            existing.issues.push(f.issue);
          }
        }
        aiAggregation.set(ra.ruleId, existing);
      }
    });

    const recurringAxe = Array.from(axeAggregation.entries())
      .filter(([, data]) => data.pages.size >= 2)
      .sort((a, b) => b[1].pages.size - a[1].pages.size)
      .slice(0, 30)
      .map(([id, data]) => ({
        id,
        pageCount: data.pages.size,
        occurrences: data.total,
        description: data.rule,
        rgaaTags: data.tags.filter((t) => t.startsWith('RGAA-')),
        wcagTags: data.tags.filter((t) => /^wcag\d/.test(t)),
      }));

    const recurringAi = Array.from(aiAggregation.entries())
      .filter(([, data]) => data.pages.size >= 2)
      .sort((a, b) => b[1].pages.size - a[1].pages.size)
      .slice(0, 20)
      .map(([id, data]) => ({
        id,
        pageCount: data.pages.size,
        occurrences: data.issues.length,
        description: data.summary,
      }));

    const totalRecurring = recurringAxe.length + recurringAi.length;

    if (totalRecurring === 0) {
      logger.info(
        'No recurring rule on ≥ 2 pages — "common problems" section omitted',
      );
      return {
        problems: [],
        generatedAt,
        basedOnPages: results.length,
      };
    }

    const baseline = buildBaselineProblems(
      recurringAxe,
      recurringAi,
      results.length,
    );

    logger.info(
      {
        pages: results.length,
        recurringAxe: recurringAxe.length,
        recurringAi: recurringAi.length,
        baseline: baseline.length,
      },
      'Common problems skeleton built',
    );

    // Optional AI enrichment: return the skeleton if AI is unavailable.
    if (!this.isAvailable()) {
      return {
        problems: baseline,
        generatedAt,
        basedOnPages: results.length,
      };
    }

    try {
      const baselineForPrompt = baseline.map((p, idx) => ({
        index: idx,
        title: p.title,
        severity: p.severity,
        rgaaCriteria: p.rgaaCriteria,
        wcagReferences: p.wcagReferences,
      }));

      const systemPrompt = `Tu es un expert RGAA 4 et WCAG 2.1 spécialisé en accessibilité numérique francophone.

CONTEXTE : on t'a déjà identifié N problèmes d'accessibilité récurrents sur un site (chacun confirmé par les outils d'audit). Ta seule tâche est d'ENRICHIR le contenu textuel de chaque problème avec des descriptions, recommandations et exemples de code de qualité professionnelle.

RÈGLES :
1. Pour CHAQUE problème de la liste fournie, tu DOIS produire un objet enrichi correspondant — même nombre d'objets, même ordre, même index.
2. Ne pas changer "title", "severity", "rgaaCriteria", "wcagReferences" — ils sont déjà corrects.
3. Pour chaque entrée, ajoute :
   - "description" : 2 à 4 phrases en français expliquant le problème, son impact sur les utilisateurs en situation de handicap, et le contexte typique.
   - "recommendation" : 1 à 2 phrases décrivant la correction à apporter.
   - "codeExample" : exemple HTML/CSS court montrant ❌ avant / ✅ après (utiliser \\n pour les sauts de ligne).

FORMAT DE SORTIE : JSON STRICT, sans markdown, sans backticks, sans texte hors JSON :
{
  "enriched": [
    { "index": 0, "description": "...", "recommendation": "...", "codeExample": "..." },
    { "index": 1, "description": "...", "recommendation": "...", "codeExample": "..." }
  ]
}`;

      const userPrompt = `Problèmes pré-identifiés à enrichir (${String(baseline.length)}) :
${JSON.stringify(baselineForPrompt, null, 2)}

Produis le JSON enrichi.`;

      const response = await this.openaiClient.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { temperature: 0.2, max_tokens: 6000 },
        { timeout: 120000 },
      );

      const jsonText = extractFirstJsonObject(response.response);
      if (jsonText == null || jsonText === '') {
        logger.warn(
          { rawPreview: response.response.slice(0, 200) },
          'No valid JSON found in AI response — returning skeleton',
        );
        return {
          problems: baseline,
          generatedAt,
          basedOnPages: results.length,
        };
      }

      const parsed = JSON.parse(jsonText) as {
        enriched?: {
          index: number;
          description?: string;
          recommendation?: string;
          codeExample?: string;
        }[];
      };
      const enriched = Array.isArray(parsed.enriched) ? parsed.enriched : [];

      // Merge: title, severity and criteria remain those of the skeleton.
      const pickEnriched = (
        aiVal: string | undefined,
        fallback: string | undefined,
      ): string | undefined => {
        const trimmed = aiVal?.trim();
        return trimmed != null && trimmed.length > 0 ? trimmed : fallback;
      };
      const merged: ICommonProblem[] = baseline.map((base, i) => {
        const ai = enriched.find((e) => e.index === i);
        if (!ai) return base;
        return {
          ...base,
          description:
            pickEnriched(ai.description, base.description) ?? base.description,
          recommendation:
            pickEnriched(ai.recommendation, base.recommendation) ??
            base.recommendation,
          codeExample: pickEnriched(ai.codeExample, base.codeExample),
        };
      });

      logger.info(
        { baseline: baseline.length, enrichedByAi: enriched.length },
        'Common problems enriched by AI',
      );

      return {
        problems: merged,
        generatedAt,
        basedOnPages: results.length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        { error: message, fallback: 'baseline' },
        'AI enrichment failed — returning deterministic skeleton',
      );
      return {
        problems: baseline,
        generatedAt,
        basedOnPages: results.length,
      };
    }
  }

  /**
   * Checks whether the AI service is available
   */
  isAvailable(): boolean {
    return this.openaiClient.isReady();
  }
}
