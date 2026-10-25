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
export const blobStoreId = (process.env.BLOB_STORE_ID || "").trim();
const oidcToken = (process.env.VERCEL_OIDC_TOKEN || "").trim();

/**
 * How this deployment authenticates to Vercel Blob.
 *
 * Two modes exist, and confusing them is a real deployment trap:
 *
 *  - `token`  — a `BLOB_READ_WRITE_TOKEN` (what "Connect Store" used to inject,
 *               and what local development uses).
 *  - `oidc`   — the newer connection style: Vercel injects `BLOB_STORE_ID` and
 *               issues short-lived OIDC tokens at runtime (`VERCEL_OIDC_TOKEN`).
 *               Nothing else is needed; requiring a token here made a correctly
 *               connected production deployment look unconfigured.
 *
 * `oidc` is chosen only when the store id is present *and* we are on Vercel (or an
 * OIDC token was pulled locally), otherwise `npm run dev` would try to reach a
 * store it cannot authenticate to.
 */
export const blobAuth: "token" | "oidc" | "none" = blobToken
  ? "token"
  : blobStoreId && (oidcToken || process.env.VERCEL)
    ? "oidc"
    : "none";

/** Which storage driver this process uses. */
export const storageDriver: "blob" | "local" = blobAuth === "none" ? "local" : "blob";

/**
 * How a browser should move bytes for this deployment.
 * `blob-presigned` is the OIDC path: the server issues a scoped signed token and
 * the browser uploads through a presigned URL (`uploadPresigned`).
 */
export const blobUploadMode: "local" | "blob-token" | "blob-presigned" =
  storageDriver === "local" ? "local" : blobAuth === "token" ? "blob-token" : "blob-presigned";

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

/**
 * Everything wrong with this deployment's configuration, in the operator's terms.
 *
 * This exists because of one specific, expensive mistake: a production deploy
 * without `BLOB_READ_WRITE_TOKEN` silently fell back to the local-disk driver, the
 * browser then uploaded to `/api/uploads/<id>/files`, and Vercel answered
 * `413 FUNCTION_PAYLOAD_TOO_LARGE` — after the user had waited for a 40 MB
 * upload. The upload path is now refused at session-open with this list, and the
 * dashboard shows it before anyone picks a file.
 */
export function runtimeProblems(): string[] {
  const problems: string[] = [];
  if (isVercel) {
    if (storageDriver === "local") {
      problems.push(
        blobStoreId
          ? "A Blob store is connected (BLOB_STORE_ID is set) but this deployment has no way to authenticate to it: VERCEL_OIDC_TOKEN is not available at runtime. Redeploy the project so Vercel injects a fresh OIDC token, or add BLOB_READ_WRITE_TOKEN from the store's settings."
          : "No Blob store is connected: BLOB_READ_WRITE_TOKEN / BLOB_STORE_ID are both missing. A Vercel Function cannot receive more than 4.5 MB and has no durable disk, so uploads must go to Vercel Blob (Vercel → Storage → Blob → connect to this project, then redeploy).",
      );
    }
    if (!databaseUrl) {
      problems.push(
        "No Postgres connection string: set DATABASE_URL (or POSTGRES_URL from the Vercel/Neon integration) and redeploy.",
      );
    }
  }
  return problems;
}

export function assertUsableRuntime(): void {
  const problems = runtimeProblems();
  if (problems.length > 0) throw new Error(problems.join(" "));
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
