/**
 * Auth-action heuristic: recognizes the natural-language action that selects a
 * named authentication config, e.g. `auth: my-key`, `login = adfs`,
 * `s'authentifier : form`.
 *
 * Lives in utils (not in the action-parser service) so the validation layer
 * can reuse it to cross-check `authConfigs` references without depending on a
 * service.
 */

/** Matches `authentification|auth|login : <key>` (also `=`, `s'authentifier`). */
export const HEURISTIC_AUTH =
  /^\s*(?:s'?\s*authentifier?|auth(?:entification)?|login)\s*[:=]\s*([\w-]+)\s*$/i;

/**
 * Extracts the auth config key from a natural-language action, or null if the
 * string is not an auth action.
 */
export function extractAuthKey(actionStr: string): string | null {
  const m = HEURISTIC_AUTH.exec(actionStr);
  return m?.[1] ?? null;
}
