/**
 * Types for intelligent RGAA rules and AI analysis
 */

/**
 * Configuration of an RGAA rule
 */
export interface IRGAARule {
  /** Rule ID (e.g. "1.1") */
  id: string;
  /** Technical Axe-Core rule ID */
  ruleId: string;
  /** Rule title */
  title: string;
  /** Detailed description */
  description: string;
  /** RGAA reference */
  rgaaReference: string;
  /** WCAG reference */
  wcagReference: string | null;
  /** RGAA theme (Images, Colors, Forms, etc.) */
  theme: string;
  /** WCAG level (A, AA, AAA) */
  level: 'A' | 'AA' | 'AAA' | null;
  /** Rule applicability conditions */
  applicability?: {
    description: string;
    signals?: {
      selectors: string[];
      minimumCount: number;
    };
    nonApplicableCases: string[];
  };
  /** Test scenarios */
  testScenarios: Record<string, ITestScenario>;
  /** AI analysis configuration */
  aiAnalysisConfig: IAIAnalysisConfig;
  /** Automated checks */
  automatedChecks: string[];
  /** Manual checks */
  manualChecks: string[];
  /** Common errors */
  commonErrors: ICommonError[];
  /** Resources */
  resources: string[];
}

/**
 * Test scenario of a rule
 */
export interface ITestScenario {
  /** Scenario description */
  description: string;
  /** Tests to perform */
  tests: ITestCase[];
}

/**
 * Individual test case
 */
export interface ITestCase {
  /** Unique test ID */
  id: string;
  /** Reference to the official RGAA test (e.g. "Test 1.4.1") */
  rgaaTestRef?: string;
  /** Test description */
  description: string;
  /** Test methodology (steps) */
  methodology?: string[];
  /** CSS selector to target the elements */
  selector: string | null;
  /** Expected result */
  expected: string;
  /** Severity (critical, serious, moderate, minor) */
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  /** Finding type */
  type?: 'violation' | 'warning' | 'recommendation';
  /** Can be automated */
  automatable?: boolean;
  /** Requires AI analysis */
  aiAnalysis?: boolean;
  /** Context for the AI prompt */
  aiPromptContext?: Record<string, boolean | number | string>;
}

/**
 * AI analysis configuration
 */
export interface IAIAnalysisConfig {
  /** AI analysis enabled */
  enabled: boolean;
  /** System role for the AI */
  systemRole?: string;
  /** Inputs needed for the analysis */
  inputs?: {
    dom?: boolean;
    screenshots?: boolean;
    ruleMetadata?: boolean;
  };
  /** DOM extraction rules */
  extractionRules?: Record<string, unknown>;
  /** AI prompt configuration */
  analysisPrompt?: {
    tasks?: string[];
    /** Important instructions for the prompt */
    important?: string[];
    outputFormat?: {
      description?: string;
      strictJsonOnly?: boolean;
      structure?: Record<string, string>;
      findingsFormat?: Record<string, string>;
    };
  };
  /** Correction suggestions */
  correctionSuggestions?: {
    enabled: boolean;
    includeCodeExamples: boolean;
    prioritization: string;
  };
}

/**
 * Documented common error
 */
export interface ICommonError {
  /** Error description */
  error: string;
  /** Example of erroneous code */
  example: string;
  /** Corrected code */
  correction: string;
  /** Explanation */
  explanation: string;
}

/**
 * AI analysis result for a rule
 */
export interface IAIRuleAnalysis {
  /** Rule ID */
  ruleId: string;
  /** Compliant or not */
  compliant: boolean;
  /** Overall severity */
  severity: 'critical' | 'serious' | 'moderate' | 'minor';
  /** Analysis summary */
  summary: string;
  /** Total number of analyzed elements */
  totalElements?: number;
  /** Detailed findings */
  findings: IFinding[];
  /** Enriched intelligent analysis */
  intelligentAnalysis?: {
    contextualInsights?: string;
    semanticRelevance?: string;
    userImpact?: string;
  };
  /** Optional error */
  error?: string;
}

/**
 * Individual finding of a rule
 */
export interface IFinding {
  /** Finding type */
  type: 'violation' | 'warning' | 'recommendation';
  /** Affected element (CSS selector) */
  element?: string;
  /** Description of the issue */
  issue: string;
  /** Correction recommendation */
  recommendation: string;
  /** WCAG reference */
  wcagReference?: string;
  /** RGAA reference (criterion of the analyzed rule) */
  rgaaReference?: string;
}

/**
 * Collection of RGAA rules
 */
export interface IRGAARulesCollection {
  /** RGAA version */
  version: string;
  /** Last update date */
  lastUpdated: string;
  /** Rules indexed by ID */
  rules: Record<string, IRGAARule>;
}
