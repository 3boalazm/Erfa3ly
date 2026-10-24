import { randomBytes } from "node:crypto";

/** URL-safe random id. Not a UUID: shorter, and just as unguessable. */
export function createId(prefix = ""): string {
  const id = randomBytes(12).toString("base64url");
  return prefix ? `${prefix}_${id}` : id;
}

/** Share-link token. Longer than an id because it *is* the capability. */
export function createShareToken(): string {
  return randomBytes(24).toString("base64url");
}
