/**
 * Adapter for POST /api/v1/journey (v3 contract).
 *
 * Converts the public, typed request
 *   `{ name?, options?, auth?, pages: [{ url, auth?, actions? }] }`
 * into the internal options consumed by the orchestration, which still works
 * on natural-language action strings + an auth-config dictionary keyed by id.
 *
 * Responsibilities:
 * - normalize inline auth (request-level default + per-page override) into the
 *   internal authConfigs dict, returning the resolved key;
 * - map each typed action to the canonical NL string understood by the engine;
 * - default a page without actions to a single scan.
 */

import type { AuthConfig } from '@shared/types/audit-api.types.js';
import type { IAuthConfigs } from '@shared/types/auth.types.js';
import type {
  JourneyAction,
  JourneyBlock,
  JourneyPage,
  JourneyRequest,
} from '@shared/types/journey-api.types.js';
import type { IJourneyInternalOptions } from '@shared/services/journey/journey-orchestration.types.js';

import { normalizeAuthConfig } from './audit-api.adapter.js';

/** Internal prefix for auto-generated auth keys (reserved). */
const INTERNAL_AUTH_PREFIX = '__auth_';

/**
 * Default actions for a page that omits (or leaves empty) its `actions`:
 * a single scan — the page is loaded by the navigation step, then audited.
 */
const DEFAULT_PAGE_ACTIONS = ['scanner'];

/**
 * Maps a typed action to the canonical natural-language string understood by
 * the action parser. Built-ins hit deterministic heuristics; interactions are
 * phrased so the AI resolves the selector; `ai` passes the raw instruction.
 */
function actionToInternal(action: JourneyAction): string {
  switch (action.type) {
    case 'scan':
      return 'scanner';
    case 'acceptCookies':
      return 'accepter les cookies';
    case 'wait':
      return `attendre ${String(action.ms)} ms`;
    case 'click':
      return `cliquer sur ${action.target}`;
    case 'hover':
      return `survoler ${action.target}`;
    case 'fill':
      return `saisir "${action.value}" dans ${action.target}`;
    case 'select':
      return `sélectionner "${action.value}" dans ${action.target}`;
    case 'ai':
      return action.instruction;
  }
}

/**
 * Normalizes an inline auth config into the authConfigs dict and returns the
 * key to reference it. (No auth is expressed by omitting the field upstream,
 * never reaching this function.)
 */
function injectInlineAuth(
  authConfigs: IAuthConfigs,
  config: AuthConfig,
  key: string,
): string {
  authConfigs[key] = normalizeAuthConfig(config);
  return key;
}

/**
 * Converts a v3 JourneyRequest into internal orchestration options.
 */
export function convertJourneyRequestToOptions(
  req: JourneyRequest,
): IJourneyInternalOptions {
  const authConfigs: IAuthConfigs = {};

  // Request-level default auth → injected once under a reserved key.
  let defaultAuthKey: string | undefined;
  if (req.auth !== undefined) {
    defaultAuthKey = injectInlineAuth(
      authConfigs,
      req.auth,
      `${INTERNAL_AUTH_PREFIX}default`,
    );
  }

  const blocks: JourneyBlock[] = req.pages.map(
    (page: JourneyPage, index: number): JourneyBlock => {
      const authKey =
        page.auth === undefined
          ? defaultAuthKey
          : injectInlineAuth(
              authConfigs,
              page.auth,
              `${INTERNAL_AUTH_PREFIX}page_${String(index)}`,
            );

      const actions =
        page.actions && page.actions.length > 0
          ? page.actions.map(actionToInternal)
          : DEFAULT_PAGE_ACTIONS;

      return { url: page.url, auth: authKey, actions };
    },
  );

  const result: IJourneyInternalOptions = {
    blocks,
    authConfigs,
    analysisType: req.options?.analysisType ?? 'full',
    reportFormat: req.options?.reportFormat ?? 'html',
  };
  if (req.name !== undefined) result.name = req.name;
  if (req.options?.rules !== undefined)
    result.specificRules = req.options.rules;
  if (req.options?.viewport) {
    result.viewport = {
      width: req.options.viewport.width,
      height: req.options.viewport.height,
    };
  }
  return result;
}
