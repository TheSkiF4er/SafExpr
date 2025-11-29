# Contributing to Safexpr

First of all – thank you for considering contributing to **Safexpr** 💛  
Every improvement, from typo fixes to deep refactors, helps make the project better.

This document explains how to set up your environment, the contribution process, coding style, and project conventions.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Project Setup](#project-setup)
  - [Prerequisites](#prerequisites)
  - [Fork & Clone](#fork--clone)
  - [Install Dependencies](#install-dependencies)
- [Development Workflow](#development-workflow)
  - [Running Tests](#running-tests)
  - [Linting & Formatting](#linting--formatting)
  - [Building the Library](#building-the-library)
- [Project Structure](#project-structure)
- [Coding Guidelines](#coding-guidelines)
  - [TypeScript](#typescript)
  - [Errors & DX](#errors--dx)
  - [Tests](#tests)
  - [Security Considerations](#security-considerations)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Reporting Issues & Feature Requests](#reporting-issues--feature-requests)
- [Security Reports](#security-reports)
- [License](#license)

---

## Code of Conduct

By participating in this project, you agree to abide by the project’s  
**[Code of Conduct](./CODE_OF_CONDUCT.md)**.

Be respectful, constructive, and inclusive.  
We’re all here to build something useful and secure together.

---

## Ways to Contribute

There are many ways you can help:

- 🐞 **Report bugs** – unexpected behavior, crashes, incorrect evaluation, etc.
- 💡 **Suggest features** – new syntax, plugins, integrations, or APIs.
- 🧪 **Improve tests** – add edge cases, security tests, performance tests.
- 📚 **Improve docs** – clarify wording, add examples, fix typos.
- 🛠 **Contribute code** – bugfixes, refactors, new plugins, DX improvements.
- 🔐 **Review security** – identify and report potential security issues.

If you’re unsure whether your idea fits, feel free to open a **discussion** or **issue** to talk about it first.

---

## Project Setup

### Prerequisites

- **Node.js**: `>= 18`
- **npm**, **pnpm**, or **yarn** (examples below use `npm`)
- A GitHub account and basic git knowledge

### Fork & Clone

1. Fork the repository on GitHub:  
   `https://github.com/TheSkiF4er/safexpr`

2. Clone your fork:

   ```bash
   git clone https://github.com/<your-username>/safexpr.git
   cd safexpr
````

3. Add the original repository as upstream (optional but recommended):

   ```bash
   git remote add upstream https://github.com/TheSkiF4er/safexpr.git
   ```

### Install Dependencies

```bash
npm install
```

You should now be able to run tests and build the project.

---

## Development Workflow

Typical workflow:

1. Create a new branch from `main`.
2. Make your changes.
3. Run tests, lints, and build.
4. Commit with a clear message.
5. Push and open a Pull Request.

### Running Tests

Safexpr uses **Vitest**.

* Run the full test suite:

  ```bash
  npm test
  ```

* Run tests in watch mode (during development):

  ```bash
  npm run test:watch
  ```

### Linting & Formatting

* Check lint:

  ```bash
  npm run lint
  ```

* Auto-fix lint issues:

  ```bash
  npm run lint:fix
  ```

* Check formatting (Prettier):

  ```bash
  npm run format
  ```

* Auto-format:

  ```bash
  npm run format:fix
  ```

Please make sure **lint and format checks pass** before opening a PR.

### Building the Library

The build is split into:

* Type declarations via `tsc`
* JS bundles via Rollup

Run:

```bash
npm run build
```

This will:

* Generate `.d.ts` into `dist/` using `tsconfig.build.json`
* Build ESM/CJS bundles into `dist/` using `rollup.config.mts`

---

## Project Structure

A simplified view of the repository:

```text
safexpr/
├─ src/
│  ├─ core/          # tokenizer, parser, AST, evaluator, engine, errors
│  ├─ plugins/       # built-in plugin helpers (math, collections, etc.)
│  ├─ integrations/  # optional React/Node helpers
│  └─ index.ts       # public entry point (exports core API)
├─ tests/
│  ├─ unit/          # low-level tests (lexer, parser, evaluator, engine)
│  ├─ integration/   # end-to-end expression tests
│  └─ security/      # security-focused tests (globals, proto, DoS)
├─ docs/             # documentation markdown files
├─ examples/         # runnable usage examples
├─ benchmarks/       # performance tests and comparisons
├─ package.json
├─ tsconfig.json
├─ tsconfig.build.json
├─ rollup.config.mts
├─ vitest.config.mts
├─ SECURITY.md
├─ CODE_OF_CONDUCT.md
├─ CONTRIBUTING.md
└─ LICENSE
```

---

## Coding Guidelines

### TypeScript

Safexpr is **TypeScript-first**.

* Use **strict typing** (`strict` is enabled).
* Prefer explicit types for public APIs.
* Avoid `any` whenever possible; use `unknown`, generics, or proper interfaces.
* Keep public types **stable and minimal** – avoid leaking internal details.

### Errors & DX

Safexpr is focused on great developer and user experience.

* Use the shared error classes (e.g. `SafexprError`) where appropriate.
* Provide **clear, actionable messages**, especially for expression parsing/evaluation.
* When possible, include:

  * Position/column information
  * A snippet/preview of the expression with a marker
* Avoid exposing internal implementation details in user-facing errors.

### Tests

* Add tests for every non-trivial change.
* Prefer **small, focused unit tests** in `tests/unit`.
* Add **integration tests** when behavior spans multiple layers (parser + evaluator + engine).
* For any change touching safety/isolation, add or update tests in `tests/security`.

Examples:

* New operator → tests in lexer, parser, evaluator, and a few integration tests.
* Security fix → add regression tests in `tests/security`.

### Security Considerations

Safexpr’s main purpose is executing **user-defined expressions securely**.

When contributing:

* **Never introduce** `eval`, `new Function`, or similar dynamic code execution.
* Avoid adding APIs that allow direct access to:

  * `global`
  * `window`
  * `process`
  * `require`
  * Prototypes or constructors
* Be careful with property access:

  * Guard against prototype pollution and dangerous properties (`__proto__`, `constructor`, `prototype`, etc.).
* For features that may impact performance/complexity:

  * Consider whether they could enable DoS (e.g. extremely deep expressions).
  * Add limits or safeguards where reasonable.

If you think your change may affect security, **call it out in your PR description**.

For reporting actual vulnerabilities, see [Security Reports](#security-reports).

---

## Commit Messages

Clear commit messages make history easier to read and maintain.

You don’t have to strictly follow Conventional Commits, but the following style is recommended:

* **feat:** for new features
* **fix:** for bug fixes
* **perf:** for performance improvements
* **refactor:** for code refactoring
* **test:** for adding or updating tests
* **docs:** for documentation changes
* **chore:** for maintenance tasks (config updates, tooling, etc.)

Examples:

* `feat: add support for ternary operator in expressions`
* `fix: prevent access to __proto__ through member expressions`
* `docs: add React integration example`
* `test: add security regression tests for global access`

---

## Pull Requests

When you’re ready to open a PR:

1. **Sync with upstream** `main` (if needed) and rebase your branch.

2. Ensure the following all pass:

   ```bash
   npm run lint
   npm test
   npm run build
   ```

3. Open a PR against `main` with a clear title and description:

   * What does this change do?
   * Why is it needed?
   * Does it introduce breaking changes?
   * Did you add/update tests?
   * Any security implications?

4. Be responsive to review comments:

   * It’s normal to iterate a bit before merge.
   * Discussion is welcome if you disagree with feedback.

---

## Reporting Issues & Feature Requests

Use the **GitHub Issues** page:
`https://github.com/TheSkiF4er/safexpr/issues`

When opening an issue:

* For **bugs**:

  * Include Safexpr version, Node.js version, and environment.
  * Provide a minimal reproducible example.
  * Describe expected vs actual behavior.

* For **feature requests**:

  * Explain your use case and why existing features are not enough.
  * If possible, provide a rough API/usage sketch.

---

## Security Reports

Do **not** report security vulnerabilities via public GitHub issues.

Instead, follow the instructions in **[SECURITY.md](./SECURITY.md)** for responsible disclosure.

Briefly:

* Email the designated security contact.
* Include details, PoC, and impact.
* Do not publicly disclose until the issue is triaged and a fix is available.

---

## License

By contributing to Safexpr, you agree that your contributions will be licensed under the same license as the project:

> **Apache License 2.0**

For details, see the [`LICENSE`](./LICENSE) file.

---

Thank you for contributing to **Safexpr**!
Created and maintained by **[TheSkiF4er](https://github.com/TheSkiF4er)**.
