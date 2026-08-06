import { describe, it, expect } from 'vitest';

import { journeyRequestSchema } from './schemas.js';

// ─── Journey schema (v3) ──────────────────────────────────────────────────────
describe('journeyRequestSchema', () => {
  describe('valid requests', () => {
    it('should accept a minimal journey (page with url only → defaults to scan)', () => {
      const result = journeyRequestSchema.safeParse({
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept a page with empty actions', () => {
      const result = journeyRequestSchema.safeParse({
        pages: [{ url: 'https://example.com', actions: [] }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept a multi-page journey with typed actions', () => {
      const result = journeyRequestSchema.safeParse({
        name: 'My audit',
        options: { analysisType: 'static', reportFormat: 'html' },
        pages: [
          { url: 'https://a.com', actions: [{ type: 'scan' }] },
          {
            url: 'https://b.com',
            actions: [
              { type: 'acceptCookies' },
              { type: 'wait', ms: 1500 },
              { type: 'click', target: 'OK' },
              { type: 'fill', target: 'email', value: 'a@b.com' },
              { type: 'select', target: 'pays', value: 'France' },
              { type: 'hover', target: 'Menu' },
              { type: 'ai', instruction: 'ouvrir le sous-menu Fondation' },
              { type: 'scan' },
            ],
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should accept request-level credentials-only auth', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { username: 'jdoe', password: 's3cret' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth).toEqual({
          username: 'jdoe',
          password: 's3cret',
        });
      }
    });

    it('should accept auth with an optional loginUrl', () => {
      const result = journeyRequestSchema.safeParse({
        auth: {
          username: 'jdoe',
          password: 's3cret',
          loginUrl: 'https://login.example.com',
        },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept per-page credentials-only auth', () => {
      const result = journeyRequestSchema.safeParse({
        pages: [
          {
            url: 'https://example.com',
            auth: { username: 'jdoe', password: 's3cret' },
            actions: [{ type: 'scan' }],
          },
          { url: 'https://b.com' },
        ],
      });
      expect(result.success).toBe(true);
    });

    it('should reject auth missing the password', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { username: 'jdoe' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject auth missing the username', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { password: 's3cret' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('invalid requests', () => {
    it('should reject when pages is missing', () => {
      expect(journeyRequestSchema.safeParse({}).success).toBe(false);
    });

    it('should reject an empty pages array', () => {
      const result = journeyRequestSchema.safeParse({ pages: [] });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('at least one page');
      }
    });

    it('should reject more than 30 pages', () => {
      const pages = Array.from({ length: 31 }, () => ({
        url: 'https://example.com',
      }));
      const result = journeyRequestSchema.safeParse({ pages });
      expect(result.success).toBe(false);
    });

    it('should reject a page with an invalid url', () => {
      const result = journeyRequestSchema.safeParse({
        pages: [{ url: 'not-a-url' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject more than 50 actions on a page', () => {
      const actions = Array.from({ length: 51 }, () => ({ type: 'scan' }));
      const result = journeyRequestSchema.safeParse({
        pages: [{ url: 'https://example.com', actions }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject an unknown action type', () => {
      const result = journeyRequestSchema.safeParse({
        pages: [
          { url: 'https://example.com', actions: [{ type: 'teleport' }] },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a click action without a target', () => {
      const result = journeyRequestSchema.safeParse({
        pages: [{ url: 'https://example.com', actions: [{ type: 'click' }] }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a wait action with ms out of range', () => {
      const result = journeyRequestSchema.safeParse({
        pages: [
          { url: 'https://example.com', actions: [{ type: 'wait', ms: 0 }] },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('should reject a target exceeding 500 characters', () => {
      const result = journeyRequestSchema.safeParse({
        pages: [
          {
            url: 'https://example.com',
            actions: [{ type: 'click', target: 'a'.repeat(501) }],
          },
        ],
      });
      expect(result.success).toBe(false);
    });

    it('should reject an invalid analysisType in options', () => {
      const result = journeyRequestSchema.safeParse({
        options: { analysisType: 'bad' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject an invalid reportFormat in options', () => {
      const result = journeyRequestSchema.safeParse({
        options: { reportFormat: 'pdf' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Authentication modes ────────────────────────────────────────────────
  describe('authentication modes', () => {
    it('should accept an explicit auto type with credentials', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { type: 'auto', username: 'jdoe', password: 's3cret' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth?.type).toBe('auto');
      }
    });

    it('should accept a minimal manual auth config', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { type: 'manual' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth).toEqual({ type: 'manual' });
      }
    });

    it('should accept manual auth with loginUrl and timeoutMs', () => {
      const result = journeyRequestSchema.safeParse({
        auth: {
          type: 'manual',
          loginUrl: 'https://sso.example.com/login',
          timeoutMs: 600000,
        },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(true);
    });

    it('should accept manual auth with waitForManualConfirm', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { type: 'manual', waitForManualConfirm: true },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth).toEqual({
          type: 'manual',
          waitForManualConfirm: true,
        });
      }
    });

    it('should reject manual auth with a non-boolean waitForManualConfirm', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { type: 'manual', waitForManualConfirm: 'yes' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(false);
    });

    it('should accept per-page manual auth', () => {
      const result = journeyRequestSchema.safeParse({
        pages: [{ url: 'https://example.com', auth: { type: 'manual' } }],
      });
      expect(result.success).toBe(true);
    });

    it('should reject manual auth with a timeoutMs below the minimum', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { type: 'manual', timeoutMs: 5000 },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject manual auth with a timeoutMs above the maximum', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { type: 'manual', timeoutMs: 2_000_000 },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject manual auth with an invalid loginUrl', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { type: 'manual', loginUrl: 'not-a-url' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(false);
    });

    it('should reject an unknown auth type', () => {
      const result = journeyRequestSchema.safeParse({
        auth: { type: 'kerberos' },
        pages: [{ url: 'https://example.com' }],
      });
      expect(result.success).toBe(false);
    });
  });
});
