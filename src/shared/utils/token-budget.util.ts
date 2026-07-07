/**
 * Token budget management utilities for LLM calls: per-model context limits,
 * a rough token estimator, and input-budget computation.
 */

/**
 * Context limits (tokens) per known LLM model.
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4.1': 1047000,
  claude: 200000,
};

/** Default context limit if the model is unknown */
export const DEFAULT_CONTEXT_LIMIT = 128000;

/** Tokens consumed by a low-resolution image (OpenAI vision) */
export const IMAGE_TOKEN_COST = 85;

/** Safety margin (10%) on the input budget to absorb estimation inaccuracies */
export const SAFETY_MARGIN_RATIO = 0.1;

/** Upper bound on the number of output tokens */
export const MAX_OUTPUT_TOKENS_HARD_CAP = 8192;

/** Dynamic ratio to compute the output max_tokens based on the context */
export const OUTPUT_TOKENS_CONTEXT_RATIO = 0.06;

/**
 * Retrieves the context limit of a model.
 * Looks up by exact key then by prefix (e.g. 'claude-3-haiku' matches 'claude').
 */
export function getContextLimit(modelName: string): number {
  const exact = MODEL_CONTEXT_LIMITS[modelName];
  if (exact !== undefined) {
    return exact;
  }
  for (const [key, value] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (modelName.includes(key)) {
      return value;
    }
  }
  return DEFAULT_CONTEXT_LIMIT;
}

/**
 * Rough estimate of the number of tokens in a string.
 * Approximation: 1 token ≈ 4 characters. Aligned with ai-analyzer.service.ts.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Computes the token budget available for the input prompt,
 * accounting for the model, the image and the expected output.
 */
export function computeBudget(
  modelName: string,
  options: { hasImage?: boolean } = {},
): {
  contextLimit: number;
  maxOutputTokens: number;
  inputBudget: number;
} {
  const contextLimit = getContextLimit(modelName);
  const maxOutputTokens = Math.min(
    MAX_OUTPUT_TOKENS_HARD_CAP,
    Math.floor(contextLimit * OUTPUT_TOKENS_CONTEXT_RATIO),
  );
  const imageTokens = options.hasImage === true ? IMAGE_TOKEN_COST : 0;
  const rawInput = contextLimit - maxOutputTokens - imageTokens;
  const inputBudget = Math.floor(rawInput * (1 - SAFETY_MARGIN_RATIO));
  return { contextLimit, maxOutputTokens, inputBudget };
}
