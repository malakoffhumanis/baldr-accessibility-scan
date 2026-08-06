/**
 * Internal authentication configuration types.
 *
 * BALDR authenticates against an audited site with one of two modes:
 *
 * - `auto`   — credentials (`username`/`password`) that the engine applies to
 *              whatever the site presents (native HTTP popup or HTML login
 *              form, single- or two-step). Fully automated.
 * - `manual` — no credentials: BALDR opens a visible browser and the operator
 *              authenticates by hand (2FA/MFA included). The engine resumes the
 *              audit once the operator signals completion (Enter in the
 *              terminal or the browser reaching the target URL). Local /
 *              interactive use only — never in production (headless server).
 *
 * The API-facing equivalents (without the `I` prefix) live in
 * `audit-api.types.ts`; the adapter maps between the two. "No auth" is
 * represented by the absence of a config (a public page).
 */

/**
 * Auto authentication configuration: provide only credentials, the engine
 * adapts (native popup or HTML form, single- or two-step).
 */
export interface IAutoAuthConfig {
  type: 'auto';
  username: string;
  password: string;
  /** Optional explicit login page to visit first (auto-detected otherwise). */
  loginUrl?: string;
}

/**
 * Manual authentication configuration: no credentials. BALDR opens a visible
 * browser at `loginUrl` (or the target URL) and waits while the operator logs
 * in by hand — including any 2FA/MFA step. Completion is signalled by pressing
 * Enter in the terminal or by the browser landing on the target URL.
 */
export interface IManualAuthConfig {
  type: 'manual';
  /** Optional explicit page to open first (the target URL otherwise). */
  loginUrl?: string;
  /**
   * Max time (ms) to wait for the operator before giving up. Defaults to
   * `DEFAULT_MANUAL_TIMEOUT_MS` (5 min) in the manual strategy.
   */
  timeoutMs?: number;
  /**
   * When true, resume ONLY when the operator presses Enter in the terminal
   * (URL auto-detection disabled). Recommended for heavy multi-redirect SSO
   * (Microsoft 365 / SharePoint), where the URL bar shows the target before
   * the page has finished loading. Requires an interactive terminal; falls
   * back to URL auto-detection when none is available.
   */
  waitForManualConfirm?: boolean;
}

/**
 * Authentication configuration (discriminated by `type`).
 */
export type IAuthConfig = IAutoAuthConfig | IManualAuthConfig;

/**
 * Dictionary of authentication configurations.
 */
export type IAuthConfigs = Record<string, IAuthConfig>;
