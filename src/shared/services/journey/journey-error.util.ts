import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Page } from 'puppeteer';

import { createLogger } from '@shared/utils/logger.js';
import type {
  ActionErrorResult,
  JourneyErrorType,
} from '@shared/types/journey-api.types.js';

const logger = createLogger('journey-error');

/**
 * Specialized error carrying a categorized type.
 */
export class JourneyError extends Error {
  public readonly type: JourneyErrorType;
  public readonly attemptedSelector?: string;
  public readonly aiConfidenceScore?: number;
  public override readonly cause?: unknown;

  constructor(
    type: JourneyErrorType,
    message: string,
    options: {
      attemptedSelector?: string;
      aiConfidenceScore?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'JourneyError';
    this.type = type;
    this.attemptedSelector = options.attemptedSelector;
    this.aiConfidenceScore = options.aiConfidenceScore;
    this.cause = options.cause;
  }
}

/**
 * Categorizes an error into a journey error type.
 */
export function categorizeJourneyError(
  err: unknown,
  context:
    | 'parsing'
    | 'selector'
    | 'action'
    | 'navigation'
    | 'auth'
    | 'audit'
    | 'cookies'
    | 'other',
): { type: JourneyErrorType; details: string; suggestions: string[] } {
  if (err instanceof JourneyError) {
    return {
      type: err.type,
      details: err.message,
      suggestions: getSuggestions(err.type),
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    lower.includes('protocol error') ||
    lower.includes('target closed') ||
    lower.includes('session closed') ||
    lower.includes('browser has disconnected')
  ) {
    return {
      type: 'BROWSER_CRASH',
      details: message,
      suggestions: getSuggestions('BROWSER_CRASH'),
    };
  }
  if (lower.includes('timeout') || lower.includes('exceeded')) {
    if (context === 'navigation') {
      return {
        type: 'NAVIGATION_POST_ACTION',
        details: message,
        suggestions: getSuggestions('NAVIGATION_POST_ACTION'),
      };
    }
    return {
      type: 'ACTION_EXECUTION',
      details: message,
      suggestions: getSuggestions('ACTION_EXECUTION'),
    };
  }
  if (lower.includes('node is detached') || lower.includes('not visible')) {
    return {
      type: 'AI_ELEMENT_NOT_VISIBLE',
      details: message,
      suggestions: getSuggestions('AI_ELEMENT_NOT_VISIBLE'),
    };
  }
  if (
    context === 'auth' ||
    lower.includes('authentification') ||
    lower.includes('login')
  ) {
    return {
      type: 'AUTH_FAILED',
      details: message,
      suggestions: getSuggestions('AUTH_FAILED'),
    };
  }
  if (context === 'cookies') {
    return {
      type: 'COOKIE_BANNER',
      details: message,
      suggestions: getSuggestions('COOKIE_BANNER'),
    };
  }
  if (context === 'parsing') {
    return {
      type: 'AI_PARSING',
      details: message,
      suggestions: getSuggestions('AI_PARSING'),
    };
  }
  if (context === 'navigation') {
    return {
      type: 'NAVIGATION_BLOCK',
      details: message,
      suggestions: getSuggestions('NAVIGATION_BLOCK'),
    };
  }
  if (context === 'selector') {
    return {
      type: 'AI_SELECTOR_NOT_FOUND',
      details: message,
      suggestions: getSuggestions('AI_SELECTOR_NOT_FOUND'),
    };
  }
  if (context === 'action') {
    return {
      type: 'ACTION_EXECUTION',
      details: message,
      suggestions: getSuggestions('ACTION_EXECUTION'),
    };
  }
  return {
    type: 'UNKNOWN',
    details: message,
    suggestions: getSuggestions('UNKNOWN'),
  };
}

/**
 * Actionable suggestions by error type.
 */
export function getSuggestions(type: JourneyErrorType): string[] {
  switch (type) {
    case 'VALIDATION_BODY':
      return [
        'Check the body structure: { pages: [{ url, actions?: [{ type, ... }] }] }',
        'Each action must be a typed object (scan, click, wait, ai, ...)',
        'A page without actions defaults to a single scan',
        'Make sure loginUrl is provided for ADFS/form auth configs',
      ];
    case 'AUTH_FAILED':
      return [
        'Check the credentials in authConfigs',
        'Verify the loginUrl for the chosen auth type',
        'For ADFS: username and email must be valid',
      ];
    case 'NAVIGATION_BLOCK':
      return [
        'Is the block URL accessible?',
        'Check network connectivity (proxy, DNS)',
        'Does the site respond within 30 seconds?',
      ];
    case 'AI_PARSING':
      return [
        'The AI could not interpret the action phrase',
        'Rephrase more clearly (e.g., "click on button X in the menu")',
        'Check the LLM Provider configuration (see GET /api/v1/audit/sante)',
      ];
    case 'AI_SELECTOR_NOT_FOUND':
      return [
        'The described element was not found on the page',
        "Add a 'wait 1 second' step before to let the page load",
        'Make sure you navigated/clicked the right element beforehand (closed submenu?)',
      ];
    case 'AI_SELECTOR_INVALID':
      return [
        'The selector proposed by the AI does not match any element',
        'Rephrase the description with more precision',
      ];
    case 'AI_SELECTOR_AMBIGUOUS':
      return [
        'The AI found multiple matching elements',
        "Be more specific (e.g., 'the FIRST button X', 'the button X in the footer')",
      ];
    case 'AI_ELEMENT_NOT_VISIBLE':
      return [
        'The element is hidden (display:none, visibility:hidden, opacity:0)',
        "Add a 'hover X' action before to open the submenu",
        "Add 'wait 1 second' after an action to let the DOM update",
      ];
    case 'AI_ELEMENT_DISABLED':
      return [
        'The element is disabled (disabled / aria-disabled=true)',
        'Check the pre-conditions (required fields filled...)',
      ];
    case 'ACTION_EXECUTION':
      return [
        'Puppeteer action failed (intercepted click, detached element, timeout)',
        "Add 'wait 1 second' before to stabilize the page",
        'Make sure no element overlaps the target (popup, tooltip, modal)',
      ];
    case 'NAVIGATION_POST_ACTION':
      return [
        'The page did not finish loading after the action',
        'Verify that the action actually triggers a navigation',
      ];
    case 'COOKIE_BANNER':
      return [
        'Automatic cookie banner acceptance failed',
        'You can instead use a navigation action: "click on the Accept button of the cookie banner"',
      ];
    case 'AXE_FAILED':
      return [
        'Axe-core could not analyze the page',
        'AI alone can continue if analysisType=full',
      ];
    case 'AI_ANALYSIS':
      return [
        'AI audit enrichment failed (Axe audit is still available)',
        'Check the LLM Provider configuration (see GET /api/v1/audit/sante)',
      ];
    case 'TOKEN_BUDGET':
      return [
        'The DOM is too large even after reduction',
        'The LLM model used has a too limited context',
        'Try gpt-4.1 (1M tokens) instead of gpt-4o (128k)',
      ];
    case 'BROWSER_CRASH':
      return [
        'The Puppeteer browser crashed or the page was closed',
        'Check container resources (memory, CPU)',
      ];
    case 'UNKNOWN':
    default:
      return [
        'Unexpected error, check server logs',
        'Check service health with GET /api/v1/audit/sante',
      ];
  }
}

/**
 * Strips potentially sensitive values out of an HTML dump:
 * - removes the `value="..."` attribute from password inputs
 * - removes `value="..."` from inputs whose name/id/autocomplete hint at a
 *   credential (password, secret, token, card, cvv, ssn...)
 *
 * Best-effort regex cleanup (the DOM dump is only an indicative snapshot).
 */
function stripSensitiveValues(html: string): string {
  return html.replace(/<input\b[^>]*>/gi, (tag) => {
    const isPasswordType = /\btype\s*=\s*["']?password["']?/i.test(tag);
    const hasSensitiveHint =
      /\b(?:name|id|autocomplete)\s*=\s*["'][^"']*(?:pass(?:word)?|secret|token|cvv|cvc|card|credit|ssn|social)[^"']*["']/i.test(
        tag,
      );
    if (!isPasswordType && !hasSensitiveHint) return tag;
    // Drop any value="..."/value='...' attribute.
    return tag.replace(/\svalue\s*=\s*("[^"]*"|'[^']*')/gi, ' value=""');
  });
}

/**
 * Builds a structured ActionErrorResult for the report.
 *
 * Screenshot + DOM capture (returned in the report AND written to disk) is
 * gated behind a debug flag (`debugCapture`). When OFF (the default), nothing
 * is captured nor written to disk — this prevents leaking sensitive page
 * content. When ON, the DOM dump has password/sensitive input values stripped.
 *
 * `debugCapture` defaults to the BALDR_DEBUG_ERROR_CAPTURE env var so existing
 * callers stay safe-by-default without having to thread the flag through.
 */
export async function buildActionError(args: {
  blockIndex: number;
  actionIndex: number;
  blockUrl: string;
  action: string;
  parsedActionType?: string;
  err: unknown;
  page: Page | null;
  context:
    | 'parsing'
    | 'selector'
    | 'action'
    | 'navigation'
    | 'auth'
    | 'audit'
    | 'cookies'
    | 'other';
  debugCapture?: boolean;
}): Promise<ActionErrorResult> {
  const {
    blockIndex,
    actionIndex,
    blockUrl,
    action,
    parsedActionType,
    err,
    page,
    context,
  } = args;
  const debugCapture =
    args.debugCapture ?? process.env['BALDR_DEBUG_ERROR_CAPTURE'] === 'true';
  const cat = categorizeJourneyError(err, context);
  const message = err instanceof Error ? err.message : String(err);

  let errorScreenshot: string | undefined;
  let domAtError: string | undefined;

  if (debugCapture && page && !page.isClosed()) {
    try {
      errorScreenshot = await page.screenshot({
        encoding: 'base64',
        type: 'jpeg',
        quality: 50,
      });
      try {
        const reportsDir = path.resolve(process.cwd(), 'reports');
        await fs.mkdir(reportsDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filepath = path.join(
          reportsDir,
          `journey-error-block${String(blockIndex)}-action${String(actionIndex)}-${ts}.jpg`,
        );
        await fs.writeFile(filepath, Buffer.from(errorScreenshot, 'base64'));
        logger.info({ filepath }, '[JOURNEY] Error screenshot saved to disk');
      } catch (errSave) {
        logger.warn(
          { err: errSave },
          'Failed to save error screenshot to disk',
        );
      }
    } catch (e) {
      logger.warn({ err: e }, 'Failed to capture error screenshot');
    }
    try {
      const html = await page.content();
      const sanitized = stripSensitiveValues(html);
      const cleaned = sanitized
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
      domAtError =
        cleaned.length > 50000
          ? `${cleaned.substring(0, 50000)}\n... [TRUNCATED]`
          : cleaned;
    } catch (e) {
      logger.warn({ err: e }, 'Failed to retrieve DOM at error time');
    }
  }

  const attemptedSelector =
    err instanceof JourneyError ? err.attemptedSelector : undefined;
  const aiConfidenceScore =
    err instanceof JourneyError ? err.aiConfidenceScore : undefined;

  const result: ActionErrorResult = {
    blockIndex,
    actionIndex,
    blockUrl,
    action,
    type: cat.type,
    message,
    details: cat.details,
    suggestions: cat.suggestions,
    timestamp: new Date().toISOString(),
  };
  if (parsedActionType !== undefined)
    result.parsedActionType = parsedActionType;
  if (attemptedSelector !== undefined)
    result.attemptedSelector = attemptedSelector;
  if (aiConfidenceScore !== undefined)
    result.aiConfidenceScore = aiConfidenceScore;
  if (errorScreenshot !== undefined) result.errorScreenshot = errorScreenshot;
  if (domAtError !== undefined) result.domAtError = domAtError;
  return result;
}
