import "server-only";
import { blobToken, storageDriver } from "@/lib/config";
import { LocalStorage } from "@/lib/storage-local";
import { BlobStorage } from "@/lib/storage-blob";
import { StorageError, type Storage } from "@/lib/storage-types";

export type { Storage, StoredObject, StoredBody } from "@/lib/storage-types";
export { StorageError } from "@/lib/storage-types";

const globalForStorage = globalThis as unknown as { __erfa3lyStorage?: Storage };

/**
 * The storage seam. Chosen once per process from the environment:
 *
 *   BLOB_READ_WRITE_TOKEN set → Vercel Blob (production)
 *   otherwise               → local disk under $ERFA3LY_DATA_DIR (development)
 *
 * Everything above this line — sessions, unzip, previews, the share page — is
 * backend agnostic. Version trees are immutable, so keys never get overwritten
 * and both backends can cache reads without invalidation.
 */
export function getStorage(): Storage {
  if (!globalForStorage.__erfa3lyStorage) {
    if (storageDriver === "blob") {
      if (!blobToken) throw new StorageError("BLOB_READ_WRITE_TOKEN is missing");
      globalForStorage.__erfa3lyStorage = new BlobStorage(blobToken);
    } else {
      globalForStorage.__erfa3lyStorage = new LocalStorage();
    }
  }
  return globalForStorage.__erfa3lyStorage;
}

/** Test/seed hook: forget the cached backend. */
export function resetStorage(): void {
  globalForStorage.__erfa3lyStorage = undefined;
}
