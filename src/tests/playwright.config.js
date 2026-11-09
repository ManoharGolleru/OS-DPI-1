import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "ai-design.spec.js", workers: 1, timeout: 30000,
  use: {baseURL: "http://127.0.0.1:8080", headless: true},
  webServer: {command:"npm run start -- --host 127.0.0.1", url:"http://127.0.0.1:8080/OS-DPI-1/", reuseExistingServer:false},
});
