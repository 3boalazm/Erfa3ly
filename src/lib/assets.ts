// Why a preview can look blank.
//
// Two failure modes account for almost every "it works in my browser but not in
// the platform" report, and both are detectable from the artifact itself:
//
//  1. **Assets that were never uploaded.** A page exported from a site builder
//     references `assets/css/style.css` and three fonts; if only the HTML was
//     uploaded, the page renders unstyled or stays hidden behind an entry
//     animation that never gets its class.
//  2. **Browser APIs an opaque origin forbids.** `localStorage`,
//     `sessionStorage`, `indexedDB` and `history.replaceState` throw in a
//     sandboxed frame without `allow-same-origin`. A page whose first script line
//     touches one of them stops executing there — and if it reveals content by
//     adding a class, the result is a blank screen.
//
// This module answers both questions from the stored HTML, so the dashboard can
// say what is wrong instead of showing an empty frame.

const SKIP_PREFIXES = ["#", "data:", "http://", "https://", "//", "mailto:", "tel:", "javascript:", "blob:", "sms:"];

/** `src`, `href`, `poster` and the first candidate of `srcset`. */
const REF_PATTERN = /\b(?:src|href|poster)\s*=\s*["']([^"']+)["']|srcset\s*=\s*["']([^"'\s]+)[^"']*["']/gi;

const OPAQUE_ORIGIN_APIS: { pattern: RegExp; name: string }[] = [
  { pattern: /\blocalStorage\b/, name: "localStorage" },
  { pattern: /\bsessionStorage\b/, name: "sessionStorage" },
  { pattern: /\bindexedDB\b/, name: "indexedDB" },
  { pattern: /\bhistory\s*\.\s*(?:push|replace)State\b/, name: "history.pushState/replaceState" },
  { pattern: /\bserviceWorker\b/, name: "serviceWorker" },
];

export interface AssetRef {
  /** As written in the HTML. */
  raw: string;
  /** Resolved path relative to the site root, or null when it is not ours. */
  resolved: string | null;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index + 1);
}

/** RFC-3986-ish normalisation for a relative reference; null if it escapes the root. */
function resolveRelative(baseDir: string, ref: string): string | null {
  const clean = ref.split("#")[0].split("?")[0];
  if (!clean) return null;
  const parts = `${baseDir}${clean}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/**
 * Every local reference in a document, resolved against the entry point's
 * directory. Absolute references (`/assets/x.png`) resolve to null: they point at
 * the *domain* root, which this platform never owns, so they can never work here.
 */
export function extractAssetRefs(html: string, entryPath: string): AssetRef[] {
  const baseDir = dirname(entryPath);
  const refs: AssetRef[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(REF_PATTERN)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    if (SKIP_PREFIXES.some((prefix) => raw.toLowerCase().startsWith(prefix))) {
      refs.push({ raw, resolved: null });
      continue;
    }
    refs.push({ raw, resolved: resolveRelative(baseDir, raw) });
  }
  return refs;
}

export interface PreviewDiagnosis {
  /** Local references no stored file satisfies. */
  missing: string[];
  /** References to the domain root (`/css/x.css`), which cannot resolve here. */
  absolute: string[];
  /** Opaque-origin APIs the document touches. */
  opaqueApis: string[];
  /** True when nothing about this artifact explains a blank render. */
  looksFine: boolean;
}

export function diagnosePreview(input: {
  html: string;
  entryPath: string;
  /** Stored file paths, relative to the site root. */
  files: readonly string[];
}): PreviewDiagnosis {
  const present = new Set(input.files);
  const missing: string[] = [];
  const absolute: string[] = [];

  for (const ref of extractAssetRefs(input.html, input.entryPath)) {
    if (ref.raw.startsWith("/") && !ref.raw.startsWith("//")) {
      absolute.push(ref.raw);
      continue;
    }
    if (!ref.resolved) continue;
    if (ref.resolved === input.entryPath) continue;
    if (!present.has(ref.resolved)) missing.push(ref.raw);
  }

  const opaqueApis = OPAQUE_ORIGIN_APIS.filter((api) => api.pattern.test(input.html)).map((api) => api.name);

  const uniqueMissing = [...new Set(missing)].slice(0, 25);
  const uniqueAbsolute = [...new Set(absolute)].slice(0, 25);
  return {
    missing: uniqueMissing,
    absolute: uniqueAbsolute,
    opaqueApis,
    looksFine: uniqueMissing.length === 0 && uniqueAbsolute.length === 0 && opaqueApis.length === 0,
  };
}
