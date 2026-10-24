import "server-only";
import { cookies } from "next/headers";
import { LANG_COOKIE, type Lang } from "@/lib/i18n";

/** Language for this request, from the cookie the toggle writes. Arabic is the default. */
export async function getLang(): Promise<Lang> {
  const jar = await cookies();
  return jar.get(LANG_COOKIE)?.value === "en" ? "en" : "ar";
}
