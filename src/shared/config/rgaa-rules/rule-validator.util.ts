import path from 'node:path';

import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import betterAjvErrors from 'better-ajv-errors';
import fs from 'fs-extra';

import type { IRGAARule } from '@shared/types/rgaa-rules.types.js';

export interface RuleValidators {
  /** Validates a rule; returns the typed rule or throws a readable error. */
  validateRule(data: unknown, ruleId: string, file: string): IRGAARule;
  /** Validates the manifest; throws a readable error on failure. */
  validateIndex(data: unknown, file: string): void;
}

/**
 * Compiles the RGAA schemas (rule + manifest) from `rulesDir` and exposes
 * validation functions. Reads `rgaa-rule.schema.json` and
 * `rgaa-rules-index.schema.json` co-located with the rules.
 */
export function createRuleValidators(rulesDir: string): RuleValidators {
  const ajv = new Ajv({ allErrors: true, strict: false });

  const ruleSchema: unknown = fs.readJsonSync(
    path.join(rulesDir, 'rgaa-rule.schema.json'),
  );
  const indexSchema: unknown = fs.readJsonSync(
    path.join(rulesDir, 'rgaa-rules-index.schema.json'),
  );

  const validateRuleFn = ajv.compile(ruleSchema as object);
  const validateIndexFn = ajv.compile(indexSchema as object);

  /** Formats ajv errors into a pinpointed message (code-frame: location + offending value). */
  const formatErrors = (
    schema: unknown,
    data: unknown,
    errors: ErrorObject[] | null | undefined,
  ): string =>
    betterAjvErrors(schema, data, errors ?? [], {
      indent: 2,
      json: JSON.stringify(data, null, 2),
    });

  return {
    validateRule(data, ruleId, file): IRGAARule {
      if (!validateRuleFn(data)) {
        throw new Error(
          `Invalid RGAA rule "${ruleId}" (${file}):\n${formatErrors(ruleSchema, data, validateRuleFn.errors)}`,
        );
      }
      return data as IRGAARule;
    },
    validateIndex(data, file): void {
      if (!validateIndexFn(data)) {
        throw new Error(
          `Invalid RGAA rules index (${file}):\n${formatErrors(indexSchema, data, validateIndexFn.errors)}`,
        );
      }
    },
  };
}
