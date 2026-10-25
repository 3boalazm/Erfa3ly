import "server-only";
import { allowedOrigins, publicOrigin, runtimeProblems } from "@/lib/config";

/** Errors that are safe to show a visitor, with the status they map to. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, message);
}
export function notFound(message = "not found"): ApiError {
  return new ApiError(404, message);
}
export function tooMany(message = "too many requests"): ApiError {
  return new ApiError(429, message);
}
export function conflict(message: string): ApiError {
  return new ApiError(409, message);
}

/**
 * CSRF guard for cookie-authenticated writes.
 *
 * Our write API is authenticated by an ambient cookie, so a cross-site form post
 * would otherwise be able to publish on someone's behalf. Browsers always attach
 * `Origin` to a cross-site POST, so: if the header is present it must match this
 * deployment; if it is absent the caller is not a browser (curl, an agent with a
 * bearer-free request) and cannot be riding a victim's cookie.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const host = request.headers.get("host");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "unparseable Origin header");
  }
  const extra = allowedOrigins();
  if (extra.has(origin) || extra.has(originHost)) return;
  if (host && originHost === host) return;
  const configured = publicOrigin();
  if (configured && origin === configured) return;
  throw new ApiError(403, "cross-origin write refused");
}

/** Turn any thrown value into a JSON response without leaking internals. */
export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "UnsafePathError") {
    return Response.json({ error: "unsafe path" }, { status: 400 });
  }
  // An unreachable or misconfigured database is an operator problem, not a bug:
  // say so in one actionable sentence, and never echo the connection string.
  const text = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ""}` : "";
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|password authentication failed|does not exist|too many connections|timeout exceeded when trying to connect|Connection terminated|self.signed certificate/i.test(text)) {
    console.error("[erfa3ly] database unavailable", error);
    return Response.json(
      {
        error:
          "cannot reach Postgres: check DATABASE_URL (or POSTGRES_URL) and that the database accepts connections from Vercel (pooled host, SSL, IP allow-list).",
        code: "database_unavailable",
      },
      { status: 503 },
    );
  }
  // Storage and database messages can contain internals: log them, say nothing.
  console.error("[erfa3ly] unhandled error", error);
  return Response.json({ error: "internal error" }, { status: 500 });
}

/**
 * A deployment whose storage or database is not configured cannot accept writes.
 * Answer 503 with the reasons *before* doing any work — a bare 500 here is how a
 * missing token turns into "internal error" and an hour of guessing.
 */
export function configurationResponse(): Response | null {
  const problems = runtimeProblems();
  if (problems.length === 0) return null;
  return jsonNoStore({ error: problems.join(" "), code: "config_incomplete", problems }, { status: 503 });
}

export function jsonNoStore(body: unknown, init?: ResponseInit): Response {
  const response = Response.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
