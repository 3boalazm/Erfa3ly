import { isHtml, isInlineRenderable, mimeFor } from "@/lib/mime";
import { resolvePreviewTarget } from "@/lib/sites";
import { getStorage } from "@/lib/storage";
import { safeRelativePath, UnsafePathError, versionKey } from "@/lib/paths";
import { publicOrigin } from "@/lib/config";
import { isPreviewRequest } from "@/lib/request-host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The only way artifact bytes leave this platform.
 *
 * Two rules hold for every response here:
 *
 *  1. **The origin is opaque.** `Content-Security-Policy: sandbox …` makes the
 *     document run in a unique origin even if someone opens the URL directly or
 *     the iframe attribute is bypassed. Uploaded code therefore cannot read the
 *     platform's cookies, storage or API responses — the dashboard's session is
 *     unreachable by construction, not by convention.
 *  2. **Nothing is sniffed.** `X-Content-Type-Options: nosniff` plus a small
 *     inline-safe type list means an uploaded "report.pdf" that is really an
 *     HTML page is not rendered as one, and unknown types are attachments.
 *
 * The route is public with respect to the owner cookie because a share link must
 * work for a visitor who has none: the site id is the capability. Deleted sites
 * stop resolving immediately (`resolvePreviewTarget` filters them).
 */
type RouteContext = { params: Promise<{ siteId: string; versionRef: string; path?: string[] }> };

export async function GET(request: Request, context: RouteContext) {
  return serve(request, context, false);
}

export async function HEAD(request: Request, context: RouteContext) {
  return serve(request, context, true);
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { Allow: "GET, HEAD, OPTIONS" } });
}

async function serve(request: Request, context: RouteContext, headOnly: boolean): Promise<Response> {
  const { siteId, versionRef, path: segments } = await context.params;
  const target = await resolvePreviewTarget(siteId, versionRef);
  if (!target) return notFound();

  let rel: string;
  try {
    const raw = (segments ?? []).join("/");
    if (!raw) {
      rel = target.version.entryPath;
    } else if (raw.endsWith("/")) {
      rel = `${safeRelativePath(raw.replace(/\/+$/, ""))}/index.html`;
    } else {
      rel = safeRelativePath(raw);
    }
  } catch (error) {
    if (error instanceof UnsafePathError) return plain("bad path", 400);
    throw error;
  }

  const storage = getStorage();
  const keyFor = (candidate: string) => versionKey(siteId, target.version.id, `${target.version.rootPrefix}${candidate}`);

  // Probe cheaply (stat / HEAD) before downloading: an asset miss should not
  // pull a body, and the size is needed for Range anyway.
  let resolvedPath = "";
  let meta: { size: number; contentType: string } | null = null;
  for (const candidate of [rel, `${rel}/index.html`, `${rel}.html`]) {
    meta = await storage.headObject(keyFor(candidate));
    if (meta) {
      resolvedPath = candidate;
      break;
    }
  }
  if (!meta) return notFound();

  const mime = mimeFor(resolvedPath);
  // A separate preview hostname means the artifact gets a real origin (storage and
  // history APIs work) while carrying none of this app's cookies.
  const onPreviewOrigin = isPreviewRequest(request.headers);
  const headers = baseHeaders(onPreviewOrigin);
  headers.set("Content-Type", mime);
  headers.set("Accept-Ranges", "bytes");
  headers.set("ETag", `"${target.version.id}-${resolvedPath}"`);
  headers.set(
    "Content-Disposition",
    isInlineRenderable(mime)
      ? "inline"
      : `attachment; filename="${encodeURIComponent(resolvedPath.split("/").pop() ?? "file")}"`,
  );
  // Immutable version URLs may be cached forever; "current" must be revalidated
  // because a rollback or edit changes what it points at.
  headers.set(
    "Cache-Control",
    versionRef === "current" ? "no-cache, must-revalidate" : "public, max-age=31536000, immutable",
  );

  const range = resolveRange(request.headers.get("range"), meta.size);
  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${meta.size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    if (headOnly) return new Response(null, { status: 206, headers });
    const partial = await storage.getObject(keyFor(resolvedPath), range);
    if (!partial) return notFound();
    return new Response(partial.body, { status: 206, headers });
  }

  if (headOnly) {
    headers.set("Content-Length", String(meta.size));
    return new Response(null, { status: 200, headers });
  }

  // HTML is small enough in practice to rewrite in memory; that is where the
  // storage shim is injected. Anything bigger streams untouched.
  if (isHtml(resolvedPath) && meta.size <= 8 * 1024 * 1024) {
    const full = await storage.getObject(keyFor(resolvedPath));
    if (!full) return notFound();
    const bytes = new Uint8Array(await new Response(full.body).arrayBuffer());
    const injected = injectShim(new TextDecoder().decode(bytes), {
      siteRoot: `/api/raw/${siteId}/${versionRef}/`,
      // A root <base> repairs asset paths on nested pages of a multi-file site.
      // It also changes how bare `#anchor` links resolve, so single-page
      // artifacts (where the page already sits at the root) are left alone.
      injectBase: target.version.fileCount > 1,
    });
    const encoded = new TextEncoder().encode(injected);
    headers.set("Content-Length", String(encoded.byteLength));
    return new Response(encoded, { status: 200, headers });
  }

  const object = await storage.getObject(keyFor(resolvedPath));
  if (!object) return notFound();
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

function baseHeaders(realOrigin = false): Headers {
  const headers = new Headers();
  // The sandbox directive is the boundary: opaque origin, scripts allowed (they
  // are the artifact), forms/pop-ups/downloads as a browser tab would allow.
  //
  // On a dedicated preview hostname the artifact already lives in an origin of
  // its own, so the opaque-origin restriction is unnecessary — and it is exactly
  // what breaks pages that use localStorage, indexedDB or history.replaceState.
  // There we keep the frame locked to this deployment instead of sandboxing.
  if (realOrigin) {
    // Only this deployment may frame the artifact; nothing else about the origin
    // is restricted, because the origin itself is the isolation boundary now.
    const app = publicOrigin();
    headers.set("Content-Security-Policy", `frame-ancestors 'self'${app ? ` ${app}` : ""}`);
  } else {
    headers.set(
      "Content-Security-Policy",
      "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-popups-to-escape-sandbox",
    );
  }
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return headers;
}

function plain(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { ...Object.fromEntries(baseHeaders()), "Content-Type": "text/plain; charset=utf-8", "Content-Length": String(message.length) },
  });
}

function notFound(): Response {
  return plain("Not found", 404);
}

/** `bytes=0-`, `bytes=100-200`, `bytes=-500` (last N bytes) — or null. */
function resolveRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (startRaw === "" && endRaw === "") return null;
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(startRaw);
  if (!Number.isFinite(start) || start >= size) return null;
  const end = endRaw === "" ? size - 1 : Math.min(Number(endRaw), size - 1);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

/**
 * Two injections, both about making ordinary pages work:
 *
 *  - `<base href>`, pointing at the site root. Without it a page at
 *    `pages/about.html` that references `assets/app.css` asks for
 *    `pages/assets/app.css` — the classic "unstyled / blank" upload.
 *  - a storage shim. `localStorage`/`sessionStorage` are `[LegacyUnforgeable]`
 *    on `window`, so a page in an opaque origin cannot be given a stand-in by
 *    redefining the property; what we can do is remove the *first* failure for
 *    pages that probe before use. Pages that genuinely need storage should be
 *    served from a dedicated preview origin (ERFA3LY_PREVIEW_ORIGIN), which the
 *    dashboard recommends when it detects them.
 */
function injectShim(html: string, options: { siteRoot: string; injectBase: boolean }): string {
  const base =
    options.injectBase && !/<base\s/i.test(html) ? `<base href="${options.siteRoot}">` : "";
  const shim = base + `<script data-erfa3ly-shim>(function(){try{window.localStorage.getItem("probe")}catch(e){var m={},s={getItem:function(k){return Object.prototype.hasOwnProperty.call(m,String(k))?m[String(k)]:null},setItem:function(k,v){m[String(k)]=String(v)},removeItem:function(k){delete m[String(k)]},clear:function(){m={}},key:function(i){return Object.keys(m)[i]||null}};try{Object.defineProperty(s,"length",{get:function(){return Object.keys(m).length}})}catch(e){}try{Object.defineProperty(window,"localStorage",{configurable:true,value:s})}catch(e){}try{Object.defineProperty(window,"sessionStorage",{configurable:true,value:s})}catch(e){}}})();</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}${shim}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (match) => `${match}${shim}`);
  return shim + html;
}
