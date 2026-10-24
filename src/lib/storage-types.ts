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
