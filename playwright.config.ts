import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:4399', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build:pages && npx vite preview --config packages/web/vite.config.ts --host 127.0.0.1 --port 4399 --strictPort',
    url: 'http://127.0.0.1:4399/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
