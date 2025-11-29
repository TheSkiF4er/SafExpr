# Changelog

All notable changes to **Safexpr** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- (planned) Built-in date/time plugin (common date helpers, `now()`, etc.).
- (planned) Collection plugin with aggregate helpers (`sum`, `avg`, `minBy`, `maxBy`).
- (planned) CLI tool to validate and test expressions from the command line.
- (planned) More framework integrations (NestJS / Express examples).

### Changed
- (planned) Fine-tune default security limits (expression length, AST depth).

### Fixed
- (planned) TBD.

---

## [0.1.0] – 2025-11-30

Initial public release of **Safexpr**.

### Added

#### Core Engine
- **Expression engine** for JavaScript/TypeScript:
  - Safe, minimal, type-safe evaluation of user-defined expressions.
  - No `eval`, no `Function`, no direct access to globals or environment.
- **Context-based evaluation**:
  - Expressions can only access data explicitly passed as context.
  - Support for nested property access (e.g. `user.age`, `order.total`).
- **Supported syntax**:
  - Literals: numbers, strings (basic support).
  - Identifiers and member access.
  - Arithmetic operators: `+`, `-`, `*`, `/`, `%`.
  - Comparison operators: `==`, `!=`, `>`, `>=`, `<`, `<=`.
  - Logical operators: `&&`, `||`, `!`.
  - Ternary operator: `cond ? thenExpr : elseExpr`.
  - Function calls with an explicit function allowlist.

#### Parser & Evaluator
- **Tokenizer (lexer)**:
  - Converts expression strings into tokens with position information.
  - Supports numbers, strings, identifiers, operators, parentheses, commas, `?`, `:`.
- **Parser (recursive descent)**:
  - Builds an AST with operator precedence.
  - Produces meaningful syntax errors with position hints.
- **Evaluator**:
  - Evaluates AST nodes using a safe, controlled runtime.
  - Member access guarded to avoid prototype pollution patterns.
  - Function calls restricted to registered functions only.

#### Public API
- `compile<C, R>(source: string)`:
  - Compiles an expression string into a `CompiledExpression<C, R>`.
  - Returns an object with:
    - `eval(context: C): R`
    - `ast` (internal AST representation)
    - `source` (original string)
- `createEngine(options?)`:
  - Creates an `Engine` instance with a function table and options.
  - Supports method chaining:
    - `.withFunction(name, fn)` to register safe, explicit functions.
  - `engine.compile<C, R>(source)` to compile with shared configuration.
- Error handling:
  - `SafexprError`:
    - Specialized error type for expression parsing / validation issues.
    - Carries `column` (position) and `snippet` (expression preview with marker).

#### TypeScript Support
- **TS-first design**:
  - Strong typing of context and result for `compile` and `Engine.compile`.
  - Helpful IntelliSense in modern editors.
- **Config**:
  - `tsconfig.json` with strict type checking enabled.
  - `tsconfig.build.json` for declaration-only builds.

#### Tooling & Build
- **Build pipeline**:
  - `tsc -p tsconfig.build.json` to emit `.d.ts` types to `dist/`.
  - **Rollup** configuration (`rollup.config.mts`) to build:
    - ESM bundle: `dist/index.mjs`
    - CJS bundle: `dist/index.cjs`
  - Proper `exports` in `package.json` for `import` / `require` / `types`.
- **Testing**:
  - **Vitest** setup (`vitest.config.mts`) with:
    - Node environment by default.
    - Optional jsdom environment mapping for React integration tests.
    - Coverage via V8.
- **Linters & formatters** (expected, with config files in repo):
  - ESLint + Prettier integration (scripts for `lint`, `lint:fix`, `format`, `format:fix`).

#### Documentation & Repo Meta
- **README.md**:
  - Project overview, features, quick start, examples, security model.
  - React usage example and recommended project layout.
- **CONTRIBUTING.md**:
  - Guidelines for contributions, coding standards, tests, and PRs.
- **SECURITY.md**:
  - Security model description and instructions for responsible disclosure.
- **CHANGELOG.md**:
  - This file, following Keep a Changelog + SemVer.
- **License**:
  - Apache License 2.0 with attribution to **TheSkiF4er**.

---

## Versioning

Safexpr uses **Semantic Versioning**:

- **MAJOR**: incompatible API changes.
- **MINOR**: backwards-compatible feature additions.
- **PATCH**: backwards-compatible bug fixes.

---

## Links

- Repository: <https://github.com/TheSkiF4er/safexpr>
- Issues: <https://github.com/TheSkiF4er/safexpr/issues>

[Unreleased]: https://github.com/TheSkiF4er/safexpr/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/TheSkiF4er/safexpr/releases/tag/v0.1.0
