import { jsonrepair } from 'jsonrepair';

import { createLogger } from '@shared/utils/logger.js';

const logger = createLogger('safe-json-parse');

/**
 * Attempts to parse a string as JSON with multiple fallback strategies:
 * 1. Direct JSON.parse
 * 2. Extract first JSON object via bracket-matching
 * 3. jsonrepair library (handles trailing commas, missing quotes, etc.)
 *
 * Returns the parsed object or throws if all strategies fail.
 */
export function safeJsonParse(raw: string, context?: string): unknown {
  // Strategy 1: direct parse
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // continue to fallbacks
  }

  // Strategy 2: extract first JSON object
  const extracted = extractFirstJsonObject(raw);
  if (extracted !== null) {
    try {
      return JSON.parse(extracted) as unknown;
    } catch {
      // continue
    }
  }

  // Strategy 3: jsonrepair
  const target = extracted ?? raw;
  try {
    const repaired = jsonrepair(target);
    const result = JSON.parse(repaired) as unknown;
    logger.info(
      { context: context ?? 'unknown', repairedLength: repaired.length },
      '[SAFE-JSON] Recovered malformed JSON via jsonrepair',
    );
    return result;
  } catch (err) {
    throw new Error(
      `Failed to parse JSON${context !== undefined ? ` (${context})` : ''}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

/**
 * Extracts the first balanced JSON object ({...}) from a string
 * that may contain markdown fences or prose around it.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
