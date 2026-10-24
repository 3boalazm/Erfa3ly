import { assertSameOrigin, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { getSiteDetail, softDeleteSite } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "not found" }, { status: 404 });
    const { id } = await context.params;
    const site = await getSiteDetail(id, ownerId);
    if (!site) return jsonNoStore({ error: "not found" }, { status: 404 });
    return jsonNoStore(site);
  } catch (error) {
    return errorResponse(error);
  }
}

/** Soft delete: the link dies now, the bytes are purged by the GC after retention. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "not found" }, { status: 404 });
    const { id } = await context.params;
    await softDeleteSite(id, ownerId);
    return jsonNoStore({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
