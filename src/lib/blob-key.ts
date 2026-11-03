// Blob object keys are ASCII-only. No imports: the browser uploader uses this too.
//
// Why: `@vercel/blob`'s `presign()` decodes the signed token's payload with
// `atob()`, which yields Latin-1 text, then compares the token's pathname with
// the one being uploaded. For a pathname such as `…/مشروع.html` the two never
// match ("Blob path does not match the signed token scope"), so every upload
// of a non-ASCII file name fails in OIDC mode. Keeping the *key* ASCII sidesteps
// the SDK; the real name stays in the database and in the UI.
//
// A segment that contains anything outside printable ASCII becomes
// `__u_<base64url(utf8 stem)><.ext>`. Plain ASCII segments are untouched, so
// existing keys keep working.

const NON_ASCII = /[^\x20-\x7e]/;
const ENCODED_SEGMENT = /^__u_([A-Za-z0-9_-]+)(\.[A-Za-z0-9]{1,10})?$/;
const EXTENSION = /\.[A-Za-z0-9]{1,10}$/;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string | null {
  try {
    const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function hasNonAscii(key: string): boolean {
  return NON_ASCII.test(key);
}

/** Turn a storage key (any Unicode) into an ASCII-only Blob pathname. */
export function encodeBlobKey(key: string): string {
  if (!NON_ASCII.test(key)) return key;
  return key
    .split("/")
    .map((segment) => {
      if (!NON_ASCII.test(segment)) return segment;
      const extension = EXTENSION.exec(segment)?.[0] ?? "";
      const stem = extension ? segment.slice(0, -extension.length) : segment;
      return `__u_${toBase64Url(stem)}${extension}`;
    })
    .join("/");
}

/** Inverse of `encodeBlobKey`; leaves anything it does not recognise as-is. */
export function decodeBlobKey(pathname: string): string {
  if (!pathname.includes("__u_")) return pathname;
  return pathname
    .split("/")
    .map((segment) => {
      const match = ENCODED_SEGMENT.exec(segment);
      if (!match) return segment;
      const stem = fromBase64Url(match[1]);
      return stem === null ? segment : `${stem}${match[2] ?? ""}`;
    })
    .join("/");
}
