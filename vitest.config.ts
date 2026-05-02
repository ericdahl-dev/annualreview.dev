import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./test/setup.js"],
    reporters: ["default", "junit"],
    outputFile: { junit: "test-report.junit.xml" },
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
        statements: 77,
        branches: 69,
        functions: 74,
        lines: 79,
      },
    },
  },
});
