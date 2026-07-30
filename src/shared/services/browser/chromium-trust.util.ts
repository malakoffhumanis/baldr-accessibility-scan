import { createHash, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { createLogger } from '@shared/utils/logger.js';

const logger = createLogger('chromium-trust');

/**
 * Chromium on Linux does NOT honour `NODE_EXTRA_CA_CERTS` — that variable only
 * configures Node.js' own TLS stack. To let the headless browser reach internal
 * HTTPS sites signed by a private CA (e.g. AC ROOT SI2M) we pass Chromium the
 * `--ignore-certificate-errors-spki-list` switch with the SPKI fingerprints of
 * the CAs in that bundle.
 *
 * Unlike `--ignore-certificate-errors` (which disables validation entirely and
 * is refused in production), this switch is *targeted*: Chromium only bypasses
 * certificate errors for chains whose SubjectPublicKeyInfo SHA-256 matches one
 * of the listed hashes. Every other host keeps full TLS validation. It needs no
 * system package, no root, and no NSS database — everything is computed here
 * with Node's `crypto`.
 *
 * Best-effort: any failure is logged and swallowed so it never blocks startup.
 * Result is memoised for the life of the process.
 */
let cachedArgs: string[] | null = null;

/** Splits a PEM bundle into individual certificate blocks. */
const splitPemBundle = (pem: string): string[] => {
  const matches = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
  );
  return matches ?? [];
};

/**
 * Chromium's SPKI fingerprint: base64(SHA-256(DER SubjectPublicKeyInfo)).
 * Matches the format expected by `--ignore-certificate-errors-spki-list`.
 */
const spkiFingerprint = (pem: string): string => {
  const cert = new X509Certificate(pem);
  const spkiDer = cert.publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spkiDer).digest('base64');
};

/** SPKI fingerprints computed from the `NODE_EXTRA_CA_CERTS` bundle. */
const spkiFromBundle = (): string[] => {
  const caPath = process.env['NODE_EXTRA_CA_CERTS'];
  if (caPath == null || caPath === '') return [];

  if (!existsSync(caPath)) {
    logger.warn({ caPath }, 'NODE_EXTRA_CA_CERTS file not found, skipping');
    return [];
  }

  try {
    const certs = splitPemBundle(readFileSync(caPath, 'utf8'));
    if (certs.length === 0) {
      logger.warn({ caPath }, 'No PEM certificates found in CA bundle');
      return [];
    }

    const fingerprints: string[] = [];
    certs.forEach((cert, index) => {
      try {
        fingerprints.push(spkiFingerprint(cert));
      } catch (err) {
        logger.warn({ index, err }, 'Could not compute SPKI for a certificate');
      }
    });
    return fingerprints;
  } catch (err) {
    logger.warn({ err, caPath }, 'Could not read CA bundle');
    return [];
  }
};

/**
 * Extra SPKI fingerprints pinned explicitly via `BALDR_EXTRA_TRUSTED_SPKI`
 * (comma-separated base64 SHA-256 hashes).
 *
 * Workaround for servers that do not serve their intermediate chain: with only
 * the leaf presented, Chromium cannot match one of the bundle's CA SPKIs, so we
 * pin the leaf's SPKI directly. The proper fix is server-side (serve the full
 * chain); a pinned leaf must be refreshed whenever that certificate rotates.
 */
const spkiFromPinnedEnv = (): string[] => {
  const pinned = (process.env['BALDR_EXTRA_TRUSTED_SPKI'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (pinned.length > 0) {
    logger.warn(
      { count: pinned.length },
      'Trusting extra pinned SPKIs (workaround) via BALDR_EXTRA_TRUSTED_SPKI',
    );
  }
  return pinned;
};

/**
 * Builds the Chromium launch arguments that make the headless browser trust the
 * private CAs referenced by `NODE_EXTRA_CA_CERTS`, plus any leaf/CA SPKIs pinned
 * explicitly via `BALDR_EXTRA_TRUSTED_SPKI`. Returns an empty array when neither
 * source yields a fingerprint. Memoised: computed once, reused on every launch.
 */
export const getChromiumCaTrustArgs = (): string[] => {
  if (cachedArgs !== null) return cachedArgs;
  cachedArgs = [];

  const fingerprints = [...spkiFromBundle(), ...spkiFromPinnedEnv()];
  if (fingerprints.length === 0) return cachedArgs;

  // De-duplicate: a CA reused across leaf/intermediate — or a pinned SPKI that
  // already appears in the bundle — yields the same fingerprint.
  const unique = [...new Set(fingerprints)];
  cachedArgs = [`--ignore-certificate-errors-spki-list=${unique.join(',')}`];

  logger.info(
    { count: unique.length },
    'Chromium will trust private CAs via SPKI allow-list',
  );

  return cachedArgs;
};
