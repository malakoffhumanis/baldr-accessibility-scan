/**
 * Internal authentication configuration types.
 *
 * BALDR authenticates against an audited site with a single, adaptive mode:
 * credentials (`username`/`password`) that the engine applies to whatever the
 * site presents (native HTTP popup or HTML login form). The API-facing
 * equivalent (without the `I` prefix) lives in `audit-api.types.ts`; the
 * adapter maps between the two. "No auth" is represented by the absence of a
 * config (a public page).
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
 * Authentication configuration.
 */
export type IAuthConfig = IAutoAuthConfig;

/**
 * Dictionary of authentication configurations.
 */
export type IAuthConfigs = Record<string, IAuthConfig>;
