#!/usr/bin/env node

/**
 * Script to copy assets (JSON, etc.) into the dist directory.
 * Needed because TypeScript (tsc) only copies .ts files.
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

/**
 * Recursively copies all JSON files from src/ to dist/.
 */
async function copyJsonFiles() {
  console.log('📋 Copying JSON files...');

  try {
    // Copy the RGAA rules (JSON) — target mirrors tsc emit (rootDir=src → dist/shared/...)
    const rgaaRulesSrc = path.join(srcDir, 'shared', 'config', 'rgaa-rules');
    const rgaaRulesDist = path.join(distDir, 'shared', 'config', 'rgaa-rules');

    await fs.ensureDir(rgaaRulesDist);

    // Recursively copy the whole rgaa-rules directory (subfolders included)
    await fs.copy(rgaaRulesSrc, rgaaRulesDist, {
      filter: (src) => {
        // Copy directories and JSON files only
        const stat = fs.statSync(src);
        if (stat.isDirectory()) return true;
        return src.endsWith('.json');
      },
    });

    console.log(`✅ RGAA rules copied recursively`);
  } catch (error) {
    console.error('❌ Error while copying JSON files:', error);
    process.exit(1);
  }
}

// Run
copyJsonFiles();
