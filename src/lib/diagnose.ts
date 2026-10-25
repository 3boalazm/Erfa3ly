import "server-only";
import { diagnosePreview, type PreviewDiagnosis } from "@/lib/assets";
import { preview as previewConfig } from "@/lib/config";
import { logger } from "@/lib/log";
import { getFileList, getSiteDetail, readVersionPrefix, readVersionSuffix } from "@/lib/sites";
import { getStorage } from "@/lib/storage";
import { isHtml } from "@/lib/mime";

/**
 * End-to-end self-test for one artifact.
 *
 * It answers the question "why is my preview blank?" with evidence instead of a
 * guess, in the order a browser experiences it:
 *
 *   1. what the version actually contains (files, sizes, entry point);
 *   2. what the entry document references and which of those are missing;
 *   3. what our own preview route returns right now for that document — status,
 *      content type, size, whether the sandbox header and injection are there,
 *      and how long it took;
 *   4. whether a few of those references resolve through the preview route.
 *
 * Everything is logged (scope `diagnose`) so the same steps can be followed in
 * the platform's runtime logs when the report itself cannot be fetched.
 */

export type VerdictLevel = "error" | "warn" | "info";

export interface Verdict {
  code: string;
  level: VerdictLevel;
  /** Already-localised sentence: the report is meant to be read and pasted. */
  message: string;
}

export interface AssetProbe {
  reference: string;
  resolved: string | null;
  status: number | null;
  contentType: string | null;
  bytes: number | null;
  ms: number | null;
}

export interface SiteDiagnosisReport {
  generatedAt: string;
  requestId: string;
  site: { id: string; title: string; kind: string; needsRuntime: boolean; runtimeReason: string | null };
  version: { id: string; entryPath: string; rootPrefix: string; fileCount: number; byteSize: number; source: string };
  scan: PreviewDiagnosis & {
    /** Bytes of the document actually inspected (a 40 MB page is scanned partly). */
    scannedBytes: number;
    truncated: boolean;
    hints: string[];
  };
  delivery: {
    url: string;
    status: number | null;
    contentType: string | null;
    contentLength: number | null;
    servedBy: string | null;
    sandboxed: boolean;
    injected: boolean;
    ms: number | null;
    error: string | null;
  };
  assets: AssetProbe[];
  verdicts: Verdict[];
  /** Raw log lines this run produced, when ERFA3LY_LOG is on. */
  logLevel: string;
}

const LANG = (lang: string) => (lang === "en" ? "en" : "ar");

function say(lang: string, ar: string, en: string): string {
  return LANG(lang) === "en" ? en : ar;
}

/**
 * Markers that explain a blank render without any network failure. Kept as plain
 * string evidence: the report says what it saw, not what it concluded from a
 * fuzzy match, so a reader can disagree with it.
 */
const BLANK_HINTS: { code: string; test: RegExp; ar: string; en: string }[] = [
  {
    code: "hidden-body",
    test: /<body[^>]*(?:style\s*=\s*["'][^"']*(?:visibility\s*:\s*hidden|display\s*:\s*none|opacity\s*:\s*0)[^"']*["'])/i,
    ar: "عنصر <body> مخفي بأنماط داخلية (visibility/display/opacity) — الصفحة تُظهر نفسها عادةً عبر JavaScript.",
    en: "The <body> is hidden by inline styles (visibility/display/opacity) — the page reveals itself from JavaScript.",
  },
  {
    code: "loading-class",
    test: /<body[^>]*class\s*=\s*["'][^"']*\b(?:loading|preload|hidden|is-hidden)\b/i,
    ar: "الصفحة تبدأ بكلاس تحميل (loading/hidden) يُزال عادةً بسكربت — إن توقف السكربت بقيت فارغة.",
    en: "The page starts with a loading/hidden class that a script is expected to remove — if the script stops, it stays blank.",
  },
  {
    code: "animations",
    test: /animation\s*:\s*[^;}]*(?:fade|reveal)|\bopacity\s*:\s*0\b[\s\S]{0,400}?animation/i,
    ar: "حركات ظهور تعتمد على اكتمال تحميل السكربتات والخطوط.",
    en: "Reveal animations depend on scripts and fonts finishing their load.",
  },
  {
    code: "document-write",
    test: /document\s*\.\s*write(?:ln)?\s*\(/i,
    ar: "تستخدم document.write، وهو يمحو المستند الحالي إن نُفِّذ بعد التحميل.",
    en: "Uses document.write, which wipes the current document if it runs after load.",
  },
  {
    code: "iframe-content",
    test: /<iframe[^>]+src\s*=\s*["'](?!#|https?:|data:|about:)[^"']+["']/i,
    ar: "تضمّن إطاراً داخلياً من ملف محلي — إن لم يُرفع ذلك الملف يظهر الإطار فارغاً.",
    en: "Embeds a local file in an inner frame — if that file was not uploaded, the frame is empty.",
  },
  {
    code: "inline-data-heavy",
    test: /(?:src|href)\s*=\s*["']data:[^"']{100000,}/i,
    ar: "تحتوي أصولاً مضمّنة كـ base64، ما يضخّم حجم الملف بشدة ويبطئ الفتح.",
    en: "Contains base64-inlined assets, which inflate the file size and slow the first paint.",
  },
];

function hintsFor(head: string): string[] {
  return BLANK_HINTS.filter((hint) => hint.test.test(head)).map((hint) => hint.code);
}

export async function diagnoseSite(input: {
  ownerId: string;
  siteId: string;
  origin: string;
  requestId: string;
  lang: string;
}): Promise<SiteDiagnosisReport | null> {
  const log = logger("diagnose", { reqId: input.requestId, siteId: input.siteId });
  const site = await getSiteDetail(input.siteId, input.ownerId);
  if (!site || !site.current) {
    log.warn("site not found for owner");
    return null;
  }
  const version = site.current;
  const files = await getFileList(version.id);
  log.info("start", { versionId: version.id, files: files.length, bytes: version.byteSize });

  // ---- 1. the entry document ------------------------------------------------
  const scanBase: PreviewDiagnosis & { scannedBytes: number; truncated: boolean; hints: string[] } = {
    missing: [],
    absolute: [],
    opaqueApis: [],
    looksFine: true,
    scannedBytes: 0,
    truncated: false,
    hints: [],
  };

  if (isHtml(version.entryPath)) {
    const head = await readVersionPrefix(input.siteId, version, version.entryPath, previewConfig.diagnosePrefixBytes);
    if (head) {
      // Head plus tail: a document can be tens of megabytes, and the line that
      // blanks a page is usually in the last few kilobytes of scripts.
      let text = new TextDecoder().decode(head.bytes);
      if (head.size > head.bytes.byteLength) {
        const tail = await readVersionSuffix(input.siteId, version, version.entryPath, 256 * 1024);
        if (tail) text += `\n<!-- erfa3ly:tail -->\n${new TextDecoder().decode(tail.bytes)}`;
      }
      const diagnosis = diagnosePreview({
        html: text,
        entryPath: version.entryPath,
        files: files.map((file) => file.path),
      });
      Object.assign(scanBase, diagnosis);
      scanBase.scannedBytes = head.bytes.byteLength;
      scanBase.truncated = head.size > head.bytes.byteLength;
      scanBase.hints = hintsFor(text);
      log.info("scanned entry", {
        scanned: scanBase.scannedBytes,
        total: head.size,
        truncated: scanBase.truncated,
        missing: scanBase.missing.length,
        absolute: scanBase.absolute.length,
        opaque: scanBase.opaqueApis,
        hints: scanBase.hints,
      });
    } else {
      log.warn("entry document missing from storage", { entry: version.entryPath });
    }
  }

  // ---- 2. what our own route returns ---------------------------------------
  const url = `${input.origin}/api/raw/${site.id}/current/${version.entryPath}`;
  const delivery: SiteDiagnosisReport["delivery"] = {
    url,
    status: null,
    contentType: null,
    contentLength: null,
    servedBy: null,
    sandboxed: false,
    injected: false,
    ms: null,
    error: null,
  };
  const started = Date.now();
  try {
    const response = await fetch(url, {
      headers: { "x-erfa3ly-diagnose": input.requestId, accept: "text/html,*/*" },
      redirect: "manual",
      cache: "no-store",
    });
    delivery.status = response.status;
    delivery.contentType = response.headers.get("content-type");
    delivery.contentLength = Number(response.headers.get("content-length") ?? 0) || null;
    delivery.servedBy = response.headers.get("x-erfa3ly-served-by");
    delivery.sandboxed = (response.headers.get("content-security-policy") ?? "").includes("sandbox");
    delivery.ms = Date.now() - started;
    if (response.status === 200 && isHtml(version.entryPath) && response.body) {
      // Read the first chunk or two and hang up: enough to see whether injection
      // happened, without pulling tens of megabytes into the function.
      const reader = response.body.getReader();
      let seen = 0;
      const chunks: Uint8Array[] = [];
      while (seen < 256 * 1024) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        seen += value.byteLength;
      }
      await reader.cancel().catch(() => {});
      const text = new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
      delivery.injected = text.includes("data-erfa3ly-shim") || text.includes('<base href="/api/raw/');
    } else {
      // Nothing read: release the connection instead of leaving it dangling.
      await response.body?.cancel().catch(() => {});
    }
    log.info("fetched own preview", {
      status: delivery.status,
      contentType: delivery.contentType,
      ms: delivery.ms,
      servedBy: delivery.servedBy,
      injected: delivery.injected,
    });
  } catch (error) {
    delivery.error = error instanceof Error ? error.message : "fetch failed";
    delivery.ms = Date.now() - started;
    log.error("own preview fetch failed", { error: delivery.error });
  }

  // ---- 3. do the referenced assets resolve? --------------------------------
  const assets: AssetProbe[] = [];
  const references = [...new Set([...scanBase.missing, ...scanBase.absolute])].slice(0, 8);
  for (const reference of references) {
    const target = reference.startsWith("/")
      ? reference.replace(/^\/+/, "")
      : resolveRef(reference, version.entryPath);
    if (!target) continue;
    const probeStarted = Date.now();
    let status: number | null = null;
    let contentType: string | null = null;
    let bytes: number | null = null;
    try {
      const response = await fetch(`${input.origin}/api/raw/${site.id}/current/${target}`, {
        method: "HEAD",
        cache: "no-store",
      });
      status = response.status;
      contentType = response.headers.get("content-type");
      bytes = Number(response.headers.get("content-length") ?? 0) || null;
      await response.body?.cancel();
    } catch {
      status = null;
    }
    assets.push({ reference, resolved: target, status, contentType, bytes, ms: Date.now() - probeStarted });
    log.debug("asset probe", { reference, target, status, bytes });
  }

  // ---- 4. verdicts ---------------------------------------------------------
  const verdicts: Verdict[] = [];
  const ar = LANG(input.lang) === "ar";

  if (delivery.status === null) {
    verdicts.push({
      code: "route-unreachable",
      level: "error",
      message: ar
        ? `لم نتمكن من جلب المعاينة من داخل التطبيق (${delivery.error}).`
        : `The preview could not be fetched from inside the app (${delivery.error}).`,
    });
  } else if (delivery.status >= 400) {
    verdicts.push({
      code: "route-error",
      level: "error",
      message: ar
        ? `مسار المعاينة أعاد الحالة ${delivery.status}.`
        : `The preview route returned ${delivery.status}.`,
    });
  } else if (delivery.contentType && !delivery.contentType.includes("text/html")) {
    verdicts.push({
      code: "wrong-content-type",
      level: "error",
      message: ar
        ? `المسار يعيد النوع ${delivery.contentType} بدل text/html، فلن يعرضه المتصفح كصفحة.`
        : `The route returned ${delivery.contentType} instead of text/html, so the browser will not render it as a page.`,
    });
  }

  if (scanBase.missing.length > 0) {
    verdicts.push({
      code: "missing-assets",
      level: "error",
      message: ar
        ? `${scanBase.missing.length} ملفاً مشاراً إليه غير موجود في هذا الإصدار (${scanBase.missing.slice(0, 4).join(", ")}). ارفع المجلد كاملاً أو ZIP.`
        : `${scanBase.missing.length} referenced files are missing from this version (${scanBase.missing.slice(0, 4).join(", ")}). Upload the whole folder or a ZIP.`,
    });
  }
  if (scanBase.absolute.length > 0) {
    verdicts.push({
      code: "absolute-assets",
      level: "warn",
      message: ar
        ? `${scanBase.absolute.length} مرجعاً يبدأ من جذر النطاق (${scanBase.absolute.slice(0, 3).join(", ")}) ولا يعمل على عنوان المعاينة.`
        : `${scanBase.absolute.length} references start at the domain root (${scanBase.absolute.slice(0, 3).join(", ")}) and cannot work on a preview URL.`,
    });
  }
  if (scanBase.opaqueApis.length > 0) {
    verdicts.push({
      code: "opaque-api",
      level: "error",
      message: ar
        ? `الصفحة تستخدم ${scanBase.opaqueApis.join(", ")}، وهي ممنوعة في الأصل المعزول وقد توقف السكربت عند أول سطر. اضبط ERFA3LY_PREVIEW_ORIGIN لنطاق فرعي منفصل.`
        : `The page uses ${scanBase.opaqueApis.join(", ")}; these throw in an opaque origin and can stop the script at its first line. Set ERFA3LY_PREVIEW_ORIGIN to a separate hostname.`,
    });
  }
  for (const code of scanBase.hints) {
    const hint = BLANK_HINTS.find((entry) => entry.code === code);
    if (hint) verdicts.push({ code, level: "warn", message: ar ? hint.ar : hint.en });
  }
  if (version.byteSize > previewConfig.inlineMaxBytes) {
    verdicts.push({
      code: "oversized",
      level: "warn",
      message: ar
        ? `حجم هذا الإصدار ${(version.byteSize / 1024 / 1024).toFixed(1)} MB وأكبر من حد الحقن (${(previewConfig.inlineMaxBytes / 1024 / 1024).toFixed(0)} MB)، فالصفحة تُخدم بلا <base> ولا shim. الملف الواحد الضخم عادةً نتيجة تضمين base64 — صدّر الموقع بأصوله كملفات بدل تضمينها.`
        : `This version is ${(version.byteSize / 1024 / 1024).toFixed(1)} MB, above the injection limit (${(previewConfig.inlineMaxBytes / 1024 / 1024).toFixed(0)} MB), so the page is served without <base> or the shim. One huge file usually means base64-inlined assets — export the site with separate asset files.`,
    });
  }
  if (delivery.servedBy === "redirect") {
    verdicts.push({
      code: "redirected",
      level: "info",
      message: ar
        ? "يُخدم المستند مباشرة من تخزين Blob لتجنّب مهلة الدالة؛ لا تُحقن <base> في هذه الحالة."
        : "The document is served straight from Blob storage to avoid the function timeout; <base> is not injected in this mode.",
    });
  }
  if (verdicts.length === 0) {
    verdicts.push({
      code: "no-obvious-cause",
      level: "info",
      message: ar
        ? "لا يظهر سبب واضح من الملف نفسه: المسار يعيد 200 بترويسات صحيحة، وكل المراجع الموجودة في أول الملف موجودة. إن بقي الإطار أبيض فالسبب داخل السكربت (خطأ وقت تشغيل) — افتح المعاينة المباشرة واطلع على Console المتصفح."
        : "Nothing in the file explains it: the route returns 200 with correct headers and every reference in the scanned head resolves. If the frame is still white, the cause is inside the script (a runtime error) — open the raw preview and read the browser console.",
    });
  }

  log.info("verdicts", { codes: verdicts.map((verdict) => verdict.code) });

  return {
    generatedAt: new Date().toISOString(),
    requestId: input.requestId,
    site: {
      id: site.id,
      title: site.title,
      kind: site.kind,
      needsRuntime: site.needsRuntime,
      runtimeReason: site.runtimeReason,
    },
    version: {
      id: version.id,
      entryPath: version.entryPath,
      rootPrefix: version.rootPrefix,
      fileCount: version.fileCount,
      byteSize: version.byteSize,
      source: version.source,
    },
    scan: scanBase,
    delivery,
    assets,
    verdicts,
    logLevel: (process.env.ERFA3LY_LOG || "error").toLowerCase(),
  };
}

function resolveRef(reference: string, entryPath: string): string | null {
  const baseDir = entryPath.includes("/") ? entryPath.slice(0, entryPath.lastIndexOf("/") + 1) : "";
  const clean = reference.split("#")[0].split("?")[0];
  if (!clean || clean.startsWith("/")) return null;
  const parts = `${baseDir}${clean}`.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

