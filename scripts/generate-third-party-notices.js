#!/usr/bin/env node

/**
 * Generates THIRD_PARTY_NOTICES.md from the project's PRODUCTION dependencies.
 *
 * Uses `license-checker` (already a devDependency). Run via `npm run notices:generate`.
 * Output is deterministic (packages sorted by name) so CI can re-run it and fail
 * when the committed file is out of date.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const licenseChecker = require('license-checker');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const selfId = `${pkg.name}@${pkg.version}`;
const outFile = path.join(rootDir, 'THIRD_PARTY_NOTICES.md');

licenseChecker.init({ start: rootDir, production: true }, (err, packages) => {
  if (err) {
    console.error('license-checker failed:', err);
    process.exit(1);
  }

  // Exclude the project itself — the file lists third-party packages only.
  delete packages[selfId];

  const keys = Object.keys(packages).sort((a, b) => a.localeCompare(b));

  const header =
    '# Third-Party Notices\n\n' +
    'BALDR bundles the following third-party packages. Each retains its own license.\n\n';

  const blocks = keys.map((key) => {
    const info = packages[key];
    const licenses = Array.isArray(info.licenses)
      ? info.licenses.join(', ')
      : info.licenses || 'UNKNOWN';
    const repository = info.repository || 'n/a';
    const copyright = info.copyright || 'n/a';
    return `## ${key}\n\n- License: ${licenses}\n- Repository: ${repository}\n- Copyright: ${copyright}\n`;
  });

  fs.writeFileSync(outFile, header + blocks.join('\n'));
  console.log(`Wrote ${keys.length} third-party packages to THIRD_PARTY_NOTICES.md`);
});
