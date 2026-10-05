// Shared helpers for route handlers: typed JSON errors { error: { code, message } } and auth guards.
import { z } from "zod";
import { currentUser, type SessionUser } from "@/core/auth/session";
import type { Role } from "@/core/contracts";
import { JobError } from "@/core/services/jobs";
import { LedgerError } from "@/core/services/ledger";
import { MandateError } from "@/core/services/mandates";
import { TreasuryError } from "@/core/services/treasury";
import { IllegalTransitionError } from "@/core/state/machines";
import { PayPalApiError } from "@/core/adapters/paypal/live";
import { clientIp, enforce, LIMITS, RateLimitError } from "@/core/rate-limit";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  MANDATE_NOT_FOUND: 404,
  FORBIDDEN: 403,
  INVALID_STATE: 409,
  MANDATE_REPLAY: 409,
  KILL_SWITCH: 503,
};

/** Rate limits (spec §14): per IP before auth, per user after; AI-backed routes get the tighter "llm" budget. */
export function limit(req: Request, kind: keyof typeof LIMITS, who?: string): void {
  enforce(`${kind}:ip:${clientIp(req)}`, LIMITS[kind]);
  if (who) enforce(`${kind}:who:${who}`, LIMITS[kind]);
}

export function errorResponse(err: unknown): Response {
  if (err instanceof RateLimitError) {
    return Response.json({ error: { code: "RATE_LIMITED", message: err.message } }, { status: 429, headers: { "retry-after": String(err.retryAfterSeconds) } });
  }
  if (err instanceof HttpError) return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
  if (err instanceof z.ZodError) {
    return Response.json({ error: { code: "VALIDATION", message: err.issues[0]?.message ?? "Invalid request" } }, { status: 400 });
  }
  if (err instanceof JobError || err instanceof MandateError || err instanceof TreasuryError || err instanceof LedgerError) {
    return Response.json({ error: { code: err.code, message: err.message } }, { status: STATUS_BY_CODE[err.code] ?? 422 });
  }
  if (err instanceof IllegalTransitionError) {
    return Response.json({ error: { code: "INVALID_STATE", message: err.message } }, { status: 409 });
  }
  if (err instanceof PayPalApiError) {
    return Response.json({ error: { code: "PAYPAL_ERROR", message: err.message } }, { status: err.retryable ? 502 : 422 });
  }
  console.error(err);
  return Response.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
}

export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "UNAUTHENTICATED", "Log in first");
  if (roles && !roles.includes(user.role)) throw new HttpError(403, "FORBIDDEN", `This action needs the ${roles.join(" or ")} role`);
  return user;
}

/** Wrap a handler so thrown errors become typed JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be JSON");
  }
  return schema.parse(body);
}
