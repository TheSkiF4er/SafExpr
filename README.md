# Safexpr

> A safe, minimal, and type-safe expression engine for JavaScript/TypeScript —  
> formulas, rules, and filters without `eval`, without global access, with a great DX.

---

[![npm version](https://img.shields.io/npm/v/safexpr.svg?style=flat-square)](https://www.npmjs.com/package/safexpr)
[![npm downloads](https://img.shields.io/npm/dm/safexpr.svg?style=flat-square)](https://www.npmjs.com/package/safexpr)
[![Build Status](https://img.shields.io/github/actions/workflow/status/TheSkiF4er/safexpr/ci.yml?style=flat-square)](https://github.com/TheSkiF4er/safexpr/actions)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE)

---

Safexpr is a secure, minimalistic expression engine for JavaScript and TypeScript.

It lets your users define **formulas, filters, and business rules** using a familiar syntax – without relying on `eval`, without accessing globals, and with a fully typed API.

Safexpr parses expressions into an AST and evaluates them in a **tightly controlled sandbox**:

- Expressions only see the **context you pass in**.
- Expressions can call **only the functions you explicitly register**.
- The API is **TypeScript-first**, with full IDE autocompletion for both context and return types.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Expressions Syntax](#expressions-syntax)
- [TypeScript & Typing the Context](#typescript--typing-the-context)
- [Registering Custom Functions (Plugins)](#registering-custom-functions-plugins)
- [Error Handling & Diagnostics](#error-handling--diagnostics)
- [React Integration Example](#react-integration-example)
- [Security Model](#security-model)
- [Project Structure](#project-structure)
- [Scripts](#scripts)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Features

- 🚫 **No `eval`, no globals**
  - No `eval`, `Function`, or dynamic code generation.
  - No access to `global`, `window`, `process`, `require`, or other globals.

- 🔒 **Safe by design**
  - Expressions can only access **plain data** in the provided context.
  - Attempts to reach “dangerous” properties (e.g. `__proto__`, `constructor`) can be rejected.

- 🧠 **Familiar syntax**
  - Arithmetic: `+ - * / %`
  - Comparisons: `== != > >= < <=`
  - Logical ops: `&& || !`
  - Ternaries: `cond ? then : else`
  - Function calls: `max(a, b)`
  - Property access: `user.age`, `order.total`

- 🧾 **Type-safe API (TS-first)**
  - Strong typing for **context** and **result**.
  - Great IntelliSense in VS Code / WebStorm.

- ⚙️ **Extensible**
  - Register your own functions (e.g. `ifNull`, `round`, domain-specific helpers).
  - Plugin system for math/date/collection helpers.

- 🧩 **Zero or minimal dependencies**
  - Small and focused, easy to audit and embed.

- 📍 **Great DX**
  - Helpful error messages with column info and snippets.
  - Easy to integrate in Node, browsers, React, etc.

---

## Installation

Using **npm**:

```bash
npm install safexpr
````

Using **yarn**:

```bash
yarn add safexpr
```

Using **pnpm**:

```bash
pnpm add safexpr
```

Safexpr is published as **ES modules** by default and supports Node.js **18+**.

---

## Quick Start

### Basic usage (TypeScript)

```ts
import { compile } from "safexpr";

type Context = {
  price: number;
  qty: number;
  user: { age: number; country: string };
};

const expr = compile<Context, number>(
  "price * qty * (user.age >= 18 ? 1 : 0)"
);

const result = expr.eval({
  price: 10,
  qty: 3,
  user: { age: 20, country: "US" },
});

console.log(result); // 30
```

### Using the engine with custom functions

```ts
import { createEngine } from "safexpr";

const engine = createEngine()
  .withFunction("max", (a: number, b: number) => Math.max(a, b))
  .withFunction("ifNull", <T>(value: T | null | undefined, fallback: T) =>
    value == null ? fallback : value
  );

type Ctx = { x?: number; y?: number };

const expr = engine.compile<Ctx, number>(
  "max(ifNull(x, 0), ifNull(y, 0))"
);

console.log(expr.eval({ x: 10 }));         // 10
console.log(expr.eval({ y: 42 }));         // 42
console.log(expr.eval({ x: 2, y: 5 }));    // 5
```

---

## Expressions Syntax

Safexpr uses a small, familiar subset of JavaScript-like syntax.

### Literals

* Numbers: `0`, `1.5`, `.5`, `10.0`
* Strings: `"hello"`, `'world'`
* Booleans: `true`, `false` (can be supported as identifiers/literals depending on implementation)
* `null` (if implemented as a literal or special value)

Example:

```text
42
"hello"
'user'
```

### Identifiers & Property Access

* Simple identifiers: `price`, `qty`, `user`
* Nested access: `user.age`, `order.total`, `customer.address.city`

Example:

```text
user.age >= 18 && user.country == "US"
```

### Arithmetic

```text
price * qty
subtotal + tax
(score + bonus) / 2
```

Supported operators:

* `+ - * / %`

### Comparisons

```text
price > 0
qty >= 1
status == "active"
country != "US"
```

Supported operators:

* `== != > >= < <=`

### Logical Operators

```text
user.age >= 18 && user.country == "US"
qty > 0 || isFree
!isBlocked
```

Supported operators:

* `&& || !`

### Ternary

```text
user.age >= 18 ? "adult" : "child"
qty > 0 ? price * qty : 0
```

---

## TypeScript & Typing the Context

Safexpr is **TS-first**. You can type both the **context** and the **result**:

```ts
import { compile } from "safexpr";

type User = {
  id: string;
  age: number;
  country: string;
};

type Context = {
  user: User;
  premium: boolean;
};

const expr = compile<Context, boolean>(
  'premium || (user.age >= 18 && user.country == "US")'
);

const allow = expr.eval({
  premium: false,
  user: { id: "u1", age: 20, country: "US" },
});

console.log(allow); // true
```

Type errors will show up in your IDE / build if you try to pass a wrong context shape or assign wrong result type.

---

## Registering Custom Functions (Plugins)

You can expose **only safe, controlled functions** to expressions.

### Simple custom function

```ts
import { createEngine } from "safexpr";

const engine = createEngine().withFunction(
  "discount",
  (price: number, percent: number) => price * (1 - percent / 100)
);

type Ctx = { price: number };

const expr = engine.compile<Ctx, number>("discount(price, 15)");

console.log(expr.eval({ price: 200 })); // 170
```

### Reusable plugin pattern

Create a plugin module:

```ts
// src/plugins/discount.ts
import type { Engine } from "safexpr";

export function withDiscountPlugin(engine: Engine): Engine {
  return engine.withFunction(
    "discount",
    (price: number, percent: number) => price * (1 - percent / 100)
  );
}
```

Use it in your app:

```ts
import { createEngine } from "safexpr";
import { withDiscountPlugin } from "./plugins/discount";

const engine = withDiscountPlugin(createEngine());

const expr = engine.compile<{ price: number }, number>("discount(price, 10)");
console.log(expr.eval({ price: 100 })); // 90
```

---

## Error Handling & Diagnostics

Safexpr throws a specialized error (e.g. `SafexprError`) for parse and validation issues.

```ts
import { compile, SafexprError } from "safexpr";

try {
  const expr = compile("price * * qty"); // invalid
  expr.eval({ price: 10, qty: 2 });
} catch (e) {
  if (e instanceof SafexprError) {
    console.error("Expression error:", e.message);
    console.error("Column:", e.column);
    console.error("Snippet:", e.snippet); // e.g. "price * 🔺* qty"
  } else {
    throw e;
  }
}
```

You can surface `message` and a pretty `snippet` (with marker) to your users in a UI, making it easy for them to fix their expressions.

---

## React Integration Example

Safexpr is framework-agnostic but can be easily used in React apps.

### Minimal custom React hook

```tsx
// src/integrations/react/useExpression.ts
import { useMemo } from "react";
import { createEngine, SafexprError } from "safexpr";

const engine = createEngine();

export function useExpression<C, R>(source: string | null) {
  return useMemo(() => {
    if (!source) {
      return { eval: (_: C) => null as unknown as R, error: null as SafexprError | null };
    }

    try {
      const compiled = engine.compile<C, R>(source);
      return { eval: compiled.eval.bind(compiled), error: null };
    } catch (err) {
      if (err instanceof SafexprError) {
        return {
          eval: (_: C) => null as unknown as R,
          error: err,
        };
      }
      throw err;
    }
  }, [source]);
}
```

### Using it in a component

```tsx
import React, { useState } from "react";
import { useExpression } from "./useExpression";

type Ctx = { score: number; bonus: number };

export function ExpressionPlayground() {
  const [exprStr, setExprStr] = useState("score * 2 + bonus");
  const [score, setScore] = useState(10);
  const [bonus, setBonus] = useState(5);

  const { eval: evalExpr, error } = useExpression<Ctx, number>(exprStr);

  const value = error
    ? "Error"
    : evalExpr({ score, bonus });

  return (
    <div>
      <h2>Safexpr Playground</h2>
      <label>
        Expression:
        <input
          value={exprStr}
          onChange={(e) => setExprStr(e.target.value)}
        />
      </label>

      <label>
        Score:
        <input
          type="number"
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
        />
      </label>

      <label>
        Bonus:
        <input
          type="number"
          value={bonus}
          onChange={(e) => setBonus(Number(e.target.value))}
        />
      </label>

      <div>
        <strong>Result:</strong> {String(value)}
      </div>

      {error && (
        <pre style={{ color: "red" }}>
          {error.message}
          {"\n"}
          {error.snippet}
        </pre>
      )}
    </div>
  );
}
```

---

## Security Model

Safexpr is designed with **security first**:

* No dynamic code execution via `eval` / `Function`.
* Expressions only get the **context** you give them.
* You control every function they can call.
* Property access is limited to “safe” object properties (no proto tricks).
* You can add additional guards around:

  * Maximum expression length.
  * Maximum AST depth.
  * Evaluation timeouts (on your application layer).

**Important:** Safexpr is a **building block**, not a complete security solution. You are responsible for:

* Carefully choosing which data you pass into the context.
* Auditing functions you expose to expressions.
* Applying best practices in your application (auth, rate limiting, etc.).

For more details, see [`SECURITY.md`](./SECURITY.md).

---

## Project Structure

A typical repo layout for Safexpr:

```text
safexpr/
├─ src/
│  ├─ core/          # tokenizer, parser, AST, evaluator, engine, errors
│  ├─ plugins/       # optional math/date/collection plugins
│  ├─ integrations/  # React / Node helpers (optional)
│  └─ index.ts       # public entry point
├─ tests/
│  ├─ unit/          # low-level tests
│  ├─ integration/   # end-to-end expression tests
│  └─ security/      # security-focused tests (globals, proto, DoS)
├─ examples/         # runnable examples (Node, React)
├─ benchmarks/       # performance tests
├─ docs/             # documentation markdown files
├─ package.json
├─ tsconfig.json
├─ tsconfig.build.json
├─ rollup.config.mts
├─ vitest.config.mts
├─ SECURITY.md
└─ LICENSE
```

---

## Scripts

From `package.json`:

```jsonc
{
  "scripts": {
    "build:types": "tsc -p tsconfig.build.json",
    "build:js": "rollup -c",
    "build": "npm run build:types && npm run build:js",

    "test": "vitest run",
    "test:watch": "vitest",

    "lint": "eslint \"src/**/*.ts\" \"tests/**/*.ts\"",
    "lint:fix": "eslint \"src/**/*.ts\" \"tests/**/*.ts\" --fix",

    "format": "prettier --check \"src/**/*.{ts,tsx}\" \"tests/**/*.{ts,tsx}\"",
    "format:fix": "prettier --write \"src/**/*.{ts,tsx}\" \"tests/**/*.{ts,tsx}\"",

    "clean": "rm -rf dist coverage .turbo .vitest",

    "prepare": "npm run build"
  }
}
```

---

## Roadmap

Planned / possible features:

* ⚡ **More plugins**

  * Date/time helpers
  * Collection helpers (aggregations, filter-like behavior)

* 🧪 **Static analysis & linting**

  * Detect overly complex expressions.
  * Identify always-true / always-false conditions.

* 🛡️ **Stronger DoS protection**

  * Built-in limits for expression length and AST depth.
  * Optional loop-like constructs with safe guards (if ever added).

* 🧩 **More integrations**

  * NestJS / Express middleware examples.
  * CLI tool for validating and testing expressions.

You can help shape the roadmap by opening issues and discussions.

---

## Contributing

Contributions are welcome! 🎉

1. **Fork** the repository.

2. **Clone** your fork and install dependencies:

   ```bash
   npm install
   ```

3. Make your changes on a feature branch.

4. Run tests and lints:

   ```bash
   npm test
   npm run lint
   ```

5. Open a **pull request** describing:

   * What you changed.
   * Why it’s needed.
   * Any breaking changes or migration notes.

Before contributing, please read:

* [`CONTRIBUTING.md`](./CONTRIBUTING.md)
* [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md)

---

## Security

If you discover a security issue, **please do not** open a public GitHub issue.

Instead, follow the instructions in [`SECURITY.md`](./SECURITY.md) for responsible disclosure.

---

## License

Safexpr is licensed under the **Apache License 2.0**.
You are free to use it in both open-source and commercial projects under the terms of the Apache-2.0 license.

See [`LICENSE`](./LICENSE) for details.

---

## Author

Created and maintained by **TheSkiF4er**.
GitHub: [@TheSkiF4er](https://github.com/TheSkiF4er)
