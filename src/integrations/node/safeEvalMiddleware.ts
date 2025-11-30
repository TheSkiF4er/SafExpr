/**
 * SafExpr – Node integration / safeEvalMiddleware
 *
 * A small, framework-agnostic middleware/handler for safely evaluating
 * SafExpr expressions over HTTP.
 *
 * It is designed to work with:
 *  - Express / Koa (via a thin adapter)
 *  - raw Node http.Server
 *  - any “req/res/next” style interface that looks similar
 *
 * Default JSON wire format (for POST requests):
 *
 *  Request body (JSON):
 *    {
 *      "expression": "price * qty",
 *      "context": { "price": 10, "qty": 3 }
 *    }
 *
 *  Response (JSON):
 *    {
 *      "ok": true,
 *      "result": 30
 *    }
 *
 * On error:
 *    {
 *      "ok": false,
 *      "error": {
 *        "code": "E_PARSE",
 *        "message": "SafExpr: unterminated string literal.",
 *        "line": 1,
 *        "column": 17,
 *        "snippet": "user.name == \"foo\n                ^ --- SafExpr: unterminated string literal."
 *      }
 *    }
 *
 * License: Apache-2.0
 * Author:  TheSkiF4er
 */

import { createEngine } from '../../core/engine';
import type {
  Engine,
  EngineOptions,
  CompiledExpression,
} from '../../core/engine';
import {
  SafexprError,
  isSafexprError,
} from '../../core/errors';

//////////////////////
// Public interfaces //
//////////////////////

/**
 * Shape of the default JSON payload this middleware expects.
 */
export interface SafeEvalRequestPayload<Context = unknown> {
  /**
   * SafExpr expression to evaluate.
   */
  expression: string;

  /**
   * Context object that will be passed into `compiled.eval(context)`.
   */
  context?: Context;
}

/**
 * Standard JSON response shape when using the built-in responder.
 */
export interface SafeEvalResponse<Result = unknown> {
  ok: boolean;
  result?: Result;
  error?: {
    code: string;
    message: string;
    line?: number | null;
    column?: number | null;
    snippet?: string;
    note?: string;
  };
}

/**
 * Configuration options for `createSafeEvalMiddleware`.
 *
 * Generics:
 *  - Context – type of the evaluation context
 *  - Result  – type of the evaluation result
 */
export interface SafeEvalMiddlewareOptions<
  Context = Record<string, unknown>,
  Result = unknown,
> {
  /**
   * Pre-configured SafExpr engine instance.
   *
   * If omitted, a new engine with the given `engineOptions` will be created.
   */
  engine?: Engine;

  /**
   * Engine options to use if `engine` is not provided.
   */
  engineOptions?: EngineOptions;

  /**
   * Field name in the payload that contains the expression string.
   * Defaults to "expression".
   */
  expressionField?: string;

  /**
   * Field name in the payload that contains the context object.
   * Defaults to "context".
   */
  contextField?: string;

  /**
   * Whether to accept expressions from `req.query` in addition to `req.body`.
   * Defaults to `false`.
   *
   * When enabled:
   *  - `expression` can be sent as query param (e.g. ?expression=price*qty)
   *  - `context` is still expected to be in the body by default
   */
  allowQuery?: boolean;

  /**
   * Restrict allowed HTTP methods. Defaults to ["POST"].
   */
  allowedMethods?: string[];

  /**
   * Optional maximum *wire* expression length. If set, this is checked
   * before compilation (separate from engine.maxExpressionLength).
   */
  maxWireExpressionLength?: number;

  /**
   * Optional hook to transform the raw context before evaluation.
   * Useful for adding authenticated user info, request metadata, etc.
   */
  normalizeContext?(rawContext: unknown, req: any): Context;

  /**
   * Optional hook to post-process the evaluation result before it is returned
   * to the client (e.g. masking secrets, shaping the result).
   */
  transformResult?(result: Result, req: any): unknown;

  /**
   * Optional hook to log or handle errors.
   *
   * If it throws, the middleware will still respond with an error but will
   * not swallow your thrown error.
   */
  onError?(err: unknown, req: any): void | Promise<void>;

  /**
   * If true, the middleware will *not* send HTTP responses directly.
   * Instead, it will attach the response payload to `req.safexpr` and
   * call `next()`.
   *
   * This is useful when you want a custom response format or when you
   * integrate in frameworks with their own response handling.
   *
   * Default: false.
   */
  delegateResponse?: boolean;

  /**
   * Where to attach the evaluation result on the `req` object when
   * `delegateResponse` is true.
   *
   * Default: "safexpr".
   */
  requestPropertyName?: string;

  /**
   * If true, `snippet` and `note` from SafexprError are included in the
   * error response. In production you may want to turn this off.
   *
   * Default: true.
   */
  exposeErrorDetails?: boolean;

  /**
   * Optional static CORS headers to set on responses.
   * This is a convenience – for more complex setups you should use a
   * dedicated CORS middleware.
   */
  corsHeaders?: {
    [headerName: string]: string;
  };
}

/**
 * Result payload attached to `req` when `delegateResponse` is true.
 */
export interface SafeEvalRequestExtension<Result = unknown> {
  safexpr: SafeEvalResponse<Result>;
}

//////////////////////
// Middleware factory
//////////////////////

/**
 * Create a “safe eval” middleware/handler for SafExpr.
 *
 * It is intentionally typed loosely as `(req, res, next?) => void | Promise<void>`
 * so that it can be used with:
 *
 *  - Express:
 *      app.post('/eval', createSafeEvalMiddleware());
 *
 *  - Koa:
 *      router.post('/eval', async (ctx, next) => {
 *        const handler = createSafeEvalMiddleware();
 *        await handler(ctx.request, ctx.response, next);
 *      });
 *
 *  - Node http.Server:
 *      const handler = createSafeEvalMiddleware();
 *      const server = http.createServer((req, res) => handler(req, res));
 */
export function createSafeEvalMiddleware<
  Context = Record<string, unknown>,
  Result = unknown,
>(
  options: SafeEvalMiddlewareOptions<Context, Result> = {},
): (req: any, res: any, next?: (err?: any) => void) => Promise<void> {
  const {
    engine = createEngine(options.engineOptions),
    expressionField = 'expression',
    contextField = 'context',
    allowQuery = false,
    allowedMethods = ['POST'],
    maxWireExpressionLength,
    normalizeContext,
    transformResult,
    onError,
    delegateResponse = false,
    requestPropertyName = 'safexpr',
    exposeErrorDetails = true,
    corsHeaders,
  } = options;

  return async function safexprMiddleware(
    req: any,
    res: any,
    next?: (err?: any) => void,
  ): Promise<void> {
    try {
      // Method check
      const method = String(req.method || 'GET').toUpperCase();
      if (allowedMethods.length > 0 && !allowedMethods.includes(method)) {
        // If we have next, delegate; otherwise, respond with 405.
        if (typeof next === 'function') {
          return next();
        }
        if (corsHeaders) setCorsHeaders(res, corsHeaders);
        sendJson(res, 405, {
          ok: false,
          error: {
            code: 'E_RUNTIME',
            message: 'Method Not Allowed',
          },
        });
        return;
      }

      // Extract payload from body (and optionally query)
      const body = req.body ?? {};
      const query = allowQuery ? req.query ?? {} : {};
      const payload: any = {
        ...query,
        ...body,
      };

      const rawExpression = payload[expressionField];

      if (typeof rawExpression !== 'string' || rawExpression.trim() === '') {
        const response: SafeEvalResponse = {
          ok: false,
          error: {
            code: 'E_PARSE',
            message: `SafExpr: "${expressionField}" must be a non-empty string.`,
          },
        };
        if (delegateResponse) {
          attachToRequest(req, requestPropertyName, response);
          if (typeof next === 'function') return next();
          if (corsHeaders) setCorsHeaders(res, corsHeaders);
          sendJson(res, 400, response);
          return;
        }
        if (corsHeaders) setCorsHeaders(res, corsHeaders);
        sendJson(res, 400, response);
        return;
      }

      const expression = rawExpression;

      if (
        typeof maxWireExpressionLength === 'number' &&
        maxWireExpressionLength >= 0 &&
        expression.length > maxWireExpressionLength
      ) {
        const response: SafeEvalResponse = {
          ok: false,
          error: {
            code: 'E_DOS',
            message:
              'SafExpr: expression is too long (wire length limit exceeded).',
          },
        };
        if (delegateResponse) {
          attachToRequest(req, requestPropertyName, response);
          if (typeof next === 'function') return next();
          if (corsHeaders) setCorsHeaders(res, corsHeaders);
          sendJson(res, 413, response);
          return;
        }
        if (corsHeaders) setCorsHeaders(res, corsHeaders);
        sendJson(res, 413, response);
        return;
      }

      const rawContext = payload[contextField] ?? {};
      const context: Context =
        typeof normalizeContext === 'function'
          ? normalizeContext(rawContext, req)
          : (rawContext as Context);

      // Compile & evaluate
      const compiled: CompiledExpression<Context, Result> =
        engine.compile<Context, Result>(expression);

      const result = compiled.eval(context);

      const finalResult =
        typeof transformResult === 'function'
          ? (transformResult(result, req) as unknown)
          : result;

      const response: SafeEvalResponse = {
        ok: true,
        result: finalResult,
      };

      if (delegateResponse) {
        attachToRequest(req, requestPropertyName, response);
        if (typeof next === 'function') return next();
        if (corsHeaders) setCorsHeaders(res, corsHeaders);
        sendJson(res, 200, response);
        return;
      }

      if (corsHeaders) setCorsHeaders(res, corsHeaders);
      sendJson(res, 200, response);
    } catch (err) {
      try {
        if (onError) {
          await onError(err, req);
        }
      } catch {
        // Swallow secondary errors from onError – primary error still handled.
      }

      const errorResponse = buildErrorResponse(err, exposeErrorDetails);

      if (delegateResponse) {
        attachToRequest(req, requestPropertyName, errorResponse);
        if (typeof next === 'function') return next(err);
        if (corsHeaders) setCorsHeaders(res, corsHeaders);
        sendJson(res, 400, errorResponse);
        return;
      }

      if (corsHeaders) setCorsHeaders(res, corsHeaders);
      sendJson(res, 400, errorResponse);
      if (typeof next === 'function') {
        return next(err);
      }
    }
  };
}

//////////////////////
// Helper functions //
//////////////////////

function attachToRequest(
  req: any,
  key: string,
  value: SafeEvalResponse<any>,
): void {
  if (!req || typeof req !== 'object') return;
  req[key] = value;
}

/**
 * Build a JSON-safe error response.
 */
function buildErrorResponse(err: unknown, exposeDetails: boolean): SafeEvalResponse {
  if (isSafexprError(err)) {
    const base: SafeEvalResponse = {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
      },
    };

    if (exposeDetails) {
      base.error!.line = err.line ?? undefined;
      base.error!.column = err.column ?? undefined;
      base.error!.snippet = err.snippet || undefined;
      base.error!.note = err.note || undefined;
    }

    return base;
  }

  const message =
    err instanceof Error && typeof err.message === 'string'
      ? err.message
      : String(err);

  return {
    ok: false,
    error: {
      code: 'E_RUNTIME',
      message,
    },
  };
}

/**
 * Minimal JSON sender that works with both Express-like and raw Node responses.
 */
function sendJson(res: any, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);

  // Express-style
  if (res && typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode);
    return res.json(body);
  }

  // Fallback: raw Node http.ServerResponse
  if (res && typeof res.setHeader === 'function') {
    try {
      res.statusCode = statusCode;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(payload, 'utf8'));
    } catch {
      // ignore header errors
    }
  }

  if (res && typeof res.end === 'function') {
    res.end(payload);
  }
}

/**
 * Set simple CORS headers (if configured).
 */
function setCorsHeaders(res: any, headers: { [headerName: string]: string }) {
  if (!res || typeof res.setHeader !== 'function') return;
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

//////////////////////
// Usage examples   //
//////////////////////

/**
 * Example: Express
 *
 *   import express from 'express';
 *   import { createSafeEvalMiddleware } from 'safexpr/src/integrations/node/safeEvalMiddleware';
 *
 *   const app = express();
 *   app.use(express.json());
 *
 *   app.post('/api/safexpr/eval', createSafeEvalMiddleware());
 *
 *   app.listen(3000, () => {
 *     console.log('Listening on http://localhost:3000');
 *   });
 */

/**
 * Example: Express with custom context and helpers
 *
 *   type EvalContext = {
 *     user: { id: string; premium: boolean };
 *     order: { subtotal: number; shipping: number; taxRate: number };
 *   };
 *
 *   const engine = createEngine()
 *     .withFunction('discountFor', (subtotal: number, premium: boolean) => {
 *       if (!premium) return 0;
 *       if (subtotal >= 200) return subtotal * 0.2;
 *       if (subtotal >= 100) return subtotal * 0.12;
 *       return 0;
 *     });
 *
 *   const middleware = createSafeEvalMiddleware<EvalContext, number>({
 *     engine,
 *     normalizeContext(raw, req) {
 *       // Optionally extend context with authenticated user info, etc.
 *       return raw as EvalContext;
 *     },
 *   });
 */

/**
 * Example: raw Node http.Server
 *
 *   import http from 'http';
 *   import { createSafeEvalMiddleware } from 'safexpr/src/integrations/node/safeEvalMiddleware';
 *
 *   const handler = createSafeEvalMiddleware();
 *
 *   const server = http.createServer((req, res) => {
 *     let body = '';
 *     req.on('data', (chunk) => (body += chunk));
 *     req.on('end', () => {
 *       try {
 *         req.body = body ? JSON.parse(body) : {};
 *       } catch {
 *         req.body = {};
 *       }
 *       handler(req, res);
 *     });
 *   });
 *
 *   server.listen(3000);
 */
