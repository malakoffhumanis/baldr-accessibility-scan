import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const lookupMock = vi.fn();
vi.mock('node:dns/promises', () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
}));

import { validateUrlSsrf, validateUrlSsrfResolved } from './ssrf-guard.util.js';

describe('validateUrlSsrf', () => {
  // ── Allowed URLs ──────────────────────────────────────────────────────────
  it.each([
    'https://example.com',
    'https://example.com/path?q=1',
    'http://corporate.intranet.company.com',
    'https://8.8.8.8/dns',
    'https://203.0.113.5',
  ])('allows %s', (url) => {
    expect(validateUrlSsrf(url)).toBeNull();
  });

  // ── Blocked: non-HTTP protocols ───────────────────────────────────────────
  it.each([
    'file:///etc/passwd',
    'ftp://evil.com/data',
    'gopher://evil.com/data',
    'data:text/html,<script>alert(1)</script>',
  ])('blocks non-HTTP protocol %s', (url) => {
    expect(validateUrlSsrf(url)).not.toBeNull();
  });

  // ── Blocked: loopback ─────────────────────────────────────────────────────
  it.each([
    'http://127.0.0.1',
    'http://127.0.0.1:8080/admin',
    'http://127.1.2.3',
    'http://localhost',
    'http://localhost:3000',
  ])('blocks loopback %s', (url) => {
    expect(validateUrlSsrf(url)).not.toBeNull();
  });

  // ── Blocked: RFC1918 private ranges ───────────────────────────────────────
  it.each([
    'http://10.0.0.1',
    'http://10.255.255.255',
    'http://172.16.0.1',
    'http://172.31.255.255',
    'http://192.168.0.1',
    'http://192.168.1.100:8080',
  ])('blocks private IP %s', (url) => {
    expect(validateUrlSsrf(url)).not.toBeNull();
  });

  // ── Blocked: link-local / IMDS ────────────────────────────────────────────
  it.each([
    'http://169.254.169.254',
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.0.1',
  ])('blocks link-local/IMDS %s', (url) => {
    expect(validateUrlSsrf(url)).not.toBeNull();
  });

  // ── Blocked: cloud metadata hostnames ─────────────────────────────────────
  it.each([
    'http://metadata.google.internal',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://metadata.azure.com',
    'http://metadata.azure.com/metadata/instance?api-version=2021-02-01',
  ])('blocks cloud metadata %s', (url) => {
    expect(validateUrlSsrf(url)).not.toBeNull();
  });

  // ── Blocked: 172.16-31 but NOT 172.15 or 172.32 ──────────────────────────
  it('allows 172.15.x.x (not in private range)', () => {
    expect(validateUrlSsrf('http://172.15.0.1')).toBeNull();
  });

  it('allows 172.32.x.x (not in private range)', () => {
    expect(validateUrlSsrf('http://172.32.0.1')).toBeNull();
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  it('rejects invalid URLs', () => {
    expect(validateUrlSsrf('not-a-url')).not.toBeNull();
  });

  it('blocks 0.0.0.0', () => {
    expect(validateUrlSsrf('http://0.0.0.0')).not.toBeNull();
  });

  // ── Blocked: IPv4 alternate notations (inet_aton bypasses) ────────────────
  it.each([
    'http://2130706433/', // decimal 127.0.0.1
    'http://0177.0.0.1/', // octal first octet
    'http://0x7f000001/', // hex 127.0.0.1
    'http://0x7f.0.0.1/', // mixed hex
    'http://127.1/', // short form → 127.0.0.1
    'http://017700000001/', // full octal 127.0.0.1
    'http://0xa000001/', // hex 10.0.0.1
  ])('blocks IPv4 alternate-notation loopback/private %s', (url) => {
    expect(validateUrlSsrf(url)).not.toBeNull();
  });

  it('blocks decimal 169.254.169.254 (2852039166)', () => {
    expect(validateUrlSsrf('http://2852039166/')).not.toBeNull();
  });

  it('still allows a public decimal-encoded IP (8.8.8.8 = 134744072)', () => {
    expect(validateUrlSsrf('http://134744072/')).toBeNull();
  });

  // ── Blocked: IPv6 private / reserved ──────────────────────────────────────
  it.each([
    'http://[::1]/', // loopback
    'http://[::]/', // unspecified
    'http://[fe80::1]/', // link-local
    'http://[fe80::dead:beef]/',
    'http://[fc00::1]/', // ULA
    'http://[fd12:3456::1]/', // ULA
    'http://[::ffff:127.0.0.1]/', // IPv4-mapped dotted
    'http://[::ffff:7f00:1]/', // IPv4-mapped hex (127.0.0.1)
    'http://[::ffff:a00:1]/', // IPv4-mapped hex (10.0.0.1)
  ])('blocks IPv6 private/reserved %s', (url) => {
    expect(validateUrlSsrf(url)).not.toBeNull();
  });

  it('allows a public IPv6 literal', () => {
    expect(validateUrlSsrf('http://[2606:4700:4700::1111]/')).toBeNull();
  });

  it('blocks a cloud-metadata subdomain', () => {
    expect(
      validateUrlSsrf('http://foo.metadata.google.internal/'),
    ).not.toBeNull();
  });

  it('allows a public global-unicast IPv6 (not ULA/link-local)', () => {
    expect(validateUrlSsrf('http://[2001:db8::1]/')).toBeNull();
  });

  it('allows a hostname with dots that is not an IP', () => {
    expect(validateUrlSsrf('http://0x.example.com/')).toBeNull();
  });

  it('blocks octal leading-part private form (012.0.0.1 = 10.0.0.1)', () => {
    expect(validateUrlSsrf('http://012.0.0.1/')).not.toBeNull();
  });
});

describe('validateUrlSsrfResolved (anti-DNS-rebinding)', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('passes through the static check (blocks before any DNS lookup)', async () => {
    const res = await validateUrlSsrfResolved('http://127.0.0.1/');
    expect(res).not.toBeNull();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('blocks a host that resolves to a private IPv4 (rebinding)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    const res = await validateUrlSsrfResolved('http://attacker.example/');
    expect(res).not.toBeNull();
    expect(res).toContain('10.0.0.5');
    expect(lookupMock).toHaveBeenCalledWith('attacker.example', { all: true });
  });

  it('blocks when ANY of several resolved IPs is internal', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    const res = await validateUrlSsrfResolved('http://rebind.example/');
    expect(res).not.toBeNull();
    expect(res).toContain('169.254.169.254');
  });

  it('blocks a host that resolves to a private IPv6', async () => {
    lookupMock.mockResolvedValueOnce([{ address: 'fe80::1', family: 6 }]);
    const res = await validateUrlSsrfResolved('http://v6.example/');
    expect(res).not.toBeNull();
  });

  it('allows a host that resolves only to public IPs', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);
    const res = await validateUrlSsrfResolved('http://public.example/');
    expect(res).toBeNull();
  });

  it('fails closed on DNS resolution error', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));
    const res = await validateUrlSsrfResolved('http://nxdomain.example/');
    expect(res).not.toBeNull();
    expect(res).toContain('fail-closed');
  });

  it('fails closed when DNS returns no addresses', async () => {
    lookupMock.mockResolvedValueOnce([]);
    const res = await validateUrlSsrfResolved('http://empty.example/');
    expect(res).not.toBeNull();
    expect(res).toContain('fail-closed');
  });

  it('skips DNS lookup for a literal public IP', async () => {
    const res = await validateUrlSsrfResolved('http://8.8.8.8/');
    expect(res).toBeNull();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('returns Invalid URL for a malformed input', async () => {
    const res = await validateUrlSsrfResolved('not-a-url');
    expect(res).toBe('Invalid URL');
  });
});

describe('SSRF host allowlist (BALDR_SSRF_ALLOW_HOSTS)', () => {
  const prev = process.env['BALDR_SSRF_ALLOW_HOSTS'];

  beforeEach(() => {
    lookupMock.mockReset();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env['BALDR_SSRF_ALLOW_HOSTS'];
    else process.env['BALDR_SSRF_ALLOW_HOSTS'] = prev;
  });

  it('allows an otherwise-blocked private IP literal when allowlisted (static)', () => {
    expect(validateUrlSsrf('http://10.0.0.5/')).not.toBeNull(); // blocked by default
    process.env['BALDR_SSRF_ALLOW_HOSTS'] = '10.0.0.5';
    expect(validateUrlSsrf('http://10.0.0.5/')).toBeNull();
  });

  it('allows an allowlisted host and skips DNS resolution', async () => {
    process.env['BALDR_SSRF_ALLOW_HOSTS'] =
      'mon-compte.malakoffhumanis.com, *.intranet.corp';
    const res = await validateUrlSsrfResolved(
      'https://mon-compte.malakoffhumanis.com/',
    );
    expect(res).toBeNull();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('supports *.suffix wildcard entries', () => {
    process.env['BALDR_SSRF_ALLOW_HOSTS'] = '*.intranet.corp';
    expect(validateUrlSsrf('http://192.168.1.10/')).not.toBeNull();
    // a host matching the wildcard that resolves internally is allowed
    expect(validateUrlSsrf('https://app.intranet.corp/')).toBeNull();
  });

  it('never allowlists localhost/metadata even if listed (defence)', () => {
    process.env['BALDR_SSRF_ALLOW_HOSTS'] = 'localhost';
    expect(validateUrlSsrf('http://localhost/')).not.toBeNull();
  });

  it('does nothing when the env var is unset', () => {
    delete process.env['BALDR_SSRF_ALLOW_HOSTS'];
    expect(validateUrlSsrf('http://10.0.0.5/')).not.toBeNull();
  });
});
