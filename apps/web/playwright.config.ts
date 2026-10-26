import { defineConfig, devices } from "@playwright/test";

export const LOCAL_PORT = 5179;
export const API_PORT = 5180;
/** Fake Supabase origin for API mode; every request to it is answered by page.route. */
export const MOCK_SUPABASE = "http://mock-supabase.test";

// Playwright's bundled Chromium is used by default. PW_CHROMIUM_PATH points at another binary if needed.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${LOCAL_PORT}`,
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // Local mode: no Supabase env, history in localStorage.
      command: `npx vite --port ${LOCAL_PORT} --strictPort`,
      url: `http://localhost:${LOCAL_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: { VITE_SUPABASE_URL: "", VITE_SUPABASE_ANON_KEY: "", CALC_VITE_CACHE: "node_modules/.vite-local" },
      timeout: 60_000,
    },
    {
      // API mode against a mocked Supabase origin.
      command: `npx vite --port ${API_PORT} --strictPort`,
      url: `http://localhost:${API_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_SUPABASE_URL: MOCK_SUPABASE,
        VITE_SUPABASE_ANON_KEY: "test-anon-key",
        CALC_VITE_CACHE: "node_modules/.vite-api",
      },
      timeout: 60_000,
    },
  ],
});
