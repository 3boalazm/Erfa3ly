import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { dirOf, t } from "@/lib/i18n";
import { getLang } from "@/lib/i18n-server";
import { LangToggle } from "@/components/lang-toggle";

export const metadata: Metadata = {
  title: "ارفعلي · Erfa3ly",
  description:
    "Self-hosted publisher for AI-generated HTML, static sites, ZIPs and documents: sandboxed previews, versions, revocable share links.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#080b10",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} dir={dirOf(lang)}>
      <body>
        <header
          style={{
            borderBottom: "1px solid var(--line)",
            background: "rgba(8,11,16,0.72)",
            backdropFilter: "blur(8px)",
            position: "sticky",
            top: 0,
            zIndex: 20,
          }}
        >
          <div className="shell row" style={{ height: 62, justifyContent: "space-between" }}>
            <Link href="/" className="row" style={{ gap: 10 }}>
              <span
                aria-hidden
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: "linear-gradient(140deg,#6ee7b7,#3fae8a)",
                  color: "#04241a",
                  fontWeight: 800,
                  fontSize: 15,
                }}
              >
                ع
              </span>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                <strong style={{ fontSize: 15 }}>{t(lang, "appName")}</strong>
                <span className="muted" style={{ fontSize: 11.5 }}>
                  {t(lang, "tagline")}
                </span>
              </span>
            </Link>
            <nav className="row" style={{ gap: 6 }}>
              <Link href="/" className="btn btn-ghost btn-sm">
                {t(lang, "home")}
              </Link>
              <Link href="/docs" className="btn btn-ghost btn-sm">
                {t(lang, "docs")}
              </Link>
              <LangToggle lang={lang} label={t(lang, "langSwitch")} />
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <footer style={{ borderTop: "1px solid var(--line)", marginTop: 40 }}>
          <div className="shell row muted" style={{ height: 62, justifyContent: "space-between", fontSize: 12.5 }}>
            <span>
              {t(lang, "appName")} · {t(lang, "tagline")}
            </span>
            <span className="mono">static artifacts · sandboxed · versioned</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
