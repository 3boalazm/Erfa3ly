import path from "node:path";

// Every tunable in one place. Values come from the environment because the
// platform runs in three places: a laptop, a container, and Vercel (functions
// plus Blob). Nothing here may import a request-scoped API.

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MiB = 1024 * 1024;

export const limits = {
  quotaBytes: num("ERFA3LY_QUOTA_BYTES", 900 * MiB),
  maxFileBytes: num("ERFA3LY_MAX_FILE_BYTES", 100 * MiB),
  maxVersionBytes: num("ERFA3LY_MAX_VERSION_BYTES", 500 * MiB),
  maxFiles: num("ERFA3LY_MAX_FILES", 2000),
  sessionTtlHours: num("ERFA3LY_SESSION_TTL_HOURS", 24),
  deletedRetentionDays: num("ERFA3LY_DELETED_RETENTION_DAYS", 7),
  rateLimitPerHour: num("ERFA3LY_RATE_LIMIT_PER_HOUR", 60),
  /** Text pasted into the "new page" box: one page, no files. */
  maxTextBytes: 2 * MiB,
} as const;

export const dataDir = path.resolve(process.env.ERFA3LY_DATA_DIR || "./.erfa3ly-data");

export const blobToken = (process.env.BLOB_READ_WRITE_TOKEN || "").trim();

/** Which storage driver this process uses. Chosen by the presence of a Blob token. */
export const storageDriver: "blob" | "local" = blobToken ? "blob" : "local";

/**
 * Postgres connection string.
 *
 * `DATABASE_URL` is the name this project documents, but the Vercel/Neon
 * integrations inject different names depending on how the store was created
 * (`POSTGRES_URL` for "Vercel Postgres", `DATABASE_URL_UNPOOLED` for a direct
 * connection, `POSTGRES_PRISMA_URL` for Prisma). Accepting them in order of
 * preference means a deployment does not fail on a naming detail — and the
 * pooled names win, because every serverless instance keeps its own pool and an
 * unpooled string runs out of connections first.
 */
function pickDatabaseUrl(): string {
  const names = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "DATABASE_URL_UNPOOLED"];
  for (const name of names) {
    const value = (process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

export const databaseUrl = pickDatabaseUrl();

/** Which variable the connection string came from — for the boot log, never the value. */
export function databaseUrlSource(): string | null {
  const names = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "DATABASE_URL_UNPOOLED"];
  return names.find((name) => (process.env[name] || "").trim()) ?? null;
}

/**
 * Vercel sets VERCEL=1 and has no writable disk that survives a request. Local
 * storage and PGlite are therefore refused there, loudly, instead of silently
 * losing uploads between two invocations of the same function.
 */
export const isVercel = Boolean(process.env.VERCEL);

export function assertUsableRuntime(): void {
  if (!isVercel) return;
  if (storageDriver === "local") {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is missing: on Vercel there is no durable disk, so artifacts must go to Vercel Blob. Connect a Blob store to the project.",
    );
  }
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is missing: metadata needs a Postgres database (Neon, Supabase, ...). The in-process PGlite fallback is for local development only.",
    );
  }
}

/** Public origin, when the deployment knows it (share links, absolute URLs). */
export function publicOrigin(): string {
  const explicit = (process.env.ERFA3LY_PUBLIC_URL || "").trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "";
}

export function allowedOrigins(): Set<string> {
  const extra = (process.env.ERFA3LY_ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(extra);
}
