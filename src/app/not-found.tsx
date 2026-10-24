import Link from "next/link";
import { getLang } from "@/lib/i18n-server";
import { t } from "@/lib/i18n";

export default async function NotFound() {
  const lang = await getLang();
  return (
    <div className="shell" style={{ paddingTop: 60 }}>
      <div className="panel" style={{ padding: 26, maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: 34, marginBottom: 8 }} aria-hidden>
          404
        </div>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{t(lang, "notFound")}</h1>
        <p className="muted" style={{ fontSize: 13.5, marginBottom: 18, lineHeight: 1.8 }}>
          {t(lang, "notFoundBody")}
        </p>
        <Link href="/" className="btn">
          {t(lang, "backHome")}
        </Link>
      </div>
    </div>
  );
}
