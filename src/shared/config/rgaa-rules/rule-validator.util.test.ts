import fs from 'fs';
import path from 'path';

import { describe, it, expect } from 'vitest';

import { createRuleValidators } from './rule-validator.util.js';

const RULES_DIR = path.resolve('src/shared/config/rgaa-rules');

function readJson(rel: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(RULES_DIR, rel), 'utf8'));
}

describe('RGAA rule schema validation', () => {
  const validators = createRuleValidators(RULES_DIR);
  const index = readJson('rules-index.json') as {
    rules: Record<string, string>;
  };

  it('validates the manifest against the index schema', () => {
    expect(() =>
      validators.validateIndex(index, 'rules-index.json'),
    ).not.toThrow();
  });

  it('validates the 71 manifest rules against the schema', () => {
    const failures: string[] = [];
    for (const [ruleId, rel] of Object.entries(index.rules)) {
      try {
        validators.validateRule(readJson(rel), ruleId, rel);
      } catch (e) {
        failures.push((e as Error).message);
      }
    }
    expect(failures).toEqual([]);
  });

  it('rejects a malformed rule with a clear message', () => {
    const call = (): unknown =>
      validators.validateRule({ id: 'x' }, 'x', 'fake.json');
    expect(call).toThrow(/Invalid RGAA rule "x"/);
    // the message must carry the actionable ajv detail (missing required field)
    expect(call).toThrow(/must have required property/);
  });

  it('rejects a malformed manifest', () => {
    expect(() =>
      validators.validateIndex(
        { rules: { a: 'not-a-relative-path' } },
        'fake.json',
      ),
    ).toThrow(/Invalid RGAA rules index/);
  });
});
