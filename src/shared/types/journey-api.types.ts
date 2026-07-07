/**
 * Types for the v2 accessibility journey API (rework).
 *
 * The POST /api/v1/journey endpoint accepts a list of blocks `{url, actions[]}`,
 * each action being a natural-language string.
 *
 * - Built-ins (heuristic): "scanner" / "accepter cookies" / "attendre N s"
 * - Everything else: navigation classified and executed via the AI
 *
 * The audit is triggered by the `"scanner"` action. When a block omits
 * `actions` entirely, it defaults to a single scan (load + audit).
 * The screenshot is captured on every scan and shown at the top of the page
 * section in the HTML report.
 */

import type {
  AnalysisType,
  ReportFormat,
  ViewportDimensions,
  AuthConfig,
  ConsolidatedAuditReport,
} from './audit-api.types.js';

/**
 * URL block of a journey (normalized internal type).
 * `auth` is always a string key referencing an entry in the authConfigs
 * dict resolved by the adapter.
 */
export interface JourneyBlock {
  /** URL to load for this block (format http(s)://...) */
  url: string;
  /**
   * Resolved authentication key (reference in the internal dict) or "none".
   * If provided and different from "none", authentication is executed BEFORE
   * navigating to `url`.
   */
  auth?: string;
  /**
   * Sequence of natural-language actions to execute in order on the page.
   *
   * Built-ins recognized heuristically:
   * - "scanner" / "audit" / "lancer un scan" → accessibility scan (screenshot
   *   + Axe audit + AI depending on analysisType)
   * - "accepter cookies" / "accepter la bannière" → attempts the automatic
   *   acceptance of the cookie banner (Tarteaucitron, Didomi, OneTrust, etc.)
   * - "attendre N ms" / "attendre N secondes" → fixed pause
   *
   * All other strings are sent to the AI which determines the action type
   * (click, hover, type, select, ...) and finds the CSS selector.
   *
   * Examples:
   * - "cliquer sur le bouton Contact dans le menu"
   * - "saisir 'jean@test.com' dans le champ email"
   * - "survoler La fondation pour ouvrir le sous-menu"
   * - "cliquer sur Envoyer puis attendre la page de confirmation"
   */
  actions: string[];
}

/**
 * A single typed action to perform on a page (v3 public contract).
 *
 * Deterministic built-ins (`scan`, `acceptCookies`, `wait`) and the common
 * interactions (`click`, `hover`, `fill`, `select`) are first-class and fully
 * validatable. `ai` is the escape hatch: a free-form natural-language
 * instruction resolved by the AI when no typed action fits.
 */
export type JourneyAction =
  | { type: 'scan' }
  | { type: 'acceptCookies' }
  | { type: 'wait'; ms: number }
  | { type: 'click'; target: string }
  | { type: 'hover'; target: string }
  | { type: 'fill'; target: string; value: string }
  | { type: 'select'; target: string; value: string }
  | { type: 'ai'; instruction: string };

/**
 * A page of the journey as submitted by the API client (v3).
 */
export interface JourneyPage {
  /** URL to load (http(s)://...). */
  url: string;
  /** Inline authentication for this page; overrides the request-level `auth`. */
  auth?: AuthConfig;
  /**
   * Ordered actions to run on the page. OPTIONAL: when omitted or empty,
   * the page defaults to a single scan (load the URL, then audit).
   */
  actions?: JourneyAction[];
}

/**
 * Audit options shared by every page (v3).
 */
export interface JourneyOptions {
  /** Analysis depth applied to each scan (default: 'full'). */
  analysisType?: AnalysisType;
  /** Output report format (default: 'html'). */
  reportFormat?: ReportFormat;
  /** Specific RGAA rule IDs to restrict the audit to (e.g. ["1.1", "3.1"]). */
  rules?: string[];
  /** Custom window dimensions. */
  viewport?: ViewportDimensions;
}

/**
 * v3 accessibility journey request — a flat, typed contract:
 * `{ name?, options?, auth?, pages: [{ url, auth?, actions? }] }`.
 */
export interface JourneyRequest {
  /** Name of the global audit, used in the report and its filename. */
  name?: string;
  /** Audit options applied to every page. */
  options?: JourneyOptions;
  /** Default authentication applied to every page (inline). */
  auth?: AuthConfig;
  /** Ordered list of pages to traverse (at least one). */
  pages: JourneyPage[];
}

/**
 * Categorized error type for a step of the v2 journey.
 */
export type JourneyErrorType =
  | 'VALIDATION_BODY'
  | 'AUTH_FAILED'
  | 'NAVIGATION_BLOCK'
  | 'AI_PARSING'
  | 'AI_SELECTOR_NOT_FOUND'
  | 'AI_SELECTOR_INVALID'
  | 'AI_SELECTOR_AMBIGUOUS'
  | 'AI_ELEMENT_NOT_VISIBLE'
  | 'AI_ELEMENT_DISABLED'
  | 'ACTION_EXECUTION'
  | 'NAVIGATION_POST_ACTION'
  | 'COOKIE_BANNER'
  | 'AXE_FAILED'
  | 'AI_ANALYSIS'
  | 'TOKEN_BUDGET'
  | 'BROWSER_CRASH'
  | 'UNKNOWN';

/**
 * Structured result of an action that failed.
 */
export interface ActionErrorResult {
  /** Index of the block in journey[] (0-based) */
  blockIndex: number;
  /** Index of the action in actions[] (0-based) */
  actionIndex: number;
  /** URL of the current block */
  blockUrl: string;
  /** Exact action string that failed */
  action: string;
  /** Inferred action type (scan / cookies / wait / click / hover / ...) if parsed */
  parsedActionType?: string;
  /** Categorized error type */
  type: JourneyErrorType;
  /** Main error message */
  message: string;
  /** Technical details */
  details: string;
  /** Resolution suggestions */
  suggestions: string[];
  /** CSS selector attempted by the AI (if applicable) */
  attemptedSelector?: string;
  /** AI confidence score (0-100) */
  aiConfidenceScore?: number;
  /** Screenshot at the time of the error (base64) */
  errorScreenshot?: string;
  /** DOM truncated to 50KB at the time of the error */
  domAtError?: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * v2 consolidated journey report (extends the standard audit report).
 */
export interface ConsolidatedJourneyReport extends ConsolidatedAuditReport {
  /** List of URLs of the traversed blocks */
  journeyUrls: string[];
  /** Total number of blocks defined in the request */
  definedBlocksCount: number;
  /** Number of blocks actually executed (up to the possible stop) */
  executedBlocksCount: number;
  /** Total number of defined actions */
  definedActionsCount: number;
  /** Number of actions actually executed */
  executedActionsCount: number;
  /** List of actions in error (empty on success) */
  actionErrors: ActionErrorResult[];
  /** True if the journey was stopped prematurely */
  journeyStopped: boolean;
}
