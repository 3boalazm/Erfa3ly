import { assertSameOrigin, badRequest, errorResponse, jsonNoStore } from "@/lib/http";
import { ensureOwnerId } from "@/lib/auth";
import { publishHtml } from "@/lib/sites";
import { consumeWriteBudget } from "@/lib/rate-limit";
import { limits } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Publish pasted HTML as a single page.
 *
 * Everything here is small by construction (a textarea, capped at
 * `limits.maxTextBytes`), so it does not need the upload-session dance that file
 * uploads use.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const ownerId = await ensureOwnerId();
    const body = (await request.json()) as { title?: string | null; html?: string };
    if (typeof body.html !== "string" || body.html.trim().length === 0) throw badRequest("html is required");
    if (new TextEncoder().encode(body.html).byteLength > limits.maxTextBytes) {
      throw badRequest("html is too large for the paste box; upload it as a file instead");
    }
    await consumeWriteBudget(ownerId);
    const result = await publishHtml({
      ownerId,
      title: body.title?.slice(0, 200) ?? null,
      html: body.html,
      source: "text",
    });
    return jsonNoStore({ ok: true, ...result, url: `/d/${result.siteId}` });
  } catch (error) {
    return errorResponse(error);
  }
}
