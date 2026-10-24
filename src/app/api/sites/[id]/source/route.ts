import { errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { getSiteDetail, readVersionFile } from "@/lib/sites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Current HTML of a single-page artifact, for the in-browser editor.
 * Owner-only: this is not a share surface.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "not found" }, { status: 404 });
    const { id } = await context.params;
    const site = await getSiteDetail(id, ownerId);
    if (!site || !site.current) return jsonNoStore({ error: "not found" }, { status: 404 });
    if (site.fileCount > 1) {
      return jsonNoStore({ error: "editing is available for single-page artifacts only" }, { status: 409 });
    }
    const file = await readVersionFile(site.id, site.current, site.entryPath);
    if (!file) return jsonNoStore({ error: "source not found" }, { status: 404 });
    if (file.bytes.byteLength > 2 * 1024 * 1024) {
      return jsonNoStore({ error: "page is too large to edit in the browser" }, { status: 413 });
    }
    return jsonNoStore({ html: new TextDecoder().decode(file.bytes), entryPath: site.entryPath });
  } catch (error) {
    return errorResponse(error);
  }
}
