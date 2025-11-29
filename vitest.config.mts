// vitest.config.mts
//
// Vitest configuration for the Safexpr project.
// - TypeScript-first
// - Node by default, jsdom for React integration tests
// - Coverage enabled and tuned for a library
// - Path aliases via tsconfig (and a direct @ → src alias)

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  // Use Vite plugins — this one reads path aliases from tsconfig.json.
  plugins: [tsconfigPaths()],

  resolve: {
    alias: {
      // Optional convenience alias for imports such as "@/core/engine"
      "@": resolve(__dirname, "src"),
    },
  },

  test: {
    // Use global test functions (describe, it, expect, etc.)
    globals: true,

    // Default test environment is Node (ideal for a core expression engine).
    environment: "node",

    // Use jsdom only for React-related integration tests.
    environmentMatchGlobs: [
      ["tests/integration/react/**", "jsdom"],
    ],

    // Where to look for test files.
    include: ["tests/**/*.spec.ts", "tests/**/*.test.ts"],

    // Paths that should never be considered as test files.
    exclude: [
      "node_modules",
      "dist",
      "coverage",
      "examples/**",
      "benchmarks/**",
      ".git",
      ".turbo",
    ],

    // Optional: global setup for mocks, custom matchers, etc.
    // Create tests/setupTests.ts if you actually need it.
    setupFiles: ["./tests/setupTests.ts"],

    // Code coverage configuration.
    coverage: {
      provider: "v8", // Native V8 coverage, fast and recommended.
      reportsDirectory: "coverage",
      reporter: ["text", "html", "lcov"],

      // What to include in coverage reports.
      include: ["src/**/*.ts"],

      // Exclude type declarations, simple barrel files, etc.
      exclude: [
        "src/**/*.d.ts",
        "src/**/index.ts", // often just re-exports
        "src/**/__tests__/**",
      ],

      // Reasonable default thresholds for a serious library.
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
    },

    // Make tests safer and more deterministic by resetting mocks between runs.
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,

    // Avoid noisy watch rebuilds for generated / heavy folders.
    watchExclude: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
    ],

    // Helpful when tracking memory usage during large test suites.
    logHeapUsage: true,
  },

  // Global replacements available at build/test time.
  // You can use this in the source like: if (__DEV__) { ... }
  define: {
    __DEV__: true,
  },
});
