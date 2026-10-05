import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'iPhone 13', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: /responsive\.spec\.ts/ },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'], browserName: 'chromium' }, testMatch: /responsive\.spec\.ts/ },
    { name: 'iPad (gen 7)', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' }, testMatch: /responsive\.spec\.ts/ },
  ],
});
