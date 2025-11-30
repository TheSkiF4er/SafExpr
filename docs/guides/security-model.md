# SafExpr Security Model

SafExpr is designed to evaluate **untrusted expressions** safely inside your
Node/JavaScript application.

This document explains:

- What SafExpr protects you from.
- What it *does not* attempt to protect you from.
- How globals, prototypes and DoS are handled.
- How to use engines, context and plugins securely.
- How the test suite reflects the security model.

If you only remember one thing, remember this:

> **Expressions are sandboxed; your helpers are not.**  
> The sandbox boundary is the **expression**, not the host code you register.

---

## 1. Threat model

SafExpr is intended for situations like:

- Business rules written by **non-trusted** or semi-trusted users.
- Admin/ops UIs where people type conditions into text fields.
- Feature flags, pricing rules, workflow conditions stored in a DB.
- Multi-tenant SaaS systems where each tenant defines their own logic.

The main threats:

1. **Remote code execution (RCE)**  
   User injecting expressions that escape the sandbox and run arbitrary JS.

2. **Data exfiltration / privilege escalation**  
   Expressions accessing secrets or powerful APIs (e.g. `process.env`,
   filesystem, network) that they were not meant to see.

3. **Prototype pollution / object tampering**  
   Expressions mutating prototypes (`Object.prototype`, `Array.prototype`),
   or modifying shared data structures in unexpected ways.

4. **Denial of service (DoS)**  
   Expressions that are huge, deeply nested, or evaluate in exponential time.

SafExpr is built to make these *hard or impossible* from inside an expression
string, assuming you treat **context and helpers correctly**.

---

## 2. Execution model in one picture

**At evaluation time**:

```txt
User expression string
        │
        ▼
   SafExpr compiler
        │
        ▼
  Compiled expression
        │           ▲
        │           │
        ▼           │
   eval(context)    │
        │           │
        ▼           │
     result   +   trusted helpers
````

* The expression sees:

  * the **context** you pass into `eval(context)`; and
  * any **functions** you registered via `engine.withFunction(...)`.

* The expression **does not** see:

  * Node/browser globals (`process`, `globalThis`, `window`, `document`, …);
  * the module system (`require`, `module`, etc.);
  * prototypes (`__proto__`, `constructor.prototype`, …);
  * `eval`, `Function`, `new`, `class`, etc.

---

## 3. Global isolation

### 3.1. Forbidden global identifiers

Expressions must not be able to reference these directly:

```txt
globalThis
global
window
self
process
require
module
__dirname
__filename
document
```

Attempting to use them should:

* either fail at **compile time**, or
* throw an error (ideally `SafexprError`) when evaluating.

Examples that must **fail**:

```txt
process.env
globalThis
window.localStorage
require("fs")
```

See: `tests/security/globals-access.spec.ts`.

### 3.2. Dynamic code execution is blocked

Expressions should never be able to call **dynamic code primitives**:

```txt
eval("1 + 1")
Function("return process")()
new Function("return globalThis")()
this.constructor.constructor("return process")()
({}).constructor.constructor("return globalThis")()
```

These are classic sandbox-escape patterns.
SafExpr’s parser / evaluator must reject or guard them.

### 3.3. No magic `this`

The expression-level `this` should not expose anything interesting:

* `this`
* `this.process`
* `this.window`
* `this && this.process`

All of the above are tested as **forbidden** in
`tests/security/globals-access.spec.ts`.

---

## 4. Prototype & property safety

Prototype pollution is a common way to escalate from “can run code” to
“can corrupt everything”.

SafExpr protects against this by rejecting **dangerous property access**:

### 4.1. Dangerous patterns

Expressions like these must **not succeed**:

```txt
user.__proto__
config.__proto__
payload.__proto__
user.constructor
user.constructor.prototype
payload.constructor.prototype
payload["__proto__"]
payload["constructor"]
payload["__proto__"].polluted
```

These are all covered in `tests/security/prototype-pollution.spec.ts`
and `tests/unit/evaluator.spec.ts` (high-level safety).

### 4.2. No mutation of prototypes

Mutation attempts must not change `Object.prototype` or `Array.prototype`
(even if they error):

```txt
payload.__proto__ = { polluted: "yes" }
payload.constructor.prototype.polluted = "yes"
payload["__proto__"] = { polluted: "yes" }
```

The test suite checks that after such attempts, this property remains unchanged:

```ts
(Object.prototype as any).__safexprTestPollution__
(Array.prototype as any).__safexprTestPollution__
```

See: `tests/security/prototype-pollution.spec.ts`.

### 4.3. Safe lookalikes

Properties that merely **look** suspicious but are not dangerous by themselves
should still work:

```txt
payload.__protoSafe__
payload.constructorName
"__proto__"   // string literal is harmless
"constructor"
```

The tests explicitly distinguish between:

* using such keys in string literals → ✅ allowed;
* using them for property access → ❌ blocked.

---

## 5. Denial-of-service (DoS) protections

SafExpr supports (or aspires to support) **limits** that defend against
pathological expressions.

These are controlled via `EngineOptions` in `createEngine(options?)`:

```ts
const engine = createEngine({
  maxExpressionLength: 2_000,
  maxAstDepth: 64,
  maxEvalOperations: 10_000,
});
```

### 5.1. `maxExpressionLength`

Limits the **length of the expression source** (in characters).

* Too-long expression strings are rejected early.
* Intended to mitigate memory bloat / tokenization/parsing time.

Test example (from `tests/security/dos-limits.spec.ts`):

* “short” expression like `1 + 1 + ...` (50 terms) → ✅ OK;
* extremely long expression (10 000 `+` terms) with `maxExpressionLength: 2000` → ❌.

### 5.2. `maxAstDepth`

Limits the **nesting depth** of the AST.

Pathological cases like:

```txt
((((((((((1 + 1) + 1) + 1) ... ))) ... ))
```

or deeply nested ternaries can cause stack overflows or enormous recursion.

With `maxAstDepth: 64`, expressions deeper than that must be rejected at
compile time.

### 5.3. `maxEvalOperations`

Bounds the **amount of work** during evaluation.

* Very wide chains like:
  `true && true && true && ...` (50 000 terms)
* Or synthesized data-heavy expressions.

With `maxEvalOperations` set reasonably:

* normal expressions evaluate fine;
* huge expressions either cannot compile, or crash early with a clear error.

Tests: `tests/security/dos-limits.spec.ts`.

---

## 6. Context safety

The **context object** you pass to `eval(context)` is the *only* data the
expression can see (plus registered helpers).

Key points:

1. Expressions **cannot** escape the context via globals or prototypes.
2. SafExpr should not mutate the context itself during evaluation.
3. You still own **what** you put into the context.

### 6.1. No unexpected mutation

SafExpr is expected **not to mutate** the original context object:

* It should treat context as read-only.
* Tests in `tests/unit/engine.spec.ts` and `tests/unit/evaluator.spec.ts`
  assert that evaluating expressions does not change the input object.

If you decide to allow mutations in the future, treat that as an explicit,
dangerous extension.

### 6.2. Missing fields & out-of-bounds access

Accessing missing fields or out-of-bounds array indices should:

* return `undefined`, or
* throw a controlled error (depending on configuration),

but never crash the engine in uncontrolled ways.

Example:

```txt
user.missingField
items[999]
```

Tests in `tests/unit/evaluator.spec.ts` check that such cases either return
`undefined` or produce a controlled error.

---

## 7. Helpers, plugins, and trust boundaries

**Crucial idea:**

> Expressions are untrusted.
> Helpers (functions registered via `withFunction`) are trusted.

### 7.1. Helpers run in normal JS

When you call:

```ts
const engine = createEngine().withFunction('discount', (subtotal, premium) => {
  // This code runs in regular JavaScript
  if (!premium) return 0;
  if (subtotal >= 200) return subtotal * 0.2;
  if (subtotal >= 100) return subtotal * 0.12;
  return 0;
});
```

* `discount` can:

  * read environment variables;
  * access the database;
  * call external APIs;
  * mutate anything in your process.

This is **by design** – helpers are part of your **trusted codebase**.
They’re how you intentionally grant expressions controlled powers.

### 7.2. Treat helper arguments as untrusted

Arguments to helpers (`subtotal`, `premium`, etc.) come from expressions, so:

* validate inputs;
* handle unknown / `null` / `undefined` gracefully;
* avoid throwing cryptic errors when users mistype arguments.

### 7.3. Plugins

Plugins are **just functions over engines**:

```ts
type Engine = ReturnType<typeof createEngine>;

function mathPlugin(engine: Engine): Engine {
  return engine
    .withFunction('abs', (x: number) => (x < 0 ? -x : x))
    .withFunction('clamp', (x: number, min: number, max: number) =>
      x < min ? min : x > max ? max : x,
    );
}
```

Plugins extend the trusted surface:

* engines *with* a plugin gain its helpers;
* engines *without* a plugin must *not* see those helpers.

Tests: `tests/unit/plugins.spec.ts`.

---

## 8. Syntax restrictions for security

SafExpr deliberately forbids many JavaScript features that are hard to sandbox.

### 8.1. Not supported (by design)

* Statements:

  * `if`, `else`
  * `for`, `while`, `do`
  * `switch`
  * `return`, `break`, `continue`
  * `try/catch`, `throw`, etc.
* Assignments:

  * `=`, `+=`, `-=`, `*=`, `/=`, `%=` …
  * `++`, `--`
* Dynamic code:

  * `eval`, `Function`, `new`, `class`
* Globals:

  * `process`, `window`, `globalThis`, `document`, …
* Prototype tricks:

  * `__proto__`, `.constructor`, `.prototype`
* `this`, `arguments`, closures.

Any attempt to use these should result in:

* a `SafexprError` at parse/compile time, or
* a controlled runtime failure if some pattern slips into evaluation.

See:

* `tests/unit/parser.spec.ts`
* `tests/integration/syntax-cases.spec.ts`
* `tests/security/*.spec.ts`

---

## 9. Error handling & diagnostics

SafExpr uses `SafexprError` to surface parse and runtime errors with context:

```ts
class SafexprError extends Error {
  column: number; // 1-based column position (where available)
  snippet: string; // short snippet of the expression near the error
}
```

### 9.1. Developer experience

Examples (from the tests):

* syntax error: `n * * m`
* invalid operator: `n *** m`
* unterminated parentheses: `a + (b *`

The tests assert that:

* `SafexprError` is thrown;
* `message`, `column`, and `snippet` are populated.

This helps you:

* log helpful errors in backend services;
* highlight the failing part of an expression in your UI;
* provide better feedback to rule authors.

---

## 10. What SafExpr does **not** guarantee

SafExpr is not a silver bullet; it’s “just” a safer evaluation layer.

It does **not**:

* Turn arbitrary helpers into secure code.
* Protect you from **bugs in your own helpers/plugins**.
* Prevent SSRF, SQL injection, or logic flaws in your application.
* Automatically sanitize or validate your **context**.

You are still responsible for:

* **What** you expose in the context;
* **Which** helpers you register;
* **How** expressions are used (e.g. if they can control security-critical flows).

---

## 11. Security checklist

When adopting SafExpr:

### 11.1. Engine configuration

* [ ] Set `maxExpressionLength` to a reasonable upper bound.
* [ ] Set `maxAstDepth` to prevent deep nesting.
* [ ] Optionally set `maxEvalOperations` for extra DoS protection.
* [ ] Ensure `allowUnsafeGlobalAccess` is either **omitted** or explicitly false.

### 11.2. Helpers & plugins

* [ ] Keep helpers **small and well-typed**.
* [ ] Validate helper inputs; treat them as **untrusted**.
* [ ] Avoid leaking powerful capabilities unless necessary:

  * DB, network, filesystem, etc.
* [ ] Group helpers into **plugins** and apply only where needed.

### 11.3. Context

* [ ] Pass only the data expressions are supposed to see.
* [ ] Avoid passing secrets into context unnecessarily.
* [ ] Make a clear contract: “these fields are available to expressions”.

### 11.4. Testing

* [ ] Add tests using your own **host code** with attacker-like expressions:

  * attempts to access `process`, `globalThis`, etc.;
  * attempts to use `__proto__`, `constructor`, etc.;
  * huge / deeply nested expressions.
* [ ] Keep `tests/security/*.spec.ts` as a **specification** for engine behavior.

---

## 12. Where to go next

* **API docs**

  * [`docs/api/compile.md`](../api/compile.md)
  * [`docs/api/engine.md`](../api/engine.md)
  * [`docs/api/plugins.md`](../api/plugins.md)

* **Syntax & usage**

  * [`docs/guides/expressions-syntax.md`](./expressions-syntax.md)
  * [`docs/guides/migration-guide.md`](./migration-guide.md)

* **Reference tests**

  * `tests/security/globals-access.spec.ts`
  * `tests/security/prototype-pollution.spec.ts`
  * `tests/security/dos-limits.spec.ts`
  * `tests/unit/evaluator.spec.ts`
  * `tests/unit/engine.spec.ts`

SafExpr’s security model is intentionally conservative: **fail closed, not open**.
If an expression looks suspicious or uses unsupported constructs, it should not
run. Build on that assumption, and treat helpers/context as your explicit,
carefully-designed trust boundary.
