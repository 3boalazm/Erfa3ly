"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatBytes, t, type Lang } from "@/lib/i18n";

interface UploaderProps {
  lang: Lang;
  driver: "local" | "blob";
  limits: { maxFileBytes: number; maxVersionBytes: number; maxFiles: number; quotaBytes: number };
  usedBytes: number;
}

interface PickedFile {
  path: string;
  size: number;
  file: File;
}

type Phase = "idle" | "opening" | "uploading" | "committing" | "error";

const DOCUMENT_RE = /\.(pdf|docx|pptx|xlsx|odt|odp|png|jpe?g|gif|webp|svg|txt|md|csv)$/i;
const ZIP_RE = /\.zip$/i;

/**
 * The browser half of publishing.
 *
 * On Vercel it hands each file to Blob's client SDK (`upload()`), which asks our
 * server for a scoped token and then talks to storage directly — that is the only
 * way around the 4.5 MB function body cap, and it is also why a 300 MB video can
 * be published from a phone. In local development the same UI streams to
 * `/api/uploads/<session>/files` with XHR so it can show progress.
 *
 * Either way the server has already decided what is allowed: the file list, the
 * per-file cap and the quota are checked when the session opens, and again
 * against the bytes that actually arrived when it commits.
 */
export function Uploader({ lang, driver, limits, usedBytes }: UploaderProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [currentName, setCurrentName] = useState("");
  const [title, setTitle] = useState("");
  const [paste, setPaste] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const busy = phase === "opening" || phase === "uploading" || phase === "committing";
  const percent = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  const publish = useCallback(
    async (items: PickedFile[]) => {
      setError(null);
      if (items.length === 0) return;
      if (items.length > limits.maxFiles) {
        setError(`${t(lang, "failed")}: ${limits.maxFiles} ${lang === "ar" ? "ملف كحد أقصى" : "files max"}`);
        setPhase("error");
        return;
      }
      const total = items.reduce((sum, item) => sum + item.size, 0);
      const oversized = items.find((item) => item.size > limits.maxFileBytes);
      if (oversized) {
        setError(`${t(lang, "failed")}: ${oversized.path} > ${formatBytes(limits.maxFileBytes)}`);
        setPhase("error");
        return;
      }
      if (total > limits.maxVersionBytes) {
        setError(`${t(lang, "failed")}: ${formatBytes(total)} > ${formatBytes(limits.maxVersionBytes)}`);
        setPhase("error");
        return;
      }
      if (usedBytes + total > limits.quotaBytes) {
        setError(
          `${t(lang, "failed")}: ${t(lang, "quotaOf", { used: formatBytes(usedBytes), total: formatBytes(limits.quotaBytes) })}`,
        );
        setPhase("error");
        return;
      }

      const single = items.length === 1;
      const kind = single && ZIP_RE.test(items[0].path) ? "zip" : single && DOCUMENT_RE.test(items[0].path) ? "document" : "files";

      setPhase("opening");
      setProgress({ done: 0, total });
      try {
        const openResponse = await fetch("/api/uploads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind,
            title: title.trim() || null,
            files: items.map((item) => ({ path: item.path, size: item.size })),
          }),
        });
        const session = (await openResponse.json()) as {
          sessionId?: string;
          prefix?: string;
          driver?: "local" | "blob";
          fileUrl?: string;
          error?: string;
        };
        if (!openResponse.ok || !session.sessionId) throw new Error(session.error || `HTTP ${openResponse.status}`);

        setPhase("uploading");
        let done = 0;
        for (const item of items) {
          setCurrentName(item.path);
          const onProgress = (loaded: number) => {
            setProgress({ done: done + Math.min(loaded, item.size), total });
          };
          if (session.driver === "blob") {
            const { upload } = await import("@vercel/blob/client");
            await upload(`${session.prefix}/${item.path}`, item.file, {
              access: "public",
              handleUploadUrl: "/api/blob/upload",
              clientPayload: JSON.stringify({ sessionId: session.sessionId }),
              // Above 100 MB the SDK switches to multipart: parts retry on their
              // own instead of the whole file starting over.
              multipart: item.size > 100 * 1024 * 1024,
              onUploadProgress: (event) => onProgress(event.loaded),
            });
          } else {
            await putWithProgress(
              `${session.fileUrl}?path=${encodeURIComponent(item.path)}`,
              item.file,
              onProgress,
            );
          }
          done += item.size;
          setProgress({ done, total });
        }

        setPhase("committing");
        setCurrentName("");
        const commitResponse = await fetch(`/api/uploads/${session.sessionId}/commit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim() || null }),
        });
        const committed = (await commitResponse.json()) as { url?: string; error?: string };
        if (!commitResponse.ok || !committed.url) throw new Error(committed.error || `HTTP ${commitResponse.status}`);

        setTitle("");
        setPaste("");
        router.push(committed.url);
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "upload failed");
        setPhase("error");
      }
    },
    [lang, limits, router, title, usedBytes],
  );

  const sampleHtml = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>صفحة نموذجية · ارفعلي</title>
<style>
 body{margin:0;font-family:system-ui,Tahoma,sans-serif;background:#0b1020;color:#e9eef7;display:grid;place-items:center;min-height:100vh}
 main{max-width:620px;padding:32px}
 h1{margin:0 0 8px;font-size:30px;color:#6ee7b7}
 p{color:#9fb0c3;line-height:1.9}
 .kpi{display:flex;gap:12px;margin-top:20px;flex-wrap:wrap}
 .card{flex:1;min-width:150px;background:#121a26;border:1px solid #1e2a38;border-radius:14px;padding:14px}
 .card b{display:block;font-size:24px;color:#fff;margin-bottom:4px}
 button{margin-top:20px;background:#6ee7b7;color:#04241a;border:0;border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer}
</style></head><body><main>
<h1>صفحة نموذجية</h1>
<p>هذه صفحة ثابتة تعمل داخل إطار معزول: لا كوكيز، لا وصول إلى لوحة التحكم، ومع ذلك تعمل الجافاسكربت بالكامل.</p>
<div class="kpi">
  <div class="card"><b id="n">0</b>نقرة على الزر</div>
  <div class="card"><b>١٢</b>ملف ثابت</div>
  <div class="card"><b>٢٤ms</b>زمن الاستجابة</div>
</div>
<button id="b">اضغط لزيادة العدّاد</button>
<p style="font-size:13px;opacity:.7" id="note"></p>
<script>
 let n=0; const el=document.getElementById('n');
 document.getElementById('b').onclick=()=>{el.textContent=++n};
 try{ localStorage.setItem('probe','1'); document.getElementById('note').textContent='التخزين المحلي متاح داخل العزل ✓'; }
 catch(e){ document.getElementById('note').textContent='التخزين غير متاح'; }
</script>
</main></body></html>`;

  async function publishPasted() {
    setError(null);
    if (!paste.trim()) return;
    setPhase("committing");
    try {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ html: paste, title: title.trim() || null }),
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || `HTTP ${response.status}`);
      setPaste("");
      router.push(body.url);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "publish failed");
      setPhase("error");
    }
  }

  function handleList(list: FileList | null) {
    if (!list || list.length === 0) return;
    const items: PickedFile[] = Array.from(list).map((file) => ({
      // webkitRelativePath is "folder/sub/file" for a directory pick, and the
      // folder name must survive: it is usually the site root.
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
      size: file.size,
      file,
    }));
    void publish(items);
  }

  return (
    <div className="panel" style={{ padding: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <span className={`badge ${driver === "blob" ? "badge-accent" : ""}`}>
          {driver === "blob" ? t(lang, "modeBlob") : t(lang, "modeLocal")}
        </span>
        <span className="badge">
          {t(lang, "quotaOf", { used: formatBytes(usedBytes), total: formatBytes(limits.quotaBytes) })}
        </span>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label className="label" htmlFor="artifact-title">
          {t(lang, "titleLabel")}
        </label>
        <input
          id="artifact-title"
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value.slice(0, 200))}
          placeholder={t(lang, "titlePlaceholder")}
          disabled={busy}
        />
      </div>

      <div
        className="dropzone"
        data-active={dragActive}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          if (busy) return;
          const dropped = event.dataTransfer.files;
          if (!dropped || dropped.length === 0) return;
          const items: PickedFile[] = Array.from(dropped).map((file) => ({
            path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
            size: file.size,
            file,
          }));
          void publish(items);
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{t(lang, "dropTitle")}</div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
          {t(lang, "dropSubtitle")}
        </div>
        <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
            {t(lang, "chooseFiles")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => folderInput.current?.click()}>
            {t(lang, "chooseFolder")}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => zipInput.current?.click()}>
            {t(lang, "chooseZip")}
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          {t(lang, "limitsHint", {
            file: formatBytes(limits.maxFileBytes),
            total: formatBytes(limits.maxVersionBytes),
            files: limits.maxFiles,
          })}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          handleList(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={folderInput}
        type="file"
        multiple
        hidden
        // @ts-expect-error: webkitdirectory is not in React's input typings.
        webkitdirectory=""
        directory=""
        onChange={(event) => {
          handleList(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={zipInput}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          handleList(event.target.files);
          event.target.value = "";
        }}
      />

      {busy || phase === "error" ? (
        <div style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span>
              {phase === "opening" && t(lang, "preparing")}
              {phase === "uploading" && `${t(lang, "uploading")} — ${currentName}`}
              {phase === "committing" && t(lang, "processing")}
              {phase === "error" && t(lang, "failed")}
            </span>
            {phase === "uploading" ? <span className="mono">{percent}%</span> : null}
          </div>
          <div className="progress">
            <div style={{ width: `${phase === "error" ? 100 : percent}%`, opacity: phase === "error" ? 0.35 : 1 }} />
          </div>
          {error ? (
            <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 10 }}>
              {error}{" "}
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginInlineStart: 6 }}
                onClick={() => {
                  setPhase("idle");
                  setError(null);
                }}
              >
                {t(lang, "retry")}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}

      <details style={{ marginTop: 16 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
          {t(lang, "pasteTitle")}
        </summary>
        <textarea
          className="input"
          style={{ marginTop: 10, minHeight: 120, fontFamily: "var(--font-mono)", direction: "ltr", textAlign: "left" }}
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          placeholder={t(lang, "pastePlaceholder")}
          disabled={busy}
        />
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy || !paste.trim()}
            onClick={() => void publishPasted()}
          >
            {t(lang, "pasteButton")}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() => {
              setPaste(sampleHtml);
              setTitle(title || "صفحة نموذجية");
            }}
          >
            {t(lang, "trySample")}
          </button>
        </div>
      </details>

      <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0, lineHeight: 1.7 }}>
        {t(lang, "backendHint")}
      </p>
    </div>
  );
}

/** XHR rather than fetch: local uploads need progress events. */
function putWithProgress(url: string, file: File, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", file.type || "application/octet-stream");
    request.upload.onprogress = (event) => onProgress(event.loaded);
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(readError(request.responseText) || `HTTP ${request.status}`));
    };
    request.onerror = () => reject(new Error("network error"));
    request.send(file);
  });
}

function readError(text: string): string {
  try {
    return (JSON.parse(text) as { error?: string }).error ?? "";
  } catch {
    return text.slice(0, 200);
  }
}
