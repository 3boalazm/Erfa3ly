import { getLang } from "@/lib/i18n-server";
import { limits, storageDriver, isVercel, databaseUrl } from "@/lib/config";
import { formatBytes, t, type StringKey } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const SECTIONS: { title: StringKey; body: StringKey }[] = [
  { title: "sec1Title", body: "sec1Body" },
  { title: "sec2Title", body: "sec2Body" },
  { title: "sec3Title", body: "sec3Body" },
  { title: "sec4Title", body: "sec4Body" },
];

export default async function DocsPage() {
  const lang = await getLang();
  return (
    <div className="shell" style={{ paddingTop: 32, paddingBottom: 20, maxWidth: 860 }}>
      <h1 style={{ fontSize: 26, margin: "0 0 8px" }}>{t(lang, "docsTitle")}</h1>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.8, marginBottom: 22 }}>
        {t(lang, "heroSubtitle")}
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {SECTIONS.map((section, index) => (
          <section key={section.title} className="panel" style={{ padding: 16 }}>
            <div className="row" style={{ gap: 10, marginBottom: 6 }}>
              <span
                aria-hidden
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: "rgba(110,231,183,.12)",
                  color: "var(--accent)",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {index + 1}
              </span>
              <h2 className="section-title" style={{ margin: 0 }}>
                {t(lang, section.title)}
              </h2>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.9 }}>
              {t(lang, section.body)}
            </p>
          </section>
        ))}
      </div>

      <section className="panel" style={{ padding: 16, marginTop: 16 }}>
        <h2 className="section-title" style={{ margin: "0 0 10px" }}>
          {t(lang, "limitsTitle")}
        </h2>
        <table className="files">
          <tbody>
            <tr>
              <td>{t(lang, "quotaOf", { used: "—", total: "" })}</td>
              <td className="mono">{formatBytes(limits.quotaBytes)}</td>
            </tr>
            <tr>
              <td>{lang === "ar" ? "أقصى حجم لملف واحد" : "Max file size"}</td>
              <td className="mono">{formatBytes(limits.maxFileBytes)}</td>
            </tr>
            <tr>
              <td>{lang === "ar" ? "أقصى حجم لعملية نشر" : "Max publish size"}</td>
              <td className="mono">{formatBytes(limits.maxVersionBytes)}</td>
            </tr>
            <tr>
              <td>{lang === "ar" ? "عدد الملفات" : "File count"}</td>
              <td className="mono">{limits.maxFiles}</td>
            </tr>
            <tr>
              <td>{lang === "ar" ? "مدة جلسة الرفع" : "Upload session TTL"}</td>
              <td className="mono">{limits.sessionTtlHours} h</td>
            </tr>
            <tr>
              <td>{lang === "ar" ? "الاحتفاظ بعد الحذف" : "Deleted retention"}</td>
              <td className="mono">{limits.deletedRetentionDays} d</td>
            </tr>
            <tr>
              <td>{lang === "ar" ? "التخزين" : "Storage"}</td>
              <td className="mono">{storageDriver}</td>
            </tr>
            <tr>
              <td>{lang === "ar" ? "قاعدة البيانات" : "Database"}</td>
              <td className="mono">{databaseUrl ? "postgres" : isVercel ? "missing" : "pglite (local)"}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel" style={{ padding: 16, marginTop: 16, borderColor: "rgba(246,193,119,.28)" }}>
        <h2 className="section-title" style={{ margin: "0 0 8px", color: "var(--warn)" }}>
          {t(lang, "needsRuntimeTitle")}
        </h2>
        <p className="muted" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.9 }}>
          {t(lang, "needsRuntimeBody")}
        </p>
      </section>
    </div>
  );
}
