import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { limits } from "@/lib/config";
import { assertSameOrigin, errorResponse, jsonNoStore } from "@/lib/http";
import { readOwnerId } from "@/lib/auth";
import { getOpenSession } from "@/lib/uploads";
import { safeRelativePath } from "@/lib/paths";
import { recordEvent } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Token exchange for browser → Blob uploads.
 *
 * The client sends `pathname` + `clientPayload`; we authorise it against the
 * open session this browser already owns:
 *
 *   - the pathname must sit under this session's prefix (`sites/<site>/<version>/`),
 *     so a token can never be replayed to overwrite somebody else's artifact;
 *   - the file must have been declared when the session opened, so the quota and
 *     size limits were checked against it;
 *   - `maximumSizeInBytes` repeats the per-file cap, because the token is what
 *     the storage service enforces.
 *
 * `access: "public"` is set on the client and documented in storage-blob.ts.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ownerId = await readOwnerId();
    if (!ownerId) return jsonNoStore({ error: "no workspace cookie" }, { status: 401 });

    const body = (await request.json()) as HandleUploadBody;
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let sessionId = "";
        try {
          sessionId = String((JSON.parse(clientPayload ?? "{}") as { sessionId?: string }).sessionId ?? "");
        } catch {
          throw new Error("invalid client payload");
        }
        const session = await getOpenSession(sessionId, ownerId);
        const prefix = `${session.prefix}/`;
        if (!pathname.startsWith(prefix)) throw new Error("pathname outside this upload session");
        const relpath = safeRelativePath(pathname.slice(prefix.length));
        const declared = session.expectedFiles.find((target) => target.path === relpath);
        if (!declared) throw new Error(`file was not declared in this session: ${relpath}`);

        return {
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 31_536_000,
          maximumSizeInBytes: Math.min(limits.maxFileBytes, Math.max(declared.size, 1024)),
          tokenPayload: JSON.stringify({ sessionId: session.id }),
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
