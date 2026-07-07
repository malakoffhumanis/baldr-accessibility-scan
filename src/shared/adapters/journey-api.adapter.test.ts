import { describe, it, expect } from 'vitest';

import { convertJourneyRequestToOptions } from './journey-api.adapter.js';
import type { JourneyRequest } from '@shared/types/journey-api.types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function validRequest(overrides: Partial<JourneyRequest> = {}): JourneyRequest {
  return {
    pages: [{ url: 'https://example.com', actions: [{ type: 'scan' }] }],
    ...overrides,
  };
}

// ─── Tests: convertJourneyRequestToOptions (v3) ─────────────────────────────
describe('convertJourneyRequestToOptions', () => {
  it('maps a scan action to the internal "scanner" string', () => {
    const result = convertJourneyRequestToOptions(validRequest());
    expect(result.blocks).toEqual([
      { url: 'https://example.com', auth: undefined, actions: ['scanner'] },
    ]);
  });

  it('defaults actions to ["scanner"] when omitted', () => {
    const result = convertJourneyRequestToOptions(
      validRequest({ pages: [{ url: 'https://example.com' }] }),
    );
    expect(result.blocks[0]?.actions).toEqual(['scanner']);
  });

  it('defaults actions to ["scanner"] when empty', () => {
    const result = convertJourneyRequestToOptions(
      validRequest({ pages: [{ url: 'https://example.com', actions: [] }] }),
    );
    expect(result.blocks[0]?.actions).toEqual(['scanner']);
  });

  it('maps every typed action to its canonical NL string', () => {
    const result = convertJourneyRequestToOptions(
      validRequest({
        pages: [
          {
            url: 'https://example.com',
            actions: [
              { type: 'acceptCookies' },
              { type: 'wait', ms: 1500 },
              { type: 'click', target: 'OK' },
              { type: 'hover', target: 'Menu' },
              { type: 'fill', target: 'email', value: 'a@b.com' },
              { type: 'select', target: 'pays', value: 'France' },
              { type: 'ai', instruction: 'ouvrir le sous-menu' },
              { type: 'scan' },
            ],
          },
        ],
      }),
    );
    expect(result.blocks[0]?.actions).toEqual([
      'accepter les cookies',
      'attendre 1500 ms',
      'cliquer sur OK',
      'survoler Menu',
      'saisir "a@b.com" dans email',
      'sélectionner "France" dans pays',
      'ouvrir le sous-menu',
      'scanner',
    ]);
  });

  it('reads analysisType and reportFormat from options (with defaults)', () => {
    const withOpts = convertJourneyRequestToOptions(
      validRequest({
        options: { analysisType: 'static', reportFormat: 'json' },
      }),
    );
    expect(withOpts.analysisType).toBe('static');
    expect(withOpts.reportFormat).toBe('json');

    const defaults = convertJourneyRequestToOptions(validRequest());
    expect(defaults.analysisType).toBe('full');
    expect(defaults.reportFormat).toBe('html');
  });

  it('includes name when present', () => {
    const result = convertJourneyRequestToOptions(
      validRequest({ name: 'Mon Audit' }),
    );
    expect(result.name).toBe('Mon Audit');
  });

  it('maps options.rules to specificRules', () => {
    const result = convertJourneyRequestToOptions(
      validRequest({ options: { rules: ['1.1', '1.2'] } }),
    );
    expect(result.specificRules).toEqual(['1.1', '1.2']);
  });

  it('maps options.viewport when provided, omits otherwise', () => {
    const withVp = convertJourneyRequestToOptions(
      validRequest({ options: { viewport: { width: 1920, height: 1080 } } }),
    );
    expect(withVp.viewport).toEqual({ width: 1920, height: 1080 });
    expect(
      convertJourneyRequestToOptions(validRequest()).viewport,
    ).toBeUndefined();
  });

  it('injects request-level credentials as __auth_default', () => {
    const result = convertJourneyRequestToOptions(
      validRequest({
        auth: { username: 'user', password: 'pass' },
      }),
    );
    expect(result.authConfigs['__auth_default']).toEqual({
      type: 'auto',
      username: 'user',
      password: 'pass',
      loginUrl: undefined,
    });
    expect(result.blocks[0]?.auth).toBe('__auth_default');
  });

  it('injects per-page credentials as __auth_page_N (with loginUrl)', () => {
    const result = convertJourneyRequestToOptions(
      validRequest({
        pages: [
          {
            url: 'https://example.com',
            auth: {
              username: 'a@b.com',
              password: 'x',
              loginUrl: 'https://login.example.com',
            },
            actions: [{ type: 'scan' }],
          },
        ],
      }),
    );
    expect(result.authConfigs['__auth_page_0']).toEqual({
      type: 'auto',
      username: 'a@b.com',
      password: 'x',
      loginUrl: 'https://login.example.com',
    });
    expect(result.blocks[0]?.auth).toBe('__auth_page_0');
  });

  it('leaves a page without auth unauthenticated (no key)', () => {
    const result = convertJourneyRequestToOptions(
      validRequest({ pages: [{ url: 'https://example.com' }] }),
    );
    expect(result.blocks[0]?.auth).toBeUndefined();
    expect(Object.keys(result.authConfigs)).toHaveLength(0);
  });

  it('applies request-level auth as default to pages without their own', () => {
    const result = convertJourneyRequestToOptions(
      validRequest({
        auth: { username: 'u', password: 'p' },
        pages: [
          { url: 'https://a.com', actions: [{ type: 'scan' }] },
          {
            url: 'https://b.com',
            auth: { username: 'other', password: 'pw' },
            actions: [{ type: 'scan' }],
          },
        ],
      }),
    );
    expect(result.blocks[0]?.auth).toBe('__auth_default');
    expect(result.blocks[1]?.auth).toBe('__auth_page_1');
  });
});
