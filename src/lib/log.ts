// Structured logging you can turn up when something is wrong.
//
// Set `ERFA3LY_LOG` to `debug` (or `info`) and every interesting step prints one
// JSON line: which site/version was resolved, which keys were probed, how many
// bytes were injected or streamed, how long it took, and why a decision was
// made. On Vercel these lines land in the runtime logs, where each entry is
// searchable — and every response carries `x-erfa3ly-request-id`, so a line in
// the log can be matched to the exact browser request that produced it.
//
// Rules this file exists to enforce:
//  - never log a secret: connection strings, tokens and cookies go through
//    `redact()` before they can reach a message;
//  - never log file contents;
//  - the default is quiet (`error`), because a logging system that is always on
//    is a logging system nobody reads.

export type LogLevel = "off" | "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };

export function logLevel(): LogLevel {
  const raw = (process.env.ERFA3LY_LOG || "").trim().toLowerCase();
  if (raw === "off" || raw === "error" || raw === "warn" || raw === "info" || raw === "debug") return raw;
  if (raw === "true" || raw === "1") return "info";
  // Default: errors only. Warnings from libraries (pg's sslmode notice, for
  // instance) are noise the platform shows as failures; keep us out of it.
  return "error";
}

function enabled(level: Exclude<LogLevel, "off">): boolean {
  return LEVELS[logLevel()] >= LEVELS[level];
}

/** Strip anything that looks like a credential from a string before logging. */
export function redact(value: string): string {
  return value
    .replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1***")
    .replace(/(vercel_blob_rw_)[A-Za-z0-9_]+/gi, "$1***")
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1***")
    .replace(/([?&](?:token|key|secret|password|pwd)=)[^&\s"']+/gi, "$1***");
}

export type LogFields = Record<string, unknown>;

function emit(level: "error" | "warn" | "info" | "debug", scope: string, message: string, fields?: LogFields): void {
  if (!enabled(level)) return;
  const line: Record<string, unknown> = {
    level,
    scope,
    msg: redact(message),
    at: new Date().toISOString(),
  };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      line[key] = typeof value === "string" ? redact(value.length > 400 ? `${value.slice(0, 400)}…` : value) : value;
    }
  }
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export interface Logger {
  error(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  /** Child logger with extra fields on every line (siteId, reqId, …). */
  with(fields: LogFields): Logger;
  /** Milliseconds since the logger was created, for duration fields. */
  elapsed(): number;
}

export function logger(scope: string, base: LogFields = {}): Logger {
  const started = Date.now();
  return {
    error: (message, fields) => emit("error", scope, message, { ...base, ...fields }),
    warn: (message, fields) => emit("warn", scope, message, { ...base, ...fields }),
    info: (message, fields) => emit("info", scope, message, { ...base, ...fields }),
    debug: (message, fields) => emit("debug", scope, message, { ...base, ...fields }),
    with: (fields) => logger(scope, { ...base, ...fields }),
    elapsed: () => Date.now() - started,
  };
}

/**
 * Request id for correlating a log line with a browser request. Vercel already
 * assigns one (`x-vercel-id`); we reuse it so the two views line up, and fall
 * back to a short random id locally.
 */
export function requestId(headers: Headers): string {
  const vercel = headers.get("x-vercel-id");
  if (vercel) return vercel.split("::")[0].slice(0, 40);
  const existing = headers.get("x-erfa3ly-request-id");
  if (existing) return existing.slice(0, 40);
  return Math.random().toString(36).slice(2, 10);
}
