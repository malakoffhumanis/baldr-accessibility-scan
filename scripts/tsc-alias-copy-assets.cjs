const { execFileSync } = require('node:child_process');
const path = require('node:path');

const copyAssetsScript = path.join(__dirname, 'copy-assets.js');

try {
  execFileSync(process.execPath, [copyAssetsScript], { stdio: 'inherit' });
} catch (err) {
  console.error('tsc-alias hook: copy-assets.js failed', err);
  process.exit(1);
}

module.exports.default = ({ orig }) => orig;
