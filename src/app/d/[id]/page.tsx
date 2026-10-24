import Link from "next/link";
import { notFound } from "next/navigation";
import { getLang } from "@/lib/i18n-server";
import { readOwnerId } from "@/lib/auth";
import { getFileList, getSiteDetail } from "@/lib/sites";
import { limits } from "@/lib/config";
import { formatBytes, t } from "@/lib/i18n";
import { SiteWorkspace, type WorkspaceSite } from "@/components/site-workspace";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = await getLang();
  const ownerId = await readOwnerId();
  if (!ownerId) notFound();

  const site = await getSiteDetail(id, ownerId);
  if (!site) notFound();

  const files = site.current ? await getFileList(site.current.id) : [];

  // Dates become ISO strings at the boundary: the client component should not
  // depend on how the runtime serialises Date.
  const workspace: WorkspaceSite = {
    id: site.id,
    title: site.title,
    kind: site.kind,
    entryPath: site.entryPath,
    currentVersionId: site.currentVersionId,
    fileCount: site.fileCount,
    byteSize: site.byteSize,
    needsRuntime: site.needsRuntime,
    runtimeReason: site.runtimeReason,
    versions: site.versions.map((version) => ({
      id: version.id,
      source: version.source,
      entryPath: version.entryPath,
      fileCount: version.fileCount,
      byteSize: version.byteSize,
      createdAt: version.createdAt.toISOString(),
      note: version.note,
    })),
    shares: site.shares.map((share) => ({
      id: share.id,
      token: share.token,
      label: share.label,
      createdAt: share.createdAt.toISOString(),
      expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
      views: share.views,
    })),
    files,
  };

  return (
    <div className="shell" style={{ paddingTop: 24, paddingBottom: 20 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <Link href="/" className="muted" style={{ fontSize: 12.5 }}>
            ← {t(lang, "home")}
          </Link>
          <h1 style={{ fontSize: 22, margin: "6px 0 4px", overflowWrap: "anywhere" }}>{site.title}</h1>
          <div className="muted" style={{ fontSize: 12.5 }}>
            <span className="mono">{site.id}</span> · {formatBytes(site.byteSize)} ·{" "}
            {t(lang, "filesCount", { n: site.fileCount })}
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="badge">
            {site.kind === "folder" ? t(lang, "kindFolder") : site.kind === "document" ? t(lang, "kindDocument") : t(lang, "kindSingle")}
          </span>
          <span className="badge">{t(lang, "entryPoint")}: <code className="inline">{site.entryPath}</code></span>
        </div>
      </div>

      <SiteWorkspace lang={lang} site={workspace} retentionDays={limits.deletedRetentionDays} />
    </div>
  );
}
