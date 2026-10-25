import "server-only";

/** One object in a version tree. */
export interface StoredObject {
  key: string;
  size: number;
}

export interface StoredBody {
  body: ReadableStream<Uint8Array>;
  size: number;
  contentType: string;
}

export interface ByteRange {
  /** Inclusive, HTTP semantics. */
  start: number;
  end: number;
}

/** A backend-internal failure. Never echo its message to a visitor: it may leak internals. */
export class StorageError extends Error {
  constructor(message = "storage error") {
    super(message);
    this.name = "StorageError";
  }
}

export interface Storage {
  readonly driver: "local" | "blob";
  /** Write a small object (text paste, edit, generated metadata). */
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /**
   * Stream a request body straight to storage without buffering it in memory.
   * Rejects as soon as `maxBytes` is exceeded, deleting the partial object.
   */
  putStream(key: string, body: ReadableStream<Uint8Array>, contentType: string, maxBytes: number): Promise<number>;
  /** Read an object, optionally one byte range (video seeking / partial PDFs). */
  getObject(key: string, range?: ByteRange): Promise<StoredBody | null>;
  /** Size + type without downloading. */
  headObject(key: string): Promise<{ size: number; contentType: string } | null>;
  /**
   * First `maxBytes` of an object. Used to inspect a huge document's `<head>`
   * without pulling tens of megabytes into a function.
   */
  readPrefix(key: string, maxBytes: number): Promise<Uint8Array | null>;
  /**
   * Last `maxBytes` of an object. Scripts sit at the end of the document, and a
   * 40 MB page's blank cause is usually in those last kilobytes.
   */
  readSuffix(key: string, maxBytes: number): Promise<Uint8Array | null>;
  /**
   * A URL the browser can fetch directly from the storage provider, or null when
   * the backend has none (local disk). Large artifacts are redirected here so a
   * 40 MB page does not have to be streamed through a serverless function.
   */
  publicUrl(key: string): Promise<string | null>;
  removeObject(key: string): Promise<void>;
  /** Every object under a prefix, with sizes. */
  listObjects(prefix: string): Promise<StoredObject[]>;
  /** Delete a whole prefix (version tree, abandoned session). Returns how many objects went. */
  removePrefix(prefix: string): Promise<number>;
}

/** Fail fast and identically on both backends when a stream runs long. */
export function tooLarge(maxBytes: number): StorageError {
  return new StorageError(`object exceeds ${maxBytes} bytes`);
}
