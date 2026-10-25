import "server-only";
import { del, get, head, list, put } from "@vercel/blob";
import { mimeFor } from "@/lib/mime";
import { safeRelativePath } from "@/lib/paths";
import { tooLarge, type ByteRange, type Storage, type StoredBody, type StoredObject } from "@/lib/storage-types";

/**
 * Production backend: Vercel Blob.
 *
 * Two deliberate choices:
 *
 * 1. **Public access.** Blobs are stored `public`, because a private blob can only
 *    be read through a short-lived signed URL and our preview route needs to
 *    stream bytes on every request (including range requests for PDFs and video).
 *    The security consequence is bounded and documented: a blob URL lives on the
 *    provider's own hostname (`*.public.blob.vercel-storage.com`), not on the
 *    platform's, so it carries none of the platform's cookies and cannot reach
 *    its API. Everything served from *our* origin goes through `/api/raw/...`,
 *    which always adds the sandbox CSP.
 *
 * 2. **Uploads never pass through a function.** Browsers upload straight to Blob
 *    with a token issued by `/api/blob/upload` (see `uploads.ts`). Vercel caps a
 *    function request body at 4.5 MB, so proxying a ZIP or a video would simply
 *    not work; server-side `put()` here is only used for small generated files.
 */
/** Never buffer more than this just to look at part of an object. */
const WHOLE_OBJECT_CEILING = 8 * 1024 * 1024;

export class BlobStorage implements Storage {
  readonly driver = "blob" as const;
  private readonly token?: string;
  private readonly storeId?: string;

  /**
   * Authenticate with a read-write token, or — when the project was connected to a
   * store through OIDC — with just the store id: the SDK then signs requests with
   * `VERCEL_OIDC_TOKEN`, which Vercel injects into every invocation.
   */
  constructor(auth: { token?: string; storeId?: string }) {
    this.token = auth.token || undefined;
    this.storeId = auth.storeId || undefined;
    if (!this.token && !this.storeId) throw new Error("BlobStorage needs a token or a store id");
  }

  private options() {
    return this.token
      ? { token: this.token, access: "public" as const }
      : { storeId: this.storeId, access: "public" as const };
  }

  async putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await put(safeRelativePath(key), Buffer.from(bytes), {
      ...this.options(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
    });
  }

  async putStream(key: string, body: ReadableStream<Uint8Array>, contentType: string, maxBytes: number): Promise<number> {
    // Only generated files take this path. Anything user-sized is uploaded
    // directly by the browser; buffering here keeps the code honest about the
    // fact that a function cannot proxy large bodies anyway.
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge(maxBytes);
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    await this.putObject(key, merged, contentType);
    return total;
  }

  async getObject(key: string, range?: ByteRange): Promise<StoredBody | null> {
    const pathname = safeRelativePath(key);
    if (!range) {
      const result = await get(pathname, this.options());
      if (!result || result.statusCode !== 200) return null;
      return {
        body: result.stream,
        size: result.blob.size,
        contentType: result.blob.contentType ?? mimeFor(pathname),
      };
    }
    // Blob's SDK has no Range option; slice instead. Kept under a hard ceiling so
    // a range request for a 4 GB video cannot pull 4 GB into a function.
    const MAX_RANGE_BUFFER = 48 * 1024 * 1024;
    const meta = await this.headObject(pathname);
    if (!meta) return null;
    if (meta.size > MAX_RANGE_BUFFER) {
      const result = await get(pathname, this.options());
      if (!result || result.statusCode !== 200) return null;
      return { body: result.stream, size: meta.size, contentType: meta.contentType };
    }
    const result = await get(pathname, this.options());
    if (!result || result.statusCode !== 200) return null;
    const all = new Uint8Array(await new Response(result.stream).arrayBuffer());
    const start = Math.max(0, Math.min(range.start, all.byteLength - 1));
    const end = Math.max(start, Math.min(range.end, all.byteLength - 1));
    const slice = all.slice(start, end + 1);
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(slice);
          controller.close();
        },
      }),
      size: meta.size,
      contentType: meta.contentType,
    };
  }

  async headObject(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const result = await head(safeRelativePath(key), this.options());
      return { size: result.size, contentType: result.contentType };
    } catch {
      return null;
    }
  }

  async readPrefix(key: string, maxBytes: number): Promise<Uint8Array | null> {
    const pathname = safeRelativePath(key);
    const meta = await this.headObject(pathname);
    if (!meta) return null;
    if (meta.size <= maxBytes) {
      const whole = await this.getObject(pathname);
      if (!whole) return null;
      return new Uint8Array(await new Response(whole.body).arrayBuffer());
    }
    // Public blob URLs honour Range, so the head of a 40 MB document costs 2 MB.
    const url = await this.publicUrl(pathname);
    if (url) {
      try {
        const response = await fetch(url, { headers: { range: `bytes=0-${maxBytes - 1}` } });
        if (response.ok) return new Uint8Array(await response.arrayBuffer());
      } catch {
        /* fall through */
      }
    }
    // No range support and no URL: only worth buffering when the object is small
    // enough to be safe inside a function.
    if (meta.size > WHOLE_OBJECT_CEILING) return null;
    const fallback = await this.getObject(pathname);
    if (!fallback) return null;
    const bytes = new Uint8Array(await new Response(fallback.body).arrayBuffer());
    return bytes.slice(0, maxBytes);
  }

  async readSuffix(key: string, maxBytes: number): Promise<Uint8Array | null> {
    const pathname = safeRelativePath(key);
    const meta = await this.headObject(pathname);
    if (!meta) return null;
    if (meta.size <= maxBytes) return this.readPrefix(pathname, maxBytes);
    const url = await this.publicUrl(pathname);
    if (url) {
      try {
        // A suffix range is one request and never touches the middle of the file.
        const response = await fetch(url, { headers: { range: `bytes=-${maxBytes}` } });
        if (response.ok) return new Uint8Array(await response.arrayBuffer());
      } catch {
        /* fall through */
      }
    }
    // The SDK cannot seek, so a full read is the only fallback — refuse it for
    // anything that would not fit comfortably in a function's memory.
    if (meta.size > WHOLE_OBJECT_CEILING) return null;
    const all = await this.getObject(pathname);
    if (!all) return null;
    const bytes = new Uint8Array(await new Response(all.body).arrayBuffer());
    return bytes.slice(Math.max(0, bytes.byteLength - maxBytes));
  }

  async publicUrl(key: string): Promise<string | null> {
    try {
      const result = await head(safeRelativePath(key), this.options());
      return result.url || null;
    } catch {
      return null;
    }
  }

  async removeObject(key: string): Promise<void> {
    await del(safeRelativePath(key), this.options());
  }

  async listObjects(prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: safeRelativePath(prefix), cursor, ...this.options(), limit: 1000 });
      for (const blob of page.blobs) out.push({ key: blob.pathname, size: blob.size });
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }

  async removePrefix(prefix: string): Promise<number> {
    const objects = await this.listObjects(prefix);
    // del() takes up to 1000 URLs per call.
    for (let i = 0; i < objects.length; i += 1000) {
      await del(objects.slice(i, i + 1000).map((object) => object.key), this.options());
    }
    return objects.length;
  }
}
