"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBytes, t, type Lang } from "@/lib/i18n";

export interface WorkspaceVersion {
  id: string;
  source: string;
  entryPath: string;
  fileCount: number;
  byteSize: number;
  createdAt: string;
  note: string | null;
}

export interface WorkspaceShare {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  expiresAt: string | null;
  views: number;
}

export interface WorkspaceSite {
  id: string;
  title: string;
  kind: string;
  entryPath: string;
  currentVersionId: string | null;
  fileCount: number;
  byteSize: number;
  needsRuntime: boolean;
  runtimeReason: string | null;
  versions: WorkspaceVersion[];
  shares: WorkspaceShare[];
  files: { path: string; size: number; mime: string }[];
}

interface Props {
  lang: Lang;
  site: WorkspaceSite;
  retentionDays: number;
}

/**
 * Dashboard for one artifact: sandboxed preview, versions, share links, the
 * single-page editor and the delete switch. Every mutation is a fetch against
 * the API routes and then a `router.refresh()` — the server stays the source of
 * truth, so two tabs cannot drift into disagreeing about the current version.
 */
export function SiteWorkspace({ lang, site, retentionDays }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [label, setLabel] = useState("");
  const [days, setDays] = useState("");
  const [editing, setEditing] = useState(false);
  const [html, setHtml] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const previewSrc = `/api/raw/${site.id}/current/${site.entryPath}`;

  async function call(key: string, input: RequestInfo, init?: RequestInit): Promise<unknown> {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(input, init);
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      router.refresh();
      return body;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("clipboard unavailable");
    }
  }

  async function createShare() {
    const body = (await call("share", `/api/sites/${site.id}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: label.trim() || null, expiresInDays: days ? Number(days) : null }),
    })) as { token?: string } | null;
    if (body?.token) {
      setLabel("");
      setDays("");
      setNotice(t(lang, "linkCopied"));
      await copy(`${window.location.origin}/v/${body.token}`, body.token);
    }
  }

  async function openEditor() {
    setEditing(true);
    setError(null);
    const response = await fetch(`/api/sites/${site.id}/source`);
    const body = (await response.json().catch(() => ({}))) as { html?: string; error?: string };
    if (!response.ok) {
      setError(body.error ?? `HTTP ${response.status}`);
      setEditing(false);
      return;
    }
    setHtml(body.html ?? "");
  }

  async function saveEdit() {
    const result = await call("save", `/api/sites/${site.id}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ html }),
    });
    if (result) {
      setEditing(false);
      setNotice(t(lang, "done"));
    }
  }

  async function restore(versionId: string) {
    const result = await call(`rollback-${versionId}`, `/api/sites/${site.id}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ versionId }),
    });
    if (result) setNotice(t(lang, "restored"));
  }

  async function remove() {
    const result = await call("delete", `/api/sites/${site.id}`, { method: "DELETE" });
    if (result) router.push("/");
  }

  const runtimeMessage = (reason: string | null): string | null => {
    if (!reason) return null;
    if (reason === "server-app") return t(lang, "reasonServer", { path: "…" });
    if (reason === "build-required") return t(lang, "reasonBuild", { path: "…" });
    return t(lang, "reasonBackend", { path: "…" });
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {error ? (
        <div className="panel" style={{ padding: 12, borderColor: "rgba(243,111,111,.35)", color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="panel" style={{ padding: 12, borderColor: "rgba(110,231,183,.3)", color: "var(--accent)", fontSize: 13 }}>
          {notice}
        </div>
      ) : null}

      {site.needsRuntime ? (
        <div className="panel" style={{ padding: 14, borderColor: "rgba(246,193,119,.3)" }}>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <span className="badge badge-warn">{t(lang, "needsRuntime")}</span>
            <strong style={{ fontSize: 13.5 }}>{t(lang, "needsRuntimeTitle")}</strong>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.8 }}>
            {runtimeMessage(site.runtimeReason) ?? t(lang, "needsRuntimeBody")}
          </p>
        </div>
      ) : null}

      <section className="panel" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="section-title">{t(lang, "preview")}</span>
            <span className="badge">{t(lang, `kind${site.kind === "folder" ? "Folder" : site.kind === "document" ? "Document" : "Single"}` as "kindSingle")}</span>
          </div>
          <a className="btn btn-sm btn-ghost" href={previewSrc} target="_blank" rel="noreferrer noopener">
            {t(lang, "openRaw")}
          </a>
        </div>
        <div className="frame-shell">
          <iframe
            key={site.currentVersionId ?? "current"}
            src={previewSrc}
            title={site.title}
            // No allow-same-origin: the document runs in an opaque origin and
            // cannot reach this page's cookies or the API.
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
            style={{ height: 520 }}
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        </div>
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          {t(lang, "widthNote")}
        </p>
      </section>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <section className="panel" style={{ padding: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <span className="section-title">{t(lang, "sharing")}</span>
            <span className="badge">{site.shares.length}</span>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px", lineHeight: 1.7 }}>
            {t(lang, "shareHint")}
          </p>
          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value.slice(0, 120))}
              placeholder={t(lang, "shareLabelPlaceholder")}
              aria-label={t(lang, "shareLabel")}
            />
            <div className="row">
              <input
                className="input"
                inputMode="numeric"
                value={days}
                onChange={(event) => setDays(event.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                placeholder={t(lang, "shareExpiry")}
                aria-label={t(lang, "shareExpiry")}
              />
              <button type="button" className="btn btn-primary" disabled={busy === "share"} onClick={() => void createShare()}>
                {t(lang, "newShare")}
              </button>
            </div>
          </div>

          {site.shares.length === 0 ? (
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              {t(lang, "noShares")}
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {site.shares.map((share) => (
                <div key={share.id} className="panel-soft" style={{ padding: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{share.label || t(lang, "shareTitle")}</span>
                    <span className="badge">
                      {share.expiresAt
                        ? `${t(lang, "views", { n: share.views })} · ${new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short" }).format(new Date(share.expiresAt))}`
                        : t(lang, "expiryNone")}
                    </span>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <code className="inline" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                      /v/{share.token}
                    </code>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void copy(`${window.location.origin}/v/${share.token}`, share.id)}
                    >
                      {copied === share.id ? t(lang, "copied") : t(lang, "copyLink")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busy === `revoke-${share.id}`}
                      onClick={() =>
                        void call(`revoke-${share.id}`, `/api/shares/${share.id}`, { method: "DELETE" })
                      }
                    >
                      {t(lang, "revoke")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel" style={{ padding: 14 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <span className="section-title">{t(lang, "versions")}</span>
            <span className="badge">{t(lang, "versionsCount", { n: site.versions.length })}</span>
          </div>
          <div style={{ display: "grid", gap: 6, maxHeight: 300, overflow: "auto" }}>
            {site.versions.map((version) => {
              const isCurrent = version.id === site.currentVersionId;
              return (
                <div
                  key={version.id}
                  className="panel-soft"
                  style={{ padding: 9, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 11.5, opacity: 0.75 }}>
                      {version.id.slice(0, 12)} · {version.source}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {formatBytes(version.byteSize)} · {t(lang, "filesCount", { n: version.fileCount })} ·{" "}
                      {new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(new Date(version.createdAt))}
                    </div>
                  </div>
                  {isCurrent ? (
                    <span className="badge badge-accent">{t(lang, "current")}</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy === `rollback-${version.id}`}
                      onClick={() => void restore(version.id)}
                    >
                      {t(lang, "restore")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <section className="panel" style={{ padding: 14 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <span className="section-title">{t(lang, "fileList")}</span>
          <span className="badge">
            {formatBytes(site.byteSize)} · {t(lang, "entryPoint")}: <code className="inline">{site.entryPath}</code>
          </span>
        </div>
        <div style={{ maxHeight: 220, overflow: "auto" }}>
          <table className="files">
            <thead>
              <tr>
                <th>{t(lang, "fileList")}</th>
                <th style={{ width: 100 }}>{t(lang, "size")}</th>
              </tr>
            </thead>
            <tbody>
              {site.files.slice(0, 200).map((file) => (
                <tr key={file.path}>
                  <td className="mono" style={{ overflowWrap: "anywhere" }}>
                    {file.path}
                  </td>
                  <td className="muted">{formatBytes(file.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {site.kind === "single" ? (
          <div style={{ marginTop: 12 }}>
            {editing ? (
              <>
                <label className="label" htmlFor="html-source">
                  {t(lang, "htmlSource")}
                </label>
                <textarea
                  id="html-source"
                  className="input"
                  style={{ minHeight: 260, fontFamily: "var(--font-mono)", direction: "ltr", textAlign: "left" }}
                  value={html}
                  onChange={(event) => setHtml(event.target.value)}
                />
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy === "save"} onClick={() => void saveEdit()}>
                    {busy === "save" ? t(lang, "saving") : t(lang, "save")}
                  </button>
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => setEditing(false)}>
                    {t(lang, "cancel")}
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => void openEditor()}>
                {t(lang, "edit")}
              </button>
            )}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
            {t(lang, "editOnlySingle")}
          </p>
        )}
      </section>

      <section className="panel" style={{ padding: 14, borderColor: "rgba(243,111,111,.22)" }}>
        <div className="section-title" style={{ marginBottom: 6, color: "var(--danger)" }}>
          {t(lang, "dangerZone")}
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px", lineHeight: 1.8 }}>
          {t(lang, "deleteWarn", { days: retentionDays })}
        </p>
        {confirmDelete ? (
          <div className="row">
            <button type="button" className="btn btn-danger" disabled={busy === "delete"} onClick={() => void remove()}>
              {t(lang, "deleteConfirm")}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
              {t(lang, "cancel")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            {t(lang, "deleteSite")}
          </button>
        )}
      </section>
    </div>
  );
}
