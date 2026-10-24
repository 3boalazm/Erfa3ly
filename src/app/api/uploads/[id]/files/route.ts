import { assertSameOrigin, badRequest, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { storeLocalUpload } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local-driver upload endpoint: one streamed file per request.
 *
 * `PUT /api/uploads/<session>/files?path=<relative path>` with the raw body.
 * The body is piped straight to disk by the storage backend, so memory use is
 * one chunk regardless of file size, and the max-bytes guard aborts mid-stream.
 *
 * On Vercel this route intentionally refuses: a function there cannot receive
 * more than 4.5 MB, so the browser must write to Blob directly instead.
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "no workspace cookie" }, { status: 401 });
    const { id } = await context.params;
    const relpath = new URL(request.url).searchParams.get("path");
    if (!relpath) throw badRequest("missing ?path=");
    if (!request.body) throw badRequest("empty body");

    const result = await storeLocalUpload({
      sessionId: id,
      ownerId,
      relpath,
      body: request.body as ReadableStream<Uint8Array>,
    });
    return jsonNoStore({ ok: true, size: result.size });
  } catch (error) {
    return errorResponse(error);
  }
}
