import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/**/*.{test,spec}.{ts,tsx}",
      "apps/*/{app,src}/**/*.{test,spec}.{ts,tsx}",
      "packages/*/src/**/*.{test,spec}.{ts,tsx}",
      "services/*/src/**/*.{test,spec}.{ts,tsx}",
    ],
    passWithNoTests: false,
  },
});
