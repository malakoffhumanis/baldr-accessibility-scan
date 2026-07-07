import type { IAxeResult } from '@shared/types/audit.types.js';
import type { IAuthConfigs } from '@shared/types/auth.types.js';
import type {
  JourneyBlock,
  ActionErrorResult,
} from '@shared/types/journey-api.types.js';

/**
 * Internal journey options, produced by
 * `convertJourneyRequestToOptions`.
 */
export interface IJourneyInternalOptions {
  name?: string;
  blocks: JourneyBlock[];
  authConfigs: IAuthConfigs;
  analysisType: 'static' | 'intel' | 'full';
  specificRules?: string[];
  reportFormat: 'html' | 'json' | 'csv';
  viewport?: { width: number; height: number };
}

/**
 * Aggregated result of a complete journey — list of scans + execution
 * metadata (defined vs executed blocks/actions, errors, duration).
 */
export interface IJourneyExecutionResult {
  results: IAxeResult[];
  journeyUrls: string[];
  definedBlocksCount: number;
  executedBlocksCount: number;
  definedActionsCount: number;
  executedActionsCount: number;
  actionErrors: ActionErrorResult[];
  journeyStopped: boolean;
  durationMs: number;
}

/**
 * Serialized report ready to be served as an HTTP response.
 */
export interface IJourneyReport {
  content: string;
  contentType: string;
  filename?: string;
}
