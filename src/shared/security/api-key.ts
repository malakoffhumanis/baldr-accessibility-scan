/**
 * API-key primitives — framework-agnostic, dependency-free.
 *
 * This module holds the reusable core of API-key authentication: the entry
 * shape, the env parser, a constant-time comparison and the matching routine.
 * It depends only on Node's `crypto` so it can be dropped into any service
 * (the Express glue lives in `api-key-auth.middleware.ts`).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * A single accepted API key: a public identifier for tracing and its secret.
 */
export interface ApiKeyEntry {
  /** Public, non-sensitive identifier used in logs/metrics. */
  id: string;
  /** The secret value matched against the API-key header. */
  secret: string;
}

/**
 * Parses a raw env value into a list of {id, secret} entries.
 *
 * Format: comma-separated entries, each `id:secret`. An entry without a colon
 * is treated as a bare secret and gets a derived, non-sensitive id
 * (`key-<sha256(secret)[:8]>`) so it can be traced without exposing the secret.
 * Whitespace is trimmed and empty/secret-less entries are dropped.
 */
export function parseApiKeys(raw?: string): ApiKeyEntry[] {
  if (raw === undefined) return [];
  const entries: ApiKeyEntry[] = [];
  for (const chunk of raw.split(',')) {
    const trimmed = chunk.trim();
    if (trimmed === '') continue;
    const sep = trimmed.indexOf(':');
    const rawId = sep === -1 ? '' : trimmed.slice(0, sep).trim();
    const secret = (sep === -1 ? trimmed : trimmed.slice(sep + 1)).trim();
    if (secret === '') continue;
    const id =
      rawId !== ''
        ? rawId
        : `key-${createHash('sha256').update(secret).digest('hex').slice(0, 8)}`;
    entries.push({ id, secret });
  }
  return entries;
}

/**
 * Constant-time string comparison that also handles differing lengths
 * without leaking length information through an early return.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch; compare a self-pair instead so
  // the work is still performed, then fold in the length check.
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Returns the public id of the first key whose secret matches `presented`,
 * or `undefined` if none match (or the presented value is absent).
 *
 * Every key is compared (no early break) to limit the timing signal about
 * which/how many keys are configured.
 */
export function matchApiKey(
  presented: string | undefined,
  keys: readonly ApiKeyEntry[],
): string | undefined {
  if (typeof presented !== 'string') return undefined;
  let matchedId: string | undefined;
  for (const { id, secret } of keys) {
    if (safeCompare(presented, secret)) {
      matchedId = id;
    }
  }
  return matchedId;
}
