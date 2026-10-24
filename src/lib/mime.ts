// Extension → MIME type for everything we serve back. Inline-renderable types
// are kept deliberately small: anything unknown is served as an attachment so a
// stray `.swf`, `.hta` or `.exe` can never be rendered as a document.

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  wasm: "application/wasm",
  zip: "application/zip",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Types a browser may render inline inside the sandboxed frame. */
const INLINE_SAFE = new Set([
  "text/html; charset=utf-8",
  "text/css; charset=utf-8",
  "text/javascript; charset=utf-8",
  "application/json; charset=utf-8",
  "text/plain; charset=utf-8",
  "image/svg+xml",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/x-icon",
  "image/bmp",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/otf",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/wav",
  "application/wasm",
]);

export function extensionOf(relpath: string): string {
  const base = relpath.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function mimeFor(relpath: string): string {
  return TYPES[extensionOf(relpath)] ?? "application/octet-stream";
}

/** HTML is the only type that gets script handling policies beyond the sandbox. */
export function isHtml(relpath: string): boolean {
  const mime = mimeFor(relpath);
  return mime.startsWith("text/html");
}

export function isInlineRenderable(mime: string): boolean {
  return INLINE_SAFE.has(mime);
}

/** A document kind derived from an extension, for the UI's badges. */
export function kindFor(relpath: string): "html" | "pdf" | "office" | "image" | "text" | "other" {
  const ext = extensionOf(relpath);
  if (ext === "html" || ext === "htm") return "html";
  if (ext === "pdf") return "pdf";
  if (["docx", "pptx", "xlsx", "odt", "odp"].includes(ext)) return "office";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"].includes(ext)) return "image";
  if (["txt", "md", "csv", "json"].includes(ext)) return "text";
  return "other";
}
