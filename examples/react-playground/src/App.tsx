// SafExpr/examples/react-playground/src/App.tsx
//
// Interactive React playground for Safexpr.
// - Edit the expression and JSON context
// - See live evaluation results
// - Inspect SafexprError with snippet + column
//
// This file is meant to be simple, dependency-free (besides React + Safexpr),
// and easy to understand for people exploring the library.

import React, { useMemo, useState } from 'react';
import { createEngine, SafexprError } from 'safexpr';

// Create a shared engine instance (can be reused across evaluations)
const engine = createEngine();

// Default context shown in the playground (as JSON text)
const DEFAULT_CONTEXT_TEXT = JSON.stringify(
  {
    user: {
      id: 'user-123',
      name: 'Alice',
      age: 21,
      country: 'US',
      premium: true,
    },
    order: {
      id: 'order-456',
      subtotal: 150,
      shipping: 10,
      taxRate: 0.2,
    },
    config: {
      minAge: 18,
      premiumDiscount: 0.1,
    },
  },
  null,
  2,
);

// Default expression
const DEFAULT_EXPRESSION =
  'user.premium && user.age >= config.minAge\n' +
  '  ? (order.subtotal * (1 - config.premiumDiscount) + order.shipping) * (1 + order.taxRate)\n' +
  '  : (order.subtotal + order.shipping) * (1 + order.taxRate)';

export const App: React.FC = () => {
  const [expression, setExpression] = useState<string>(DEFAULT_EXPRESSION);
  const [contextText, setContextText] = useState<string>(DEFAULT_CONTEXT_TEXT);

  // Parse JSON context safely
  const parsedContext = useMemo(() => {
    try {
      const ctx = JSON.parse(contextText);
      return { context: ctx as unknown, contextError: null as Error | null };
    } catch (err) {
      return {
        context: null,
        contextError: err instanceof Error ? err : new Error('Failed to parse JSON context'),
      };
    }
  }, [contextText]);

  // Compile expression with Safexpr
  const compiled = useMemo(() => {
    try {
      const compiledExpression = engine.compile<unknown, unknown>(expression);
      return { compiledExpression, compileError: null as SafexprError | Error | null };
    } catch (err) {
      if (err instanceof SafexprError) {
        return { compiledExpression: null, compileError: err as SafexprError };
      }
      return {
        compiledExpression: null,
        compileError: err instanceof Error ? err : new Error('Unknown compile error'),
      };
    }
  }, [expression]);

  // Evaluate expression (if both parse and compile succeeded)
  const evaluation = useMemo(() => {
    if (parsedContext.contextError || !compiled.compiledExpression) {
      return {
        value: null as unknown,
        evalError: null as SafexprError | Error | null,
      };
    }

    try {
      const value = compiled.compiledExpression.eval(parsedContext.context);
      return { value, evalError: null as SafexprError | Error | null };
    } catch (err) {
      if (err instanceof SafexprError) {
        return {
          value: null,
          evalError: err as SafexprError,
        };
      }
      return {
        value: null,
        evalError: err instanceof Error ? err : new Error('Unknown evaluation error'),
      };
    }
  }, [parsedContext.context, parsedContext.contextError, compiled.compiledExpression]);

  const hasAnyError = Boolean(
    parsedContext.contextError || compiled.compileError || evaluation.evalError,
  );

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.title}>Safexpr React Playground</h1>
        <p style={styles.subtitle}>
          Edit the expression and JSON context below. Safexpr will compile and evaluate on the fly.
        </p>
      </header>

      <main style={styles.main}>
        <section style={styles.panelsRow}>
          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <h2 style={styles.panelTitle}>Expression</h2>
              <span style={styles.panelHint}>
                Example: <code>user.age &gt;= 18 ? "adult" : "child"</code>
              </span>
            </div>
            <textarea
              style={styles.textarea}
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
              spellCheck={false}
            />
          </div>

          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <h2 style={styles.panelTitle}>Context (JSON)</h2>
              <span style={styles.panelHint}>
                This is passed as the evaluation context: <code>ctx</code>
              </span>
            </div>
            <textarea
              style={styles.textarea}
              value={contextText}
              onChange={(e) => setContextText(e.target.value)}
              spellCheck={false}
            />
          </div>
        </section>

        <section style={styles.resultSection}>
          <div style={styles.resultHeader}>
            <h2 style={styles.panelTitle}>Result</h2>
            {!hasAnyError && <span style={styles.badgeOk}>OK</span>}
            {hasAnyError && <span style={styles.badgeError}>Error</span>}
          </div>

          <div style={styles.resultGrid}>
            <div style={styles.resultBox}>
              <h3 style={styles.resultTitle}>Evaluated Value</h3>
              <pre style={styles.pre}>
                {typeof evaluation.value === 'undefined'
                  ? 'undefined'
                  : JSON.stringify(evaluation.value, null, 2)}
              </pre>
            </div>

            <div style={styles.resultBox}>
              <h3 style={styles.resultTitle}>Details &amp; Errors</h3>
              <ErrorList
                contextError={parsedContext.contextError}
                compileError={compiled.compileError}
                evalError={evaluation.evalError}
              />
            </div>
          </div>
        </section>
      </main>

      <footer style={styles.footer}>
        <span>
          Built with <strong>Safexpr</strong> • Author:&nbsp;
          <a href="https://github.com/TheSkiF4er" target="_blank" rel="noreferrer">
            TheSkiF4er
          </a>
        </span>
      </footer>
    </div>
  );
};

type ErrorListProps = {
  contextError: Error | null;
  compileError: SafexprError | Error | null;
  evalError: SafexprError | Error | null;
};

const ErrorList: React.FC<ErrorListProps> = ({ contextError, compileError, evalError }) => {
  if (!contextError && !compileError && !evalError) {
    return (
      <p style={styles.noErrorText}>
        No errors. The expression compiled and evaluated successfully.
      </p>
    );
  }

  return (
    <div style={styles.errorList}>
      {contextError && (
        <ErrorBlock title="Context JSON Error" error={contextError} highlight={false} />
      )}
      {compileError && (
        <ErrorBlock title="Expression Compile Error" error={compileError} highlight />
      )}
      {evalError && (
        <ErrorBlock title="Expression Evaluation Error" error={evalError} highlight />
      )}
    </div>
  );
};

type ErrorBlockProps = {
  title: string;
  error: Error;
  highlight?: boolean;
};

const ErrorBlock: React.FC<ErrorBlockProps> = ({ title, error, highlight = false }) => {
  const isSafexprError = error instanceof SafexprError;
  const safexprError = error as SafexprError;

  return (
    <div style={highlight ? styles.errorBlockHighlight : styles.errorBlock}>
      <strong>{title}</strong>
      <p style={styles.errorMessage}>{error.message}</p>
      {isSafexprError && (
        <>
          <p style={styles.errorMeta}>
            Column: <code>{safexprError.column}</code>
          </p>
          {safexprError.snippet && (
            <pre style={styles.errorSnippet}>{safexprError.snippet}</pre>
          )}
        </>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
  },
  header: {
    padding: '1.5rem 2rem 1rem',
    borderBottom: '1px solid rgba(148, 163, 184, 0.35)',
  },
  title: {
    margin: 0,
    fontSize: '1.6rem',
    fontWeight: 600,
  },
  subtitle: {
    marginTop: '0.5rem',
    marginBottom: 0,
    color: '#94a3b8',
    fontSize: '0.95rem',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: '1.5rem 2rem 2rem',
    gap: '1.5rem',
  },
  panelsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1.25rem',
  },
  panel: {
    flex: 1,
    minWidth: '280px',
    display: 'flex',
    flexDirection: 'column',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: '0.5rem',
    gap: '0.75rem',
  },
  panelTitle: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: 600,
  },
  panelHint: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#94a3b8',
  },
  textarea: {
    flex: 1,
    minHeight: '220px',
    padding: '0.75rem 0.9rem',
    borderRadius: '0.75rem',
    border: '1px solid rgba(148, 163, 184, 0.6)',
    backgroundColor: '#020617',
    color: '#e2e8f0',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: '0.9rem',
    resize: 'vertical',
    outline: 'none',
  },
  resultSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  resultHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  badgeOk: {
    padding: '0.1rem 0.5rem',
    borderRadius: '999px',
    backgroundColor: '#16a34a33',
    color: '#bbf7d0',
    fontSize: '0.75rem',
  },
  badgeError: {
    padding: '0.1rem 0.5rem',
    borderRadius: '999px',
    backgroundColor: '#b91c1c33',
    color: '#fecaca',
    fontSize: '0.75rem',
  },
  resultGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '1.25rem',
  },
  resultBox: {
    flex: 1,
    minWidth: '260px',
    padding: '0.75rem 1rem',
    borderRadius: '0.75rem',
    border: '1px solid rgba(148, 163, 184, 0.6)',
    backgroundColor: '#020617',
  },
  resultTitle: {
    margin: '0 0 0.5rem',
    fontSize: '0.95rem',
    fontWeight: 600,
  },
  pre: {
    margin: 0,
    padding: '0.5rem 0.75rem',
    borderRadius: '0.5rem',
    backgroundColor: '#020617',
    border: '1px solid rgba(51, 65, 85, 0.9)',
    fontSize: '0.85rem',
    overflowX: 'auto',
    whiteSpace: 'pre',
  },
  noErrorText: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#a5b4fc',
  },
  errorList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  errorBlock: {
    padding: '0.5rem 0.75rem',
    borderRadius: '0.5rem',
    backgroundColor: '#111827',
    border: '1px solid rgba(71, 85, 105, 0.8)',
    fontSize: '0.8rem',
  },
  errorBlockHighlight: {
    padding: '0.5rem 0.75rem',
    borderRadius: '0.5rem',
    backgroundColor: '#111827',
    border: '1px solid rgba(248, 113, 113, 0.9)',
    fontSize: '0.8rem',
  },
  errorMessage: {
    margin: '0.25rem 0 0.25rem',
    color: '#fecaca',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  errorMeta: {
    margin: 0,
    fontSize: '0.75rem',
    color: '#cbd5f5',
  },
  errorSnippet: {
    marginTop: '0.25rem',
    marginBottom: 0,
    padding: '0.3rem 0.5rem',
    borderRadius: '0.35rem',
    backgroundColor: '#020617',
    border: '1px solid rgba(51, 65, 85, 0.9)',
    fontSize: '0.75rem',
    overflowX: 'auto',
  },
  footer: {
    borderTop: '1px solid rgba(148, 163, 184, 0.35)',
    padding: '0.75rem 2rem',
    fontSize: '0.8rem',
    color: '#64748b',
    display: 'flex',
    justifyContent: 'space-between',
  },
};

export default App;
