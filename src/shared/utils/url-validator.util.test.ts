import { describe, it, expect } from 'vitest';

import {
  isValidUrl,
  validateAndNormalizeUrl,
  extractDomain,
} from './url-validator.util.js';

describe('url-validator', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // isValidUrl
  // ═══════════════════════════════════════════════════════════════════════════
  describe('isValidUrl', () => {
    describe('valid URLs', () => {
      it('should accept a simple https URL', () => {
        expect(isValidUrl('https://example.com')).toBe(true);
      });

      it('should accept a simple http URL', () => {
        expect(isValidUrl('http://example.com')).toBe(true);
      });

      it('should accept a URL with a path', () => {
        expect(isValidUrl('https://example.com/page/sub')).toBe(true);
      });

      it('should accept a URL with query parameters', () => {
        expect(isValidUrl('https://example.com/search?q=test&lang=fr')).toBe(
          true,
        );
      });

      it('should accept a URL with a fragment', () => {
        expect(isValidUrl('https://example.com/page#section')).toBe(true);
      });

      it('should accept a URL with a port', () => {
        expect(isValidUrl('http://localhost:3000')).toBe(true);
      });

      it('should accept a URL with auth', () => {
        expect(isValidUrl('https://user:pass@example.com')).toBe(true);
      });

      it('should accept a URL with a subdomain', () => {
        expect(isValidUrl('https://www.sub.example.com')).toBe(true);
      });

      it('should accept a URL with encoded characters', () => {
        expect(isValidUrl('https://example.com/path%20with%20spaces')).toBe(
          true,
        );
      });

      it('should accept an IP URL', () => {
        expect(isValidUrl('http://192.168.1.1:8080')).toBe(true);
      });
    });

    describe('invalid URLs', () => {
      it('should reject an empty string', () => {
        expect(isValidUrl('')).toBe(false);
      });

      it('should reject a URL without a protocol', () => {
        expect(isValidUrl('example.com')).toBe(false);
      });

      it('should reject a URL with an unsupported protocol (ftp)', () => {
        expect(isValidUrl('ftp://example.com')).toBe(false);
      });

      it('should reject a URL with an unsupported protocol (file)', () => {
        expect(isValidUrl('file:///etc/passwd')).toBe(false);
      });

      it('should reject a URL with a mailto protocol', () => {
        expect(isValidUrl('mailto:test@example.com')).toBe(false);
      });

      it('should reject arbitrary text', () => {
        expect(isValidUrl('this is not a url')).toBe(false);
      });

      it('should reject a javascript protocol', () => {
        expect(isValidUrl('javascript:alert(1)')).toBe(false);
      });

      it('should reject a data URL', () => {
        expect(isValidUrl('data:text/html,<h1>hello</h1>')).toBe(false);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // validateAndNormalizeUrl
  // ═══════════════════════════════════════════════════════════════════════════
  describe('validateAndNormalizeUrl', () => {
    describe('nominal cases', () => {
      it('should return a valid URL as-is', () => {
        expect(validateAndNormalizeUrl('https://example.com')).toBe(
          'https://example.com',
        );
      });

      it('should return a valid http URL', () => {
        expect(validateAndNormalizeUrl('http://example.com')).toBe(
          'http://example.com',
        );
      });

      it('should strip whitespace around the URL', () => {
        expect(validateAndNormalizeUrl('  https://example.com  ')).toBe(
          'https://example.com',
        );
      });

      it('should strip leading whitespace', () => {
        expect(validateAndNormalizeUrl('   https://example.com')).toBe(
          'https://example.com',
        );
      });

      it('should strip trailing whitespace', () => {
        expect(validateAndNormalizeUrl('https://example.com   ')).toBe(
          'https://example.com',
        );
      });

      it('should keep the path and parameters', () => {
        const url = 'https://example.com/path?key=value#anchor';
        expect(validateAndNormalizeUrl(url)).toBe(url);
      });
    });

    describe('error cases', () => {
      it('should throw an error for an empty string', () => {
        expect(() => validateAndNormalizeUrl('')).toThrow(
          'URL is required and must be a string',
        );
      });

      it('should throw an error for null (cast to string)', () => {
        expect(() =>
          validateAndNormalizeUrl(null as unknown as string),
        ).toThrow('URL is required and must be a string');
      });

      it('should throw an error for undefined (cast to string)', () => {
        expect(() =>
          validateAndNormalizeUrl(undefined as unknown as string),
        ).toThrow('URL is required and must be a string');
      });

      it('should throw an error for a number (cast to string)', () => {
        expect(() => validateAndNormalizeUrl(123 as unknown as string)).toThrow(
          'URL is required and must be a string',
        );
      });

      it('should throw an error for a URL without a protocol', () => {
        expect(() => validateAndNormalizeUrl('example.com')).toThrow(
          'Invalid URL: example.com',
        );
      });

      it('should throw an error for a URL with an ftp protocol', () => {
        expect(() => validateAndNormalizeUrl('ftp://example.com')).toThrow(
          'Invalid URL: ftp://example.com',
        );
      });

      it('should throw an error with a message including the invalid URL', () => {
        expect(() => validateAndNormalizeUrl('bad-url')).toThrow(
          'URL must start with http:// or https://',
        );
      });

      it('should throw an error for a URL made only of whitespace', () => {
        expect(() => validateAndNormalizeUrl('   ')).toThrow('Invalid URL');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // extractDomain
  // ═══════════════════════════════════════════════════════════════════════════
  describe('extractDomain', () => {
    describe('successful extraction', () => {
      it('should extract the domain from an https URL', () => {
        expect(extractDomain('https://example.com')).toBe('example.com');
      });

      it('should extract the domain from an http URL', () => {
        expect(extractDomain('http://example.com')).toBe('example.com');
      });

      it('should extract the domain with a subdomain', () => {
        expect(extractDomain('https://www.example.com')).toBe(
          'www.example.com',
        );
      });

      it('should extract the domain ignoring the path', () => {
        expect(extractDomain('https://example.com/page/sub?q=1')).toBe(
          'example.com',
        );
      });

      it('should extract the domain ignoring the port', () => {
        expect(extractDomain('http://example.com:8080/path')).toBe(
          'example.com',
        );
      });

      it('should extract localhost', () => {
        expect(extractDomain('http://localhost:3000')).toBe('localhost');
      });

      it('should extract an IP address', () => {
        expect(extractDomain('http://192.168.1.1:8080')).toBe('192.168.1.1');
      });

      it('should extract the domain ignoring the auth', () => {
        expect(extractDomain('https://user:pass@example.com')).toBe(
          'example.com',
        );
      });
    });

    describe('error cases', () => {
      it('should return an empty string for an invalid URL', () => {
        expect(extractDomain('not-a-url')).toBe('');
      });

      it('should return an empty string for an empty string', () => {
        expect(extractDomain('')).toBe('');
      });

      it('should return an empty string for arbitrary text', () => {
        expect(extractDomain('hello world')).toBe('');
      });
    });
  });
});
