import { afterEach, beforeEach, describe, it, expect } from 'vitest';

import { loadConfig } from './config.js';
import { setRuntimeMode } from './runtime-mode.js';

describe('Config Utils', () => {
  describe('loadConfig', () => {
    beforeEach(() => {
      // Default to server mode; the CLI-mode test opts in explicitly.
      setRuntimeMode('server');
      process.env['RATE_LIMIT_WINDOW_MS'] = '900000';
      process.env['RATE_LIMIT_MAX'] = '100';
      // API_KEYS is mandatory; provide a default so unrelated tests can boot.
      process.env['API_KEYS'] = 'test-client:test-secret';
    });

    afterEach(() => {
      delete process.env['RATE_LIMIT_WINDOW_MS'];
      delete process.env['RATE_LIMIT_MAX'];
      delete process.env['LLM_PROVIDER_API_KEY'];
      delete process.env['LLM_PROVIDER_ENDPOINT'];
      delete process.env['LLM_PROVIDER_MODEL'];
      delete process.env['LLM_CONTEXT_LIMIT'];
      delete process.env['CORS_ORIGIN'];
      delete process.env['HTTPS_PROXY'];
      delete process.env['BALDR_DEBUG_ERROR_CAPTURE'];
      delete process.env['API_KEYS'];
    });

    it('should load default configuration', () => {
      const config = loadConfig();

      expect(config).toBeDefined();
      expect(config.port).toBeTypeOf('number');
      expect(config.env).toMatch(/development|production|test/);
      expect(config.logLevel).toMatch(/debug|info|warn|error/);
    });

    it('should use default port when PORT env is not set', () => {
      delete process.env.PORT;

      const config = loadConfig();

      expect(config.port).toBe(3000);
    });

    it('should use PORT env when set', () => {
      process.env.PORT = '4000';

      const config = loadConfig();

      expect(config.port).toBe(4000);

      delete process.env.PORT;
    });

    it('should throw when PORT is out of range', () => {
      process.env.PORT = '70000';

      expect(() => loadConfig()).toThrow(/PORT/);

      delete process.env.PORT;
    });

    it('should default RATE_LIMIT_WINDOW_MS to 900000 when unset', () => {
      delete process.env['RATE_LIMIT_WINDOW_MS'];

      expect(loadConfig().rateLimit.windowMs).toBe(900000);
    });

    it('should throw when RATE_LIMIT_WINDOW_MS is invalid', () => {
      process.env['RATE_LIMIT_WINDOW_MS'] = 'abc';

      expect(() => loadConfig()).toThrow('RATE_LIMIT_WINDOW_MS');
    });

    it('should default RATE_LIMIT_MAX to 100 when unset', () => {
      delete process.env['RATE_LIMIT_MAX'];

      expect(loadConfig().rateLimit.max).toBe(100);
    });

    it('should throw when RATE_LIMIT_MAX is invalid', () => {
      process.env['RATE_LIMIT_MAX'] = 'abc';

      expect(() => loadConfig()).toThrow('RATE_LIMIT_MAX');
    });

    it('should throw when NODE_ENV has an invalid value', () => {
      const original = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'prodcution';

      expect(() => loadConfig()).toThrow(/NODE_ENV/);

      if (original === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = original;
    });

    it('should throw when LOG_LEVEL has an invalid value', () => {
      process.env['LOG_LEVEL'] = 'verbose';

      expect(() => loadConfig()).toThrow(/LOG_LEVEL/);

      delete process.env['LOG_LEVEL'];
    });

    it('should leave llmProvider undefined when neither key nor endpoint is set', () => {
      const config = loadConfig();

      expect(config.llmProvider).toBeUndefined();
    });

    it('should configure llmProvider when both key and endpoint are set', () => {
      process.env['LLM_PROVIDER_API_KEY'] = 'sk-test';
      process.env['LLM_PROVIDER_ENDPOINT'] = 'https://litellm.example.com/';

      const config = loadConfig();

      expect(config.llmProvider).toEqual({
        apiKey: 'sk-test',
        endpoint: 'https://litellm.example.com',
        model: 'gpt-4o',
        contextLimit: undefined,
      });
    });

    it('enables llmProvider with the default OpenAI endpoint when only the api key is set', () => {
      process.env['LLM_PROVIDER_API_KEY'] = 'sk-test';

      const config = loadConfig();

      expect(config.llmProvider).toEqual({
        apiKey: 'sk-test',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        contextLimit: undefined,
      });
    });

    it('leaves llmProvider undefined when an endpoint is set without an api key', () => {
      process.env['LLM_PROVIDER_ENDPOINT'] = 'https://litellm.example.com/v1';

      const config = loadConfig();

      expect(config.llmProvider).toBeUndefined();
    });

    it('should parse CORS_ORIGIN as a comma-separated list', () => {
      process.env['CORS_ORIGIN'] = 'https://a.com, https://b.com ,';

      const config = loadConfig();

      expect(config.cors.origins).toEqual(['https://a.com', 'https://b.com']);
    });

    it('should resolve proxy from HTTPS_PROXY', () => {
      process.env['HTTPS_PROXY'] = 'http://proxy.corp:8080';

      const config = loadConfig();

      expect(config.proxy).toEqual({ url: 'http://proxy.corp:8080' });
      expect(config.browser.proxy).toEqual({ url: 'http://proxy.corp:8080' });
    });

    it('should default debugErrorCapture to false', () => {
      const config = loadConfig();
      expect(config.debugErrorCapture).toBe(false);
    });

    it('should enable debugErrorCapture when BALDR_DEBUG_ERROR_CAPTURE=true', () => {
      process.env['BALDR_DEBUG_ERROR_CAPTURE'] = 'true';
      const config = loadConfig();
      expect(config.debugErrorCapture).toBe(true);
    });

    it('should keep debugErrorCapture false for any non-"true" value', () => {
      process.env['BALDR_DEBUG_ERROR_CAPTURE'] = 'false';
      const config = loadConfig();
      expect(config.debugErrorCapture).toBe(false);
    });

    it('should throw when API_KEYS is not set (no openbar mode)', () => {
      delete process.env['API_KEYS'];
      expect(() => loadConfig()).toThrow(/API_KEYS is required/);
    });

    it('should throw when API_KEYS holds no valid entry', () => {
      process.env['API_KEYS'] = ' , bad: , ,';
      expect(() => loadConfig()).toThrow(/API_KEYS is required/);
    });

    it('does not require API_KEYS in CLI mode', () => {
      delete process.env['API_KEYS'];
      setRuntimeMode('cli');
      const config = loadConfig();
      expect(config.apiKeys).toEqual([]);
    });

    it('should parse labelled API_KEYS into {id, secret} entries', () => {
      process.env['API_KEYS'] = 'client-a:secret1, client-b:secret2';
      const config = loadConfig();
      expect(config.apiKeys).toEqual([
        { id: 'client-a', secret: 'secret1' },
        { id: 'client-b', secret: 'secret2' },
      ]);
    });

    it('should derive a non-sensitive id for a bare (id-less) key', () => {
      process.env['API_KEYS'] = 'just-a-secret';
      const config = loadConfig();
      expect(config.apiKeys).toHaveLength(1);
      expect(config.apiKeys[0]?.secret).toBe('just-a-secret');
      // id is derived (key-<hash>) and never equals the secret
      expect(config.apiKeys[0]?.id).toMatch(/^key-[0-9a-f]{8}$/);
      expect(config.apiKeys[0]?.id).not.toBe('just-a-secret');
    });

    it('should drop empty / secret-less entries and trim whitespace', () => {
      process.env['API_KEYS'] = ' , client-a:secret1 , bad: , ,';
      const config = loadConfig();
      expect(config.apiKeys).toEqual([{ id: 'client-a', secret: 'secret1' }]);
    });

    it('applies envOverrides over process.env (model)', () => {
      process.env['LLM_PROVIDER_API_KEY'] = 'sk-test';
      process.env['LLM_PROVIDER_MODEL'] = 'gpt-4o';

      const config = loadConfig({ LLM_PROVIDER_MODEL: 'gpt-4.1' });

      expect(config.llmProvider?.model).toBe('gpt-4.1');
    });

    it('enables the provider when the api key comes only from an override', () => {
      const config = loadConfig({ LLM_PROVIDER_API_KEY: 'sk-flag' });

      expect(config.llmProvider).toEqual({
        apiKey: 'sk-flag',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        contextLimit: undefined,
      });
    });

    it('lets an endpoint override replace the default', () => {
      const config = loadConfig({
        LLM_PROVIDER_API_KEY: 'sk-flag',
        LLM_PROVIDER_ENDPOINT: 'https://litellm.example.com/v1',
      });

      expect(config.llmProvider?.endpoint).toBe(
        'https://litellm.example.com/v1',
      );
    });

    it('coerces LLM_CONTEXT_LIMIT supplied via override to a number', () => {
      const config = loadConfig({
        LLM_PROVIDER_API_KEY: 'sk-flag',
        LLM_CONTEXT_LIMIT: '32000',
      });

      expect(config.llmProvider?.contextLimit).toBe(32000);
    });
  });
});
