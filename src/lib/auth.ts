import "server-only";
import { cookies, headers } from "next/headers";
import { createId } from "@/lib/ids";
import { exec } from "@/lib/db";
import { isPreviewRequest } from "@/lib/request-host";

/**
 * Preview origins serve untrusted artifacts from the same deployment. If a
 * browser ever carried the workspace cookie there, artifact JavaScript could act
 * as the owner. The cookie is host-only, so it normally is not sent — this makes
 * it impossible rather than unlikely.
 */
async function onPreviewHost(): Promise<boolean> {
  return isPreviewRequest(await headers());
}

/**
 * Anonymous workspaces.
 *
 * The owner identity is a random id in an HttpOnly cookie: it is a capability,
 * not a login. That is deliberate for v1 — anyone can publish without an
 * account, like the reference platform's anonymous uploads, and there is no
 * password to leak. Upgrading to a real identity provider means replacing this
 * file: everything else takes `ownerId: string` and does not care where it came
 * from.
 *
 * Consequence to keep in mind: whoever holds the cookie owns the files. Sharing
 * the dashboard URL does not share the files (the cookie is not in the URL), and
 * clearing cookies loses the workspace — the share links keep working.
 */
export const OWNER_COOKIE = "erfa3ly_owner";
const OWNER_ID_RE = /^o_[A-Za-z0-9_-]{16,}$/;

export async function readOwnerId(): Promise<string | null> {
  if (await onPreviewHost()) return null;
  const jar = await cookies();
  const value = jar.get(OWNER_COOKIE)?.value;
  return value && OWNER_ID_RE.test(value) ? value : null;
}

/**
 * Read the owner, or mint one and set the cookie. Only call from a Route
 * Handler or Server Action — Next refuses to set cookies while rendering.
 */
export async function ensureOwnerId(): Promise<string> {
  if (await onPreviewHost()) {
    throw new Error("the preview origin cannot create or use a workspace");
  }
  const jar = await cookies();
  const existing = jar.get(OWNER_COOKIE)?.value;
  if (existing && OWNER_ID_RE.test(existing)) {
    await touchOwner(existing);
    return existing;
  }
  const id = createId("o");
  jar.set(OWNER_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 400 * 24 * 60 * 60,
  });
  await touchOwner(id);
  return id;
}

async function touchOwner(id: string): Promise<void> {
  await exec(
    `insert into owners (id) values ($1)
     on conflict (id) do update set last_seen_at = now()`,
    [id],
  );
}
