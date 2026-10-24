import { assertSameOrigin, badRequest, conflict, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { getSiteDetail, publishHtml } from "@/lib/sites";
import { consumeWriteBudget } from "@/lib/rate-limit";
import { limits } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save an edited page as a new immutable version. Old versions stay readable. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "not found" }, { status: 404 });
    const { id } = await context.params;
    const site = await getSiteDetail(id, ownerId);
    if (!site) return jsonNoStore({ error: "not found" }, { status: 404 });
    if (site.fileCount > 1) throw conflict("inline editing is available for single-page artifacts only");

    const body = (await request.json()) as { html?: string };
    if (typeof body.html !== "string" || body.html.trim().length === 0) throw badRequest("html is required");
    if (new TextEncoder().encode(body.html).byteLength > limits.maxTextBytes) throw badRequest("html is too large");

    await consumeWriteBudget(ownerId);
    const result = await publishHtml({ ownerId, siteId: id, html: body.html, source: "edit" });
    return jsonNoStore({ ok: true, ...result, url: `/d/${result.siteId}` });
  } catch (error) {
    return errorResponse(error);
  }
}
