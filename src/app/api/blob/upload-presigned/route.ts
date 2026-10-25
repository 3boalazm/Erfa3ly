import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { issueSignedToken } from "@vercel/blob";
import { assertSameOrigin, configurationResponse, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { authorizeBlobPathname } from "@/lib/uploads";
import { blobAuth } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Presigned control-plane URLs are short-lived; an upload should start at once. */
const TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * Token exchange for browser → Blob uploads, **OIDC mode**.
 *
 * This is the flow that works when a store is connected to the project without a
 * read-write token (Vercel then injects `BLOB_STORE_ID` and issues
 * `VERCEL_OIDC_TOKEN` per invocation). The server asks the Blob control API for a
 * scoped signed token — `put` only, one pathname, a size ceiling, 15 minutes —
 * and returns a presigned upload URL to the browser. No long-lived secret ever
 * reaches the client, and the scope is narrower than a read-write token could be.
 *
 * Authorisation is identical to the token route: the pathname must sit inside the
 * browser's own open session and must have been declared, because that is when
 * quota and size limits were checked.
 */
export async function POST(request: Request) {
  const blocked = configurationResponse();
  if (blocked) return blocked;
  try {
    assertSameOrigin(request);
    if (blobAuth !== "oidc") {
      return jsonNoStore(
        { error: "this deployment has a read-write token; use /api/blob/upload", code: "use_token_upload" },
        { status: 409 },
      );
    }
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "no workspace cookie" }, { status: 401 });

    const body = (await request.json()) as HandleUploadPresignedBody;
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname, clientPayload) => {
        const { maxBytes } = await authorizeBlobPathname({ pathname, clientPayload, ownerId });
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          maximumSizeInBytes: maxBytes,
          validUntil: Date.now() + TOKEN_TTL_MS,
        });
        return {
          token,
          urlOptions: {
            allowOverwrite: true,
            addRandomSuffix: false,
            cacheControlMaxAge: 31_536_000,
            maximumSizeInBytes: maxBytes,
          },
        };
      },
    });

    return jsonNoStore(result);
  } catch (error) {
    return errorResponse(error);
  }
}
