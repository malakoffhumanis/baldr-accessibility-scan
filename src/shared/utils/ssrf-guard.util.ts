/**
 * Anti-SSRF URL validation.
 *
 * Blocks URLs targeting internal/cloud-metadata endpoints that an attacker
 * could abuse to exfiltrate credentials or probe internal services when
 * BALDR runs on a cloud VM.
 *
 * Blocked:
 * - Loopback: 127.0.0.0/8, ::1, localhost
 * - RFC1918 private: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 * - Link-local: 169.254.0.0/16 (includes AWS/Azure IMDS 169.254.169.254)
 * - Cloud metadata hostnames: metadata.google.internal, metadata.azure.com
 * - Non-HTTP schemes: file://, ftp://, gopher://, data:, etc.
 * - IPv4 in non-dotted-quad notation (decimal, octal, hex, mixed)
 * - IPv6 loopback (::1), unspecified (::), link-local (fe80::/10),
 *   ULA (fc00::/7), IPv4-mapped (::ffff:a.b.c.d and ::ffff:hex:hex)
 *
 * Two entry points:
 * - validateUrlSsrf(url) — synchronous, static checks only (used by Zod).
 * - validateUrlSsrfResolved(url) — async, also performs a DNS lookup and
 *   blocks if ANY resolved IP is internal (anti-DNS-rebinding, fail-closed).
 */

import { lookup } from 'node:dns/promises';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.azure.com',
]);

/**
 * Opt-in allowlist of hostnames that bypass the private/internal-IP blocking.
 *
 * For deliberately auditing internal apps (e.g. a corporate portal that
 * resolves to a private IP via split-horizon DNS). Comma-separated hostnames,
 * exact match or `*.suffix` wildcard. Env: BALDR_SSRF_ALLOW_HOSTS.
 *
 * Note: this only relaxes the IP/DNS checks for the listed hosts; protocol
 * validation (http/https only) and blocking of every OTHER host stay active.
 * `localhost`/metadata hostnames remain blocked even if listed (defence).
 */
function isHostAllowlisted(hostname: string): boolean {
  const raw = (process.env['BALDR_SSRF_ALLOW_HOSTS'] ?? '').trim();
  if (raw === '') return false;
  const h = hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(h)) return false;
  for (const entry of raw.split(',')) {
    const pattern = entry.trim().toLowerCase();
    if (pattern === '') continue;
    if (pattern === h) return true;
    if (pattern.startsWith('*.') && h.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

/**
 * Returns true if the four IPv4 octets are in a blocked range.
 */
function isBlockedIPv4Octets(
  a: number,
  b: number,
  c: number,
  d: number,
): boolean {
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local (IMDS lives at 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 — "this network" / unspecified
  if (a === 0) return true;
  void c;
  void d;
  return false;
}

/**
 * Parses an IPv4 address allowing all the notations the OS resolver accepts:
 * dotted-quad decimal (127.0.0.1), dotted octal (0177.0.0.1), dotted hex
 * (0x7f.0.0.1), and the "short" forms with fewer than 4 parts where the last
 * part spans the remaining bytes (e.g. 2130706433, 0x7f000001, 127.1).
 *
 * Returns the 4 octets as a tuple, or null if the string is not a valid
 * IPv4 representation. Mirrors inet_aton-style parsing so we block exactly
 * the forms a browser/OS would actually connect to.
 */
function parseIPv4(host: string): [number, number, number, number] | null {
  if (host.length === 0) return null;
  const parts = host.split('.');
  if (parts.length === 0 || parts.length > 4) return null;

  const nums: number[] = [];
  for (const part of parts) {
    const n = parseIntPart(part);
    if (n === null) return null;
    nums.push(n);
  }

  // Each leading part (all but the last) must fit in a single byte; the last
  // part fills the remaining bytes (inet_aton semantics).
  const last = nums[nums.length - 1] ?? 0;
  const leading = nums.slice(0, -1);
  if (leading.some((n) => n > 0xff)) return null;

  const maxLast = 256 ** (4 - leading.length);
  if (last >= maxLast) return null;

  const bytes: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < leading.length; i++) {
    bytes[i] = leading[i] ?? 0;
  }
  // Spread the last value over the remaining bytes (big-endian).
  let rem = last;
  for (let i = 3; i >= leading.length; i--) {
    bytes[i] = rem & 0xff;
    rem = Math.floor(rem / 256);
  }
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
}

/**
 * Parses a single IPv4 part as decimal, octal (0-prefixed) or hex (0x-prefixed),
 * matching inet_aton. Returns null on any malformed input.
 */
function parseIntPart(part: string): number | null {
  if (part.length === 0) return null;
  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(part)) {
    value = parseInt(part.slice(2), 16);
  } else if (/^0[0-7]+$/.test(part)) {
    value = parseInt(part, 8);
  } else if (/^0$/.test(part)) {
    value = 0;
  } else if (/^[1-9][0-9]*$/.test(part)) {
    value = parseInt(part, 10);
  } else {
    return null;
  }
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/**
 * Returns true if the IPv4 string (any inet_aton notation) is blocked.
 */
function isBlockedIPv4(host: string): boolean {
  const octets = parseIPv4(host);
  if (octets === null) return false;
  return isBlockedIPv4Octets(octets[0], octets[1], octets[2], octets[3]);
}

/**
 * Returns true if a dotted-decimal IPv4 (such as a raw resolver result
 * "10.0.0.5") is blocked. Used by the DNS path.
 */
function isBlockedResolvedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b, c, d] = parts;

  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined
  ) {
    return false;
  }

  if ([a, b, c, d].some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  return isBlockedIPv4Octets(a, b, c, d);
}

/**
 * Strips brackets and zone id from an IPv6 hostname, lowercases it.
 */
function normalizeIPv6(host: string): string {
  let h = host.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1);
  }
  const pct = h.indexOf('%');
  if (pct !== -1) h = h.slice(0, pct);
  return h;
}

/**
 * Returns true if the IPv6 address (without brackets) is loopback, unspecified,
 * link-local, ULA, or an IPv4-mapped address pointing at a blocked IPv4.
 */
function isBlockedIPv6(rawHost: string): boolean {
  const h = normalizeIPv6(rawHost);

  // loopback ::1 and unspecified ::
  if (h === '::1' || h === '::') return true;

  // IPv4-mapped, dotted form: ::ffff:127.0.0.1
  const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (mappedDotted?.[1] != null && isBlockedResolvedIPv4(mappedDotted[1]))
    return true;

  // IPv4-mapped, hex form: ::ffff:7f00:1  → 127.0.0.1
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (mappedHex?.[1] != null && mappedHex[2] != null) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    if (isBlockedIPv4Octets(a, b, c, d)) return true;
  }

  // link-local fe80::/10 → fe80 .. febf
  if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;

  // ULA fc00::/7 → fc.. or fd..
  if (/^f[cd][0-9a-f]*:/.test(h)) return true;

  return false;
}

/**
 * Heuristic: does this hostname look like an IPv6 literal? (contains a colon).
 */
function looksLikeIPv6(rawHost: string): boolean {
  return normalizeIPv6(rawHost).includes(':');
}

/**
 * Runs the static (no-network) part of the SSRF guard against a parsed URL.
 * Returns an error message if blocked, or null if statically safe.
 */
function staticCheck(parsed: URL): string | null {
  // Only allow http and https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Protocol "${parsed.protocol}" not allowed (only http: and https: are accepted)`;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Opt-in allowlist: trust this internal host (skip IP/range blocking).
  if (isHostAllowlisted(hostname)) {
    return null;
  }

  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return `Hostname "${hostname}" blocked (SSRF)`;
  }

  // Block cloud metadata subdomains
  if (
    hostname.endsWith('.metadata.google.internal') ||
    hostname.endsWith('.metadata.azure.com')
  ) {
    return `Hostname "${hostname}" blocked (cloud metadata SSRF)`;
  }

  // Block IPv6 private/reserved literals
  if (looksLikeIPv6(hostname) && isBlockedIPv6(hostname)) {
    return `IPv6 address "${hostname}" blocked (private/reserved — SSRF)`;
  }

  // Block IPv4 private/link-local ranges (any inet_aton notation:
  // decimal, octal, hex, short forms)
  if (isBlockedIPv4(hostname)) {
    return `IP address "${hostname}" blocked (private/link-local network — SSRF)`;
  }

  return null;
}

/**
 * Validates a URL against SSRF risks using only static checks (no DNS).
 * Returns an error message if blocked, or null if the URL is safe.
 *
 * Synchronous — safe to call from a Zod refinement.
 */
export function validateUrlSsrf(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }
  return staticCheck(parsed);
}

/**
 * Validates a URL against SSRF risks, AND resolves its hostname via DNS to
 * defeat DNS-rebinding: if any resolved IP is internal/loopback/link-local/
 * reserved, the URL is blocked.
 *
 * Fail-closed: if DNS resolution fails, the URL is blocked (returns an error).
 *
 * Returns an error message if blocked, or null if the URL is safe.
 */
export async function validateUrlSsrfResolved(
  rawUrl: string,
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }

  const staticErr = staticCheck(parsed);
  if (staticErr !== null) return staticErr;

  const hostname = parsed.hostname.toLowerCase();

  // Opt-in allowlist: trust this internal host — skip the DNS/private-IP block.
  if (isHostAllowlisted(hostname)) {
    return null;
  }

  // If the host is already a literal IP, the static check covered it; the
  // resolver would just echo it back. Skip the lookup.
  if (parseIPv4(hostname) !== null || looksLikeIPv6(hostname)) {
    return null;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (err) {
    return `DNS resolution failed for "${hostname}" (blocked, fail-closed): ${
      err instanceof Error ? err.message : String(err)
    }`;
  }

  if (addresses.length === 0) {
    return `DNS resolution returned no address for "${hostname}" (blocked, fail-closed)`;
  }

  for (const { address, family } of addresses) {
    if (family === 4) {
      if (isBlockedResolvedIPv4(address)) {
        return `Hostname "${hostname}" resolves to blocked IP "${address}" (private/loopback/link-local — SSRF)`;
      }
    } else {
      if (isBlockedIPv6(address)) {
        return `Hostname "${hostname}" resolves to blocked IPv6 "${address}" (private/reserved — SSRF)`;
      }
    }
  }

  return null;
}
