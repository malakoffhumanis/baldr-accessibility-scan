/**
 * Shared LLM default values (single source of truth).
 *
 * Centralizes the default model to avoid drift between the Zod config,
 * the OpenAI client fallback and the diagnostic messages.
 */

/** LLM model used when `LLM_PROVIDER_MODEL` is not provided. */
export const DEFAULT_LLM_MODEL = 'gpt-4o';

/**
 * OpenAI-compatible base URL (including the `/v1` segment) used when
 * `LLM_PROVIDER_ENDPOINT` is not provided.
 */
export const DEFAULT_LLM_ENDPOINT = 'https://api.openai.com/v1';
