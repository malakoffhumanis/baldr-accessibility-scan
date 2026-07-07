export default {
  '*.ts': ['eslint --fix', 'prettier --write'],
  // Validate all RGAA rules whenever a rule/schema/manifest file changes.
  // Function form => fixed command: lint-staged does NOT append filenames
  // (otherwise vitest would treat them as test filters and fail).
  'src/shared/config/rgaa-rules/**/*.json': () => 'npm run validate:rules',
};
