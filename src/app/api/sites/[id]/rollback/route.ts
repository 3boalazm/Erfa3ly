import { assertSameOrigin, badRequest, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { rollbackVersion } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Repoint the site at an older immutable version. No bytes are rewritten. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "not found" }, { status: 404 });
    const { id } = await context.params;
    const body = (await request.json()) as { versionId?: string };
    if (!body.versionId) throw badRequest("versionId is required");
    await rollbackVersion(id, body.versionId, ownerId);
    return jsonNoStore({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
