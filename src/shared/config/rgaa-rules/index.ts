import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger } from '@shared/utils/logger.js';
import type {
  IRGAARule,
  IRGAARulesCollection,
} from '@shared/types/rgaa-rules.types.js';

import { createRuleValidators } from './rule-validator.util.js';
import type { RuleValidators } from './rule-validator.util.js';

const logger = createLogger('rgaa-rules-loader');

// Get the current directory path in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the directory containing the RGAA rule JSON files.
 * Looks in several locations to support local dev,
 * the tsc build and Docker deployment.
 */
function resolveRulesDir(): string {
  const candidates = [
    // 1. Same directory as the current file (dist/shared/config/rgaa-rules/)
    __dirname,
    // 2. Original source (dev with tsx)
    path.resolve(process.cwd(), 'src', 'shared', 'config', 'rgaa-rules'),
    // 3. From the project root - built output
    path.resolve(process.cwd(), 'dist', 'shared', 'config', 'rgaa-rules'),
  ];

  for (const candidate of candidates) {
    const indexPath = path.join(candidate, 'rules-index.json');
    if (fs.pathExistsSync(indexPath)) {
      logger.info({ dir: candidate }, 'RGAA rules directory found');
      return candidate;
    }
  }

  logger.warn(
    { __dirname, cwd: process.cwd(), candidates },
    'No RGAA rules directory found among candidates',
  );
  return __dirname;
}

/**
 * Service that loads RGAA rules from rules-index.json
 */
export class RGAARulesLoader {
  private rulesDir: string;
  private cachedRules: IRGAARulesCollection | null = null;
  private validators: RuleValidators | null = null;

  constructor() {
    this.rulesDir = resolveRulesDir();
  }

  private getValidators(): RuleValidators {
    this.validators ??= createRuleValidators(this.rulesDir);
    return this.validators;
  }

  /**
   * Loads all RGAA rules from rules-index.json
   */
  async loadAllRules(): Promise<IRGAARulesCollection> {
    if (this.cachedRules) {
      return this.cachedRules;
    }

    try {
      logger.info('Loading RGAA rules from rules-index.json');

      // Load the rules index
      const indexPath = path.join(this.rulesDir, 'rules-index.json');

      // Check that the file exists before reading
      const exists = await fs.pathExists(indexPath);
      if (!exists) {
        throw new Error(
          `rules-index.json file not found at: ${indexPath}. ` +
            `CWD: ${process.cwd()}, rulesDir: ${this.rulesDir}. ` +
            `Make sure the copy-assets.js script ran after the build.`,
        );
      }
      const indexContent = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexContent) as {
        rules: Record<string, string>;
      };

      const validators = this.getValidators();
      validators.validateIndex(index, indexPath);

      const rules: Record<string, IRGAARule> = {};

      // Load + validate each rule (replaces the unchecked cast)
      for (const [ruleId, relativePath] of Object.entries(index.rules)) {
        const rulePath = path.join(this.rulesDir, relativePath);
        const ruleContent = await fs.readFile(rulePath, 'utf-8');
        const parsed = JSON.parse(ruleContent) as unknown;
        rules[ruleId] = validators.validateRule(parsed, ruleId, rulePath);
        logger.info({ ruleId }, `  Rule loaded: ${ruleId}`);
      }

      const collection: IRGAARulesCollection = {
        version: '4.1.2',
        lastUpdated: new Date().toISOString(),
        rules,
      };

      this.cachedRules = collection;

      logger.info(
        { rulesCount: Object.keys(rules).length },
        'All RGAA rules loaded successfully',
      );

      return collection;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: errorMessage }, 'Failed to load RGAA rules');
      throw new Error(`Failed to load RGAA rules: ${errorMessage}`, {
        cause: error,
      });
    }
  }

  /**
   * Loads specific rules by IDs
   */
  async loadSpecificRules(ruleIds: string[]): Promise<IRGAARule[]> {
    const allRules = await this.loadAllRules();
    const rules: IRGAARule[] = [];

    for (const ruleId of ruleIds) {
      const rule = allRules.rules[ruleId];

      if (rule != null) {
        rules.push(rule);
      } else {
        logger.warn({ ruleId }, 'RGAA rule not found');
      }
    }

    logger.info({ count: rules.length }, 'Specific rules loaded');
    return rules;
  }

  /**
   * Retrieves a rule by its RGAA ID (e.g. "1.1")
   */
  async getRuleByRGAAId(rgaaId: string): Promise<IRGAARule | null> {
    const allRules = await this.loadAllRules();
    const rule = Object.values(allRules.rules).find((r) => r.id === rgaaId);
    return rule ?? null;
  }

  /**
   * Loads specific rules by their RGAA IDs (e.g. ["1.1", "3.2"])
   */
  async loadSpecificRulesByRGAAIds(rgaaIds: string[]): Promise<IRGAARule[]> {
    logger.info({ rgaaIds }, 'Loading RGAA rules by RGAA IDs');

    const allRules = await this.loadAllRules();
    const rules: IRGAARule[] = [];

    for (const rgaaId of rgaaIds) {
      const rule = Object.values(allRules.rules).find((r) => r.id === rgaaId);
      if (rule) {
        rules.push(rule);
        logger.info({ rgaaId, ruleId: rule.ruleId }, 'RGAA rule loaded');
      } else {
        logger.warn({ rgaaId }, 'RGAA rule not found');
      }
    }

    return rules;
  }

  /**
   * Retrieves a rule by its ID (ruleId, e.g. "image-alt")
   */
  async getRuleById(ruleId: string): Promise<IRGAARule | null> {
    const allRules = await this.loadAllRules();
    return allRules.rules[ruleId] ?? null;
  }
}

export const rgaaRulesLoader = new RGAARulesLoader();
