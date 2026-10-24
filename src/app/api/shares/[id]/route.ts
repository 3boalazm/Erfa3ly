import { assertSameOrigin, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { revokeShare } from "@/lib/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revoke a link immediately. The next request through it is a 404. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "not found" }, { status: 404 });
    const { id } = await context.params;
    await revokeShare(id, ownerId);
    return jsonNoStore({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
