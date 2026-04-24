import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    // Bloqueia SW para testes deterministicos — SW faz network-first cache
    // do portfolio.json.enc e mascara o page.route().fulfill().
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "python -m http.server 8080",
    port: 8080,
    timeout: 10_000,
    reuseExistingServer: !process.env.CI,
  },
});
