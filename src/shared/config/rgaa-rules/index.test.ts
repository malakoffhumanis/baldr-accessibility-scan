import { describe, it, expect, vi, beforeEach } from 'vitest';

import type * as RuleValidatorModule from './rule-validator.util.js';

// Hoisted fs-extra mock so the IO-branch tests can drive the loader's
// filesystem behaviour. By default every method delegates to the real
// fs-extra implementation, so the integration tests (and the singleton's
// resolveRulesDir() at import time) keep reading the real rule JSON files.
const fsMock = vi.hoisted(() => ({
  pathExistsSync: vi.fn(),
  pathExists: vi.fn(),
  readFile: vi.fn(),
  // Real implementations, captured in the mock factory below.
  real: {
    pathExistsSync: (..._a: unknown[]): unknown => undefined,
    pathExists: (..._a: unknown[]): unknown => undefined,
    readFile: (..._a: unknown[]): unknown => undefined,
  },
}));

function delegateFsToReal(): void {
  fsMock.pathExistsSync.mockImplementation((...args: unknown[]) =>
    fsMock.real.pathExistsSync(...args),
  );
  fsMock.pathExists.mockImplementation((...args: unknown[]) =>
    fsMock.real.pathExists(...args),
  );
  fsMock.readFile.mockImplementation((...args: unknown[]) =>
    fsMock.real.readFile(...args),
  );
}

vi.mock('fs-extra', async (importOriginal) => {
  const actual = (await importOriginal<{ default: Record<string, unknown> }>())
    .default;
  fsMock.real.pathExistsSync = actual['pathExistsSync'] as (
    ...a: unknown[]
  ) => unknown;
  fsMock.real.pathExists = actual['pathExists'] as (...a: unknown[]) => unknown;
  fsMock.real.readFile = actual['readFile'] as (...a: unknown[]) => unknown;
  // Delegate to the real implementation by default; individual tests override
  // specific methods via fsMock.<method>.mockResolvedValue(...) etc.
  delegateFsToReal();
  return {
    default: { ...actual, ...fsMock },
  };
});

vi.mock('@shared/utils/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const validatorsMock = vi.hoisted(() => ({
  validateIndex: vi.fn(),
  validateRule: vi.fn(),
}));

vi.mock('./rule-validator.util.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RuleValidatorModule>();
  return {
    ...actual,
    // Toggle between real validators (integration tests) and the spy-driven
    // mock (IO-branch tests) via the useRealValidators flag below.
    createRuleValidators: (dir: string) =>
      useRealValidators ? actual.createRuleValidators(dir) : validatorsMock,
  };
});

// Imported after the mocks are declared. The singleton instance runs
// resolveRulesDir() here, which is why fs-extra defaults to the real impl.
import { rgaaRulesLoader, RGAARulesLoader } from './index.js';

// Controls whether the mocked module returns real or spy validators.
let useRealValidators = true;

const sampleRule = {
  id: '1.1',
  ruleId: 'image-alt',
  title: 'Images',
  level: 'A',
};

describe('RGAA Rules Loader', () => {
  beforeEach(() => {
    // Integration tests: real fs-extra + real validators.
    useRealValidators = true;
    fsMock.pathExistsSync.mockReset();
    fsMock.pathExists.mockReset();
    fsMock.readFile.mockReset();
    delegateFsToReal();
  });

  it('should load all RGAA rules', async () => {
    const collection = await rgaaRulesLoader.loadAllRules();

    expect(collection).toBeDefined();
    expect(collection.rules).toBeDefined();
    expect(Object.keys(collection.rules).length).toBeGreaterThan(0);
    // Loading + AJV-validating all rule files is the first (uncached) call and
    // is notably slower under v8 coverage instrumentation — allow extra time.
  }, 30000);

  it('should load image-alt rule specifically', async () => {
    const rule = await rgaaRulesLoader.getRuleById('image-alt');

    expect(rule).toBeDefined();
    expect(rule?.ruleId).toBe('image-alt');
    expect(rule?.title).toBe('Images - Alternative textuelle');
    expect(rule?.level).toBe('A');
    expect(rule?.aiAnalysisConfig.enabled).toBe(true);
  });

  it('should load specific rules by IDs', async () => {
    const rules = await rgaaRulesLoader.loadSpecificRules(['image-alt']);

    expect(rules).toBeDefined();
    expect(rules.length).toBe(1);
    expect(rules[0]?.ruleId).toBe('image-alt');
  });

  it('should load specific rules by RGAA IDs', async () => {
    const rules = await rgaaRulesLoader.loadSpecificRulesByRGAAIds(['1.1']);

    expect(rules).toBeDefined();
    expect(rules.length).toBe(1);
    expect(rules[0]?.id).toBe('1.1');
    expect(rules[0]?.ruleId).toBe('image-alt');
  });

  it('should return empty array for non-existent RGAA IDs', async () => {
    const rules = await rgaaRulesLoader.loadSpecificRulesByRGAAIds(['99.99']);

    expect(rules).toBeDefined();
    expect(rules.length).toBe(0);
  });

  it('should get rule by RGAA ID', async () => {
    const rule = await rgaaRulesLoader.getRuleByRGAAId('1.1');

    expect(rule).toBeDefined();
    expect(rule?.id).toBe('1.1');
    expect(rule?.ruleId).toBe('image-alt');
  });

  it('should return null for non-existent RGAA ID', async () => {
    const rule = await rgaaRulesLoader.getRuleByRGAAId('99.99');

    expect(rule).toBeNull();
  });

  it('should handle non-existent rule gracefully', async () => {
    const rule = await rgaaRulesLoader.getRuleById('non-existent');

    expect(rule).toBeNull();
  });

  it('image-alt rule should have correct structure', async () => {
    const rule = await rgaaRulesLoader.getRuleById('image-alt');

    expect(rule).toBeDefined();
    expect(rule?.testScenarios).toBeDefined();
    expect(rule?.testScenarios.informativeImage).toBeDefined();
    expect(rule?.testScenarios.decorativeImage).toBeDefined();
    expect(rule?.commonErrors).toBeDefined();
    expect(rule?.commonErrors.length).toBeGreaterThan(0);
    expect(rule?.aiAnalysisConfig.analysisPrompt?.tasks).toBeDefined();
    expect(
      rule?.aiAnalysisConfig.analysisPrompt?.tasks?.length,
    ).toBeGreaterThan(0);
  });
});

describe('RGAARulesLoader — IO branches (mocked fs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // IO-branch tests use the spy validators and fully scripted fs mocks.
    useRealValidators = false;
    // resolveRulesDir picks the first candidate whose rules-index.json exists
    fsMock.pathExistsSync.mockReturnValue(true);
    validatorsMock.validateIndex.mockImplementation(() => undefined);
    validatorsMock.validateRule.mockImplementation((parsed: unknown) => parsed);
  });

  it('throws a descriptive error when rules-index.json is missing at load time', async () => {
    fsMock.pathExists.mockResolvedValue(false);

    const loader = new RGAARulesLoader();
    await expect(loader.loadAllRules()).rejects.toThrow(
      /Failed to load RGAA rules:.*rules-index\.json file not found/,
    );
  });

  it('wraps and rethrows JSON parse errors with cause', async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.readFile.mockResolvedValueOnce('{ broken json');

    const loader = new RGAARulesLoader();
    await expect(loader.loadAllRules()).rejects.toThrow(
      /Failed to load RGAA rules:/,
    );
  });

  it('handles non-Error throwables in the catch with "Unknown error"', async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.readFile.mockResolvedValueOnce(
      JSON.stringify({ rules: { 'image-alt': 'rules/image-alt.json' } }),
    );
    // validator throws a non-Error value
    validatorsMock.validateIndex.mockImplementationOnce(() => {
      throw 'not-an-error';
    });

    const loader = new RGAARulesLoader();
    await expect(loader.loadAllRules()).rejects.toThrow(
      'Failed to load RGAA rules: Unknown error',
    );
  });

  it('loads and caches rules, then serves the cache on subsequent calls', async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.readFile
      .mockResolvedValueOnce(
        JSON.stringify({ rules: { 'image-alt': 'rules/image-alt.json' } }),
      )
      .mockResolvedValueOnce(JSON.stringify(sampleRule));

    const loader = new RGAARulesLoader();
    const first = await loader.loadAllRules();
    expect(first.rules['image-alt']).toEqual(sampleRule);
    expect(first.version).toBe('4.1.2');

    // Second call: cache hit, no additional readFile calls
    const readCountAfterFirst = fsMock.readFile.mock.calls.length;
    const second = await loader.loadAllRules();
    expect(second).toBe(first);
    expect(fsMock.readFile.mock.calls.length).toBe(readCountAfterFirst);
  });

  it('loadSpecificRules warns and skips unknown rule ids', async () => {
    fsMock.pathExists.mockResolvedValue(true);
    fsMock.readFile
      .mockResolvedValueOnce(
        JSON.stringify({ rules: { 'image-alt': 'rules/image-alt.json' } }),
      )
      .mockResolvedValueOnce(JSON.stringify(sampleRule));

    const loader = new RGAARulesLoader();
    const rules = await loader.loadSpecificRules([
      'image-alt',
      'does-not-exist',
    ]);

    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(sampleRule);
  });

  it('falls back to __dirname when no candidate directory contains the index', async () => {
    // resolveRulesDir finds nothing -> warns and returns __dirname.
    fsMock.pathExistsSync.mockReturnValue(false);
    fsMock.pathExists.mockResolvedValue(false);

    const loader = new RGAARulesLoader();
    await expect(loader.loadAllRules()).rejects.toThrow(/Failed to load/);
  });
});
