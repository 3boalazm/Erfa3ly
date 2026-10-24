import { assertSameOrigin, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { createShare } from "@/lib/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mint a capability link. The link, not the session, is what a visitor needs. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "not found" }, { status: 404 });
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      label?: string | null;
      expiresInDays?: number | string | null;
      versionId?: string | null;
    };
    const days = body.expiresInDays === null || body.expiresInDays === undefined || body.expiresInDays === ""
      ? null
      : Number(body.expiresInDays);

    const share = await createShare({
      siteId: id,
      ownerId,
      label: body.label?.toString().slice(0, 120) ?? null,
      versionId: body.versionId ?? null,
      expiresInDays: Number.isFinite(days) ? (days as number) : null,
    });
    return jsonNoStore({ ...share, url: `/v/${share.token}` });
  } catch (error) {
    return errorResponse(error);
  }
}
