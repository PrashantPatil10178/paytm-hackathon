import type { BunRequest } from "bun";

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key",
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const ok = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
export const notFound = (what: string) => new HttpError(404, `${what} not found`);
export const bad = (message: string) => new HttpError(400, message);

/** Wraps a handler with CORS headers and JSON error responses. */
export function handle<P extends string>(fn: (req: BunRequest<P>) => Response | Promise<Response>) {
  return async (req: BunRequest<P>) => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return ok({ error: e.message }, e.status);
      console.error(e);
      return ok({ error: "Something broke in the demo API. Check its terminal." }, 500);
    }
  };
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw bad("Send a JSON body with content-type: application/json");
  }
}

export function intParam(value: string | undefined, label: string): number {
  const n = Number((value ?? "").replace(/^#/, ""));
  if (!Number.isInteger(n)) throw bad(`${label} must be a number`);
  return n;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw bad(`${field} must be one of: ${allowed.join(", ")}`);
}

export const now = () => new Date().toISOString();
