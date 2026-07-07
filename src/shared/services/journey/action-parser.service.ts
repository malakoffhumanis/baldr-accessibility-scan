import type { Page } from 'puppeteer';

import {
  appendClickableSelectors,
  type AttributeMatch,
  buildStableAttributes,
  type BusinessSelectorsConfig,
  EMPTY_BUSINESS_SELECTORS,
} from '@shared/config/business-selectors.config.js';
import { createLogger } from '@shared/utils/logger.js';
import { shimTsxName } from '@shared/utils/browser-shims.util.js';
import {
  HEURISTIC_AUTH,
  extractAuthKey,
} from '@shared/utils/auth-action.util.js';

import { DomLiteExtractorService } from './dom-lite-extractor.service.js';
import { JourneyError } from './journey-error.util.js';
import { SelectorResolverService } from './selector-resolver.service.js';
import {
  LLMActionPlannerService,
  extractJsonObject,
  parseLLMResponse,
} from './llm-action-planner.service.js';
import type { OpenAIClientService } from '@shared/services/ai/openai-client.service.js';
import type { ScreenshotService } from '@shared/services/screenshot/screenshot.service.js';

const logger = createLogger('action-parser');

/** Clickable-candidate base query (universal conventions only). */
const CLICKABLE_BASE_QUERY =
  'a, button, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="tab"], [role="menuitemcheckbox"], [role="menuitemradio"], [data-action], [data-target], input[type="button"], input[type="submit"], [tabindex]';

/**
 * Navigational action (inferred by the AI from a natural-language string).
 */
export interface ActionNavigation {
  type:
    | 'click'
    | 'doubleClick'
    | 'rightClick'
    | 'hover'
    | 'type'
    | 'clear'
    | 'select'
    | 'check'
    | 'uncheck'
    | 'pressKey'
    | 'scrollTo';
  selector: string;
  value?: string;
  waitForNavigation?: boolean;
  confidenceScore: number;
  reasoning: string;
}

/**
 * Built-in action (without an LLM call).
 */
export type ActionBuiltin =
  | { type: 'scan' }
  | { type: 'cookies' }
  | { type: 'wait'; delayMs: number }
  | { type: 'waitForReady' }
  | { type: 'auth'; key: string };

/**
 * Result of parsing an action string.
 */
export type ParsedAction = ActionBuiltin | ActionNavigation;

/**
 * Result of an agentic retry: a corrective action or an explicit skip.
 */
export type ReplanResult =
  ActionNavigation | { type: 'skip'; reasoning: string };

// Re-export pure helpers for backward compat (used by tests)
export { extractJsonObject, parseLLMResponse };
// Auth-action heuristic now lives in utils (so the validation layer can reuse
// it without depending on this service); re-exported here for compatibility.
export { HEURISTIC_AUTH, extractAuthKey };

const HEURISTIC_SCAN =
  /^\s*(scanner?|audit(er)?|lance(r)?\s+(un\s+)?(audit|scan)|run\s+(audit|scan))\b/i;

// Scan keyword at end of sentence, preceded by a conditional clause:
// e.g. "quand la page est affichée, scanne", "une fois chargé scanner la page"
const HEURISTIC_SCAN_CONDITIONNEL =
  /\b(?:quand|une\s+fois|lorsque|apr[èe]s|d[èe]s\s+que|when|once|after)\b.*\b(scan(?:ne[rz]?)?|audit(?:e[rz])?)\s*(?:la\s+page)?\s*$/i;

const HEURISTIC_COOKIES =
  /(cookies?|banni[èe]re)\b.*\b(accept|valid|ferm)|^accept(er)?\s+(les\s+|tous\s+les\s+|la\s+banni[èe]re|cookies?)/i;
const HEURISTIC_COOKIES_SHORT =
  /^\s*(accept(er)?(\s+(les\s+)?cookies?)?|cookies?\s*(ok|accept))\s*$/i;
export const HEURISTIC_WAIT =
  /^\s*(attendre|wait|patienter|pause)\s+(\d+)\s*(ms|millisecondes?|secondes?|s)\b/i;

// e.g. "attend que la page se charge", "attendre le chargement", "wait for page load"
const HEURISTIC_WAIT_PAGE =
  /^\s*(attend(?:s|re|ez)?|wait(?:ing)?|patienter?)\s+(?:que\s+|le\s+|for\s+)?.*\b(page|charg|prêt|ready|load|affich|rendu)/i;

/**
 * Orchestrator service for parsing natural-language action strings.
 *
 * Delegates to:
 * - Built-in heuristics (inline regex checks)
 * - SelectorResolverService (selector validation)
 * - LLMActionPlannerService (LLM classification, retry)
 */
export class ActionParserService {
  private readonly selectorResolver: SelectorResolverService;
  private readonly llmPlanner: LLMActionPlannerService;

  constructor(
    openaiClient: OpenAIClientService,
    screenshotService: ScreenshotService,
    domLiteExtractor?: DomLiteExtractorService,
    public readonly businessSelectors: BusinessSelectorsConfig = EMPTY_BUSINESS_SELECTORS,
  ) {
    const domExtractor = domLiteExtractor ?? new DomLiteExtractorService();
    this.selectorResolver = new SelectorResolverService(businessSelectors);
    this.llmPlanner = new LLMActionPlannerService(
      openaiClient,
      screenshotService,
      domExtractor,
      this.selectorResolver,
    );
  }

  /**
   * Parses a natural-language action string.
   */
  async parse(actionStr: string, page: Page): Promise<ParsedAction> {
    const trimmed = actionStr.trim();

    // 1. Built-ins
    if (
      HEURISTIC_SCAN.test(trimmed) ||
      HEURISTIC_SCAN_CONDITIONNEL.test(trimmed)
    ) {
      logger.info({ action: trimmed }, '[ACTION-PARSER] → built-in scan');
      return { type: 'scan' };
    }
    if (
      HEURISTIC_COOKIES.test(trimmed) ||
      HEURISTIC_COOKIES_SHORT.test(trimmed)
    ) {
      logger.info({ action: trimmed }, '[ACTION-PARSER] → built-in cookies');
      return { type: 'cookies' };
    }
    const waitMatch = HEURISTIC_WAIT.exec(trimmed);
    if (waitMatch) {
      const n = parseInt(waitMatch[2] ?? '0', 10);

      const unit = (waitMatch[3] ?? 's').toLowerCase();
      const delayMs = unit.startsWith('ms') ? n : n * 1000;
      logger.info(
        { action: trimmed, delayMs },
        '[ACTION-PARSER] → built-in wait',
      );
      return { type: 'wait', delayMs: Math.min(Math.max(delayMs, 1), 60000) };
    }
    if (HEURISTIC_WAIT_PAGE.test(trimmed)) {
      logger.info(
        { action: trimmed },
        '[ACTION-PARSER] → built-in waitForReady',
      );
      return { type: 'waitForReady' };
    }
    const authKey = extractAuthKey(trimmed);
    if (authKey !== null) {
      logger.info(
        { action: trimmed, key: authKey },
        '[ACTION-PARSER] → built-in auth',
      );
      return { type: 'auth', key: authKey };
    }

    // 2. Explicit CSS selector in the description
    const explicit = this.extractExplicitSelector(trimmed);
    if (explicit !== null) {
      logger.info(
        { action: trimmed, type: explicit.type, selector: explicit.selector },
        '[ACTION-PARSER] → Explicit selector detected, AI bypassed',
      );
      const validation = await this.selectorResolver.validateSelector(
        page,
        explicit.selector,
      );
      if (!validation.ok) {
        throw new JourneyError(
          validation.type ?? 'AI_SELECTOR_INVALID',
          `Invalid explicit selector provided: "${explicit.selector}" — ${validation.reason}`,
          { attemptedSelector: explicit.selector },
        );
      }
      return explicit;
    }

    // 2.5 Shortcut text-direct
    const shortcut = await this.directTextShortcut(page, trimmed);
    if (shortcut !== null) {
      logger.info(
        {
          action: trimmed,
          type: shortcut.type,
          selector: shortcut.selector,
          text: shortcut.reasoning,
        },
        '[ACTION-PARSER] → Direct-text shortcut, AI bypassed',
      );
      return shortcut;
    }

    // 3. LLM-based navigation
    logger.info(
      { action: trimmed },
      '[ACTION-PARSER] → AI navigation (classification + selector)',
    );
    return this.llmPlanner.planInitial(page, trimmed, (s) =>
      this.extractTargetText(s),
    );
  }

  /**
   * Agentic retry — delegates to LLMActionPlannerService.
   */
  async replanAfterNoEffect(
    page: Page,
    context: {
      originalActionStr: string;
      previousAction: ActionNavigation;
      urlBefore: string;
    },
  ): Promise<ReplanResult | null> {
    return this.llmPlanner.planRetry(page, context);
  }

  /**
   * Extracts an explicit CSS selector from the action description.
   */
  extractExplicitSelector(actionStr: string): ActionNavigation | null {
    // Two patterns:
    //  1. "avec/via sélecteur [:]" (colon optional with prefix)
    //  2. "sélecteur:" / "selecteur:" / "selector:" standalone (colon required)
    const re =
      /(?:avec|via)\s+s[ée]lecteurs?\s*:?\s*(.+?)(?=\s+-\s+|\s+de\s+|\s+du\s+|\s+dans\s+|\s+pour\s+|\s+et\s+|\s*$)|(?:s[ée]lecteurs?|selector)\s*:\s*(.+?)(?=\s+-\s+|\s*$)/i;
    const match = re.exec(actionStr);
    if (!match) return null;

    const selector = (match[1] ?? match[2] ?? '').trim();
    if (selector.length === 0) return null;

    const lower = actionStr.toLowerCase();
    let type: ActionNavigation['type'];

    if (/double\s*-?\s*clic/.test(lower) || /double[-\s]click/.test(lower)) {
      type = 'doubleClick';
    } else if (/clic\s*droit/.test(lower) || /right[-\s]?click/.test(lower)) {
      type = 'rightClick';
    } else if (
      /^survoler|^hover|passer\s+la\s+souris|mettre\s+le\s+curseur/.test(lower)
    ) {
      type = 'hover';
    } else if (/^saisir|^remplir|^[ée]crire|^taper|\btype\s/.test(lower)) {
      type = 'type';
    } else if (/^vider|^effacer|^clear/.test(lower)) {
      type = 'clear';
    } else if (/^cocher\b/.test(lower)) {
      type = 'check';
    } else if (/^d[ée]cocher\b/.test(lower)) {
      type = 'uncheck';
    } else if (/^s[ée]lectionner|^choisir/.test(lower)) {
      type = 'select';
    } else if (/^presser|^appuyer\s+sur|^press\b/.test(lower)) {
      type = 'pressKey';
    } else if (/^scroller|^d[ée]filer|^scroll/.test(lower)) {
      type = 'scrollTo';
    } else {
      type = 'click';
    }

    let value: string | undefined;
    if (type === 'type' || type === 'select' || type === 'pressKey') {
      const quoteMatch = /['"«»]([^'"«»]+)['"«»]/.exec(actionStr);
      if (quoteMatch) {
        value = quoteMatch[1];
      }
    }

    const waitForNavigation =
      /\bpuis\s+aller|\bet\s+attendre\s+(la\s+)?(nouvelle\s+)?page|\bpour\s+aller\s+sur|\bnaviguer\s+vers/i.test(
        actionStr,
      );

    const result: ActionNavigation = {
      type,
      selector,
      confidenceScore: 100,
      reasoning: 'Selector provided explicitly by the user in the description',
    };
    if (value !== undefined) result.value = value;
    if (waitForNavigation) result.waitForNavigation = true;
    return result;
  }

  /**
   * Extracts target text (between quotes) from the user phrase.
   */
  extractTargetText(actionStr: string): string | null {
    const match = /['"«»]([^'"«»\n]{2,})['"«»]/.exec(actionStr);
    if (match?.[1] === undefined) return null;
    const t = match[1].trim();
    return t.length >= 2 ? t : null;
  }

  /**
   * Shortcut text-direct (before LLM).
   */
  private async directTextShortcut(
    page: Page,
    actionStr: string,
  ): Promise<ActionNavigation | null> {
    const targetText = this.extractTargetText(actionStr);
    if (targetText === null) {
      logger.info(
        { actionStr },
        '[ACTION-PARSER] [SHORTCUT-DIAG] decision: skip (no text between quotes)',
      );
      return null;
    }

    const lower = actionStr.toLowerCase();
    let type: ActionNavigation['type'];
    if (/double\s*-?\s*clic/.test(lower) || /double[-\s]click/.test(lower)) {
      type = 'doubleClick';
    } else if (/clic\s*droit/.test(lower) || /right[-\s]?click/.test(lower)) {
      type = 'rightClick';
    } else if (
      /^survoler|^hover|passer\s+la\s+souris|mettre\s+le\s+curseur/.test(lower)
    ) {
      type = 'hover';
    } else if (/^cliquer|^clique\b|^click\b/.test(lower)) {
      type = 'click';
    } else {
      logger.info(
        { actionStr, targetText },
        '[ACTION-PARSER] [SHORTCUT-DIAG] decision: skip (verb not recognized)',
      );
      return null;
    }

    const clickableQuery = appendClickableSelectors(
      CLICKABLE_BASE_QUERY,
      this.businessSelectors,
    );
    const ctrClasses = this.businessSelectors.containerClasses;
    const ctrAttrs: AttributeMatch[] =
      this.businessSelectors.containerAttributes;
    const stableAttrNames = buildStableAttributes(this.businessSelectors);

    try {
      await shimTsxName(page);
      const diag = await page.evaluate(
        (
          targetText: string,
          query: string,
          containerClasses: string[],
          containerAttrs: { name: string; value: string }[],
          stableNames: string[],
        ) => {
          const norm = (s: string): string =>
            s.replace(/\s+/g, ' ').trim().toLowerCase();
          const target = norm(targetText);

          const all = Array.from(document.querySelectorAll<HTMLElement>(query));

          const exactMatches = all.filter(
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
            (el) => norm(el.textContent ?? '') === target,
          );
          const containsMatches = all.filter((el) =>
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
            norm(el.textContent ?? '').includes(target),
          );
          const matches =
            exactMatches.length > 0 ? exactMatches : containsMatches;

          if (matches.length === 0) {
            return {
              exactMatches: 0,
              containsMatches: 0,
              containerCount: 0,
              finalCandidateCount: 0,
              chosenText: null,
              stableSelector: null,
              skipReason: 'No element contains the target text',
            };
          }

          const isContainer = (el: HTMLElement): boolean =>
            (el.getAttribute('aria-haspopup') ?? '').length > 0 ||
            el.getAttribute('role') === 'menu' ||
            el.getAttribute('role') === 'menubar' ||
            containerAttrs.some((m) => el.getAttribute(m.name) === m.value) ||
            containerClasses.some((c) => el.classList.contains(c));

          const leaves = matches.filter((el) => !isContainer(el));
          const containers = matches.filter((el) => isContainer(el));
          const finalists = leaves.length > 0 ? leaves : matches;

          const buildStableSelector = (el: HTMLElement): string | null => {
            for (const a of stableNames) {
              const v = el.getAttribute(a);
              if (v != null && v !== '')
                return `[${a}="${v.replace(/"/g, '\\"')}"]`;
            }
            for (const attr of Array.from(el.attributes)) {
              if (
                /^data-[\w-]+-(?:code|id|action|target|key)$/i.test(
                  attr.name,
                ) &&
                attr.value
              ) {
                return `[${attr.name}="${attr.value.replace(/"/g, '\\"')}"]`;
              }
            }
            const id = el.id;
            if (id && !/\d{4,}/.test(id) && id.length < 60) {
              return `#${CSS.escape(id)}`;
            }
            const aria = el.getAttribute('aria-label');
            if (aria != null && aria !== '') {
              return `[aria-label="${aria.replace(/"/g, '\\"')}"]`;
            }
            return null;
          };

          const isUniqueInDocument = (sel: string): boolean => {
            try {
              return document.querySelectorAll(sel).length === 1;
            } catch {
              return false;
            }
          };

          let chosen: HTMLElement | null = null;
          let skipReason: string | null = null;

          if (finalists.length === 1) {
            chosen = finalists[0] ?? null;
          } else if (finalists.length > 1) {
            const withUniqueStable = finalists.filter((el) => {
              const sel = buildStableSelector(el);
              return sel !== null && isUniqueInDocument(sel);
            });
            if (withUniqueStable.length === 1) {
              chosen = withUniqueStable[0] ?? null;
            } else {
              skipReason = `${String(finalists.length)} final candidates, ${String(withUniqueStable.length)} with a unique stable selector (need: exactly 1)`;
            }
          } else {
            skipReason = 'No final candidate after container filter';
          }

          if (chosen === null) {
            return {
              exactMatches: exactMatches.length,
              containsMatches: containsMatches.length,
              containerCount: containers.length,
              finalCandidateCount: finalists.length,
              chosenText: null,
              stableSelector: null,
              skipReason: skipReason ?? 'unknown',
            };
          }

          const selector = buildStableSelector(chosen);
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- DOM textContent is `string | null` under typecheck
          const chosenText = norm(chosen.textContent ?? '').slice(0, 80);

          if (selector === null) {
            return {
              exactMatches: exactMatches.length,
              containsMatches: containsMatches.length,
              containerCount: containers.length,
              finalCandidateCount: finalists.length,
              chosenText,
              stableSelector: null,
              skipReason: 'Element found but no identifiable stable attribute',
            };
          }

          return {
            exactMatches: exactMatches.length,
            containsMatches: containsMatches.length,
            containerCount: containers.length,
            finalCandidateCount: finalists.length,
            chosenText,
            stableSelector: selector,
            skipReason: null,
          };
        },
        targetText,
        clickableQuery,
        ctrClasses,
        ctrAttrs,
        stableAttrNames,
      );

      if (diag.stableSelector === null) {
        logger.info(
          {
            expectedTarget: targetText,
            detectedType: type,
            exactMatches: diag.exactMatches,
            containsMatches: diag.containsMatches,
            containerCount: diag.containerCount,
            finalCandidateCount: diag.finalCandidateCount,
            chosenText: diag.chosenText,
            decision: 'fallback-llm',
            skipReason: diag.skipReason,
          },
          '[ACTION-PARSER] [SHORTCUT-DIAG] decision',
        );
        return null;
      }

      const validation = await this.selectorResolver.validateSelector(
        page,
        diag.stableSelector,
      );
      if (!validation.ok) {
        logger.info(
          {
            expectedTarget: targetText,
            detectedType: type,
            stableSelector: diag.stableSelector,
            chosenText: diag.chosenText,
            decision: 'fallback-llm',
            skipReason: `validateSelector: ${validation.reason}`,
          },
          '[ACTION-PARSER] [SHORTCUT-DIAG] decision',
        );
        return null;
      }

      logger.info(
        {
          expectedTarget: targetText,
          detectedType: type,
          exactMatches: diag.exactMatches,
          finalCandidateCount: diag.finalCandidateCount,
          chosenText: diag.chosenText,
          stableSelector: diag.stableSelector,
          decision: 'shortcut',
        },
        '[ACTION-PARSER] [SHORTCUT-DIAG] decision',
      );

      return {
        type,
        selector: diag.stableSelector,
        confidenceScore: 95,
        reasoning: `Text match "${targetText}" → ${diag.stableSelector} (shortcut without LLM)`,
      };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), targetText },
        '[ACTION-PARSER] [SHORTCUT-DIAG] evaluate error, fallback LLM',
      );
      return null;
    }
  }
}
