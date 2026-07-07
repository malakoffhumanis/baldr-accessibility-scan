import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { z } from 'zod';

import {
  type BusinessSelectorsConfig,
  loadBusinessSelectors,
} from './business-selectors.config.js';
import { DEFAULT_LLM_ENDPOINT, DEFAULT_LLM_MODEL } from './llm-defaults.js';
import { isCliMode } from './runtime-mode.js';
import { type ApiKeyEntry, parseApiKeys } from '@shared/security/api-key.js';
import type { AppConfig } from '@shared/types/index.js';

export type { ApiKeyEntry } from '@shared/security/api-key.js';

/**
 * Reads the application version from the `package.json` at the project root.
 * Used as a fallback when the `APP_VERSION` env variable is not provided
 * by the build/deployment pipeline.
 */
function readPackageVersion(): string {
  try {
    const pkgPath = resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Network proxy configuration (resolved from environment variables)
 */
export interface IProxyConfig {
  url: string;
}

/**
 * Puppeteer browser configuration
 */
export interface IBrowserConfig {
  headless: boolean;
  executablePath?: string;
  proxy?: IProxyConfig;
}

/**
 * Configuration LLM Provider (LiteLLM)
 */
export interface ILLMProviderConfig {
  apiKey: string;
  endpoint: string;
  model: string;
  contextLimit?: number;
}

/**
 * CORS configuration
 */
export interface ICorsConfig {
  origins: string[];
}

/**
 * Rate-limiting configuration
 */
export interface IRateLimitConfig {
  windowMs: number;
  max: number;
}

/**
 * Complete application configuration
 */
export interface IConfig extends AppConfig {
  proxy?: IProxyConfig;
  cors: ICorsConfig;
  rateLimit: IRateLimitConfig;
  browser: IBrowserConfig;
  llmProvider?: ILLMProviderConfig;
  exposeApiDocs: boolean;
  serverTimeoutMs: number;
  reportsDir?: string;
  appVersion: string;
  /**
   * When true, journey error capture dumps the full DOM and a base64
   * screenshot (also written to disk under reports/). Off by default to
   * avoid leaking sensitive page content. Env: BALDR_DEBUG_ERROR_CAPTURE.
   */
  debugErrorCapture: boolean;
  /**
   * API keys accepted on the audit endpoint. Each entry pairs a public `id`
   * (used for log/metric attribution — never the secret) with the secret key.
   * REQUIRED — at least one entry; an empty list aborts startup (no "openbar"
   * mode). Env: API_KEYS (comma-separated, each entry `id:secret`; a bare
   * `secret` gets a derived id).
   */
  apiKeys: ApiKeyEntry[];
  /**
   * Framework-specific DOM selectors used by the journey engine to drive
   * proprietary back-office menus. Empty by default (universal conventions
   * only). Env: BUSINESS_CLICKABLE_SELECTORS, BUSINESS_CONTAINER_CLASSES,
   * BUSINESS_CONTAINER_ATTRIBUTES, BUSINESS_STABLE_ATTRIBUTES,
   * BUSINESS_AJAX_TRIGGER_ATTRIBUTES.
   */
  businessSelectors: BusinessSelectorsConfig;
}

/**
 * Zod schema for environment variables.
 * All values are strings (process.env), coerced if necessary.
 */
const envSchema = z
  .object({
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    NODE_ENV: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

    HTTPS_PROXY: z.string().optional(),
    https_proxy: z.string().optional(),
    HTTP_PROXY: z.string().optional(),
    http_proxy: z.string().optional(),

    CORS_ORIGIN: z.string().default(''),

    RATE_LIMIT_WINDOW_MS: z.coerce
      .number({
        error: 'RATE_LIMIT_WINDOW_MS must be a number',
      })
      .int()
      .positive()
      .default(900000),
    RATE_LIMIT_MAX: z.coerce
      .number({ error: 'RATE_LIMIT_MAX must be a number' })
      .int()
      .positive()
      .default(100),

    PUPPETEER_HEADFUL: z.string().optional(),
    PUPPETEER_EXECUTABLE_PATH: z.string().optional(),

    EXPOSE_API_DOCS: z
      .enum(['true', 'false', ''])
      .default('')
      .transform((v) => v === 'true'),

    LLM_PROVIDER_API_KEY: z.string().min(1).optional(),
    LLM_PROVIDER_ENDPOINT: z.url().default(DEFAULT_LLM_ENDPOINT),
    LLM_PROVIDER_MODEL: z.string().default(DEFAULT_LLM_MODEL),
    LLM_CONTEXT_LIMIT: z.coerce.number().int().positive().optional(),

    SERVER_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),

    REPORTS_DIR: z.string().optional(),

    APP_VERSION: z.string().optional(),

    BALDR_LLM_RECORD: z
      .enum(['true', 'false', ''])
      .default('')
      .transform((v) => v === 'true'),
    BALDR_LLM_REPLAY: z.string().optional(),

    BALDR_DEBUG_ERROR_CAPTURE: z
      .enum(['true', 'false', ''])
      .default('')
      .transform((v) => v === 'true'),

    API_KEYS: z.string().optional(),

    BUSINESS_CLICKABLE_SELECTORS: z.string().optional(),
    BUSINESS_CONTAINER_CLASSES: z.string().optional(),
    BUSINESS_CONTAINER_ATTRIBUTES: z.string().optional(),
    BUSINESS_STABLE_ATTRIBUTES: z.string().optional(),
    BUSINESS_AJAX_TRIGGER_ATTRIBUTES: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Authentication is mandatory for the HTTP server: at least one valid
    // `id:secret` entry. Unauthenticated ("openbar") mode is not supported.
    // The CLI runs audits locally — no endpoint to protect — so it is exempt.
    if (!isCliMode() && parseApiKeys(env.API_KEYS).length === 0) {
      ctx.addIssue({
        code: 'custom',
        message:
          'API_KEYS is required and must contain at least one `id:secret` entry. ' +
          'Unauthenticated ("openbar") mode is no longer supported.',
        path: ['API_KEYS'],
      });
    }
  });

/**
 * Loads and validates the configuration from environment variables.
 * Every read of process.env must go through this function.
 *
 * @throws {Error} if a required variable is missing or invalid.
 *                 The message lists precisely each offending variable.
 * @returns Normalized and validated configuration
 */
export const loadConfig = (envOverrides?: Record<string, string>): IConfig => {
  const source =
    envOverrides != null ? { ...process.env, ...envOverrides } : process.env;
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const messages = parsed.error.issues.map((issue) => {
      const varName = issue.path.length > 0 ? String(issue.path[0]) : 'env';
      return `  - ${varName}: ${issue.message}`;
    });
    throw new Error(
      `Invalid or missing environment variables in .env:\n${messages.join('\n')}`,
    );
  }

  const env = parsed.data;

  const proxyUrl =
    env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  const proxy: IProxyConfig | undefined =
    proxyUrl != null && proxyUrl !== '' ? { url: proxyUrl } : undefined;

  const origins = env.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isProduction = env.NODE_ENV === 'production';
  const forceHeadful = env.PUPPETEER_HEADFUL === 'true';
  const headless = isProduction ? true : !forceHeadful;

  const llmProvider: ILLMProviderConfig | undefined =
    env.LLM_PROVIDER_API_KEY != null && env.LLM_PROVIDER_API_KEY !== ''
      ? {
          apiKey: env.LLM_PROVIDER_API_KEY,
          endpoint: env.LLM_PROVIDER_ENDPOINT.replace(/\/+$/, ''),
          model: env.LLM_PROVIDER_MODEL,
          contextLimit: env.LLM_CONTEXT_LIMIT,
        }
      : undefined;

  return {
    port: env.PORT,
    env: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    proxy,
    cors: { origins },
    rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
    browser: { headless, executablePath: env.PUPPETEER_EXECUTABLE_PATH, proxy },
    llmProvider,
    exposeApiDocs: env.EXPOSE_API_DOCS,
    serverTimeoutMs: env.SERVER_TIMEOUT_MS,
    reportsDir: env.REPORTS_DIR,
    appVersion: env.APP_VERSION ?? readPackageVersion(),
    debugErrorCapture: env.BALDR_DEBUG_ERROR_CAPTURE,
    apiKeys: parseApiKeys(env.API_KEYS),
    businessSelectors: loadBusinessSelectors(env),
  };
};
