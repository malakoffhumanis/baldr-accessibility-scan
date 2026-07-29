import { describe, it, expect, vi, beforeEach } from 'vitest';
import { X509Certificate, createHash } from 'node:crypto';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { existsSync, readFileSync } from 'node:fs';

import type * as ChromiumTrust from './chromium-trust.util.js';

// getChromiumCaTrustArgs memoises for the process lifetime, so each test loads a
// fresh module instance via vi.resetModules().
const load = async (): Promise<typeof ChromiumTrust> => {
  vi.resetModules();
  return import('./chromium-trust.util.js');
};

const SWITCH = '--ignore-certificate-errors-spki-list=';

// Two static, real self-signed certs (RSA-2048, CN=test-a / test-b, 10y).
const CERT_A = `-----BEGIN CERTIFICATE-----
MIIDAzCCAeugAwIBAgIULqZLndlJChRFygNZUeH27/OhEBEwDQYJKoZIhvcNAQEL
BQAwETEPMA0GA1UEAwwGdGVzdC1hMB4XDTI2MDcxMDEzMTI1NFoXDTM2MDcwNzEz
MTI1NFowETEPMA0GA1UEAwwGdGVzdC1hMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEApKDLU4r/KKXek4Raj86FgdcswjPu+6aBYu6i+x+JPgibf6EWCpv8
6fJ5/BEOKxcyK+DniJy0Cyh3YaZRu8aZxlX+WpDkyF4h0nc8UxRJ3G5n/L4Cxx4Y
AK+ZwDYo5eelusy5Wy/Bcn9rqDlswkxkg8VwtpS2MQSqyEqmhL004l4lxLNT7UyR
mqiIA0kuIMzksXVc0/vUo2we7GLA+YxCUCASVmLcrTEuFjGojpwO3j8nasSlKN+r
4FwoK8E5PGXvFQYGkm9Ep2gwduczZRKRgq1OFQ+Nd1CidsB7HekQrKsV+QaQ57o1
kOuszvgMnhdsapCLPWm8PcN5T7d7RkpL9QIDAQABo1MwUTAdBgNVHQ4EFgQUPbKm
VHqT/paPyGkzLROu6djE/T0wHwYDVR0jBBgwFoAUPbKmVHqT/paPyGkzLROu6djE
/T0wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAY+J9rXaNWMtU
c74ulJA3/u57n7LRNaqNV2KPWzkJe7SrJ++IPkChHfaYaY6D1BW5QD3ULfk6mAzs
EcZpIzjKWPRUuGIjqRcY0BNTj9XkORzQa4V/5tfQXG4z+SrXxgNdUL39mSyE0w50
ihU4/N2920fG89GhCs43mN1HGKM0K+nETxBXcIeHerUXDGTv3X3BGKenDzyAQhJu
o98OPlH/Uc4INZE9Gbe2r4YFWfDPuPU/Ugc7tr/eSWGEwd4M56PcwnABapeRgUfZ
rT12+whC0B0WHVHQodvOLGfEjx587gsrH3CPMLPaHHL4/ecOho3AZxY2QtYIh437
CaCvSLkr1g==
-----END CERTIFICATE-----`;

const CERT_B = `-----BEGIN CERTIFICATE-----
MIIDAzCCAeugAwIBAgIUYHNXy8Jt5urNR1oBJyu3azOUGMwwDQYJKoZIhvcNAQEL
BQAwETEPMA0GA1UEAwwGdGVzdC1iMB4XDTI2MDcxMDEzMTI1NFoXDTM2MDcwNzEz
MTI1NFowETEPMA0GA1UEAwwGdGVzdC1iMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A
MIIBCgKCAQEAtflrjsMhFsGxmqcsJyqpWZgwwpJrinLBwdE+h5RhUSKVmeY0T8lV
SwI37el7g7eAWmKORrSzIUqC36WlIvKcOKMQqYCA0Ox7yPiexeWlyakbRQWT8n1o
SC8fl0h41QD5yex0Mvs1ioL0/7WisxdCiHGVkHU024Kjvho4eQCf2uxOheFs/Sf+
ZzXlNkJe223LtdFOcPP30HrHqZBKMKyG3fYU4JfksQH2J6h6jl9ubuDj5V+ZFWCq
7Z5AQ5UqTt2LsWCCz6/qNRnUL5jkgQiDKTFpoB2A2jhJEQAJNJHXJ1dFpKAFcNd0
db2j/GEZqhRmD2woTWfzy4u8eRWGkcq5LwIDAQABo1MwUTAdBgNVHQ4EFgQUhMoX
Zv0glJ8bmQ1Vjf3KPooPI9swHwYDVR0jBBgwFoAUhMoXZv0glJ8bmQ1Vjf3KPooP
I9swDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAjVecr5YFrrfg
VyEkZP4uBdZjmtt5ofP29536MYPWrPq7QIMWg0iEiCYAXH8qjwcaHit31/h9mQm1
dOf1RQZOiAdBkET62qD/wVbnn9Pwp6UcpxXCkASQ8SAquVThM32/UuaTlhWJ82Do
VQT22jBpLzdwwCnFd4C77zcb81YDGgpuDIROlhHFFPERL7IoCHQqCSbFIUUb4hck
DaeOrJfp9RYPd2z817H2jFnI3mp1vLhbjXTrnAzN9nlg2XbM4ztfDZEsABlKrgJT
NlljmVw+Es06jotQDpVxaz54rwSLjXmBnX/PofWuQpyyumz6wvFZ1yj3TbYAWkZ+
G3w0rtjMrQ==
-----END CERTIFICATE-----`;

const spkiOf = (pem: string): string => {
  const cert = new X509Certificate(pem);
  const der = cert.publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('base64');
};

describe('getChromiumCaTrustArgs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['NODE_EXTRA_CA_CERTS'];
    delete process.env['BALDR_EXTRA_TRUSTED_SPKI'];
  });

  it('returns no args when NODE_EXTRA_CA_CERTS is unset', async () => {
    const { getChromiumCaTrustArgs } = await load();
    expect(getChromiumCaTrustArgs()).toEqual([]);
  });

  it('returns no args when the CA file is missing', async () => {
    process.env['NODE_EXTRA_CA_CERTS'] = '/app/certs/missing.pem';
    vi.mocked(existsSync).mockReturnValue(false);
    const { getChromiumCaTrustArgs } = await load();
    expect(getChromiumCaTrustArgs()).toEqual([]);
  });

  it('returns no args when the bundle has no certificates', async () => {
    process.env['NODE_EXTRA_CA_CERTS'] = '/app/certs/ca.pem';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('garbage, not a pem');
    const { getChromiumCaTrustArgs } = await load();
    expect(getChromiumCaTrustArgs()).toEqual([]);
  });

  it('builds the SPKI allow-list switch from every CA in the bundle', async () => {
    process.env['NODE_EXTRA_CA_CERTS'] = '/app/certs/ca.pem';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(`${CERT_A}\n${CERT_B}`);

    const { getChromiumCaTrustArgs } = await load();
    const args = getChromiumCaTrustArgs();

    expect(args).toHaveLength(1);
    expect(args[0]?.startsWith(SWITCH)).toBe(true);
    const list = args[0]!.slice(SWITCH.length).split(',');
    expect(list).toEqual([spkiOf(CERT_A), spkiOf(CERT_B)]);
    // Sanity check against a fingerprint computed independently (openssl).
    expect(list).toContain('/XKKV9wbsNEDbWa6HKoo4KNiYslpM9pN1yS7ehcgFMc=');
  });

  it('de-duplicates identical CAs in the bundle', async () => {
    process.env['NODE_EXTRA_CA_CERTS'] = '/app/certs/ca.pem';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(`${CERT_A}\n${CERT_A}`);

    const { getChromiumCaTrustArgs } = await load();
    const list = getChromiumCaTrustArgs()[0]!.slice(SWITCH.length).split(',');
    expect(list).toEqual([spkiOf(CERT_A)]);
  });

  it('trusts SPKIs pinned via BALDR_EXTRA_TRUSTED_SPKI, even without a bundle', async () => {
    process.env['BALDR_EXTRA_TRUSTED_SPKI'] = ' hashLeafA= , hashLeafB= ';
    // No NODE_EXTRA_CA_CERTS set.
    const { getChromiumCaTrustArgs } = await load();
    const list = getChromiumCaTrustArgs()[0]!.slice(SWITCH.length).split(',');
    expect(list).toEqual(['hashLeafA=', 'hashLeafB=']);
  });

  it('merges bundle SPKIs with pinned SPKIs and de-duplicates', async () => {
    process.env['NODE_EXTRA_CA_CERTS'] = '/app/certs/ca.pem';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(CERT_A);
    // Pin one new SPKI plus a duplicate of the bundle's own SPKI.
    process.env['BALDR_EXTRA_TRUSTED_SPKI'] = `leafPinned=,${spkiOf(CERT_A)}`;

    const { getChromiumCaTrustArgs } = await load();
    const list = getChromiumCaTrustArgs()[0]!.slice(SWITCH.length).split(',');
    expect(list).toEqual([spkiOf(CERT_A), 'leafPinned=']);
  });

  it('memoises the result across calls', async () => {
    process.env['NODE_EXTRA_CA_CERTS'] = '/app/certs/ca.pem';
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(CERT_A);

    const { getChromiumCaTrustArgs } = await load();
    getChromiumCaTrustArgs();
    const callsAfterFirst = vi.mocked(readFileSync).mock.calls.length;
    getChromiumCaTrustArgs();
    expect(vi.mocked(readFileSync).mock.calls.length).toBe(callsAfterFirst);
  });
});
