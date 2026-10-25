import { assertSameOrigin, configurationResponse, errorResponse, jsonNoStore } from "@/lib/http";
import { ensureOwnerId } from "@/lib/auth";
import { createUploadSession } from "@/lib/uploads";
import type { UploadKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: UploadKind[] = ["files", "zip", "document"];

/**
 * Open an upload session.
 *
 * The response tells the browser *where* to put bytes: `prefix` under the
 * storage backend and, on the local driver, the endpoint that accepts a streamed
 * PUT. On Vercel the browser talks to Blob directly with a token from
 * /api/blob/upload; this function never sees the payload.
 */
export async function POST(request: Request) {
  const blocked = configurationResponse();
  if (blocked) return blocked;
  try {
    assertSameOrigin(request);
    const ownerId = await ensureOwnerId();
    const body = (await request.json()) as { kind?: string; files?: unknown; title?: string | null };
    const kind = (body.kind ?? "files") as UploadKind;
    if (!KINDS.includes(kind)) return jsonNoStore({ error: "unknown upload kind" }, { status: 400 });

    const session = await createUploadSession({
      ownerId,
      kind,
      files: body.files,
      title: body.title ?? null,
    });

    return jsonNoStore({
      sessionId: session.id,
      driver: session.driver,
      uploadMode: session.uploadMode,
      prefix: session.prefix,
      siteId: session.siteId,
      versionId: session.versionId,
      expiresAt: session.expiresAt,
      fileUrl: `/api/uploads/${session.id}/files`,
      commitUrl: `/api/uploads/${session.id}/commit`,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
