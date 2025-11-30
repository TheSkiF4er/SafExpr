# SafExpr Expression Syntax

This guide describes the **expression language** used by SafExpr:

- what you can write inside an expression string;
- how it behaves (precedence, short-circuiting, etc.);
- what is *deliberately not* supported for safety.

SafExpr is deliberately **small and predictable**:  
you get a focused subset of JavaScript-like expressions, without statements,
globals, or dynamic code evaluation.

---

## Mental model

- Every expression is a **pure expression** that is evaluated against a
  **context object**.
- The only things you can “see” from inside an expression are:
  - the **context** (`ctx`) you pass to `eval(context)`;
  - **functions** you explicitly register via `engine.withFunction(...)`.

There are **no statements** (no `if`, `for`, `while`, `return`, etc.) and  
**no assignment** (`=`, `+=`, `++`, …) inside expressions.

---

## Quick examples

```ts
// 1. Simple arithmetic
const expr1 = compile<{ price: number; qty: number }, number>('price * qty');

expr1.eval({ price: 19.99, qty: 3 }); // 59.97

// 2. Nested properties + ternary
const expr2 = compile<{
  user: { age: number; premium: boolean };
  order: { subtotal: number; shipping: number; taxRate: number };
}, number>(`
  user.premium && user.age >= 18
    ? (order.subtotal * 0.9 + order.shipping) * (1 + order.taxRate)
    : (order.subtotal + order.shipping) * (1 + order.taxRate)
`);

// 3. Array indexing
const expr3 = compile<{ scores: number[] }, number>('scores[0] * 2');

// 4. Using engine functions
const engine = createEngine().withFunction(
  'segment',
  (age: number) => (age < 18 ? 'child' : age < 30 ? 'young-adult' : 'adult'),
);

const expr4 = engine.compile<{ user: { age: number } }, string>(
  'segment(user.age)',
);
````

---

## Core building blocks

### Literals

SafExpr supports the following literal forms:

* **Numbers**

  ```txt
  0
  42
  3.14
  .5    // 0.5
  10.   // 10
  ```

* **Strings**

  ```txt
  "hello"
  'world'
  "escaped\nline"
  'tab\tchar'
  "\\\\"    // backslash
  ```

* **Booleans**

  ```txt
  true
  false
  ```

* **Null**

  ```txt
  null
  ```

> Where possible, literals expose a decoded `value` internally (e.g. numeric
> value for numbers, string value without quotes, etc.).

---

### Identifiers & context

Identifiers map to properties of the context you pass to `eval(...)`.

```ts
type Ctx = {
  n: number;
  flag: boolean;
  user: { name: string; age: number };
};

const expr = compile<Ctx, string>(
  'flag && user.age >= 18 ? user.name : "anonymous"',
);

expr.eval({ n: 10, flag: true, user: { name: 'Alice', age: 21 } });
// → "Alice"
```

Valid identifier examples:

```txt
a
price
user_1
_internal
fooBar
```

Keywords like `true`, `false`, `null` are treated as **literals**, not identifiers.

---

### Property access

Use dot notation to read nested properties:

```txt
user.age
order.subtotal
config.featureFlag
```

Array indexing is also supported:

```txt
scores[0]
items[3]
matrix[2][1]
```

Combined:

```txt
user.address.city
orders[0].total
users[1].profile.age
```

**Safety note:**
access to dangerous prototype-related properties is blocked:

```txt
user.__proto__           // ❌ should be rejected
user.constructor         // ❌
user.constructor.prototype // ❌
```

(See security tests for details.)

---

### Arithmetic operators

Supported arithmetic operators:

| Kind           | Operators     | Examples                  |
| -------------- | ------------- | ------------------------- |
| Unary          | `-`           | `-n`, `-(n - m)`          |
| Multiplicative | `*`, `/`, `%` | `a * b`, `n / 3`, `n % 2` |
| Additive       | `+`, `-`      | `a + b`, `a - b`          |

Examples:

```txt
n + m
n - m
n * m
n / m
n % m
-n
-(n - m)
```

---

### Comparison & equality

Supported comparison operators:

```txt
<
<=
>
>=
==   // loose equality
!=   // loose inequality
```

Examples:

```txt
n == 10
n != 10
n > m
n >= 10
n < m
n <= 10
user.age >= 18
user.country == "US"
```

> There is intentionally **no** `===` / `!==` or other JS-only quirks.

---

### Logical operators & short-circuiting

Supported logical operators:

* `&&` (logical AND)
* `||` (logical OR)
* `!`  (logical NOT)

Behavior:

* `&&` and `||` **short-circuit**:

  * in `A && B`, if `A` is false, `B` is **not** evaluated;
  * in `A || B`, if `A` is true, `B` is **not** evaluated.
* `!` negates a boolean-like value.

Examples:

```txt
true && true         // true
true && false        // false
true || false        // true
false || false       // false
!true                // false
!false               // true

n > m && user.age >= 18
n < m || user.country == "US"
```

Short-circuit safety example (the right side must not throw):

```txt
false && dangerousFunction()
true || dangerousFunction()
```

---

### Nullish coalescing `??`

SafExpr supports a nullish coalescing operator:

```txt
a ?? b
```

Semantics (typical):

* if `a` is `null` or `undefined`, returns `b`;
* otherwise returns `a` as-is.

Example:

```txt
max(nums) ?? 0
user.displayName ?? user.name
```

When mixing `??` with `&&` / `||`, **always use parentheses** for clarity.

---

### Ternary (`cond ? a : b`)

Standard ternary operator:

```txt
condition ? whenTrue : whenFalse
```

Examples:

```txt
n > m ? "larger" : "smaller"

user.age < 18 ? "child" : "adult"

user.premium
  ? "VIP"
  : "REGULAR"
```

Nested ternaries are allowed (but should be used sparingly):

```txt
user.age < 18
  ? "child"
  : user.age < 30
    ? "young-adult"
    : "adult"
```

Associativity is **right-to-left**, same as JavaScript.

---

### Parentheses

Use parentheses to override default precedence or to improve readability:

```txt
(1 + 2) * 3
(n + m) * (n - m)
(user.age >= 18 && user.premium) || user.country == "US"
```

You should also prefer parentheses when mixing different logical operators
or `??` with others.

---

### Function calls

If you register a function via `engine.withFunction(name, fn)`, you can call
it from expressions:

```ts
const engine = createEngine()
  .withFunction('max', (a: number, b: number) => Math.max(a, b))
  .withFunction(
    'segment',
    (age: number) => (age < 18 ? 'child' : age < 30 ? 'young-adult' : 'adult'),
  );

type Ctx = { a: number; b: number; user: { age: number } };

const expr = engine.compile<Ctx, string>(
  'segment(user.age) == "young-adult" ? "ok" : "nope"',
);
```

Calling functions:

```txt
max(a, b)
sum(nums)
round2((order.subtotal - discount(order.subtotal, user.premium)) * 1.2)
ageBand(user.age)
```

Notes:

* Functions are **trusted code**; they run in normal JavaScript and can do
  anything (including I/O). Treat their arguments as untrusted input.
* Expressions **cannot** call arbitrary global functions (`eval`, `Function`,
  `setTimeout`, etc.) — only names you have explicitly registered.

---

### Comments

SafExpr supports:

* **Line comments** (skip until end of line):

  ```txt
  a + b  // this is a comment
  ```

* **Block comments**:

  ```txt
  a /* inner comment */ + b
  ```

Block comments are not nested (like JS):

```txt
a /* not /* nested */ + b  // OK, "/* nested */" is just inside the first block
```

---

## Operator precedence

From **highest** to **lowest** (within the expression language):

1. Parentheses: `( ... )`
2. Member & index: `obj.prop`, `arr[index]`, function call `fn(...)`
3. Unary: `!`, unary `-`
4. Multiplicative: `*`, `/`, `%`
5. Additive: `+`, `-`
6. Relational & comparison: `<`, `<=`, `>`, `>=`, `==`, `!=`
7. Logical AND: `&&`
8. Logical OR: `||`
9. Nullish coalescing: `??`  *(implementation may place this together with OR; use parentheses when mixing)*
10. Ternary: `cond ? a : b`

When in doubt, add parentheses.

---

## Behavior of `null`, `undefined` & missing fields

SafExpr is designed to **fail predictably** rather than silently producing
nonsense. Exact behavior can depend on implementation, but the tests assume:

* Accessing a missing property (e.g. `user.country` when `country` is absent)
  **does not crash the whole engine** by default. It either:

  * returns `undefined`, or
  * throws a controlled error (`SafexprError` or similar), depending on engine
    configuration.
* Out-of-bounds array indexing (`items[999]`) is treated similarly:

  * `undefined` result or a controlled error.

You can test what your configuration does and treat these as part of your
contract.

---

## What is **not** supported (by design)

To keep the engine **safe** and **predictable**, the following constructs are
**not** part of the expression language:

* **Statements:**

  * `if`, `else`
  * `for`, `while`, `do`
  * `switch`
  * `return`, `break`, `continue`
  * `try/catch`, `throw`, etc.

* **Assignments & mutations:**

  * `=`, `+=`, `-=`, `*=`, `/=`, `%=` …
  * `++`, `--`
  * `payload.__proto__ = { … }`
  * `payload.constructor.prototype.polluted = "yes"`

  Attempts to use these patterns should either fail to parse or throw a
  controlled error (many are explicitly tested as rejection cases).

* **Dynamic code & dangerous globals:**

  * `eval("1 + 1")`
  * `Function("return process")()`
  * `globalThis`, `global`, `window`, `self`, `process`, `require`, `module`,
    `document`, `__dirname`, `__filename`, …

* **Prototype escape hatches:**

  * `obj.__proto__`
  * `obj.constructor`
  * `obj.constructor.prototype`
  * `payload["__proto__"]`, `payload["constructor"]`, etc.

If any of these appear in an expression, you should expect SafExpr to reject
the expression at parse/compile time or throw a `SafexprError` when evaluating.

---

## Optional / extended syntax

Depending on your configuration or future versions, SafExpr may support some
**additional ergonomic features**. They are considered *optional* and should
**not** be relied on in portable rules unless explicitly documented.

Examples of such features:

* **Type-like annotations / casts** that behave as no-ops at runtime:

  ```txt
  payload.safeKey as string    // runtime: same as payload.safeKey
  ```

* **Local bindings** (e.g. `const`-style declarations) to simplify long
  expressions:

  ```txt
  const d = discount(order.subtotal, user.premium);
  round2((order.subtotal - d + order.shipping) * (1 + order.taxRate))
  ```

  These are *not* part of the minimal core language and may be disabled.

If your project relies on such extensions, document them clearly alongside
your SafExpr usage.

---

## Differences vs JavaScript

SafExpr is inspired by JS expression syntax, but **not** a full JS engine.
Key differences:

* No statements (`if`, `for`, `return`, …).
* No assignments (`=`, `++`, …).
* No `===` / `!==`, only `==` / `!=` (or custom comparators in helpers).
* No bitwise operators (`&`, `|`, `^`, `<<`, …).
* No access to `this`, `arguments`, or closures.
* No global objects (`window`, `globalThis`, `process`, …).
* No `eval()` / `Function()` / `new` / `class`.

The goal is to keep the expression language **small, secure, and easy to
reason about**.

---

## Summary

* SafExpr expressions are **pure, context-based** expressions (no statements).
* You get familiar building blocks:

  * literals, identifiers, property access, array indexing;
  * arithmetic, comparisons, logical operators, ternary `?:`, nullish `??`;
  * function calls for helpers registered via `withFunction`.
* You **do not** get:

  * statements, assignment, mutation, or globals;
  * dynamic code execution or prototype tricks.
* The syntax is intentionally close to JavaScript while staying **strictly
  sandboxed** and **safe for untrusted input**.

For concrete usage, see:

* `tests/integration/syntax-cases.spec.ts`
* `tests/unit/evaluator.spec.ts`
* `tests/security/*.spec.ts`
* Examples under `examples/`.
