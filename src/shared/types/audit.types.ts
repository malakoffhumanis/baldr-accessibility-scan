/**
 * Types for accessibility audits
 */

/**
 * Result of an Axe-Core test on a page
 */
export interface IAxeResult {
  /** Name of the tested page */
  name?: string;
  /** URL of the tested page */
  url: string;
  /** Test timestamp */
  timestamp: string;
  /** Authentication required */
  authenticated?: boolean;
  /** Authentication method used */
  authMethod?: 'form' | 'session' | 'none' | 'adfs';
  /** Test information */
  testInfo: ITestInfo;
  /** Results summary */
  summary: IAxeSummary;
  /** List of detected violations */
  violations: IAxeViolation[];
  /** List of passed tests */
  passes: IAxePass[];
  /** List of incomplete tests */
  incomplete: IAxeIncomplete[];
  /** List of inapplicable tests */
  inapplicable: IAxeInapplicable[];
  /** Optional enriched AI analysis */
  aiEnrichedResult?: IAIEnrichedResult;
  /** Detailed error if the AI analysis failed */
  aiAnalysisError?: IAIAnalysisError;
  /**
   * Screenshot in base64 (JPEG). Populated by /api/v1/journey to
   * embed the screenshot at the top of each page section of the HTML report,
   * including in `static` mode (where aiEnrichedResult.screenshot is absent).
   */
  screenshot?: string;
}

/**
 * Information about the test environment
 */
export interface ITestInfo {
  /** Browser user agent */
  userAgent: string;
  /** Viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };
  /** Page title */
  title: string;
}

/**
 * Summary of Axe-Core results
 */
export interface IAxeSummary {
  /** Number of violations */
  violations: number;
  /** Number of passed tests */
  passes: number;
  /** Number of incomplete tests */
  incomplete: number;
  /** Number of inapplicable tests */
  inapplicable: number;
}

/**
 * Detected accessibility violation
 */
export interface IAxeViolation {
  /** Axe rule ID */
  id: string;
  /** Impact of the violation */
  impact: 'minor' | 'moderate' | 'serious' | 'critical';
  /** Description of the violation */
  description: string;
  /** Help message */
  help: string;
  /** Documentation URL */
  helpUrl: string;
  /** Associated tags (WCAG, RGAA, etc.) */
  tags: string[];
  /** Affected DOM nodes */
  nodes: IAxeNode[];
}

/**
 * DOM node affected by a violation
 */
export interface IAxeNode {
  /** HTML of the element */
  html: string;
  /** CSS selector of the element (can be complex with shadow DOM) */
  target: string[] | string;
  /** Failure summary */
  failureSummary?: string;
  /** Details of the rules that failed */
  any?: unknown[];
  /** Details of the rules that passed */
  all?: unknown[];
  /** Details of the inapplicable rules */
  none?: unknown[];
}

/**
 * Passed test
 */
export interface IAxePass {
  id: string;
  impact: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: IAxeNode[];
}

/**
 * Incomplete test
 */
export interface IAxeIncomplete {
  id: string;
  impact: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
  nodes: IAxeNode[];
}

/**
 * Inapplicable test
 */
export interface IAxeInapplicable {
  id: string;
  impact: string | null;
  tags: string[];
  description: string;
  help: string;
  helpUrl: string;
}

/**
 * Enriched AI analysis result
 */
export interface IAIEnrichedResult {
  /** Analyses per RGAA rule */
  ruleAnalyses: {
    ruleId: string;
    compliant: boolean;
    severity: 'critical' | 'serious' | 'moderate' | 'minor';
    summary: string;
    totalElements?: number;
    findings: IFinding[];
    intelligentAnalysis?: {
      contextualInsights?: string;
      semanticRelevance?: string;
      userImpact?: string;
    };
    error?: string;
  }[];
  /** Total number of analyzed rules */
  totalRulesAnalyzed: number;
  /** Summary of AI statistics */
  summary: {
    violations: number;
    compliant: number;
    notApplicable: number;
    errors: number;
  };
  /** Analysis metadata */
  metadata: {
    model: string;
    timestamp: string;
    analysisType: 'static' | 'intel' | 'full';
    tokenUsage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  };
  /** Screenshot (base64) */
  screenshot?: string;
  /** Extracted DOM */
  extractedDOM?: string;
}

/**
 * Detailed finding
 */
export interface IFinding {
  /** Finding type */
  type: 'violation' | 'warning' | 'recommendation';
  /** Affected element */
  element?: string;
  /** Description of the issue */
  issue: string;
  /** Recommendation */
  recommendation: string;
  /** WCAG reference */
  wcagReference?: string;
  /** RGAA reference (criterion of the analyzed rule) */
  rgaaReference?: string;
}

/**
 * Error details of the AI analysis
 */
export interface IAIAnalysisError {
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
  /** Technical details of the error */
  details: string;
  /** Resolution suggestions */
  suggestions: string[];
  /** Error timestamp */
  timestamp: string;
}

/**
 * Configuration options for an audit
 */
export interface IAuditOptions {
  /** URL to audit */
  url: string;
  /** Page name (optional) */
  name?: string;

  // Reference to a predefined auth configuration
  /** Name of the authentication configuration to use */
  auth?: string;

  /** Viewport options */
  viewport?: {
    width: number;
    height: number;
  };
  /** Analysis type (static, intel, full) */
  analysisType?: 'static' | 'intel' | 'full';
  /** Specific rules to analyze (by RGAA ID, e.g. "1.1", "3.2") */
  specificRules?: string[];
  /** Desired report format */
  reportFormat?: 'html' | 'json' | 'csv' | 'all';
}

/** Recurring RGAA issue on ≥ 2 audited pages. */
export interface ICommonProblem {
  title: string;
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  rgaaCriteria: string[];
  wcagReferences: string[];
  description: string;
  recommendation: string;
  codeExample?: string;
}

/** Global synthesis of common problems. */
export interface ICommonProblemsAnalysis {
  problems: ICommonProblem[];
  generatedAt: string;
  basedOnPages: number;
  error?: string;
}

/**
 * Report generation result
 */
export interface IReportResult {
  /** Path of the generated HTML file */
  htmlPath?: string;
  /** Path of the generated JSON file */
  jsonPath?: string;
  /** Path of the generated CSV file */
  csvPath?: string;
  /** Report summary (Axe) */
  summary: IAxeSummary;
  /** AI summary (if available) */
  aiSummary?: {
    violations: number;
    compliant: number;
    notApplicable: number;
    errors: number;
  };
}

/**
 * Re-export of RGAA types
 */
export type { IAIRuleAnalysis } from './rgaa-rules.types.js';
export type {
  IRGAARule,
  ITestScenario,
  ITestCase,
  IAIAnalysisConfig,
  ICommonError,
  IRGAARulesCollection,
} from './rgaa-rules.types.js';
