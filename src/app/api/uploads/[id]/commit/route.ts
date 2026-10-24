import { assertSameOrigin, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { commitUploadSession } from "@/lib/uploads";
import { TreePlanError } from "@/lib/tree";
import { ZipLimitError } from "@/lib/unzip";

export const runtime = "nodejs";
// A ZIP close to the cap needs to inflate, be inspected and be written back.
export const maxDuration = 60;

/**
 * Close an upload session: list what arrived, enforce real sizes, unpack a ZIP
 * when there is one, detect the entry point, write the metadata.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "no workspace cookie" }, { status: 401 });
    const { id } = await context.params;
    let title: string | null = null;
    try {
      const body = (await request.json()) as { title?: string | null };
      title = body?.title ?? null;
    } catch {
      title = null;
    }

    const result = await commitUploadSession(id, ownerId, title);
    return jsonNoStore({ ok: true, siteId: result.siteId, versionId: result.versionId, url: `/d/${result.siteId}` });
  } catch (error) {
    if (error instanceof ZipLimitError) {
      return jsonNoStore({ error: `zip rejected: ${error.message}` }, { status: 400 });
    }
    if (error instanceof TreePlanError) {
      return jsonNoStore(
        {
          code: error.code,
          error:
            error.code === "no-entry"
              ? "the archive has no index.html or single HTML page to open"
              : error.message,
        },
        { status: 400 },
      );
    }
    return errorResponse(error);
  }
}
