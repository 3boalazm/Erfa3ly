import "server-only";
import { unzipSync } from "fflate";
import { isJunkPath, safeRelativePath, UnsafePathError } from "@/lib/paths";

/**
 * ZIP extraction with limits checked *before* inflation.
 *
 * fflate's `filter` sees each entry's declared `originalSize` while the central
 * directory is read, so a zip bomb is refused before it can allocate. Two
 * further rules matter as much as the size caps:
 *
 *  - every entry name goes through `safeRelativePath`, which rejects `..`,
 *    absolute names, drive prefixes and control characters — the classic
 *    "zip slip" that writes outside the target directory;
 *  - we never extract to the filesystem at all. Entries are handed back in
 *    memory and then written through the Storage seam, so there is no directory
 *    to escape from in the first place.
 */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipLimitError";
  }
}

export interface ZipEntry {
  path: string;
  bytes: Uint8Array;
  size: number;
}

export interface ZipLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export function extractZip(archive: Uint8Array, limits: ZipLimits): ZipEntry[] {
  let declaredFiles = 0;
  let declaredBytes = 0;

  const inflated = unzipSync(archive, {
    filter(file) {
      const name = file.name;
      if (!name || name.endsWith("/")) return false; // directory entry
      let safe: string;
      try {
        safe = safeRelativePath(name);
      } catch (error) {
        if (error instanceof UnsafePathError) throw new ZipLimitError(`refused entry: ${name}`);
        throw error;
      }
      if (isJunkPath(safe)) return false;

      if (file.originalSize > limits.maxFileBytes) {
        throw new ZipLimitError(`entry too large: ${safe}`);
      }
      declaredFiles += 1;
      if (declaredFiles > limits.maxFiles) throw new ZipLimitError(`too many entries (limit ${limits.maxFiles})`);
      declaredBytes += file.originalSize;
      if (declaredBytes > limits.maxTotalBytes) {
        throw new ZipLimitError(`archive expands beyond ${limits.maxTotalBytes} bytes`);
      }
      return true;
    },
  });

  const entries: ZipEntry[] = [];
  for (const [name, bytes] of Object.entries(inflated)) {
    const safe = safeRelativePath(name);
    if (isJunkPath(safe)) continue;
    entries.push({ path: safe, bytes, size: bytes.byteLength });
  }
  if (entries.length === 0) throw new ZipLimitError("the archive contains no files");
  return entries;
}

/** Cheap read of one entry, used to inspect package.json without unpacking the rest. */
export function readZipEntry(archive: Uint8Array, wanted: string): string | null {
  try {
    const map = unzipSync(archive, {
      filter(file) {
        return file.originalSize < 256 * 1024 && (file.name === wanted || file.name.endsWith(`/${wanted}`));
      },
    });
    const entry = Object.entries(map).find(([name]) => name === wanted || name.endsWith(`/${wanted}`));
    return entry ? new TextDecoder().decode(entry[1]) : null;
  } catch {
    return null;
  }
}
