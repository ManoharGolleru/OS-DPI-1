import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'.',testMatch:['authoring.spec.js','authoring.archive.spec.js','authoring.general.spec.js','authoring.transaction.spec.js'],workers:1,timeout:30000,
  use:{baseURL:'http://127.0.0.1:8080',headless:true,trace:'retain-on-failure'},
  reporter:'list',
  webServer:{command:'npm run start -- --host 127.0.0.1 --strictPort',url:'http://127.0.0.1:8080/OS-DPI-1/',reuseExistingServer:!process.env.CI},
});
