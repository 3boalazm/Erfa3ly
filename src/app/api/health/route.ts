import { blobAuth, blobStoreId, databaseUrl, databaseUrlSource, isVercel, previewOrigin, runtimeProblems, storageDriver } from "@/lib/config";
import { resolveDatabaseTls } from "@/lib/db-tls";
import { jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment self-check, for the dashboard banner and for `curl /api/health`
 * after a deploy. Reports *which* backend is active and *which variable names*
 * were found — never a value, never a secret.
 */
export async function GET() {
  const problems = runtimeProblems();
  return jsonNoStore(
    {
      ok: problems.length === 0,
      vercel: isVercel,
      storage: storageDriver,
      database: databaseUrl ? "postgres" : isVercel ? "missing" : "pglite",
      databaseVariable: databaseUrlSource(),
      databaseTls: databaseUrl ? resolveDatabaseTls(databaseUrl).mode : null,
      blobAuth,
      blobStoreIdPresent: Boolean(blobStoreId),
      previewOrigin: previewOrigin || null,
      problems,
    },
    { status: problems.length === 0 ? 200 : 503 },
  );
}
