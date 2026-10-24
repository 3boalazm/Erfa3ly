// Path guards. This file is the security core: both storage backends, the zip
// extractor and the preview route all funnel through `safeRelativePath`, so a
// hostile archive cannot write outside its version prefix or read a sibling's
// files. Do not weaken these rules without a test.
import path from "node:path";

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

const MAX_PATH_BYTES = 1024;
const MAX_SEGMENT_BYTES = 255;
const BLOCKED_SEGMENTS = new Set([".git", "node_modules", ".svn"]);

/**
 * Normalise an uploaded path to a relative POSIX path, or throw.
 *
 * Rejected: empty paths, absolute paths, `..` / `.` segments, control
 * characters, backslash tricks, over-long paths, and the `.git` / `node_modules`
 * segments that make archives unpredictable.
 */
export function safeRelativePath(input: string): string {
  if (typeof input !== "string") throw new UnsafePathError("path must be a string");
  const normalized = input.normalize("NFC").replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new UnsafePathError(`invalid relative path: ${JSON.stringify(input)}`);
  }
  if (Buffer.byteLength(normalized, "utf8") > MAX_PATH_BYTES) {
    throw new UnsafePathError(`relative path is too long: ${input.slice(0, 120)}…`);
  }
  const parts = normalized.split("/");
  // A drive letter ("C:/x") is absolute on Windows even though it has no leading
  // slash, and "file:stream" is an alternate data stream there. Neither may pass.
  if (/^[A-Za-z]:/.test(parts[0]) || parts.some((part) => part.includes(":"))) {
    throw new UnsafePathError(`invalid path segment: ${input}`);
  }
  for (const part of parts) {
    if (!part || part === "." || part === "..") throw new UnsafePathError(`unsafe relative path: ${input}`);
    if (BLOCKED_SEGMENTS.has(part.toLowerCase())) throw new UnsafePathError(`blocked path segment: ${input}`);
    if (Buffer.byteLength(part, "utf8") > MAX_SEGMENT_BYTES) throw new UnsafePathError(`path segment too long: ${input}`);
  }
  return parts.join("/");
}

/** Resolve `relative` inside `root`, proving containment with `path.resolve`. */
export function resolveInside(root: string, relative: string): string {
  const safe = safeRelativePath(relative);
  const resolved = path.resolve(root, safe);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new UnsafePathError(`path escapes root: ${relative}`);
  }
  return resolved;
}

/** Object key for one file of one immutable version. */
export function versionKey(siteId: string, versionId: string, relpath: string): string {
  return `sites/${siteId}/${versionId}/${safeRelativePath(relpath)}`;
}

export function versionPrefix(siteId: string, versionId: string): string {
  return `sites/${siteId}/${versionId}`;
}

/** Files we never store: OS junk and editor droppings that break entry detection. */
export function isJunkPath(relpath: string): boolean {
  const parts = relpath.split("/");
  const base = parts[parts.length - 1] ?? "";
  return (
    parts.includes("__MACOSX") ||
    base === ".DS_Store" ||
    base === "Thumbs.db" ||
    base === "desktop.ini" ||
    base.startsWith("._")
  );
}
