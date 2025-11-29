// rollup.config.mts
//
// Rollup configuration for the Safexpr library.
//
// Goals:
// - Build a clean ESM bundle and a CJS bundle from src/index.ts
// - Keep dependencies and peerDependencies external (no bundling React, etc.)
// - Use TypeScript via @rollup/plugin-typescript for JS output
// - Rely on `tsc -p tsconfig.build.json` to generate .d.ts files into dist/
//
// Recommended build pipeline in package.json:
//
//   "scripts": {
//     "build:types": "tsc -p tsconfig.build.json",
//     "build:js": "rollup -c",
//     "build": "npm run build:types && npm run build:js"
//   }

import { defineConfig } from "rollup";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import json from "@rollup/plugin-json";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pkg from "./package.json" assert { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mark all Node built-ins and declared deps/peerDeps as external.
// This keeps the library lean and avoids bundling React, etc.
const external = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

export default defineConfig({
  // Main entry point of the library
  input: resolve(__dirname, "src/index.ts"),

  // Do not bundle external dependencies; let the consumer install them.
  external,

  output: [
    {
      // ESM build (recommended modern entry)
      file: (pkg as any).module ?? "dist/index.mjs",
      format: "esm",
      sourcemap: true,
      exports: "named",
      // Keep the module structure friendly for tree-shaking.
      preserveModules: false
    },
    {
      // CommonJS build for older tooling / Node require()
      file: (pkg as any).main ?? "dist/index.cjs",
      format: "cjs",
      sourcemap: true,
      exports: "named"
    }
  ],

  plugins: [
    // Resolve Node-style module imports in src/
    nodeResolve({
      extensions: [".mjs", ".js", ".json", ".ts"],
      preferBuiltins: true
    }),

    // Convert CommonJS modules to ES6 (if any dependency needs it)
    commonjs(),

    // Allow importing JSON files if needed (e.g., for metadata)
    json(),

    // Transpile TypeScript to JavaScript for bundling.
    // Declarations are handled separately by `tsc -p tsconfig.build.json`.
    typescript({
      tsconfig: "./tsconfig.json",
      // Make sure Rollup itself does not attempt to emit declarations.
      declaration: false
    })
  ],

  // Enable aggressive but safe tree-shaking for a small, focused bundle.
  treeshake: {
    moduleSideEffects: false,
    propertyReadSideEffects: false,
    tryCatchDeoptimization: false
  },

  // Ensure the entry’s exported shape remains stable.
  preserveEntrySignatures: "exports-only"
});
