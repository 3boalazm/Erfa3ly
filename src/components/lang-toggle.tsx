"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LANG_COOKIE, type Lang } from "@/lib/i18n";

/**
 * Language lives in a cookie, not in client state: the server components render
 * the right direction and dictionary on the first byte, with no flash of the
 * wrong language.
 */
export function LangToggle({ lang, label }: { lang: Lang; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchLanguage() {
    const next: Lang = lang === "ar" ? "en" : "ar";
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <button type="button" className="btn btn-sm" onClick={switchLanguage} disabled={pending} aria-label={label}>
      {label}
    </button>
  );
}
