/**
 * Heuristic detection of a login / SSO / IdP page from its URL.
 *
 * Single source of truth shared by the manual authentication strategy (to keep
 * its auto-resume from firing on a login page) and by BrowserService's
 * post-authentication guard (to detect a run that is still stuck on a login
 * page). Keeping one list avoids the two diverging — a narrower guard would
 * silently let an OIDC/SAML page through and be audited as if it were the
 * target.
 */

/** Whole path segments (or the `/adfs/` substring) that denote a login page. */
const LOGIN_PATH_HINTS = new Set([
  'login',
  'connexion',
  'signin',
  'sign-in',
  'authorize',
  'authenticate',
  'adfs',
  'sso',
  'saml',
  'openid',
]);

/**
 * Best-effort: does this URL look like a login / SSO / IdP page? Matches whole
 * path segments against a fixed list (so `/about/sso-policy` does NOT match,
 * but `/sso/login` does) plus the `/adfs/` substring. Returns false for an
 * empty or unparseable URL.
 */
export function looksLikeLoginUrl(url: string): boolean {
  if (url === '') return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (pathname.includes('/adfs/')) return true;
  const segments = pathname.split('/').filter(Boolean);
  return segments.some((segment) => LOGIN_PATH_HINTS.has(segment));
}
