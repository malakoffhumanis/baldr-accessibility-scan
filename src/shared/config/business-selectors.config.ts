/**
 * Business-specific DOM selector configuration.
 *
 * Some back-office frameworks expose proprietary attributes/classes that the
 * journey engine must recognize to drive AJAX menus (clickable leaves, submenu
 * containers, AJAX triggers). Those proprietary conventions are NOT hardcoded
 * in the source: they are supplied at runtime via environment variables so the
 * codebase stays framework-agnostic and leaks no internal naming.
 *
 * All lists default to empty — out of the box the engine relies only on
 * universal web conventions (roles, data-action/target, data-testid, …).
 * Configure the BUSINESS_* env vars to teach it a specific framework.
 */

/** An attribute name matched against an exact value (e.g. data-x-type=submenu). */
export interface AttributeMatch {
  name: string;
  value: string;
}

/**
 * Extra selectors/attributes describing a target framework's conventions.
 * They are merged with the universal built-ins at call sites.
 */
export interface BusinessSelectorsConfig {
  /** CSS selectors appended to the clickable-candidate query (e.g. `[data-x-code]`). */
  clickableSelectors: string[];
  /** CSS classes marking a menu CONTAINER vs a leaf (e.g. `menu-folder`). */
  containerClasses: string[];
  /** Attribute=value pairs marking a menu CONTAINER (e.g. data-x-type=submenu). */
  containerAttributes: AttributeMatch[];
  /** Attribute names (priority order) treated as stable/unique for a selector. */
  stableAttributes: string[];
  /** Attribute names whose mere presence marks an AJAX trigger. */
  ajaxTriggerAttributes: string[];
}

/** Neutral default: no business-specific convention configured. */
export const EMPTY_BUSINESS_SELECTORS: BusinessSelectorsConfig = {
  clickableSelectors: [],
  containerClasses: [],
  containerAttributes: [],
  stableAttributes: [],
  ajaxTriggerAttributes: [],
};

// ─── Universal (framework-agnostic) baseline ────────────────────────────────

/** Attribute names always considered stable, after any business-specific ones. */
const BASE_STABLE_ATTRIBUTES = [
  'data-testid',
  'data-cy',
  'data-test',
  'data-action',
  'data-target',
  'data-id',
  'data-key',
];

/**
 * Stable attribute names in priority order: business-specific first (so a
 * framework's own code wins), then the universal fallbacks.
 */
export const buildStableAttributes = (
  cfg: BusinessSelectorsConfig,
): string[] => [...cfg.stableAttributes, ...BASE_STABLE_ATTRIBUTES];

/** Appends the business clickable selectors to a site-specific base query. */
export const appendClickableSelectors = (
  base: string,
  cfg: BusinessSelectorsConfig,
): string =>
  cfg.clickableSelectors.length > 0
    ? `${base}, ${cfg.clickableSelectors.join(', ')}`
    : base;

// ─── Env parsing ─────────────────────────────────────────────────────────────

/** Parses a comma-separated env value into a trimmed, non-empty list. */
const parseList = (raw: string | undefined): string[] =>
  raw == null
    ? []
    : raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

/** Parses `name=value` pairs (comma-separated) into AttributeMatch entries. */
const parseAttributeMatches = (raw: string | undefined): AttributeMatch[] =>
  parseList(raw)
    .map((entry) => {
      const eq = entry.indexOf('=');
      if (eq <= 0) return null;
      return {
        name: entry.slice(0, eq).trim(),
        value: entry.slice(eq + 1).trim(),
      };
    })
    .filter((m): m is AttributeMatch => m !== null && m.name.length > 0);

/**
 * Builds the business selectors config from raw environment values.
 * Every field is optional; missing values yield empty lists.
 */
export const loadBusinessSelectors = (env: {
  BUSINESS_CLICKABLE_SELECTORS?: string;
  BUSINESS_CONTAINER_CLASSES?: string;
  BUSINESS_CONTAINER_ATTRIBUTES?: string;
  BUSINESS_STABLE_ATTRIBUTES?: string;
  BUSINESS_AJAX_TRIGGER_ATTRIBUTES?: string;
}): BusinessSelectorsConfig => ({
  clickableSelectors: parseList(env.BUSINESS_CLICKABLE_SELECTORS),
  containerClasses: parseList(env.BUSINESS_CONTAINER_CLASSES),
  containerAttributes: parseAttributeMatches(env.BUSINESS_CONTAINER_ATTRIBUTES),
  stableAttributes: parseList(env.BUSINESS_STABLE_ATTRIBUTES),
  ajaxTriggerAttributes: parseList(env.BUSINESS_AJAX_TRIGGER_ATTRIBUTES),
});
