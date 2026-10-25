import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dataDir } from "@/lib/config";
import { resolveInside, safeRelativePath } from "@/lib/paths";
import { tooLarge, type ByteRange, type Storage, type StoredBody, type StoredObject } from "@/lib/storage-types";

/**
 * Development backend: one directory per object key under
 * `$ERFA3LY_DATA_DIR/blobs`. Keys look like `sites/<site>/<version>/<path>`,
 * and every key is re-validated through `resolveInside` before it touches the
 * filesystem — the same containment rule as the object-store backend.
 */
export class LocalStorage implements Storage {
  readonly driver = "local" as const;
  private readonly root = join(dataDir, "blobs");

  private pathFor(key: string): string {
    const safe = safeRelativePath(key);
    return resolveInside(this.root, safe);
  }

  async putObject(key: string, bytes: Uint8Array): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  async putStream(key: string, body: ReadableStream<Uint8Array>, _contentType: string, maxBytes: number): Promise<number> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    let written = 0;
    // Count as the bytes flow through: memory use is one chunk, whatever the
    // file size, and a body that runs past the cap aborts before it lands.
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.byteLength;
        if (written > maxBytes) {
          callback(tooLarge(maxBytes));
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(body as never), counter, createWriteStream(target));
      return written;
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
  }

  async getObject(key: string, range?: ByteRange): Promise<StoredBody | null> {
    const target = this.pathFor(key);
    let info;
    try {
      info = await stat(target);
    } catch {
      return null;
    }
    if (!info.isFile()) return null;
    const start = range ? range.start : 0;
    const end = range ? Math.min(range.end, info.size - 1) : info.size - 1;
    const stream = createReadStream(target, { start, end });
    return {
      body: Readable.toWeb(stream) as ReadableStream<Uint8Array>,
      size: info.size,
      contentType: "",
    };
  }

  async headObject(key: string): Promise<{ size: number; contentType: string } | null> {
    try {
      const info = await stat(this.pathFor(key));
      return info.isFile() ? { size: info.size, contentType: "" } : null;
    } catch {
      return null;
    }
  }

  async readPrefix(key: string, maxBytes: number): Promise<Uint8Array | null> {
    const target = this.pathFor(key);
    let info;
    try {
      info = await stat(target);
    } catch {
      return null;
    }
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const stream = createReadStream(target, { start: 0, end: Math.min(maxBytes, info.size) - 1 });
      stream.on("data", (chunk) => {
        chunks.push(chunk as Buffer);
        total += (chunk as Buffer).byteLength;
        if (total >= maxBytes) stream.destroy();
      });
      stream.on("close", () => resolve(new Uint8Array(Buffer.concat(chunks))));
      stream.on("error", () => resolve(null));
    });
  }

  async readSuffix(key: string, maxBytes: number): Promise<Uint8Array | null> {
    const target = this.pathFor(key);
    let info;
    try {
      info = await stat(target);
    } catch {
      return null;
    }
    const start = Math.max(0, info.size - maxBytes);
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(target, { start });
      stream.on("data", (chunk) => chunks.push(chunk as Buffer));
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    return new Uint8Array(Buffer.concat(chunks));
  }

  /** Local disk has no public URL; the route streams instead of redirecting. */
  async publicUrl(): Promise<string | null> {
    return null;
  }

  async removeObject(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async listObjects(prefix: string): Promise<StoredObject[]> {
    const safePrefix = safeRelativePath(prefix);
    const root = resolveInside(this.root, safePrefix);
    const out: StoredObject[] = [];
    await walk(root, async (file) => {
      const key = relative(this.root, file).split(sep).join("/");
      const info = await stat(file);
      out.push({ key, size: info.size });
    });
    return out;
  }

  async removePrefix(prefix: string): Promise<number> {
    const objects = await this.listObjects(prefix);
    await rm(resolveInside(this.root, safeRelativePath(prefix)), { recursive: true, force: true });
    return objects.length;
  }
}

async function walk(dir: string, visit: (file: string) => Promise<void>): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, visit);
    else if (entry.isFile()) await visit(full);
  }
}
