import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { assertSameOrigin, configurationResponse, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { authorizeBlobPathname } from "@/lib/uploads";
import { recordEvent } from "@/lib/rate-limit";
import { blobAuth } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Token exchange for browser → Blob uploads, **read-write-token mode**.
 *
 * Used when the project has `BLOB_READ_WRITE_TOKEN`. Stores connected through
 * OIDC have no token and must use `/api/blob/upload-presigned` instead; this
 * route says so rather than failing with an opaque SDK error.
 */
export async function POST(request: Request) {
  const blocked = configurationResponse();
  if (blocked) return blocked;
  try {
    assertSameOrigin(request);
    // Which flow this deployment uses comes before who is asking: an operator
    // hitting the wrong route should learn that, not get a 401.
    if (blobAuth !== "token") {
      return jsonNoStore(
        { error: "this deployment authenticates to Blob with OIDC; use /api/blob/upload-presigned", code: "use_presigned" },
        { status: 409 },
      );
    }
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "no workspace cookie" }, { status: 401 });

    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const { relpath, maxBytes } = await authorizeBlobPathname({ pathname, clientPayload, ownerId });
        void relpath;
        return {
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 31_536_000,
          maximumSizeInBytes: maxBytes,
          tokenPayload: JSON.stringify({ ownerId }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        await recordEvent({ ownerId, kind: "upload:object", detail: blob.pathname.slice(0, 200) });
      },
    });

    return jsonNoStore(result);
  } catch (error) {
    return errorResponse(error);
  }
}
