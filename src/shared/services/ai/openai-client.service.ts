import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { createHash } from 'node:crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { DEFAULT_LLM_MODEL } from '@shared/config/llm-defaults.js';
import { createLogger } from '@shared/utils/logger.js';
import { LRUCache } from '@shared/utils/lru-cache.util.js';
import {
  llmCallsTotal,
  llmCallDuration,
  llmTokensTotal,
  llmCacheHits,
} from '@shared/utils/metrics.js';

import { LLMRecordReplayService } from './llm-record-replay.service.js';

const logger = createLogger('openai-client');

/** Default LRU cache: 64 entries, 15 min TTL */
const LLM_CACHE_MAX_SIZE = 64;
const LLM_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * LLM Provider configuration (LiteLLM)
 */
interface ILLMProviderConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

/**
 * OpenAI message
 */
interface IOpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | IOpenAIMessageContent[];
}

/**
 * Message content with images (for vision)
 */
interface IOpenAIMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

/**
 * OpenAI response
 */
interface IOpenAIResponse {
  response: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

/**
 * Configuration required by OpenAIClientService
 */
export interface IOpenAIClientConfig {
  llmProvider?: {
    apiKey: string;
    endpoint: string;
    model: string;
  };
  proxy?: { url: string };
  env: 'development' | 'production' | 'test';
}

/**
 * LLM Provider client service (LiteLLM)
 */
export class OpenAIClientService {
  private config: ILLMProviderConfig | null = null;
  private isConfigured = false;
  private readonly proxyUrl: string | undefined;
  private readonly appEnv: string;
  private readonly safeProxyUrl: string;
  private readonly recordReplay: LLMRecordReplayService;
  private readonly responseCache = new LRUCache<IOpenAIResponse>({
    maxSize: LLM_CACHE_MAX_SIZE,
    ttlMs: LLM_CACHE_TTL_MS,
  });

  constructor(appConfig?: IOpenAIClientConfig) {
    this.proxyUrl = appConfig?.proxy?.url;
    this.appEnv = appConfig?.env ?? 'development';
    this.safeProxyUrl =
      this.proxyUrl != null && this.proxyUrl !== ''
        ? this.proxyUrl.replace(/\/\/[^@]+@/, '//<redacted>@')
        : 'not configured';
    this.recordReplay = new LLMRecordReplayService();

    if (appConfig?.llmProvider) {
      let endpoint = appConfig.llmProvider.endpoint;
      while (endpoint.endsWith('/')) {
        endpoint = endpoint.slice(0, -1);
      }
      this.config = {
        endpoint,
        apiKey: appConfig.llmProvider.apiKey,
        model: appConfig.llmProvider.model,
      };
      this.isConfigured = true;
      logger.info(
        { endpoint: this.config.endpoint, model: this.config.model },
        'OpenAIClientService configured',
      );
    } else {
      this.config = null;
      this.isConfigured = false;
      logger.info('OpenAIClientService created without LLM Provider config');
    }
  }

  /**
   * Call to the Chat Completion API (OpenAI format via LiteLLM)
   */
  async chatCompletion(
    messages: IOpenAIMessage[],
    generationParams: Record<string, unknown> = {},
    options: { timeout?: number; signal?: AbortSignal } = {},
  ): Promise<IOpenAIResponse> {
    if (!this.config || !this.isConfigured) {
      throw new Error(
        'LLM Provider service not configured. Check LLM_PROVIDER_API_KEY and LLM_PROVIDER_ENDPOINT environment variables.',
      );
    }

    // Replay mode: return cached response if available
    const replayed = this.recordReplay.replay(messages, generationParams);
    if (replayed) {
      llmCacheHits.inc({ source: 'replay' });
      return replayed;
    }

    // LRU cache: return cached response for identical prompts
    const cacheKey = createHash('sha256')
      .update(
        JSON.stringify({
          model: this.config.model,
          messages,
          generationParams,
        }),
      )
      .digest('hex')
      .slice(0, 24);
    const cached = this.responseCache.get(cacheKey);
    if (cached) {
      logger.debug({ cacheKey }, 'LLM cache hit');
      llmCacheHits.inc({ source: 'lru' });
      return cached;
    }

    const startTime = Date.now();
    const { timeout = 90000, signal } = options;
    const url = `${this.config.endpoint}/chat/completions`;

    // Base parameters common to all models
    const defaultParams: Record<string, unknown> = {
      model: this.config.model,
      temperature: 0.2,
      max_tokens: 3000,
    };

    // Claude (Bedrock) does not accept top_p together with temperature
    // We add top_p, frequency_penalty, presence_penalty only for OpenAI
    const isClaude = this.config.model.includes('claude');
    if (!isClaude) {
      defaultParams['top_p'] = 0.95;
      defaultParams['frequency_penalty'] = 0;
      defaultParams['presence_penalty'] = 0;
    }

    // Proxy configuration for a corporate environment
    const axiosConfig: AxiosRequestConfig = {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      timeout,
      signal,
      proxy: false, // Disable axios native proxy to use httpsAgent instead
    };

    if (this.proxyUrl != null && this.proxyUrl !== '') {
      logger.info(
        { proxyUrl: this.safeProxyUrl },
        'Proxy configured for LLM Provider',
      );
      const agent = new HttpsProxyAgent(this.proxyUrl);
      axiosConfig.httpsAgent = agent;
    } else if (this.appEnv === 'production') {
      logger.warn(
        'Production without proxy - if LLM Provider is unreachable, configure HTTPS_PROXY',
      );
    }

    try {
      logger.info(
        {
          url,
          model: this.config.model,
          proxyConfigured: Boolean(this.proxyUrl),
          timeout,
        },
        'Calling LLM Provider...',
      );

      const response = await this.executeWithRetry(
        () =>
          axios.post(
            url,
            {
              messages,
              ...defaultParams,
              ...generationParams,
            },
            axiosConfig,
          ),
        { maxRetries: 3, signal },
      );

      interface OpenAIResponseData {
        choices?: {
          message?: {
            content?: string;
          };
        }[];
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
        model?: string;
      }

      const data = response.data as OpenAIResponseData;
      const generated = data.choices?.[0]?.message?.content ?? '';

      logger.info(
        { tokens: data.usage?.total_tokens },
        '[OK] LLM Provider response received',
      );

      const result: IOpenAIResponse = {
        response: generated,
        usage: data.usage,
        model: data.model ?? this.config.model,
      };

      // Record mode: persist response to disk
      this.recordReplay.record(messages, generationParams, result);

      // Store in LRU cache for subsequent identical calls
      this.responseCache.set(cacheKey, result);

      // Metrics
      const durationSec = (Date.now() - startTime) / 1000;
      llmCallsTotal.inc({ model: result.model, status: 'success' });
      llmCallDuration.observe({ model: result.model }, durationSec);
      if (result.usage) {
        llmTokensTotal.inc(
          { model: result.model, type: 'prompt' },
          result.usage.prompt_tokens,
        );
        llmTokensTotal.inc(
          { model: result.model, type: 'completion' },
          result.usage.completion_tokens,
        );
      }

      return result;
    } catch (err: unknown) {
      const durationSec = (Date.now() - startTime) / 1000;
      llmCallsTotal.inc({ model: this.config.model, status: 'error' });
      llmCallDuration.observe({ model: this.config.model }, durationSec);
      const error = err as Error;

      if (axios.isAxiosError(error) && error.response) {
        const status = error.response.status;
        const message =
          (error.response.data as { error?: { message?: string } }).error
            ?.message ?? error.message;

        logger.error(
          {
            status,
            message,
            endpoint: this.config.endpoint,
            model: this.config.model,
            proxyConfigured: Boolean(this.proxyUrl),
          },
          `[ERROR] LLM Provider HTTP error (${status.toString()})`,
        );

        if (status === 401) {
          throw new Error(
            'LLM Provider authentication failed (401). Check LLM_PROVIDER_API_KEY',
            { cause: err },
          );
        }
        if (status === 429) {
          throw new Error(
            'LLM Provider rate limit reached (429). All retries exhausted',
            { cause: err },
          );
        }
        if (status === 404) {
          throw new Error(
            `Model "${this.config.model}" not found (404). Check LLM_PROVIDER_MODEL`,
            { cause: err },
          );
        }

        throw new Error(`LLM Provider (${status.toString()}): ${message}`, {
          cause: err,
        });
      }

      // Network errors (no HTTP response)
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      logger.error(
        {
          errorMessage,
          code: axios.isAxiosError(error) ? error.code : undefined,
          endpoint: this.config.endpoint,
          proxyConfigured: Boolean(this.proxyUrl),
          proxyUrl: this.safeProxyUrl,
        },
        '[ERROR] LLM Provider network error',
      );

      if (errorMessage.includes('ECONNABORTED')) {
        throw new Error(
          `LLM Provider timeout (${String(timeout)}ms). Network may be too slow or a proxy is blocking the connection`,
          { cause: err },
        );
      }

      if (errorMessage.includes('ENOTFOUND')) {
        throw new Error(
          `DNS resolution failed for ${this.config.endpoint}. Check LLM_PROVIDER_ENDPOINT and network access/proxy (HTTPS_PROXY=${this.safeProxyUrl})`,
          { cause: err },
        );
      }

      if (errorMessage.includes('ECONNREFUSED')) {
        throw new Error(
          `Connection refused to ${this.config.endpoint}. Check firewall, proxy (HTTPS_PROXY=${this.safeProxyUrl}) or network access`,
          { cause: err },
        );
      }

      if (
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('socket hang up')
      ) {
        throw new Error(
          `Connection reset to LLM Provider. Likely blocked by proxy or firewall (HTTPS_PROXY=${this.safeProxyUrl})`,
          { cause: err },
        );
      }

      throw new Error(`LLM Provider error: ${errorMessage}`, { cause: err });
    }
  }

  /**
   * Tests connectivity to LLM Provider
   * @returns Test result with details
   */
  async testConnection(): Promise<{
    success: boolean;
    details: Record<string, unknown>;
  }> {
    if (!this.config || !this.isConfigured) {
      return {
        success: false,
        details: {
          error: 'LLM Provider configuration incomplete',
          configured: false,
        },
      };
    }

    try {
      logger.info('Testing LLM Provider connectivity...');
      const response = await this.chatCompletion(
        [{ role: 'user', content: 'test' }],
        { max_tokens: 5 },
        { timeout: 30000 },
      );

      return {
        success: true,
        details: {
          model: response.model,
          endpoint: this.config.endpoint,
          proxyConfigured: Boolean(this.proxyUrl),
          tokensUsed: response.usage?.total_tokens,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        details: {
          error: msg,
          endpoint: this.config.endpoint,
          model: this.config.model,
          proxyConfigured: Boolean(this.proxyUrl),
        },
      };
    }
  }

  /**
   * Pre-flight check: verifies the LLM provider is reachable and the configured
   * model exists. Throws with a clear message if not — call this before
   * launching a journey to fail fast instead of crashing mid-execution.
   */
  async checkModelAvailability(): Promise<void> {
    if (!this.config || !this.isConfigured) {
      throw new Error(
        'LLM Provider not configured. Set LLM_PROVIDER_API_KEY and LLM_PROVIDER_ENDPOINT.',
      );
    }

    const url = `${this.config.endpoint}/models`;
    const axiosConfig: AxiosRequestConfig = {
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      timeout: 10000,
      proxy: false,
    };

    if (this.proxyUrl != null && this.proxyUrl !== '') {
      axiosConfig.httpsAgent = new HttpsProxyAgent(this.proxyUrl);
    }

    try {
      const response = await axios.get(url, axiosConfig);
      const models = (response.data as { data?: { id: string }[] }).data?.map(
        (m) => m.id,
      );

      if (!models || models.length === 0) {
        throw new Error(
          `LLM Provider returned no models. Check API key permissions.`,
        );
      }

      if (!models.includes(this.config.model)) {
        throw new Error(
          `Model "${this.config.model}" not available on provider. ` +
            `Available models: ${models.join(', ')}. ` +
            `Update LLM_PROVIDER_MODEL in your .env file.`,
        );
      }

      logger.info(
        { model: this.config.model, endpoint: this.config.endpoint },
        'LLM Provider health check passed',
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('Model "')) {
        throw err;
      }
      if (err instanceof Error && err.message.includes('no models')) {
        throw err;
      }

      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `LLM Provider unreachable at ${this.config.endpoint}: ${msg}`,
        { cause: err },
      );
    }
  }

  /**
   * Checks whether the service is configured and ready
   */
  isReady(): boolean {
    return this.config !== null && this.isConfigured;
  }

  /**
   * Returns the name of the configured model
   */
  getModel(): string {
    return this.config?.model ?? DEFAULT_LLM_MODEL;
  }

  /**
   * Executes an HTTP request with exponential backoff retry on 429/503.
   * Respects Retry-After header when present. Adds jitter to avoid thundering herd.
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    opts: { maxRetries: number; signal?: AbortSignal },
  ): Promise<T> {
    const { maxRetries, signal } = opts;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: unknown) {
        lastError = err;

        if (signal?.aborted === true) throw err;

        if (!axios.isAxiosError(err) || !err.response) throw err;

        const status = err.response.status;
        const isRetryable = status === 429 || status === 503;
        if (!isRetryable || attempt >= maxRetries) throw err;

        // Determine delay: use Retry-After header if present, else exponential backoff
        const headers = err.response.headers as
          Record<string, string> | undefined;
        const retryAfterHeader = headers?.['retry-after'];
        let delayMs: number;
        if (retryAfterHeader != null) {
          const parsed = Number(retryAfterHeader);
          delayMs = Number.isNaN(parsed) ? 5000 : parsed * 1000;
        } else {
          // Exponential backoff: 2s, 4s, 8s + jitter (0-1s)
          delayMs = Math.pow(2, attempt + 1) * 1000;
        }
        // Add jitter (0–1000ms)
        delayMs += Math.floor(Math.random() * 1000);

        logger.warn(
          { status, attempt: attempt + 1, maxRetries, delayMs },
          `Retryable error (${String(status)}), retrying after ${String(delayMs)}ms...`,
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }
}
