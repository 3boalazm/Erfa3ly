import Link from "next/link";
import { getLang } from "@/lib/i18n-server";
import { readOwnerId } from "@/lib/auth";
import { listSites, ownerUsageBytes } from "@/lib/sites";
import { limits, storageDriver } from "@/lib/config";
import { formatBytes, t } from "@/lib/i18n";
import { Uploader } from "@/components/uploader";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const lang = await getLang();
  const ownerId = await readOwnerId();
  const [sites, usedBytes] = ownerId ? await Promise.all([listSites(ownerId), ownerUsageBytes(ownerId)]) : [[], 0];

  const kindLabel = (kind: string) =>
    kind === "document" ? t(lang, "kindDocument") : kind === "folder" ? t(lang, "kindFolder") : t(lang, "kindSingle");

  return (
    <div className="shell" style={{ paddingTop: 34, paddingBottom: 20 }}>
      <section style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 30, lineHeight: 1.25, margin: "0 0 8px", letterSpacing: "-0.01em" }}>
          {t(lang, "heroTitle")}
        </h1>
        <p className="muted" style={{ margin: 0, fontSize: 14.5, maxWidth: 720, lineHeight: 1.8 }}>
          {t(lang, "heroSubtitle")}
        </p>
      </section>

      <Uploader
        lang={lang}
        driver={storageDriver}
        usedBytes={usedBytes}
        limits={{
          maxFileBytes: limits.maxFileBytes,
          maxVersionBytes: limits.maxVersionBytes,
          maxFiles: limits.maxFiles,
          quotaBytes: limits.quotaBytes,
        }}
      />

      <section style={{ marginTop: 30 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            {t(lang, "yourWork")}
          </h2>
          <span className="badge">{t(lang, "sitesCount", { n: sites.length })}</span>
        </div>

        {sites.length === 0 ? (
          <div className="panel-soft" style={{ padding: 26, textAlign: "center" }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t(lang, "emptyTitle")}</div>
            <div className="muted" style={{ fontSize: 13.5 }}>
              {t(lang, "emptyBody")}
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {sites.map((site) => (
              <Link key={site.id} href={`/d/${site.id}`} className="panel" style={{ padding: 14, display: "block" }}>
                <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                  <span className={`badge ${site.kind === "document" ? "" : "badge-accent"}`}>{kindLabel(site.kind)}</span>
                  {site.needsRuntime ? <span className="badge badge-warn">{t(lang, "needsRuntime")}</span> : null}
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, overflowWrap: "anywhere" }}>{site.title}</div>
                <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.9 }}>
                  <div className="mono" style={{ opacity: 0.8 }}>
                    {site.entryPath}
                  </div>
                  <div>
                    {formatBytes(site.byteSize)} · {t(lang, "filesCount", { n: site.fileCount })}
                  </div>
                  <div>
                    {t(lang, "updatedAt")}: {new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium" }).format(site.updatedAt)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="panel-soft" style={{ padding: 16, marginTop: 26 }}>
        <div className="section-title" style={{ marginBottom: 6 }}>
          {t(lang, "authTitle")}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.8 }}>
          {t(lang, "authBody")}
        </p>
      </section>
    </div>
  );
}
