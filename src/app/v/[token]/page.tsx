import Link from "next/link";
import type { Metadata } from "next";
import { getLang } from "@/lib/i18n-server";
import { resolveShare } from "@/lib/shares";
import { getVersionForSite } from "@/lib/sites";
import { t } from "@/lib/i18n";
import { previewOrigin } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/**
 * Share page: the reader-facing surface.
 *
 * Deliberately bare — a title, a hint that the page is untrusted content, and the
 * artifact itself in a sandboxed frame. Nothing here is a control panel, so a
 * phishing page inside the artifact cannot pretend to be the dashboard: the
 * frame is a different origin and the page above it has no forms.
 */
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const lang = await getLang();
  const share = await resolveShare(token);

  if (!share) {
    return (
      <div className="shell" style={{ paddingTop: 60 }}>
        <div className="panel" style={{ padding: 26, maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }} aria-hidden>
            🔗
          </div>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{t(lang, "shareGone")}</h1>
          <p className="muted" style={{ fontSize: 13.5, marginBottom: 18, lineHeight: 1.8 }}>
            {t(lang, "shareGoneBody")}
          </p>
          <Link href="/" className="btn">
            {t(lang, "backHome")}
          </Link>
        </div>
      </div>
    );
  }

  // A pinned share points at an exact version; otherwise "current" always wins,
  // so an updated artifact is visible through the old link too.
  const version = share.versionId ? await getVersionForSite(share.siteId, share.versionId) : null;
  const path = version ? version.entryPath : share.entryPath;
  const rawPath = `/api/raw/${share.siteId}/${version ? version.id : "current"}/${path}`;
  const src = previewOrigin ? `${previewOrigin}${rawPath}` : rawPath;
  const sandbox = previewOrigin
    ? "allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock"
    : "allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 62px)" }}>
      <div
        className="shell row"
        style={{ justifyContent: "space-between", paddingTop: 12, paddingBottom: 12, gap: 10, flexWrap: "wrap" }}
      >
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <span className="badge badge-accent">{t(lang, "sharing")}</span>
          <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {share.siteTitle}
          </strong>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="badge">{t(lang, "sharedBy", { app: t(lang, "appName") })}</span>
          <Link className="btn btn-sm btn-ghost" href="/">
            {t(lang, "appName")}
          </Link>
        </div>
      </div>
      <div style={{ flex: 1, padding: "0 20px 20px" }}>
        <div className="frame-shell" style={{ height: "calc(100vh - 190px)" }}>
          <iframe
            src={src}
            title={share.siteTitle}
            sandbox={sandbox}
            style={{ height: "100%" }}
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </div>
  );
}
