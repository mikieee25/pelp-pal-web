import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 3,
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  webServer: { command: 'npm run build && npm run start', url: 'http://localhost:3000', reuseExistingServer: false, timeout: 180_000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /responsive\.spec\.ts/ },
    { name: 'iPhone 13', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: /responsive\.spec\.ts/ },
    // Keep authentication/network mocks observable instead of routing through the PWA worker.
    { name: 'iPhone 16 Pro', use: { ...devices['iPhone 16 Pro'], browserName: 'webkit', serviceWorkers: 'block' }, testMatch: /responsive\.spec\.ts/ },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'], browserName: 'chromium' }, testMatch: /responsive\.spec\.ts/ },
    { name: 'iPad (gen 7)', use: { ...devices['iPad (gen 7)'], browserName: 'chromium' }, testMatch: /responsive\.spec\.ts/ },
  ],
});
