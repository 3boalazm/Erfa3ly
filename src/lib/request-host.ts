import { previewHost, previewOrigin } from "@/lib/config";

/**
 * Which hostname a request really arrived on.
 *
 * `request.url` is the framework's idea of the URL and can be rewritten to
 * localhost behind a proxy (Vercel included), which silently breaks the
 * preview-origin check. `x-forwarded-host` is set by Vercel and by every
 * mainstream reverse proxy; `host` is the fallback for local development.
 */
export function requestHost(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-host");
  if (forwarded) return forwarded.split(",")[0].trim().toLowerCase();
  return (headers.get("host") || "").trim().toLowerCase();
}

/** True when this request is being served on the dedicated preview hostname. */
export function isPreviewRequest(headers: Headers): boolean {
  const host = previewHost();
  if (!host) return false;
  return requestHost(headers) === host.toLowerCase();
}

/** Absolute base for artifact URLs, when a separate preview origin is configured. */
export function previewBase(): string {
  return previewOrigin;
}
