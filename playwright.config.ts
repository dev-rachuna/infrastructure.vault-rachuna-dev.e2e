import { defineConfig, devices } from '@playwright/test';

const vaultAddress = process.env.VAULT_ADDR ?? 'https://vault.rachuna.dev';
const ignoreHTTPSErrors =
  (process.env.VAULT_TLS_SKIP_VERIFY ?? 'true').toLowerCase() === 'true';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }],
    ['junit', { outputFile: 'playwright-report/junit.xml' }],
  ],
  use: {
    baseURL: vaultAddress,
    ignoreHTTPSErrors,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'api', testMatch: '**/vault-api.spec.ts' },
    {
      name: 'ui',
      testMatch: '**/vault-ui.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        screenshot: 'only-on-failure',
      },
    },
  ],
});
