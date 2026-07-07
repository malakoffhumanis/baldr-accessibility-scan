import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

import { OpenAIClientService } from './openai-client.service.js';
import { LLMRecordReplayService } from './llm-record-replay.service.js';

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    isAxiosError: vi.fn(),
  },
}));

// Mock https-proxy-agent. Vitest 4 invokes class mocks with `new`, so the
// implementation must be a constructor. Class is inlined because vi.mock
// is hoisted above any top-level declarations.
vi.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: vi.fn().mockImplementation(
    class {
      proxy: string;
      constructor(url: string) {
        this.proxy = url;
      }
    },
  ),
}));

// Mock logger
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('OpenAIClientService', () => {
  let service: OpenAIClientService;

  const defaultConfig = {
    llmProvider: {
      apiKey: 'sk-test-key-123456',
      endpoint: 'https://test.example.com',
      model: 'test-model',
    },
    env: 'test' as const,
  };

  function createConfiguredService(
    overrides?: Partial<typeof defaultConfig>,
  ): OpenAIClientService {
    return new OpenAIClientService({ ...defaultConfig, ...overrides });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // ---------------------------------------------------------------------------
  // Constructor and configuration
  // ---------------------------------------------------------------------------
  describe('constructor and configuration', () => {
    it('should create an instance without calling the API', () => {
      service = createConfiguredService();
      expect(service).toBeDefined();
      // axios.post should not be called at construction time
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should create an instance without config', () => {
      service = new OpenAIClientService();
      // No error should be thrown at construction
      expect(service).toBeDefined();
      expect(service.isReady()).toBe(false);
    });

    it('should be ready when configured with LLM Provider config', () => {
      service = createConfiguredService();
      expect(service.isReady()).toBe(true);
    });

    it('should work when config is passed via constructor', async () => {
      service = createConfiguredService();
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'test-model',
        },
      });

      const result = await service.chatCompletion([
        { role: 'user', content: 'hello' },
      ]);
      expect(result.response).toBe('response');
    });

    it('should use config provided at construction time', async () => {
      service = createConfiguredService();

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
          model: 'test-model',
        },
      });

      const result = await service.chatCompletion([
        { role: 'user', content: 'test' },
      ]);

      // The config key should be used (Bearer sk-test-key-123456)
      const callArgs = vi.mocked(axios.post).mock.calls[0];
      expect(callArgs?.[2]?.headers?.Authorization).toBe(
        'Bearer sk-test-key-123456',
      );
      expect(result.response).toBe('ok');
    });
  });

  // ---------------------------------------------------------------------------
  // chatCompletion
  // ---------------------------------------------------------------------------
  describe('chatCompletion()', () => {
    beforeEach(() => {
      service = createConfiguredService();
    });

    it('should return a successful response with usage data', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: '{"compliant": true, "findings": []}',
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
          model: 'test-model',
        },
      });

      const messages = [
        { role: 'system' as const, content: 'You are an expert.' },
        { role: 'user' as const, content: 'Analyze this page.' },
      ];
      const result = await service.chatCompletion(messages, {
        temperature: 0.3,
      });

      expect(result.response).toBe('{"compliant": true, "findings": []}');
      expect(result.usage).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      });
      expect(result.model).toBe('test-model');

      // Verify the correct URL was called
      expect(axios.post).toHaveBeenCalledWith(
        'https://test.example.com/chat/completions',
        expect.objectContaining({
          messages,
          model: 'test-model',
          temperature: 0.3,
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key-123456',
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should use default params when none are provided', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'response' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'hello' }]);

      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(body?.temperature).toBe(0.2);
      expect(body?.max_tokens).toBe(3000);
    });

    it('should return empty string when response has no content', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: {} }],
          model: 'test-model',
        },
      });

      const result = await service.chatCompletion([
        { role: 'user', content: 'test' },
      ]);
      expect(result.response).toBe('');
    });

    it('should fallback to configured model when response model is missing', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
        },
      });

      const result = await service.chatCompletion([
        { role: 'user', content: 'test' },
      ]);
      expect(result.model).toBe('test-model');
    });

    it('should throw a 401 error with clear message', async () => {
      const axiosError = new Error('Request failed') as Error & {
        response: { status: number; data: { error?: { message?: string } } };
        isAxiosError: boolean;
        code: string;
      };
      axiosError.response = {
        status: 401,
        data: { error: { message: 'Invalid API key' } },
      };
      axiosError.isAxiosError = true;

      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.post).mockRejectedValueOnce(axiosError);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow(
        'LLM Provider authentication failed (401). Check LLM_PROVIDER_API_KEY',
      );
    });

    it('should throw a 429 rate limit error with clear message after retries', async () => {
      const axiosError = new Error('Rate limited') as Error & {
        response: {
          status: number;
          data: { error?: { message?: string } };
          headers: Record<string, string>;
        };
        isAxiosError: boolean;
        code: string;
      };
      axiosError.response = {
        status: 429,
        data: { error: { message: 'Rate limit exceeded' } },
        headers: { 'retry-after': '0' },
      };
      axiosError.isAxiosError = true;

      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.post).mockRejectedValue(axiosError);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow(
        'LLM Provider rate limit reached (429). All retries exhausted',
      );

      // Should have been called 4 times (1 initial + 3 retries)
      expect(axios.post).toHaveBeenCalledTimes(4);
    });

    it('should throw a 404 model not found error', async () => {
      const axiosError = new Error('Not found') as Error & {
        response: { status: number; data: { error?: { message?: string } } };
        isAxiosError: boolean;
      };
      axiosError.response = {
        status: 404,
        data: { error: { message: 'Model not found' } },
      };
      axiosError.isAxiosError = true;

      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.post).mockRejectedValueOnce(axiosError);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('Model "test-model" not found (404)');
    });

    it('should throw a generic HTTP error for 500 status', async () => {
      const axiosError = new Error('Server error') as Error & {
        response: { status: number; data: { error?: { message?: string } } };
        isAxiosError: boolean;
      };
      axiosError.response = {
        status: 500,
        data: { error: { message: 'Internal server error' } },
      };
      axiosError.isAxiosError = true;

      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.post).mockRejectedValueOnce(axiosError);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('LLM Provider (500): Internal server error');
    });

    it('should handle timeout error (ECONNABORTED)', async () => {
      const axiosError = new Error('ECONNABORTED') as Error & {
        isAxiosError: boolean;
        code: string;
        response?: undefined;
      };
      axiosError.isAxiosError = true;
      axiosError.code = 'ECONNABORTED';

      vi.mocked(axios.isAxiosError).mockReturnValue(false);
      vi.mocked(axios.post).mockRejectedValueOnce(axiosError);

      await expect(
        service.chatCompletion(
          [{ role: 'user', content: 'test' }],
          {},
          { timeout: 5000 },
        ),
      ).rejects.toThrow('LLM Provider timeout (5000ms)');
    });

    it('should handle DNS resolution error (ENOTFOUND)', async () => {
      const error = new Error('getaddrinfo ENOTFOUND test.example.com');

      vi.mocked(axios.isAxiosError).mockReturnValue(false);
      vi.mocked(axios.post).mockRejectedValueOnce(error);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('DNS resolution failed');
    });

    it('should handle connection refused error (ECONNREFUSED)', async () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:443');

      vi.mocked(axios.isAxiosError).mockReturnValue(false);
      vi.mocked(axios.post).mockRejectedValueOnce(error);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('Connection refused');
    });

    it('should handle connection reset error (ECONNRESET)', async () => {
      const error = new Error('read ECONNRESET');

      vi.mocked(axios.isAxiosError).mockReturnValue(false);
      vi.mocked(axios.post).mockRejectedValueOnce(error);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('Connection reset');
    });

    it('should handle socket hang up error', async () => {
      const error = new Error('socket hang up');

      vi.mocked(axios.isAxiosError).mockReturnValue(false);
      vi.mocked(axios.post).mockRejectedValueOnce(error);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('Connection reset');
    });

    it('should handle generic network error', async () => {
      const error = new Error('Something unexpected happened');

      vi.mocked(axios.isAxiosError).mockReturnValue(false);
      vi.mocked(axios.post).mockRejectedValueOnce(error);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('LLM Provider error: Something unexpected happened');
    });

    it('should throw when service is not configured', async () => {
      service = new OpenAIClientService();

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('LLM Provider service not configured');
    });

    it('should use custom timeout when provided', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion(
        [{ role: 'user', content: 'test' }],
        {},
        { timeout: 120000 },
      );

      const axiosConfig = vi.mocked(axios.post).mock.calls[0]?.[2];
      expect(axiosConfig?.timeout).toBe(120000);
    });

    it('should use default timeout of 90000ms when not specified', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const axiosConfig = vi.mocked(axios.post).mock.calls[0]?.[2];
      expect(axiosConfig?.timeout).toBe(90000);
    });

    it('should pass generation params overriding defaults', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }], {
        temperature: 0.9,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      });

      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      // generationParams override defaults
      expect(body?.temperature).toBe(0.9);
      expect(body?.max_tokens).toBe(500);
      expect(body?.response_format).toEqual({ type: 'json_object' });
    });

    it('should handle HTTP error with missing error message in response', async () => {
      const axiosError = new Error('Request failed') as Error & {
        response: {
          status: number;
          data: Record<string, unknown>;
          headers: Record<string, string>;
        };
        isAxiosError: boolean;
      };
      axiosError.response = {
        status: 503,
        data: {},
        headers: { 'retry-after': '0' },
      };
      axiosError.isAxiosError = true;

      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.post).mockRejectedValue(axiosError);

      await expect(
        service.chatCompletion([{ role: 'user', content: 'test' }]),
      ).rejects.toThrow('LLM Provider (503): Request failed');

      // Should have been called 4 times (1 initial + 3 retries)
      expect(axios.post).toHaveBeenCalledTimes(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Claude vs OpenAI model detection
  // ---------------------------------------------------------------------------
  describe('Claude vs OpenAI model detection', () => {
    it('should not add top_p/frequency_penalty/presence_penalty for Claude models', async () => {
      service = new OpenAIClientService({
        llmProvider: {
          apiKey: 'sk-test-key-123456',
          endpoint: 'https://test.example.com',
          model: 'claude-3-sonnet-20240229',
        },
        env: 'test',
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'claude-3-sonnet-20240229',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(body?.model).toBe('claude-3-sonnet-20240229');
      expect(body?.top_p).toBeUndefined();
      expect(body?.frequency_penalty).toBeUndefined();
      expect(body?.presence_penalty).toBeUndefined();
    });

    it('should add top_p/frequency_penalty/presence_penalty for OpenAI models', async () => {
      service = new OpenAIClientService({
        llmProvider: {
          apiKey: 'sk-test-key-123456',
          endpoint: 'https://test.example.com',
          model: 'gpt-4o',
        },
        env: 'test',
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'gpt-4o',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(body?.top_p).toBe(0.95);
      expect(body?.frequency_penalty).toBe(0);
      expect(body?.presence_penalty).toBe(0);
    });

    it('should add OpenAI-specific params for gpt- prefixed models', async () => {
      service = new OpenAIClientService({
        llmProvider: {
          apiKey: 'sk-test-key-123456',
          endpoint: 'https://test.example.com',
          model: 'gpt-4-turbo',
        },
        env: 'test',
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'gpt-4-turbo',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(body?.top_p).toBe(0.95);
      expect(body?.frequency_penalty).toBe(0);
      expect(body?.presence_penalty).toBe(0);
    });

    it('should not add OpenAI-specific params for claude-bedrock models', async () => {
      service = new OpenAIClientService({
        llmProvider: {
          apiKey: 'sk-test-key-123456',
          endpoint: 'https://test.example.com',
          model: 'bedrock/claude-v2',
        },
        env: 'test',
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'bedrock/claude-v2',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(body?.top_p).toBeUndefined();
      expect(body?.frequency_penalty).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // testConnection
  // ---------------------------------------------------------------------------
  describe('testConnection()', () => {
    beforeEach(() => {
      service = createConfiguredService();
    });

    it('should return success with details on successful connection', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'test ok' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          model: 'test-model',
        },
      });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.details.model).toBe('test-model');
      expect(result.details.endpoint).toBe('https://test.example.com');
      expect(result.details.tokensUsed).toBe(5);
    });

    it('should send a minimal test message with max_tokens=5', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.testConnection();

      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(body?.max_tokens).toBe(5);
      expect(body?.messages).toEqual([{ role: 'user', content: 'test' }]);
    });

    it('should use 30s timeout for test connection', async () => {
      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.testConnection();

      const axiosConfig = vi.mocked(axios.post).mock.calls[0]?.[2];
      expect(axiosConfig?.timeout).toBe(30000);
    });

    it('should return failure with error details on connection error', async () => {
      vi.mocked(axios.isAxiosError).mockReturnValue(false);
      vi.mocked(axios.post).mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 127.0.0.1:443'),
      );

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.details.error).toContain('Connection refused');
      expect(result.details.endpoint).toBe('https://test.example.com');
      expect(result.details.model).toBe('test-model');
    });

    it('should return failure when not configured', async () => {
      service = new OpenAIClientService();

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.details.error).toContain(
        'LLM Provider configuration incomplete',
      );
    });

    it('should include proxy info in successful connection details', async () => {
      service = createConfiguredService({
        ...defaultConfig,
        proxy: { url: 'http://proxy.corp:8080' },
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
          model: 'test-model',
        },
      });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.details.proxyConfigured).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // isReady
  // ---------------------------------------------------------------------------
  describe('isReady()', () => {
    it('should return true when config includes LLM Provider', () => {
      service = createConfiguredService();
      expect(service.isReady()).toBe(true);
    });

    it('should return false when no config is provided', () => {
      service = new OpenAIClientService();
      expect(service.isReady()).toBe(false);
    });

    it('should return false when llmProvider is undefined', () => {
      service = new OpenAIClientService({ env: 'test' });
      expect(service.isReady()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // getModel
  // ---------------------------------------------------------------------------
  describe('getModel()', () => {
    it('should return the configured model name', () => {
      service = createConfiguredService();
      expect(service.getModel()).toBe('test-model');
    });

    it('should return fallback gpt-4o when not configured', () => {
      service = new OpenAIClientService();
      expect(service.getModel()).toBe('gpt-4o');
    });
  });

  // ---------------------------------------------------------------------------
  // Proxy configuration
  // ---------------------------------------------------------------------------
  describe('proxy configuration', () => {
    it('should configure httpsAgent when proxy is set', async () => {
      service = createConfiguredService({
        ...defaultConfig,
        proxy: { url: 'http://proxy.corp:8080' },
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const axiosConfig = vi.mocked(axios.post).mock.calls[0]?.[2];
      expect(axiosConfig?.proxy).toBe(false);
      expect(axiosConfig?.httpsAgent).toBeDefined();
    });

    it('should configure httpsAgent with different proxy URLs', async () => {
      service = createConfiguredService({
        ...defaultConfig,
        proxy: { url: 'http://proxy.corp:3128' },
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const axiosConfig = vi.mocked(axios.post).mock.calls[0]?.[2];
      expect(axiosConfig?.httpsAgent).toBeDefined();
    });

    it('should not configure httpsAgent when no proxy is set', async () => {
      service = createConfiguredService();

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const axiosConfig = vi.mocked(axios.post).mock.calls[0]?.[2];
      expect(axiosConfig?.proxy).toBe(false);
      expect(axiosConfig?.httpsAgent).toBeUndefined();
    });

    it('should always disable native axios proxy', async () => {
      service = createConfiguredService({
        ...defaultConfig,
        proxy: { url: 'http://proxy.corp:8080' },
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const axiosConfig = vi.mocked(axios.post).mock.calls[0]?.[2];
      expect(axiosConfig?.proxy).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Endpoint URL normalization
  // ---------------------------------------------------------------------------
  describe('endpoint URL normalization', () => {
    it('should strip trailing slashes from the endpoint', async () => {
      service = createConfiguredService({
        llmProvider: {
          apiKey: 'sk-test-key-123456',
          endpoint: 'https://test.example.com///',
          model: 'test-model',
        },
        env: 'test',
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const url = vi.mocked(axios.post).mock.calls[0]?.[0];
      expect(url).toBe('https://test.example.com/chat/completions');
    });

    it('treats the endpoint as the full base, including a /v1 segment', async () => {
      service = createConfiguredService({
        llmProvider: {
          apiKey: 'sk-test-key-123456',
          endpoint: 'https://api.example.com/v1',
          model: 'test-model',
        },
        env: 'test',
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'ok' } }],
          model: 'test-model',
        },
      });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const url = vi.mocked(axios.post).mock.calls[0]?.[0];
      expect(url).toBe('https://api.example.com/v1/chat/completions');
    });
  });

  // ---------------------------------------------------------------------------
  // Multimodal messages
  // ---------------------------------------------------------------------------
  describe('multimodal messages', () => {
    it('should support messages with image_url content', async () => {
      service = createConfiguredService();

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: '{"compliant": true}' } }],
          model: 'test-model',
        },
      });

      const messages = [
        { role: 'system' as const, content: 'Expert' },
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: 'Analyze' },
            {
              type: 'image_url' as const,
              image_url: {
                url: 'data:image/jpeg;base64,/9j/4AAQ...',
                detail: 'auto' as const,
              },
            },
          ],
        },
      ];

      const result = await service.chatCompletion(messages);
      expect(result.response).toBe('{"compliant": true}');

      const body = vi.mocked(axios.post).mock.calls[0]?.[1] as Record<
        string,
        unknown
      >;
      expect(body?.messages).toEqual(messages);
    });
  });
});

describe('OpenAIClientService — extra coverage', () => {
  const baseConfig = {
    llmProvider: {
      apiKey: 'sk-test-key-123456',
      endpoint: 'https://test.example.com',
      model: 'test-model',
    },
    env: 'test' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // LRU cache hit (lines 153-156)
  // ---------------------------------------------------------------------------
  describe('LRU response cache', () => {
    it('returns the cached response on a second identical call without re-calling the API', async () => {
      const service = new OpenAIClientService(baseConfig);

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'cached-content' } }],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
          model: 'test-model',
        },
      });

      const messages = [{ role: 'user' as const, content: 'identical' }];
      const first = await service.chatCompletion(messages, { temperature: 0 });
      const second = await service.chatCompletion(messages, { temperature: 0 });

      expect(first.response).toBe('cached-content');
      expect(second).toEqual(first);
      // Only the first call hits the network; the second is served from cache.
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Replay path (lines 141-142)
  // ---------------------------------------------------------------------------
  describe('record/replay short-circuit', () => {
    it('returns the replayed response and skips the HTTP call', async () => {
      const replayed = {
        response: 'replayed!',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        model: 'test-model',
      };
      const replaySpy = vi
        .spyOn(LLMRecordReplayService.prototype, 'replay')
        .mockReturnValue(replayed);

      const service = new OpenAIClientService(baseConfig);
      const result = await service.chatCompletion([
        { role: 'user', content: 'whatever' },
      ]);

      expect(result).toEqual(replayed);
      expect(axios.post).not.toHaveBeenCalled();
      expect(replaySpy).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Proxy logging branch (lines 198-200) — production without proxy
  // ---------------------------------------------------------------------------
  describe('production without proxy', () => {
    it('still issues the request when env=production and no proxy is set', async () => {
      const service = new OpenAIClientService({
        ...baseConfig,
        env: 'production',
      });

      vi.mocked(axios.post).mockResolvedValueOnce({
        data: {
          choices: [{ message: { content: 'prod-ok' } }],
          model: 'test-model',
        },
      });

      const result = await service.chatCompletion([
        { role: 'user', content: 'test' },
      ]);

      expect(result.response).toBe('prod-ok');
      const axiosConfig = vi.mocked(axios.post).mock.calls[0]?.[2];
      // No proxy agent configured.
      expect(axiosConfig?.httpsAgent).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Retry with exponential backoff (line 537 — no retry-after header)
  // ---------------------------------------------------------------------------
  describe('executeWithRetry backoff', () => {
    it('retries on 503 then succeeds, using exponential backoff when no retry-after header', async () => {
      // Make backoff instantaneous.
      vi.spyOn(global, 'setTimeout').mockImplementation((fn: () => void) => {
        fn();
        return 0 as unknown as NodeJS.Timeout;
      });

      const service = new OpenAIClientService(baseConfig);

      const axiosError = new Error('Service unavailable') as Error & {
        response: { status: number; data: unknown; headers: unknown };
        isAxiosError: boolean;
      };
      axiosError.response = { status: 503, data: {}, headers: {} };
      axiosError.isAxiosError = true;

      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.post)
        .mockRejectedValueOnce(axiosError)
        .mockResolvedValueOnce({
          data: {
            choices: [{ message: { content: 'recovered' } }],
            model: 'test-model',
          },
        });

      const result = await service.chatCompletion([
        { role: 'user', content: 'test' },
      ]);

      expect(result.response).toBe('recovered');
      // 1 failure + 1 success.
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('falls back to 5000ms delay when retry-after header is non-numeric', async () => {
      const setTimeoutSpy = vi
        .spyOn(global, 'setTimeout')
        .mockImplementation((fn: () => void) => {
          fn();
          return 0 as unknown as NodeJS.Timeout;
        });

      const service = new OpenAIClientService(baseConfig);

      const axiosError = new Error('rate limited') as Error & {
        response: { status: number; data: unknown; headers: unknown };
        isAxiosError: boolean;
      };
      axiosError.response = {
        status: 429,
        data: {},
        headers: { 'retry-after': 'soon' }, // non-numeric → NaN → 5000ms
      };
      axiosError.isAxiosError = true;

      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.post)
        .mockRejectedValueOnce(axiosError)
        .mockResolvedValueOnce({
          data: {
            choices: [{ message: { content: 'ok-after-retry' } }],
            model: 'test-model',
          },
        });

      const result = await service.chatCompletion([
        { role: 'user', content: 'test' },
      ]);

      expect(result.response).toBe('ok-after-retry');
      // The non-numeric header resolves to the 5000ms fallback (+ jitter).
      const delayArg = setTimeoutSpy.mock.calls[0]?.[1]!;
      expect(delayArg).toBeGreaterThanOrEqual(5000);
      expect(delayArg).toBeLessThan(6000);
    });

    it('honors a numeric retry-after header (seconds → ms)', async () => {
      const setTimeoutSpy = vi
        .spyOn(global, 'setTimeout')
        .mockImplementation((fn: () => void) => {
          fn();
          return 0 as unknown as NodeJS.Timeout;
        });

      const service = new OpenAIClientService(baseConfig);

      const axiosError = new Error('rate limited') as Error & {
        response: { status: number; data: unknown; headers: unknown };
        isAxiosError: boolean;
      };
      axiosError.response = {
        status: 503,
        data: {},
        headers: { 'retry-after': '2' }, // 2 seconds → 2000ms
      };
      axiosError.isAxiosError = true;

      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.post)
        .mockRejectedValueOnce(axiosError)
        .mockResolvedValueOnce({
          data: {
            choices: [{ message: { content: 'ok' } }],
            model: 'test-model',
          },
        });

      await service.chatCompletion([{ role: 'user', content: 'test' }]);

      const delayArg = setTimeoutSpy.mock.calls[0]?.[1]!;
      // 2000ms base + jitter (0-1000ms).
      expect(delayArg).toBeGreaterThanOrEqual(2000);
      expect(delayArg).toBeLessThan(3000);
    });

    it('aborts retry immediately when the signal is already aborted', async () => {
      const service = new OpenAIClientService(baseConfig);
      const controller = new AbortController();
      controller.abort();

      const axiosError = new Error('aborted-error') as Error & {
        response: { status: number; data: unknown; headers: unknown };
        isAxiosError: boolean;
      };
      axiosError.response = { status: 503, data: {}, headers: {} };
      axiosError.isAxiosError = true;

      vi.mocked(axios.isAxiosError).mockReturnValue(true);
      vi.mocked(axios.post).mockRejectedValue(axiosError);

      await expect(
        service.chatCompletion(
          [{ role: 'user', content: 'test' }],
          {},
          { signal: controller.signal },
        ),
      ).rejects.toThrow();

      // No retry: aborted before the loop continues.
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // checkModelAvailability (lines 430-484)
  // ---------------------------------------------------------------------------
  describe('checkModelAvailability()', () => {
    it('throws when the service is not configured', async () => {
      const service = new OpenAIClientService();
      await expect(service.checkModelAvailability()).rejects.toThrow(
        'LLM Provider not configured',
      );
    });

    it('passes when the configured model is in the provider model list', async () => {
      const service = new OpenAIClientService(baseConfig);

      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { data: [{ id: 'test-model' }, { id: 'other-model' }] },
      });

      await expect(service.checkModelAvailability()).resolves.toBeUndefined();

      expect(axios.get).toHaveBeenCalledWith(
        'https://test.example.com/models',
        expect.objectContaining({
          headers: { Authorization: 'Bearer sk-test-key-123456' },
          timeout: 10000,
          proxy: false,
        }),
      );
    });

    it('configures the proxy agent when a proxy URL is set', async () => {
      const service = new OpenAIClientService({
        ...baseConfig,
        proxy: { url: 'http://proxy.corp:8080' },
      });

      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { data: [{ id: 'test-model' }] },
      });

      await service.checkModelAvailability();

      const axiosConfig = vi.mocked(axios.get).mock.calls[0]?.[1];
      expect(axiosConfig?.httpsAgent).toBeDefined();
    });

    it('throws "no models" when the provider returns an empty list', async () => {
      const service = new OpenAIClientService(baseConfig);

      vi.mocked(axios.get).mockResolvedValueOnce({ data: { data: [] } });

      await expect(service.checkModelAvailability()).rejects.toThrow(
        'LLM Provider returned no models',
      );
    });

    it('throws "no models" when the provider returns no data field', async () => {
      const service = new OpenAIClientService(baseConfig);

      vi.mocked(axios.get).mockResolvedValueOnce({ data: {} });

      await expect(service.checkModelAvailability()).rejects.toThrow(
        'LLM Provider returned no models',
      );
    });

    it('throws a descriptive error when the configured model is not available', async () => {
      const service = new OpenAIClientService(baseConfig);

      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { data: [{ id: 'model-a' }, { id: 'model-b' }] },
      });

      await expect(service.checkModelAvailability()).rejects.toThrow(
        'Model "test-model" not available on provider',
      );
    });

    it('rethrows the "Model" error verbatim (not wrapped as unreachable)', async () => {
      const service = new OpenAIClientService(baseConfig);
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: { data: [{ id: 'model-a' }] },
      });

      await expect(service.checkModelAvailability()).rejects.toThrow(
        /Available models: model-a/,
      );
    });

    it('wraps a network failure as "unreachable"', async () => {
      const service = new OpenAIClientService(baseConfig);

      vi.mocked(axios.get).mockRejectedValueOnce(
        new Error('connect ECONNREFUSED'),
      );

      await expect(service.checkModelAvailability()).rejects.toThrow(
        'LLM Provider unreachable at https://test.example.com',
      );
    });

    it('rethrows the "no models" error verbatim when it bubbles up', async () => {
      const service = new OpenAIClientService(baseConfig);

      // First the inner throw produces "no models", which must be rethrown as-is.
      vi.mocked(axios.get).mockResolvedValueOnce({ data: { data: [] } });

      await expect(service.checkModelAvailability()).rejects.toThrow(
        /no models/,
      );
    });
  });
});
