import { assertSameOrigin, badRequest, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { storeLocalUpload } from "@/lib/uploads";
import { isVercel, runtimeProblems, storageDriver } from "@/lib/config";

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
  // Configuration first: a deployment without a Blob store must say why, not
  // report "no cookie" or let Vercel return a bare 413 after the whole body.
  const problems = runtimeProblems();
  if (problems.length > 0) {
    return jsonNoStore({ error: problems.join(" "), code: "config_incomplete", problems }, { status: 503 });
  }
  try {
    assertSameOrigin(request);
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "no workspace cookie" }, { status: 401 });
    // Vercel caps a function body at 4.5 MB, so this route can never be the
    // upload path there. Answer with the reason instead of letting the platform
    // return a bare 413 after the whole body has been sent.
    if (isVercel || storageDriver !== "local") {
      return jsonNoStore(
        {
          error:
            "This deployment accepts direct-to-Blob uploads only: open a session that returns driver=blob (BLOB_READ_WRITE_TOKEN must be set), then upload with @vercel/blob/client.",
          code: "blob_required",
        },
        { status: 503 },
      );
    }
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
