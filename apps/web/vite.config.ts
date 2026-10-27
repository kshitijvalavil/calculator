/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const engineMock = fileURLToPath(new URL("./src/test/engineMock.ts", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // GitHub Pages serves the app from /<repo>/, so the deploy workflow sets VITE_BASE.
  base: process.env.VITE_BASE ?? "/",
  // Separate cache dirs let the local-mode and API-mode e2e servers run side by side.
  cacheDir: process.env.CALC_VITE_CACHE ?? "node_modules/.vite",
  server: { strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Unit tests run against a table-driven stand-in; e2e tests use the real engine.
    alias: { "@calc/engine": engineMock },
  },
});
