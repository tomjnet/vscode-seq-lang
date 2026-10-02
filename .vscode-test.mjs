import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/tests/integration/**/*.test.js',
  workspaceFolder: 'tests/fixtures/project',
  launchArgs: ['--disable-workspace-trust'],
  mocha: { ui: 'tdd', timeout: 20000 },
});
