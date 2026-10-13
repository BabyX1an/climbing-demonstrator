import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const launchOptions = existsSync(edge) ? { executablePath: edge } : {};
const externalServer = process.env.PLAYWRIGHT_EXTERNAL === '1';
export default defineConfig({
  testDir: './tests/e2e', timeout: 120000, workers: 1,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173', trace: 'retain-on-failure', launchOptions },
  webServer: externalServer ? undefined : { command: 'npm run dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 60000 },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }]
});
