/**
 * Types for the OpenAPI v3 accessibility audit API
 * All types, attributes and comments are in English.
 */

/**
 * Accessibility analysis type
 * - static: Axe-Core analysis only (fast, 5-10s/page)
 * - intel: AI analysis only (in-depth, 30-60s/page)
 * - full: Axe-Core + AI analysis (complete)
 */
export type AnalysisType = 'static' | 'intel' | 'full';

/**
 * Generated report format
 * - html: Interactive HTML report with styles and charts
 * - json: Structured JSON data for automated processing
 * - csv: CSV export for Excel/Google Sheets
 */
export type ReportFormat = 'html' | 'json' | 'csv';

/**
 * Report format(s) asked for by the client: a single value, or a list such as
 * `["html", "json"]` to produce one report per format in the same run. Lists
 * are CLI-only, since an HTTP response carries one body.
 */
export type RequestedReportFormat = ReportFormat | ReportFormat[];

/** Requested formats once normalized: deduped and never empty. */
export type ReportFormats = [ReportFormat, ...ReportFormat[]];

/**
 * Authentication type
 * - none: No authentication (public page)
 * - form: HTML form authentication
 * - adfs: Microsoft ADFS/OAuth authentication
 * - manual: Manual authentication by the user
 */
export type AuthType = 'auto' | 'none' | 'form' | 'adfs' | 'manual';

/**
 * Impact level of a WCAG violation
 * - minor: Minor impact, easily worked around
 * - moderate: Moderate impact, may hinder some users
 * - serious: Serious impact, blocks access for some users
 * - critical: Critical impact, blocks access for many users
 */
export type ImpactLevel = 'minor' | 'moderate' | 'serious' | 'critical';

/**
 * Auto authentication configuration (credentials).
 * Provide just an identifier and a password; the engine adapts to whatever the
 * site presents (native HTTP popup or HTML login form, single- or two-step).
 * `type` may be omitted — it defaults to "auto". Omit the whole `auth` field
 * for a public page (no auth).
 */
export interface AutoAuthConfig {
  /** Discriminator; defaults to "auto" when omitted. */
  type?: 'auto';
  /** Login identifier (username or email) */
  username: string;
  /** Login password */
  password: string;
  /** Optional explicit login page to visit first (auto-detected otherwise) */
  loginUrl?: string;
}

/**
 * Manual authentication configuration (interactive, local use only).
 * No credentials: BALDR opens a visible browser and waits while the operator
 * authenticates by hand (2FA/MFA included). Resumes on Enter in the terminal
 * or when the browser reaches the target URL. Not available in production.
 */
export interface ManualAuthConfig {
  /** Discriminator selecting interactive manual authentication. */
  type: 'manual';
  /** Optional explicit page to open first (the target URL otherwise). */
  loginUrl?: string;
  /**
   * Max time (ms) to wait for the operator before giving up.
   * Default 300000 (5 min); range 10000..1800000.
   */
  timeoutMs?: number;
  /**
   * When true, resume only when the operator presses Enter in the terminal
   * (URL auto-detection disabled). Recommended for Microsoft 365 / SharePoint
   * and other heavy multi-redirect SSO. Requires an interactive terminal.
   */
  waitForManualConfirm?: boolean;
}

/**
 * Authentication configuration, discriminated by `type`:
 * - `auto` (default): credentials the engine applies automatically;
 * - `manual`: interactive manual login (local only).
 * "No auth" is expressed by omitting the field.
 */
export type AuthConfig = AutoAuthConfig | ManualAuthConfig;

/**
 * Browser window dimensions
 */
export interface ViewportDimensions {
  /** Width in pixels (minimum: 320) */
  width: number;
  /** Height in pixels (minimum: 240) */
  height: number;
}

/**
 * Information about the test environment
 */
export interface TestInfo {
  /** Browser user agent used for the test */
  userAgent: string;
  /** Browser window dimensions */
  viewport: ViewportDimensions;
  /** HTML title of the tested page */
  pageTitle: string;
}

/**
 * Summary of Axe-Core audit results
 */
export interface AxeResultsSummary {
  /** Total number of detected accessibility violations */
  violationCount: number;
  /** Number of passed accessibility tests */
  passedCount: number;
  /** Number of incomplete tests requiring manual verification */
  incompleteCount: number;
  /** Number of tests inapplicable to this page */
  inapplicableCount: number;
}

/**
 * DOM element affected by a violation
 */
export interface DOMElement {
  /** HTML code of the affected element */
  html: string;
  /** CSS selector to target the element */
  selector: string | string[];
  /** Explanatory summary of the test failure */
  failureSummary?: string;
}

/**
 * Accessibility violation detected by Axe-Core
 */
export interface AccessibilityViolation {
  /** Unique identifier of the Axe-Core rule */
  id: string;
  /** Impact level of the violation on accessibility */
  impact: ImpactLevel;
  /** Detailed description of the violation */
  description: string;
  /** Help message to fix the violation */
  help: string;
  /** URL to the full documentation of the rule */
  helpUrl: string;
  /** Associated tags (WCAG, RGAA, section508, best-practice, etc.) */
  tags: string[];
  /** List of DOM elements affected by this violation */
  nodes: DOMElement[];
}

/**
 * Detailed finding identified by the AI analysis
 */
export interface DetailedFinding {
  /** Finding type */
  type: 'violation' | 'warning' | 'recommendation';
  /** HTML code of the affected element (optional) */
  element?: string;
  /** Description of the identified accessibility issue */
  issue: string;
  /** Correction recommendation proposed by the AI */
  recommendation: string;
  /** WCAG reference associated with the issue (e.g. "1.1.1", "2.4.1") */
  referenceWCAG?: string;
}
export type AIScoreClass = 'compliant' | 'nonCompliant' | 'notApplicable';

/**
 * AI analysis of a specific RGAA rule
 */
export interface AIRuleAnalysis {
  /** Identifier of the RGAA rule (e.g. "1.1", "3.1") */
  ruleId: string;
  /** Full title of the rule */
  ruleTitle: string;
  /** Compliance status of the page with respect to this rule */
  status: 'compliant' | 'non-compliant' | 'not-applicable';
  /** Confidence score of the AI analysis (0-100) */
  confidenceScore: number;
  /** List of detailed findings by the AI */
  findings: DetailedFinding[];
  /** General recommendations for this rule */
  recommendations: string[];
  /** WCAG references associated with this rule */
  wcagReferences: string[];

  scoreClass?: AIScoreClass;
  violationCount?: number;
  hasError?: boolean;
}

export type AccessibilityLevelLabel =
  'Excellent' | 'Bon' | 'Moyen' | 'Faible' | 'Critique';

export interface AxeRuleOutcome {
  /** Axe rule identifier */
  id: string;
  impact: string | null;
  /** Associated tags (WCAG, RGAA, best-practice, etc.) */
  tags: string[];
  /** Help message of the rule */
  help: string;
  /** Number of DOM nodes matched by the rule */
  nodeCount: number;
}

/** Number of Axe violations (rules) per impact level */
export interface ViolationsByImpact {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  other: number;
}

export interface SummaryCards {
  /** Axe violations + AI violation findings */
  violations: number;
  /** Axe passes + AI compliant rules */
  passes: number;
  /** Axe incomplete + AI non-applicable rules */
  incomplete: number;
  /** Sources merged into the cards ('ai' when the page has no Axe test) */
  source: 'axe' | 'ai' | 'axe+ai';
}

/** RGAA criteria counters of one thematic */
export interface ThematicScoring {
  /** RGAA thematic identifier (1-13) */
  id: number;
  /** RGAA thematic name */
  name: string;
  compliant: number;
  nonCompliant: number;
  notApplicable: number;
  score: number | null;
}

/** AI analysis counters, as classified for the RGAA score */
export interface AIScoring {
  /** Number of RGAA rules analyzed by the AI */
  analyzed: number;
  /** Rules classified compliant */
  compliant: number;
  /** Rules classified non-compliant (≥ 1 violation finding) */
  nonCompliant: number;
  /** Rules classified non-applicable (incl. advisory-only and errors) */
  notApplicable: number;
  /** Rules whose analysis failed */
  errors: number;
  nonCompliantDeclared: number;
  /** Number of findings per type over all rules */
  findings: {
    violation: number;
    warning: number;
    recommendation: number;
  };
}

export interface PageScoring {
  /** RGAA score in % (0-100) */
  score: number;
  /** Qualitative level derived from the score */
  level: AccessibilityLevelLabel;
  /** Compliant criteria (Axe passes + AI compliant) */
  compliant: number;
  /** Non-compliant criteria */
  nonCompliant: number;
  /** Non-applicable criteria (106 - C - NC) */
  notApplicable: number;
  /** Counters per RGAA thematic (13 entries) */
  thematics: ThematicScoring[];
  /** Figures of the three summary cards */
  cards: SummaryCards;
  /** Axe violations per impact level */
  violationsByImpact: ViolationsByImpact;
  /** Sum of the DOM nodes affected by the Axe violations */
  affectedNodes: number;
  /** AI counters, null when the page has no AI result */
  ai: AIScoring | null;
}

/** Global RGAA scoring of the consolidated report */
export interface ReportScoring {
  /** Global RGAA score in % (C and NC summed over the pages) */
  score: number;
  /** Qualitative level derived from the global score */
  level: AccessibilityLevelLabel;
  /** Sum of the compliant criteria of the pages */
  compliant: number;
  /** Sum of the non-compliant criteria of the pages */
  nonCompliant: number;
  /** Sum of the non-applicable criteria of the pages */
  notApplicable: number;
  /** Number of scored pages */
  pageCount: number;
  /** Sum of the summary cards of the pages */
  cards: {
    violations: number;
    passes: number;
    incomplete: number;
  };
  /** Sum of the Axe violations per impact level */
  violationsByImpact: ViolationsByImpact;
  /** Sum of the affected DOM nodes */
  affectedNodes: number;
}

/**
 * Summary of the AI analysis
 */
export interface AIAnalysisSummary {
  /** Number of accessibility violations detected by the AI */
  violationCount: number;
  /** Number of compliant rules according to the AI */
  compliantRulesCount: number;
  /** Number of rules inapplicable to this page */
  inapplicableRulesCount: number;
}

/**
 * Result enriched by the AI analysis (optional)
 */
export interface AIEnrichedResult {
  /** List of detailed analyses per RGAA rule */
  ruleAnalyses: AIRuleAnalysis[];
  /** Total number of RGAA rules analyzed by the AI */
  rulesAnalyzedCount: number;
  /** AI analysis metadata */
  metadata: {
    /** AI model used (e.g. "gpt-4o", "gpt-4-turbo") */
    model: string;
    /** Date and time of the analysis (ISO 8601 format) */
    timestamp: string;
    /** Type of analysis performed */
    analysisType: AnalysisType;
  };
  /** Global summary of the AI results */
  summary: AIAnalysisSummary;
  /** Screenshot encoded in base64 (optional) */
  screenshot?: string;
  /** HTML DOM extracted from the page (optional) */
  extractedDom?: string;
}

/**
 * Audit result of a web page
 */
export interface PageAuditResult {
  /** Descriptive name of the audited page */
  pageName: string;
  /** Full URL of the audited page */
  url: string;
  /** Date and time of the audit (ISO 8601 format) */
  timestamp: string;
  /** Indicates whether authentication was required for this page */
  authRequired: boolean;
  /** Authentication method used */
  authMethod: AuthType;
  /** Information about the test environment */
  testInfo: TestInfo;
  /** Summary of Axe-Core results */
  axeSummary: AxeResultsSummary;
  /** Full list of detected accessibility violations */
  violations: AccessibilityViolation[];
  passes?: AxeRuleOutcome[];
  incomplete?: AxeRuleOutcome[];
  scoring?: PageScoring;
  /** Result enriched by the AI analysis (available in 'intel' or 'full' mode) */
  aiResult?: AIEnrichedResult;
  /** Error details if the AI analysis failed */
  aiError?: {
    /** Main error message */
    message: string;
    /** Categorized error type */
    type:
      | 'CONFIGURATION'
      | 'CONNECTIVITY'
      | 'AUTHENTICATION'
      | 'TIMEOUT'
      | 'PROXY'
      | 'DEPLOYMENT'
      | 'RATE_LIMIT'
      | 'UNKNOWN';
    /** Technical details */
    details: string;
    /** Resolution suggestions */
    suggestions: string[];
    /** Error timestamp */
    timestamp: string;
  };
}

/**
 * Consolidated audit report (multiple pages)
 */
export interface ConsolidatedAuditReport {
  /** Name of the global audit */
  name?: string;
  /** Date and time the report was generated (ISO 8601 format) */
  timestamp: string;
  /** Total number of audited URLs */
  urlCount: number;
  /** List of audit results per page */
  results: PageAuditResult[];
  /** Total audit duration in milliseconds */
  durationMs: number;
  /** Global RGAA scoring */
  scoring?: ReportScoring;
}

/**
 * API response on success
 */
export interface SuccessResponse<T = unknown> {
  /** Indicates the success of the operation (always true) */
  success: true;
  /** Response data */
  data: T;
  /** Additional response metadata */
  metadata?: {
    /** Date and time of the response (ISO 8601 format) */
    timestamp: string;
    /** API version */
    version: string;
    /** Unique request identifier for traceability */
    requestId?: string;
  };
}

/**
 * Details of an API error
 */
export interface ErrorDetail {
  /** Technical error code (e.g. "VALIDATION_ERROR", "SERVER_ERROR") */
  code: string;
  /** Descriptive error message */
  message: string;
  /** Additional details about the error (optional) */
  details?: Record<string, unknown>;
}

/**
 * API response on error
 */
export interface ErrorResponse {
  /** Indicates the failure of the operation (always false) */
  success: false;
  /** Structured details of the error */
  error: ErrorDetail;
  /** Processing duration before the error in milliseconds (optional) */
  durationMs?: number;
}

/**
 * Union of the possible API response types
 */
export type APIResponse<T = unknown> = SuccessResponse<T> | ErrorResponse;

/**
 * Health status of the audit service
 */
export interface HealthStatus {
  /** Service name (always "audit") */
  service: string;
  /** Current state of the service */
  status: 'healthy' | 'degraded' | 'unavailable';
  /** Date and time of the check (ISO 8601 format) */
  timestamp: string;
  /** Puppeteer browser status */
  browser?: {
    /** Indicates whether the browser is launched and operational */
    running: boolean;
    /** Number of currently open pages */
    pageCount: number;
  };
}
