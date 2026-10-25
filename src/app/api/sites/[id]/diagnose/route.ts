import { errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { diagnoseSite } from "@/lib/diagnose";
import { logger, requestId } from "@/lib/log";
import { publicOrigin } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Owner-only self-test for one artifact: "why is my preview blank?".
 *
 * The report is designed to be pasted into a support thread — it names the
 * version, the entry point, every reference that does not resolve, what our own
 * route returns right now (status, type, size, whether the sandbox header and
 * injection are present), and a few asset probes. It never contains file
 * contents beyond a scan, and never a secret.
 *
 * `?lang=en` switches the verdict language; the rest of the report is neutral.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const reqId = requestId(request.headers);
  try {
    const ownerId = await readOwnerId();
    if (!ownerId) {
      logger("diagnose", { reqId }).warn("no workspace cookie");
      return jsonNoStore({ error: "not found" }, { status: 404 });
    }
    const { id } = await context.params;
    const origin = publicOrigin() || new URL(request.url).origin;
    const lang = new URL(request.url).searchParams.get("lang") ?? "ar";
    const report = await diagnoseSite({ ownerId, siteId: id, origin, requestId: reqId, lang });
    if (!report) return jsonNoStore({ error: "not found" }, { status: 404 });
    return jsonNoStore(report);
  } catch (error) {
    logger("diagnose", { reqId }).error("failed", { error: error instanceof Error ? error.message : "unknown" });
    return errorResponse(error);
  }
}
