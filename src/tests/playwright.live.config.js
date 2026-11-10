import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'.', testMatch:'authoring.live.spec.js', workers:1, timeout:300000, retries:0,
  use:{baseURL:process.env.OSDPI_TEST_URL || 'http://127.0.0.1:8080/OS-DPI-1/',headless:true,trace:'off',video:'off'},
  reporter:'list',
  webServer:process.env.OSDPI_TEST_URL?undefined:{command:'npm run start -- --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:8080/OS-DPI-1/',reuseExistingServer:!process.env.CI},
});
