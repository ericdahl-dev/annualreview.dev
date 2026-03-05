import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./test/setup.js"],
    coverage: {
      provider: "v8",
      exclude: [
        "**/*.css",
        "**/node_modules/**",
        "**/dist/**",
        "**/*.config.js",
        "**/*.config.ts",
        "test/**",
      ],
      reporter: ["text", "text-summary", "html", "lcov"],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 78,
        lines: 80,
      },
    },
  },
});
