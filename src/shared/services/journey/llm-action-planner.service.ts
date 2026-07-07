import type { Page } from 'puppeteer';

import { createLogger } from '@shared/utils/logger.js';
import { computeBudget } from '@shared/utils/token-budget.util.js';
import { safeJsonParse } from '@shared/utils/safe-json-parse.util.js';
import type { OpenAIClientService } from '@shared/services/ai/openai-client.service.js';
import {
  ACTION_NAVIGATION_SCHEMA,
  REPLAN_ACTION_SCHEMA,
} from '@shared/services/ai/llm-schemas.js';
import type { ScreenshotService } from '@shared/services/screenshot/screenshot.service.js';

import type { DomLiteExtractorService } from './dom-lite-extractor.service.js';
import { JourneyError } from './journey-error.util.js';
import { normalizeCamelCaseAttributes } from './journey.util.js';
import type {
  ActionNavigation,
  ReplanResult,
} from './action-parser.service.js';
import type { SelectorResolverService } from './selector-resolver.service.js';

const logger = createLogger('llm-action-planner');

/**
 * Extracts the first balanced JSON object from a string that may contain
 * surrounding prose. Handles strings with escape sequences to ignore `{`
 * inside JSON values. Returns null if no object is found.
 */
export function extractJsonObject(s: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === '\\') {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
}

/**
 * Parses a raw LLM response string into an ActionNavigation object.
 * Strips markdown fences, falls back to JSON extraction from prose.
 */
export function parseLLMResponse(raw: string): ActionNavigation {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```\s*$/, '');

  let parsed: unknown;
  try {
    parsed = safeJsonParse(cleaned, 'parseLLMResponse');
  } catch {
    throw new JourneyError(
      'AI_PARSING',
      `LLM response contains no usable JSON object: "${cleaned.slice(0, 200)}"`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new JourneyError('AI_PARSING', 'LLM response: JSON object expected');
  }

  const obj = parsed as Record<string, unknown>;
  const type = obj['type'];
  const selector = obj['selector'];

  const validTypes = [
    'click',
    'doubleClick',
    'rightClick',
    'hover',
    'type',
    'select',
    'check',
    'uncheck',
    'pressKey',
    'scrollTo',
  ];

  if (typeof type !== 'string' || !validTypes.includes(type)) {
    throw new JourneyError(
      'AI_PARSING',
      `Invalid action type returned by the AI: "${String(type)}". Valid types: ${validTypes.join(', ')}`,
    );
  }
  if (typeof selector !== 'string' || selector.trim().length === 0) {
    throw new JourneyError(
      'AI_PARSING',
      'Missing or empty "selector" field in the AI response',
    );
  }

  const scoreRaw = obj['confidenceScore'];
  const score =
    typeof scoreRaw === 'number' ? Math.max(0, Math.min(100, scoreRaw)) : 50;

  const result: ActionNavigation = {
    type: type as ActionNavigation['type'],
    selector: selector.trim(),
    confidenceScore: score,
    reasoning: typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '',
  };
  if (typeof obj['value'] === 'string') {
    result.value = obj['value'];
  }
  if (obj['waitForNavigation'] === true) {
    result.waitForNavigation = true;
  }
  return result;
}

/**
 * Service responsible for all LLM-based action planning: initial classification
 * + selector finding, and agentic retry (replan after no effect).
 *
 * Extracted from ActionParserService to isolate LLM interaction, prompt
 * construction, and selector post-processing into a dedicated unit.
 */
export class LLMActionPlannerService {
  constructor(
    private readonly openaiClient: OpenAIClientService,
    private readonly screenshotService: ScreenshotService,
    private readonly domLiteExtractor: DomLiteExtractorService,
    private readonly selectorResolver: SelectorResolverService,
  ) {}

  /**
   * Main LLM flow: classify the action + find a CSS selector, with retry loop
   * when validation fails.
   */
  async planInitial(
    page: Page,
    actionStr: string,
    extractTargetText: (s: string) => string | null,
  ): Promise<ActionNavigation> {
    if (!this.openaiClient.isReady()) {
      throw new JourneyError(
        'AI_PARSING',
        'LLM Provider service not configured (LLM_PROVIDER_API_KEY/ENDPOINT missing)',
      );
    }

    const screenshot = await this.captureScreenshotSafe(page);
    // Always clear cache before extracting — the DOM may have changed since
    // the last action (submenu opened, AJAX content loaded, etc.)
    this.domLiteExtractor.clearCache();
    const elements = await this.domLiteExtractor.extractInteractive(page);
    const model = this.openaiClient.getModel();
    const budget = computeBudget(model, { hasImage: true });
    const domBudget = Math.floor(budget.inputBudget * 0.3);
    const maxChars = domBudget * 4;
    const {
      json: domJson,
      includedCount,
      totalCount,
    } = this.domLiteExtractor.serializeWithBudget(elements, maxChars);

    logger.info(
      { includedCount, totalCount, sizeKB: (domJson.length / 1024).toFixed(1) },
      '[LLM-PLANNER] Lite DOM context built for the AI',
    );

    const MAX_RETRIES = 2;
    let lastFailure: { selector: string; reason: string } | null = null;
    let lastParsed: ActionNavigation | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      const parsed = await this.callLLM(
        actionStr,
        domJson,
        screenshot,
        lastFailure,
      );
      lastParsed = parsed;

      const originalSelector = parsed.selector;

      const resolved = await this.selectorResolver.resolveTextBasedSelector(
        page,
        parsed.selector,
      );
      if (resolved !== parsed.selector) {
        logger.info(
          {
            originalSelector: parsed.selector,
            resolvedSelector: resolved,
            attempt,
          },
          '[LLM-PLANNER] Text-based selector resolved server-side',
        );
        parsed.selector = resolved;
      }

      const preCheck = this.selectorResolver.detectNonStandardSyntax(
        parsed.selector,
      );
      if (preCheck !== null) {
        lastFailure = { selector: originalSelector, reason: preCheck };
        logger.warn(
          { selector: originalSelector, reason: preCheck, attempt },
          '[LLM-PLANNER] Non-standard syntax detected, retry',
        );
        continue;
      }

      const normalizedCandidate = normalizeCamelCaseAttributes(parsed.selector);
      if (normalizedCandidate !== parsed.selector) {
        const originalMatches = await page.$$(parsed.selector).catch(() => []);
        if (originalMatches.length === 0) {
          const normalizedMatches = await page
            .$$(normalizedCandidate)
            .catch(() => []);
          if (normalizedMatches.length > 0) {
            logger.info(
              {
                originalSelector: parsed.selector,
                normalizedSelector: normalizedCandidate,
                attempt,
              },
              '[LLM-PLANNER] camelCase attributes normalized to kebab-case (automatic fallback)',
            );
            parsed.selector = normalizedCandidate;
          }
        }
      }

      const validation = await this.selectorResolver.validateSelector(
        page,
        parsed.selector,
      );
      if (validation.ok) {
        const typesWithValue: ActionNavigation['type'][] = [
          'type',
          'select',
          'pressKey',
        ];
        const expectedTarget = !typesWithValue.includes(parsed.type)
          ? extractTargetText(actionStr)
          : null;
        if (expectedTarget !== null) {
          const override = await this.selectorResolver.overrideContainerToLeaf(
            page,
            parsed.selector,
            expectedTarget,
          );
          if (override !== null) {
            logger.info(
              {
                previousSelector: originalSelector,
                newSelector: override,
                expectedTarget,
              },
              '[LLM-PLANNER] LLM chose a container — automatic override to leaf',
            );
            parsed.selector = override;
            const validation2 = await this.selectorResolver.validateSelector(
              page,
              override,
            );
            if (validation2.ok) {
              return parsed;
            }
          }
          const targetOk = await this.selectorResolver.verifyTargetText(
            page,
            parsed.selector,
            expectedTarget,
          );
          if (!targetOk) {
            const chosenDetails =
              await this.selectorResolver.getChosenElementDetails(
                page,
                parsed.selector,
              );
            const reason =
              `You chose an element containing "${chosenDetails}" — not the requested target. ` +
              `The user wants to click on "${expectedTarget}" (between quotes). ` +
              `You are confusing the TARGET (between quotes) with the PATH/LOCATION (menu parents). ` +
              `Find an element whose "text" field matches EXACTLY "${expectedTarget}" ` +
              `(it is probably a hidden AJAX leaf with visible:false, in the DOM JSON, ` +
              `with data-ajax-code, data-action or similar in its "dataAttrs" field).`;
            logger.warn(
              {
                originalSelector,
                expectedTarget,
                chosenText: chosenDetails,
                attempt,
              },
              '[LLM-PLANNER] Incorrect target (quoted text absent), retry',
            );
            lastFailure = { selector: originalSelector, reason };
            continue;
          }
        }
        logger.info(
          {
            action: actionStr,
            type: parsed.type,
            selector: parsed.selector,
            confidenceScore: parsed.confidenceScore,
            attempt,
          },
          '[LLM-PLANNER] [OK] Action classified and validated by the AI',
        );
        return parsed;
      }

      if (
        validation.type === 'AI_ELEMENT_DISABLED' ||
        validation.type === 'AI_ELEMENT_NOT_VISIBLE'
      ) {
        throw new JourneyError(validation.type, validation.reason, {
          attemptedSelector: parsed.selector,
          aiConfidenceScore: parsed.confidenceScore,
        });
      }

      lastFailure = {
        selector: originalSelector,
        reason: validation.reason,
      };
      logger.warn(
        { selector: originalSelector, reason: validation.reason, attempt },
        '[LLM-PLANNER] Invalid selector, retry',
      );
    }

    const lastReason = lastFailure?.reason ?? 'unknown';
    const lastSelector = lastFailure?.selector ?? lastParsed?.selector ?? '';
    throw new JourneyError(
      'AI_SELECTOR_INVALID',
      `Invalid selector after ${String(MAX_RETRIES + 1)} attempts. Last try: "${lastSelector}" — ${lastReason}`,
      { attemptedSelector: lastSelector },
    );
  }

  /**
   * Agentic retry: called when a click produced no URL change. The LLM looks
   * at the CURRENT page state (post-action) and proposes a corrective action.
   *
   * Returns:
   *   - ActionNavigation: a new plan to execute
   *   - { type: 'skip' }: the AI judges the previous action was sufficient
   *   - null: LLM call failure or unparseable response
   */
  async planRetry(
    page: Page,
    context: {
      originalActionStr: string;
      previousAction: ActionNavigation;
      urlBefore: string;
    },
  ): Promise<ReplanResult | null> {
    if (!this.openaiClient.isReady()) return null;

    let screenshot: string | null;
    let elements: ReturnType<
      DomLiteExtractorService['extractInteractive']
    > extends Promise<infer R>
      ? R
      : never;
    try {
      screenshot = await this.captureScreenshotSafe(page);
      this.domLiteExtractor.clearCache();
      elements = await this.domLiteExtractor.extractInteractive(page);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[LLM-PLANNER] planRetry: state capture failed',
      );
      return null;
    }

    const model = this.openaiClient.getModel();
    const budget = computeBudget(model, { hasImage: true });
    const domBudget = Math.floor(budget.inputBudget * 0.3);
    const maxChars = domBudget * 4;
    const {
      json: domJson,
      includedCount,
      totalCount,
    } = this.domLiteExtractor.serializeWithBudget(elements, maxChars);

    logger.info(
      { includedCount, totalCount, sizeKB: (domJson.length / 1024).toFixed(1) },
      '[LLM-PLANNER] [REPLAN] DOM context built',
    );

    const systemPrompt = `You are a web navigation agent. The user requested an action in natural language and the system attempted a first interpretation, but after execution the URL did not change even though a navigation was expected.

Your role: look at the CURRENT state of the page (after the first attempt) and propose the NEXT action to execute to fulfill the user's intent.

Typical cases:
1. The first action OPENED a menu/submenu → you must click deeper, on the LEAF (the terminal item that actually navigates)
2. The first action selected the wrong element → propose another selector for the same intent
3. A trigger must be hovered/clicked first (e.g. an expand button) → propose hover or click on that trigger
4. The page is slow to load (SPA, AJAX) → propose "skip" because the previous action was sufficient
5. The previous action was sufficient (DOM-local, modal opened, etc.) → propose "skip"

STRICT JSON RESPONSE:
{
  "type": "click|doubleClick|rightClick|hover|type|select|check|uncheck|pressKey|scrollTo|skip",
  "selector": "CSS selector if action, omit if skip",
  "value": "if type/select/pressKey",
  "waitForNavigation": true|false,
  "confidenceScore": 0-100,
  "reasoning": "1-2 sentences: why this action is the right next step"
}

SELECTOR RULES (same as the main prompt):
- #id, [data-cy], [data-testid], [aria-label], [name], [href], :has-text("…")
- NEVER :contains, :visible, :hidden, utility classes
- MUST match a SINGLE element

If you don't see how to progress, return {"type": "skip", "reasoning": "..."} instead of inventing.`;

    const userPrompt = `# User intent
"${context.originalActionStr}"

# First attempt (no effect)
Type: ${context.previousAction.type}
Selector: ${context.previousAction.selector}
URL before and after: ${context.urlBefore} (unchanged)
Initial reasoning: ${context.previousAction.reasoning}

# CURRENT page DOM (after the 1st attempt — a menu may be open)
\`\`\`json
${domJson}
\`\`\`

Propose the corrective action. Return ONLY the JSON.`;

    interface MessageContentItem {
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
    }
    const userContent: MessageContentItem[] = [
      { type: 'text', text: userPrompt },
    ];
    if (screenshot != null && screenshot !== '') {
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${screenshot}`,
          detail: 'low',
        },
      });
    }

    const isOpenAI = model.includes('gpt');
    const generationParams: Record<string, unknown> = {
      temperature: 0,
      max_tokens: 700,
      seed: 42,
    };
    if (isOpenAI) {
      generationParams['response_format'] = {
        type: 'json_schema',
        json_schema: REPLAN_ACTION_SCHEMA,
      };
    }

    let raw: string;
    try {
      const response = await this.openaiClient.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        generationParams,
        { timeout: 60000 },
      );
      raw = response.response;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[LLM-PLANNER] [REPLAN] LLM call failed',
      );
      return null;
    }

    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```\s*$/, '');
    let parsedObj: unknown;
    try {
      parsedObj = safeJsonParse(cleaned, 'replan');
    } catch {
      logger.warn(
        { raw: cleaned.slice(0, 200) },
        '[LLM-PLANNER] [REPLAN] Invalid JSON',
      );
      return null;
    }
    if (typeof parsedObj !== 'object' || parsedObj === null) return null;
    const obj = parsedObj as Record<string, unknown>;
    const type = obj['type'];

    if (type === 'skip') {
      const reasoning =
        typeof obj['reasoning'] === 'string' ? obj['reasoning'] : '';
      logger.info({ reasoning }, '[LLM-PLANNER] [REPLAN] AI proposes SKIP');
      return { type: 'skip', reasoning };
    }

    let action: ActionNavigation;
    try {
      action = parseLLMResponse(cleaned);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        '[LLM-PLANNER] [REPLAN] ActionNavigation parsing failed',
      );
      return null;
    }

    const resolved = await this.selectorResolver.resolveTextBasedSelector(
      page,
      action.selector,
    );
    if (resolved !== action.selector) {
      logger.info(
        { originalSelector: action.selector, resolvedSelector: resolved },
        '[LLM-PLANNER] [REPLAN] Text-based selector resolved',
      );
      action.selector = resolved;
    }
    const validation = await this.selectorResolver.validateSelector(
      page,
      action.selector,
    );
    if (!validation.ok) {
      logger.warn(
        { selector: action.selector, reason: validation.reason },
        '[LLM-PLANNER] [REPLAN] Invalid selector, skipping',
      );
      return null;
    }

    return action;
  }

  /**
   * Single LLM call with context (and optional failure feedback for retry).
   */
  private async callLLM(
    actionStr: string,
    domJson: string,
    screenshot: string | null,
    lastFailure: { selector: string; reason: string } | null,
  ): Promise<ActionNavigation> {
    const model = this.openaiClient.getModel();
    const isOpenAI = model.includes('gpt');
    const generationParams: Record<string, unknown> = {
      temperature: 0,
      max_tokens: 700,
      seed: 42,
    };
    if (isOpenAI) {
      generationParams['response_format'] = {
        type: 'json_schema',
        json_schema: ACTION_NAVIGATION_SCHEMA,
      };
    }

    interface MessageContentItem {
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(actionStr, domJson, lastFailure);

    const userContent: MessageContentItem[] = [
      { type: 'text', text: userPrompt },
    ];
    if (screenshot != null && screenshot !== '') {
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${screenshot}`,
          detail: 'low',
        },
      });
    }

    let raw: string;
    try {
      const response = await this.openaiClient.chatCompletion(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        generationParams,
        { timeout: 60000 },
      );
      raw = response.response;
    } catch (err: unknown) {
      throw new JourneyError(
        'AI_PARSING',
        `LLM call failed for action parsing: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    return parseLLMResponse(raw);
  }

  private buildSystemPrompt(): string {
    return `You are a web automation expert.
Analyze the user's phrase (in French or English) and return a JSON object describing the action to perform on the page.

TOP-PRIORITY RULE — IDENTIFY THE TARGET:
The TARGET of the action is ALWAYS the text between QUOTES (' ' or " ") in the
user phrase. Anything following "dans le menu", "dans le sous-menu",
"menu A > B", "depuis", "à l'intérieur de" is the PATH/LOCATION and is
NOT the target. Concrete examples:
- "cliquer sur 'Y' dans le sous-menu A > B" → TARGET = Y (find an element
  whose text/aria-label/value matches "Y"). NEVER click A or B.
- "cliquer sur 'Détail Élément' dans le sous-menu Catalogue > Liste"
  → TARGET = Détail Élément. NEVER select Catalogue or
  Liste (these are menu CONTAINERS, not the target).
- If several elements match the target text, prefer the one that looks like
  an application LEAF: <a> with data-ajax-action="Start",
  data-action, data-ajax-code, or another declarative business attribute.
  Avoid submenu CONTAINERS (data-menu-type="submenu",
  class="menu-folder", role="menubar", aria-haspopup, etc.).

POSSIBLE ACTION TYPES:
- "click": standard left click
- "doubleClick": double click
- "rightClick": right click (context menu)
- "hover": hover (move the cursor over, without clicking — e.g. open a hover dropdown)
- "type": type text into a field (input/textarea). Extract the value between quotes or after "avec/par"
- "select": choose an option in a <select>. Extract the option value
- "check": check a checkbox/radio
- "uncheck": uncheck a checkbox
- "pressKey": press a key (Enter, Tab, Escape, ArrowDown, etc.)
- "scrollTo": scroll to a specific element

CSS SELECTOR CHOICE — ABSOLUTE PRIORITY:
1. #id (if stable, not dynamically generated)
2. [data-testid="..."], [data-cy="..."], [data-test="..."]
3. Any other stable and UNIQUE data-* that appears in the "dataAttrs" field
   of the DOM JSON. Concrete examples:
   - [data-ajax-code="ITEM_DETAIL"] (business attribute example)
   - [data-action="submit-form"]
   - [data-target="user-menu"]
   These business attributes are OFTEN more stable than CSS classes.
4. [aria-label="..."]
5. Unique semantic attributes: [name="..."], [type="..."], [href="..."]
6. To target by TEXT when no unique attribute exists:
   use :has-text("exact text") — e.g. a.MenuLink:has-text("Produit")
   This pseudo-selector is resolved server-side into a unique data-baldr-target attribute.
7. UNIQUE contextual classes (not utility classes)

STRICT RULE: NEVER invent a class or attribute name. If you don't see it
in the provided DOM JSON, DON'T USE IT. Prefer :has-text()
when nothing unique distinguishes the element.

HTML ATTRIBUTE CONVENTION — kebab-case MANDATORY:
HTML attributes use **kebab-case**, never camelCase. This is the standard
HTML/CSS convention, distinct from the JavaScript convention (DOM property).
Correct examples:
  ✅ [data-cy="x"], [data-testid="x"], [aria-label="x"], [data-ajax-code="x"]
NEVER use (these don't exist in the rendered DOM):
  ❌ [dataCy="x"], [dataTestid="x"], [ariaLabel="x"], [dataAjaxCode="x"]
If you read a "dataAttrs" field in the DOM JSON like data-cy="foo", keep it
AS-IS in your selector; do NOT transform it into dataCy.

NAVIGATION IN MULTI-LEVEL MENUS (common backoffice SPA cases):
When the user describes an action like "cliquer sur X dans le sous-menu"
or "menu A > B > X", the target element is OFTEN a hidden <a> leaf
(visible:false) that has a unique and stable data-* attribute
(data-action, data-ajax-code, data-target, data-route...). Search for that
leaf in the DOM JSON by its "text" field AND its "dataAttrs" field, EVEN
IF visible is false. Baldr's DOM-click bypass triggers the associated JS
handler without the menu needing to be visually open. ALWAYS prefer
this direct approach (a single click on the leaf) over a long
sequence of intermediate hover/clicks.

REQUIREMENT: THE SELECTOR MUST MATCH A SINGLE ELEMENT (neither 0 nor several).
If you return, for example, "a.MenuLink" and there are 8 .MenuLink elements in
the provided DOM, it is INVALID. You MUST disambiguate:
- Either with a unique attribute (data-cy, id...)
- Or with :has-text("exact text") — RECOMMENDED for menus, list items,
  links distinguished only by their text.

STRICT PROHIBITIONS:
- NEVER :contains("X") (jQuery) — use :has-text() instead
- NEVER :icon-text("X"), :text("X"), :visible, :hidden
- NEVER utility classes (mb-4, p-2, w-full, flex, text-sm…)
- NEVER long nested selectors (>4 levels > > > >)
- :nth-child / :nth-of-type only AS A LAST RESORT

waitForNavigation DETECTION: FALSE by default. Set TRUE ONLY if the
phrase contains an EXPLICIT intent to wait for a navigation, for example:
- "puis aller à la page X" / "pour aller sur Y" / "et naviguer vers Z"
- "et attendre la nouvelle page" / "et attendre le chargement de la page suivante"

Cases where TRUE is FORBIDDEN (always FALSE):
- "cliquer sur X dans le menu" → opens a submenu, no nav
- "cliquer sur X" alone → ambiguous, set FALSE (the user can clarify)
- "survoler / hover" → never a nav
- "saisir / cocher / sélectionner" → never a nav
- "cliquer sur Rechercher" on an internal form → no nav (AJAX results)

The word "navigation" in "menu de navigation" does NOT count as intent.
When in doubt: FALSE. The user can force it by writing explicitly
"puis aller à" or "et attendre la nouvelle page".

STRICT JSON RESPONSE (nothing else, no markdown):
{
  "type": "click|doubleClick|rightClick|hover|type|select|check|uncheck|pressKey|scrollTo",
  "selector": "the CSS selector",
  "value": "value if type/select/pressKey, otherwise omit",
  "waitForNavigation": true|false,
  "confidenceScore": 0-100,
  "reasoning": "1-2 sentences explaining your choice"
}

EXAMPLE — hidden AJAX leaf in a submenu (internal backoffice case):
User action: "cliquer sur 'Détail Élément' dans le sous-menu Catalogue > Liste"
The DOM JSON contains:
  {"tag":"a","text":"Détail Élément","dataAttrs":"data-ajax-code=\\"ITEM_DETAIL\\" data-ajax-action=\\"Start\\"","visible":false,"idx":42}
Good answer:
{"type":"click","selector":"[data-ajax-code=\\"ITEM_DETAIL\\"]","waitForNavigation":false,"confidenceScore":95,"reasoning":"AJAX leaf directly clickable via the unique data-ajax-code attribute, the submenu does not need to be visually open."}

Bad answer to avoid:
{"type":"click","selector":"a.menu-folder:has-text(\\"Détail Élément\\")","reasoning":"..."}
→ invented class + requires the submenu to be open; will fail if :has-text() resolves to 0 matches (element hidden in a filtered list).`;
  }

  private buildUserPrompt(
    actionStr: string,
    domJson: string,
    lastFailure: { selector: string; reason: string } | null = null,
  ): string {
    let prompt = `# Action to perform
"${actionStr}"

# Page DOM (interactive elements in compact JSON)
\`\`\`json
${domJson}
\`\`\`
`;
    if (lastFailure !== null) {
      prompt += `
# ⚠️⚠️ PREVIOUS ATTEMPT — INCORRECT — DO NOT REPRODUCE ⚠️⚠️
You proposed: ${lastFailure.selector}
FAILURE REASON: ${lastFailure.reason}

INSTRUCTIONS FOR THIS ATTEMPT:
1. Re-read the user phrase carefully — the target is between QUOTES.
2. Find in the DOM JSON an element whose "text" field matches EXACTLY
   that quoted text (not a path parent, not a menu folder).
3. If the element has "visible: false" but has stable dataAttrs
   (data-ajax-code, data-action, data-target...), it is probably
   the RIGHT leaf to click — the DOM-click bypass works.
4. Return a selector DIFFERENT from the previous one (do NOT reproduce the same
   mistake by just changing the :has-text text).
`;
    }
    prompt += `
Return ONLY the JSON matching the requested schema.`;
    return prompt;
  }

  private async captureScreenshotSafe(page: Page): Promise<string | null> {
    try {
      return await this.screenshotService.captureFullPage(page);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Screenshot unavailable, parsing without vision',
      );
      return null;
    }
  }
}
