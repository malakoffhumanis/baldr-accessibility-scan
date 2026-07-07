import { describe, it, expect } from 'vitest';

import { slugifyReportName } from './report-name.util.js';

describe('slugifyReportName', () => {
  it('slugifies a normal name', () => {
    expect(slugifyReportName('Mon Audit Espace Client', 'fallback')).toBe(
      'mon-audit-espace-client',
    );
  });

  it('strips diacritics', () => {
    expect(slugifyReportName('Audit Préprod Éspace', 'fallback')).toBe(
      'audit-preprod-espace',
    );
  });

  it('returns the fallback when name is undefined', () => {
    expect(slugifyReportName(undefined, 'rapport-journey')).toBe(
      'rapport-journey',
    );
  });

  it('returns the fallback when the name sanitizes to empty', () => {
    expect(slugifyReportName('***', 'fallback')).toBe('fallback');
    expect(slugifyReportName('   ', 'fallback')).toBe('fallback');
  });

  it('neutralizes path-traversal attempts (no slash, no dots)', () => {
    const slug = slugifyReportName('../../etc/passwd', 'fallback');
    expect(slug).toBe('etc-passwd');
    expect(slug).not.toMatch(/[./\\]/);
  });

  it('neutralizes header-injection attempts (no quote, CR or LF)', () => {
    const slug = slugifyReportName('a"\r\nSet-Cookie: x=1', 'fallback');
    expect(slug).not.toMatch(/["\r\n]/);
  });

  it('collapses runs of separators into a single hyphen', () => {
    expect(slugifyReportName('a   __  b', 'fallback')).toBe('a-b');
  });

  it('caps the length and trims a trailing hyphen', () => {
    const slug = slugifyReportName('a'.repeat(100), 'fallback');
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('only ever yields [a-z0-9-]', () => {
    expect(slugifyReportName('Café! @2026 #Audit/Final', 'fallback')).toMatch(
      /^[a-z0-9-]+$/,
    );
  });
});
