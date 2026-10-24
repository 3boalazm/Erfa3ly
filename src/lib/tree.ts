// Turning "some files" into "a publishable artifact": drop junk, find the entry
// point, decide whether this is a page, a static site or a document — and notice
// when the archive is really an application that needs a runtime we do not have.
import { extensionOf, kindFor } from "@/lib/mime";
import { isJunkPath, safeRelativePath } from "@/lib/paths";

export interface TreeFile {
  path: string;
  size: number;
}

export type ArtifactKind = "single" | "folder" | "document";

export type RuntimeReason = "server-app" | "build-required" | "backend-files";

export interface TreePlan {
  /** Directory that becomes the site root ("" or "my-site/" — trailing slash included). */
  rootPrefix: string;
  /** File the preview opens, relative to the site root. */
  entryPath: string;
  kind: ArtifactKind;
  needsRuntime: boolean;
  runtimeReason: RuntimeReason | null;
  runtimePath: string | null;
  fileCount: number;
  totalBytes: number;
}

export class TreePlanError extends Error {
  constructor(
    readonly code: "empty" | "no-entry" | "unsafe" | "needs-runtime",
    message: string,
  ) {
    super(message);
    this.name = "TreePlanError";
  }
}

const SERVER_MARKERS = [
  "server.js",
  "server.ts",
  "server.mjs",
  "app.py",
  "main.py",
  "manage.py",
  "wsgi.py",
  "asgi.py",
  "index.php",
  "wp-config.php",
  "artisan",
  "Procfile",
  "docker-compose.yml",
  "docker-compose.yaml",
];

const BUILD_MARKERS = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "nuxt.config.ts",
  "svelte.config.js",
  "vite.config.ts",
  "vite.config.js",
  "angular.json",
  "astro.config.mjs",
  "remix.config.js",
  "webpack.config.js",
  "tsconfig.json",
];

const BACKEND_MARKERS = [
  "requirements.txt",
  "pyproject.toml",
  "Pipfile",
  "composer.json",
  "Gemfile",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "Dockerfile",
  "docker-compose.yaml",
  "prisma/schema.prisma",
];

const DOCUMENT_EXTENSIONS = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "odp", "png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "md", "csv", "zip"]);

function depthOf(path: string): number {
  return path.split("/").length;
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index + 1);
}

/**
 * Decide what a set of paths publishes as.
 *
 * Root-stripping rule: if a folder contains the site (`my-site/index.html`,
 * `my-site/assets/…`, which is what `zip -r` and every "download as ZIP" button
 * produce), that folder becomes the root so relative links keep working. The
 * rule only fires when *all* files live under it and the index sits at its top.
 */
export function planTree(input: readonly TreeFile[], options: { packageJson?: string | null } = {}): TreePlan {
  const seen = new Set<string>();
  const files: TreeFile[] = [];
  for (const file of input) {
    const safe = safeRelativePath(file.path);
    if (isJunkPath(safe) || seen.has(safe)) continue;
    seen.add(safe);
    files.push({ path: safe, size: Math.max(0, Math.floor(file.size)) });
  }
  if (files.length === 0) throw new TreePlanError("empty", "no usable files");

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  // A tree with no index.html is often an application rather than a broken
  // site; say so instead of "no entry point", because the fix is different.
  const allBasenames = new Set(files.map((file) => file.path.split("/").pop() ?? ""));
  const allPaths = new Set(files.map((file) => file.path));
  const earlyRuntime =
    SERVER_MARKERS.find((marker) => allBasenames.has(marker) || allPaths.has(marker)) ? "server-app"
      : BACKEND_MARKERS.find((marker) => allBasenames.has(marker) || allPaths.has(marker)) ? "backend-files"
      : allBasenames.has("package.json") ? "build-required"
      : null;

  // ---- entry point ---------------------------------------------------------
  const indexCandidates = files
    .filter((file) => /(^|\/)index\.html?$/i.test(file.path))
    .sort((a, b) => depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path));

  let rootPrefix = "";
  let entryPath = "";
  for (const candidate of indexCandidates) {
    const dir = dirnameOf(candidate.path);
    if (dir === "" || files.every((file) => file.path.startsWith(dir))) {
      rootPrefix = dir;
      entryPath = candidate.path.slice(dir.length);
      break;
    }
  }

  if (!entryPath) {
    const singleDocument = files.length === 1 && DOCUMENT_EXTENSIONS.has(extensionOf(files[0].path));
    const htmlFiles = files.filter((file) => /\.html?$/i.test(file.path));
    if (singleDocument) {
      rootPrefix = "";
      entryPath = files[0].path;
    } else if (htmlFiles.length === 1) {
      // A lone page named something else (report.html): publish the folder and
      // open that page.
      rootPrefix = "";
      entryPath = htmlFiles[0].path;
    } else if (earlyRuntime) {
      throw new TreePlanError(
        "needs-runtime",
        "this archive looks like an application (server or build files) and has no static index.html; build it first and upload the output folder",
      );
    } else {
      throw new TreePlanError("no-entry", "the archive has no index.html or single HTML page");
    }
  }

  const stripped = files.map((file) => ({
    ...file,
    path: file.path.slice(rootPrefix.length),
  }));

  const entryKind = kindFor(entryPath);
  const kind: ArtifactKind =
    stripped.length === 1 && entryKind === "html"
      ? "single"
      : stripped.length === 1 && entryKind !== "html"
        ? "document"
        : "folder";

  // ---- does this need a runtime we do not have? ---------------------------
  const basenames = new Set(stripped.map((file) => file.path.split("/").pop() ?? ""));
  const normalised = new Set(stripped.map((file) => file.path));

  let needsRuntime = false;
  let runtimeReason: RuntimeReason | null = null;
  let runtimePath: string | null = null;

  const serverHit = SERVER_MARKERS.find((marker) => basenames.has(marker) || normalised.has(marker));
  const backendHit = BACKEND_MARKERS.find((marker) => basenames.has(marker) || normalised.has(marker));
  const buildHit = BUILD_MARKERS.find((marker) => basenames.has(marker) || normalised.has(marker));

  if (serverHit) {
    needsRuntime = true;
    runtimeReason = "server-app";
    runtimePath = serverHit;
  } else if (backendHit) {
    needsRuntime = true;
    runtimeReason = "backend-files";
    runtimePath = backendHit;
  } else if (basenames.has("package.json")) {
    // A package.json alone is ambiguous; its install/start scripts are not.
    const scripts = parseScriptNames(options.packageJson ?? null);
    if (scripts.has("start") || scripts.has("serve")) {
      needsRuntime = true;
      runtimeReason = "server-app";
      runtimePath = "package.json";
    } else if (scripts.has("dev") || scripts.has("build") || buildHit) {
      needsRuntime = true;
      runtimeReason = "build-required";
      runtimePath = "package.json";
    }
  } else if (buildHit) {
    needsRuntime = true;
    runtimeReason = "build-required";
    runtimePath = buildHit;
  }

  return {
    rootPrefix,
    entryPath,
    kind,
    needsRuntime,
    runtimeReason,
    runtimePath,
    fileCount: stripped.length,
    totalBytes,
  };
}

function parseScriptNames(packageJson: string | null): Set<string> {
  if (!packageJson) return new Set();
  try {
    const parsed = JSON.parse(packageJson) as { scripts?: Record<string, unknown> };
    return new Set(Object.keys(parsed.scripts ?? {}));
  } catch {
    return new Set();
  }
}

/** Apply the plan's root prefix to a path. */
export function applyPlan(path: string, plan: TreePlan): string {
  const stripped = path.startsWith(plan.rootPrefix) ? path.slice(plan.rootPrefix.length) : path;
  return safeRelativePath(stripped);
}
