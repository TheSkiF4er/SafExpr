# Security Policy

## Overview

Safexpr is a safe, minimal, and type-safe expression engine for JavaScript/TypeScript.  
Security is a core design goal: user-defined expressions must **never** be able to:

- Access global objects (`global`, `window`, `process`, etc.)
- Escape the provided context
- Tamper with prototypes or internal engine state
- Execute arbitrary JavaScript (e.g. via `eval` or `Function`)

This document explains how to report vulnerabilities, what is in scope, and how we handle security issues.

---

## Supported Versions

We provide security fixes for the **latest released minor version** of Safexpr.

- Only the most recent `X.Y.*` line is guaranteed to receive security patches.
- Older major versions may receive backported patches on a best-effort basis, but no guarantees are made.

You are strongly encouraged to always use the latest version.

---

## Security Model

Safexpr is designed with the following security principles:

1. **No `eval` or dynamic code generation**
   - No use of `eval`, `new Function`, or similar dynamic execution primitives.

2. **Explicit context boundary**
   - Expressions can only access data explicitly passed as the evaluation context.
   - No implicit access to global variables or outer scopes.

3. **Strict property access**
   - Access is limited to “plain” object properties.
   - Engine aims to prevent prototype pollution and access to dangerous properties such as `__proto__`, `constructor`, `prototype`, and similar.

4. **Function allowlist**
   - Only functions explicitly registered with the engine can be called from expressions.
   - No automatic binding to global or built-in functions beyond what the engine exposes.

5. **Configurable limits**
   - The engine may support limits on expression length, AST depth, or evaluation complexity to reduce DoS risk (e.g. extremely deep or complex expressions).
   - These limits may be configurable by the integrator.

> **Important:** While Safexpr is designed to strongly reduce risk, no library can guarantee complete protection in all threat models. You must still follow secure development best practices in your application.

---

## Reporting a Vulnerability

If you believe you have found a security vulnerability in Safexpr, **please report it responsibly and privately**.

### How to report

Send an email to:

- `SafExpr@cajeer.com` (replace with your project’s security contact)

with the subject line:

> `[Safexpr Security] Vulnerability Report`

Please include:

1. A clear description of the vulnerability.
2. Steps to reproduce:
   - Minimal configuration or code snippet.
   - Example expression(s) that trigger the issue.
3. Expected vs actual behavior.
4. Any potential impact you foresee (e.g., RCE, context escape, prototype pollution, DoS).
5. Your environment:
   - Safexpr version
   - Node.js / runtime version
   - OS / platform
6. Whether the issue has been disclosed elsewhere (e.g., blog posts, other trackers).

You may optionally include:

- Proof-of-concept (PoC) exploit code.
- Suggestions for possible mitigations or fixes.

---

## Our Response Process

When you report a vulnerability, we aim to:

1. **Acknowledge receipt** of your report within **3–5 business days**.
2. **Assess severity** and impact.
3. **Reproduce** the issue using your PoC or our own test cases.
4. **Develop a fix** and corresponding tests.
5. **Release a patched version** of Safexpr.
6. **Publish a security advisory**, crediting you if desired.

We may:
- Ask you for more information or clarification.
- Coordinate a disclosure timeline with you.
- Request that you withhold public disclosure until a fix is available (particularly for high-severity issues).

---

## Responsible Disclosure & Safe Harbor

We support responsible security research.

As long as you:

- Make a **good-faith effort** to avoid privacy violations, data destruction, and service disruption.
- Report the vulnerability to us **privately** first.
- Give us a reasonable time window to address the issue before public disclosure.

…we will:

- Treat your research with respect and appreciation.
- Not pursue legal action against you for **good-faith** testing that adheres to the above principles.

> Note: This does not constitute a legal waiver; it is a good-faith statement of our intent.

---

## What to Report

### In Scope

Please report issues that could result in:

- **Context escape**
  - Expressions gaining access to data not explicitly provided in the evaluation context.
- **Global access**
  - Access to `global`, `window`, `process`, `require`, or similar.
- **Prototype pollution**
  - Ability to tamper with prototypes via expressions or context injection.
- **Remote Code Execution (RCE)**
  - Any path that allows execution of arbitrary JS or shell commands.
- **Sandbox breakout**
  - Bypassing isolation mechanisms of the expression engine.
- **Denial of Service (DoS)**
  - Expressions that cause unbounded CPU/memory usage within the engine (e.g., infinite recursion via expressions, pathological AST behavior).
- **Incorrect security assumptions**
  - Situations where the library claims safety but behavior contradicts that claim.

### Out of Scope

The following are generally **not** considered security vulnerabilities in Safexpr itself:

- Vulnerabilities caused by:
  - Insecure use of Safexpr in your application (e.g., passing highly sensitive global objects directly into context).
  - Application-level authorization or business logic flaws.
- Issues in third-party dependencies, unless they directly affect the security guarantees of Safexpr in a realistic usage scenario.
- Theoretical or highly unrealistic attack vectors without a practical exploitation path.
- Social engineering attacks against maintainers or users.
- Missing or incomplete documentation (unless it leads to a dangerous default that contradicts stated guarantees).

If you are unsure whether something qualifies as a vulnerability, we encourage you to report it anyway — we’d rather see a report than miss a real issue.

---

## Using Safexpr Securely (for Integrators)

To get the best security guarantees, we recommend that **users of Safexpr**:

1. **Limit the context**
   - Only pass the minimal data required for expressions.
   - Avoid passing objects that expose powerful APIs (e.g., database handles, HTTP clients, OS-level APIs).

2. **Review custom functions**
   - Carefully audit any functions you register with the engine.
   - Ensure they do not expose dangerous capabilities to expression authors.

3. **Apply resource limits**
   - Impose reasonable limits on expression length and complexity.
   - Consider enforcing timeouts for evaluation in your application layer.

4. **Keep Safexpr updated**
   - Always upgrade to the latest version, especially when security advisories are published.
   - Monitor release notes and changelog for security-related changes.

5. **Use defense in depth**
   - Combine Safexpr with other security controls:
     - Input validation and sanitization.
     - Proper authentication and authorization.
     - Secure configuration of your runtime and infrastructure.

---

## Security Advisories

If we publish security advisories, they will be available via:

- The GitHub **Security Advisories** section of the repository.
- Release notes / changelog entries for patched versions.

Please update as soon as possible when a security advisory is announced.

---

## Contact

For security-related questions or vulnerability reports:

- **Email:** `SafExpr@cajeer.com`  
- **Repository Issues:** Please **do not** open public issues for sensitive vulnerabilities. Use email first.

Thank you for helping keep Safexpr and its users safe.
