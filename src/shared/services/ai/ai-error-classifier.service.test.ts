import { describe, it, expect, beforeEach } from 'vitest';
import { AIErrorClassifierService } from './ai-error-classifier.service.js';

describe('AIErrorClassifierService', () => {
  let service: AIErrorClassifierService;

  beforeEach(() => {
    service = new AIErrorClassifierService();
  });

  describe('classify', () => {
    it('should return CONFIGURATION for "non configuré" messages', () => {
      const result = service.classify('Service non configuré correctement');
      expect(result.type).toBe('CONFIGURATION');
      expect(result.message).toBe('Service non configuré correctement');
      expect(result.timestamp).toBeDefined();
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should return CONFIGURATION for "manquant" messages', () => {
      const result = service.classify('Variable LLM_PROVIDER_API_KEY manquant');
      expect(result.type).toBe('CONFIGURATION');
    });

    it('should return CONFIGURATION for "not configured" messages', () => {
      const result = service.classify('LLM Provider not configured');
      expect(result.type).toBe('CONFIGURATION');
    });

    it('should return CONNECTIVITY for "enotfound" messages', () => {
      const result = service.classify('getaddrinfo ENOTFOUND api.example.com');
      expect(result.type).toBe('CONNECTIVITY');
    });

    it('should return CONNECTIVITY for "econnrefused" messages', () => {
      const result = service.classify('connect ECONNREFUSED 127.0.0.1:443');
      expect(result.type).toBe('CONNECTIVITY');
    });

    it('should return CONNECTIVITY for "network" messages', () => {
      const result = service.classify('Network error occurred');
      expect(result.type).toBe('CONNECTIVITY');
    });

    it('should return CONNECTIVITY for "getaddrinfo" messages', () => {
      const result = service.classify('getaddrinfo failed for host');
      expect(result.type).toBe('CONNECTIVITY');
    });

    it('should return PROXY for "proxy" messages', () => {
      const result = service.classify('Proxy connection failed');
      expect(result.type).toBe('PROXY');
    });

    it('should return PROXY for "tunneling socket" messages', () => {
      const result = service.classify(
        'tunneling socket could not be established',
      );
      expect(result.type).toBe('PROXY');
    });

    it('should return AUTHENTICATION for "401" messages', () => {
      const result = service.classify('Request failed with status 401');
      expect(result.type).toBe('AUTHENTICATION');
    });

    it('should return AUTHENTICATION for "unauthorized" messages', () => {
      const result = service.classify('Unauthorized access to API');
      expect(result.type).toBe('AUTHENTICATION');
    });

    it('should return AUTHENTICATION for "api key" messages', () => {
      const result = service.classify('Invalid api key provided');
      expect(result.type).toBe('AUTHENTICATION');
    });

    it('should return TIMEOUT for "timeout" messages', () => {
      const result = service.classify('Request timeout after 30000ms');
      expect(result.type).toBe('TIMEOUT');
    });

    it('should return TIMEOUT for "econnaborted" messages', () => {
      const result = service.classify('ECONNABORTED: socket hang up');
      expect(result.type).toBe('TIMEOUT');
    });

    it('should return TIMEOUT for "aborted" messages', () => {
      const result = service.classify('Request was aborted');
      expect(result.type).toBe('TIMEOUT');
    });

    it('should return DEPLOYMENT for "404" messages', () => {
      const result = service.classify('HTTP 404: model not found');
      expect(result.type).toBe('DEPLOYMENT');
    });

    it('should return DEPLOYMENT for "introuvable" messages', () => {
      const result = service.classify('Modèle introuvable sur la provider');
      expect(result.type).toBe('DEPLOYMENT');
    });

    it('should return DEPLOYMENT for "not found" messages', () => {
      const result = service.classify('Resource not found on server');
      expect(result.type).toBe('DEPLOYMENT');
    });

    it('should return RATE_LIMIT for "429" messages', () => {
      const result = service.classify('HTTP 429: too many requests');
      expect(result.type).toBe('RATE_LIMIT');
    });

    it('should return RATE_LIMIT for "rate limit" messages', () => {
      const result = service.classify('Rate limit exceeded');
      expect(result.type).toBe('RATE_LIMIT');
    });

    it('should return RATE_LIMIT for "quota" messages', () => {
      const result = service.classify('Quota exceeded for this month');
      expect(result.type).toBe('RATE_LIMIT');
    });

    it('should return UNKNOWN for unrecognized messages', () => {
      const result = service.classify(
        'Something completely unexpected happened',
      );
      expect(result.type).toBe('UNKNOWN');
      expect(result.message).toBe('Something completely unexpected happened');
    });

    it('should include original message in details', () => {
      const msg = 'Detailed error: ECONNREFUSED 10.0.0.1';
      const result = service.classify(msg);
      expect(result.details).toContain(msg);
    });

    it('should produce a valid ISO timestamp', () => {
      const result = service.classify('any error');
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });

  describe('buildConfigurationError', () => {
    it('should return a CONFIGURATION error', () => {
      const result = service.buildConfigurationError();
      expect(result.type).toBe('CONFIGURATION');
    });

    it('should include a descriptive message', () => {
      const result = service.buildConfigurationError();
      expect(result.message).toContain('LLM Provider');
    });

    it('should include actionable suggestions', () => {
      const result = service.buildConfigurationError();
      expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
      expect(
        result.suggestions.some((s) => s.includes('LLM_PROVIDER_API_KEY')),
      ).toBe(true);
    });

    it('should produce a valid ISO timestamp', () => {
      const result = service.buildConfigurationError();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
