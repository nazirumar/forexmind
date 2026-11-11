import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Vitest config for ForexMind.
 *
 * We test pure TS modules (src/lib/*) without needing jsdom, but the
 * react plugin is included so future component tests work out of the
 * box. Tests live next to the source as `*.test.ts(x)`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
    globals: true,
  },
});
