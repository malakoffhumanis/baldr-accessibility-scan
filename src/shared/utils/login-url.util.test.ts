import { describe, it, expect } from 'vitest';

import { looksLikeLoginUrl } from './login-url.util.js';

describe('looksLikeLoginUrl', () => {
  it('detects common login / SSO / IdP path segments', () => {
    const loginUrls = [
      'https://example.com/login',
      'https://example.com/connexion',
      'https://example.com/signin',
      'https://example.com/sign-in',
      'https://idp.example.com/authorize?client_id=x',
      'https://idp.example.com/authenticate',
      'https://portail.example.com/sso/accueil',
      'https://example.com/saml/acs',
      'https://example.com/openid/callback',
      'https://sts.example.com/adfs/ls/?wa=wsignin1.0',
    ];
    for (const url of loginUrls) {
      expect(looksLikeLoginUrl(url), url).toBe(true);
    }
  });

  it('does not flag ordinary content pages', () => {
    const contentUrls = [
      'https://example.com/',
      'https://example.com/dashboard',
      'https://example.com/sites/Intranet-Groupe',
      'https://example.com/about/sso-policy', // "sso-policy" != "sso" segment
      'https://example.com/_layouts/15/news.aspx',
      'https://example.com/single-sign-on-guide',
    ];
    for (const url of contentUrls) {
      expect(looksLikeLoginUrl(url), url).toBe(false);
    }
  });

  it('returns false for empty or unparseable input', () => {
    expect(looksLikeLoginUrl('')).toBe(false);
    expect(looksLikeLoginUrl('not-a-url')).toBe(false);
  });
});
