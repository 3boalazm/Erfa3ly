import "server-only";
import { asDate, asNumber, exec, one, rows, type Row } from "@/lib/db";
import { createId, createShareToken } from "@/lib/ids";
import { notFound } from "@/lib/http";
import { recordEvent } from "@/lib/rate-limit";
import type { ShareSummary } from "@/lib/types";

/**
 * Capability links.
 *
 * A share is a random 32-character token bound to one site (optionally pinned to
 * one version) with an optional expiry and a revoke switch. The token *is* the
 * permission: there is no second factor, exactly like an unlisted URL. Tokens are
 * stored in plaintext on purpose, unlike session secrets — the owner must be able
 * to copy an existing link again. That makes a database backup equivalent to a
 * credential file; SECURITY.md says so too.
 */
interface ShareRow extends Row {
  id: string;
  site_id: string;
  version_id: string | null;
  token: string;
  label: string | null;
  created_at: string | Date;
  expires_at: string | Date | null;
  revoked_at: string | Date | null;
  views: number | string;
}

export async function createShare(input: {
  siteId: string;
  ownerId: string;
  label?: string | null;
  versionId?: string | null;
  expiresInDays?: number | null;
}): Promise<ShareSummary> {
  const site = await one<{ id: string }>(`select id from sites where id = $1 and owner_id = $2 and deleted_at is null`, [
    input.siteId,
    input.ownerId,
  ]);
  if (!site) throw notFound("site not found");

  const id = createId("sh");
  const token = createShareToken();
  const days = input.expiresInDays && input.expiresInDays > 0 ? Math.min(input.expiresInDays, 3650) : null;

  const row = await one<ShareRow>(
    `insert into shares (id, site_id, version_id, token, label, expires_at)
     values ($1, $2, $3, $4, $5, ${days ? "now() + ($6 || ' days')::interval" : "null"})
     returning *`,
    days
      ? [id, input.siteId, input.versionId ?? null, token, input.label ?? null, String(days)]
      : [id, input.siteId, input.versionId ?? null, token, input.label ?? null],
  );
  await recordEvent({ ownerId: input.ownerId, siteId: input.siteId, kind: "write:share", detail: id });
  return toShare(row as ShareRow);
}

export async function listShares(siteId: string, ownerId: string): Promise<ShareSummary[]> {
  const result = await rows<ShareRow>(
    `select sh.* from shares sh join sites s on s.id = sh.site_id
      where sh.site_id = $1 and s.owner_id = $2
      order by sh.created_at desc`,
    [siteId, ownerId],
  );
  return result.map(toShare);
}

export async function revokeShare(shareId: string, ownerId: string): Promise<void> {
  const row = await one<{ site_id: string }>(
    `select sh.site_id from shares sh join sites s on s.id = sh.site_id
      where sh.id = $1 and s.owner_id = $2`,
    [shareId, ownerId],
  );
  if (!row) throw notFound("share not found");
  await exec(`update shares set revoked_at = now() where id = $1 and revoked_at is null`, [shareId]);
  await recordEvent({ ownerId, siteId: row.site_id, kind: "write:revoke", detail: shareId });
}

export interface ResolvedShare {
  siteId: string;
  siteTitle: string;
  versionId: string | null;
  entryPath: string;
  kind: string;
  needsRuntime: boolean;
  shareId: string;
  label: string | null;
}

/** Token → what to render, or null when revoked, expired, or the site is gone. */
export async function resolveShare(token: string): Promise<ResolvedShare | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = await one<ShareRow & { title: string; entry_path: string; kind: string; needs_runtime: boolean }>(
    `select sh.*, s.title, s.entry_path, s.kind, s.needs_runtime
       from shares sh join sites s on s.id = sh.site_id
      where sh.token = $1
        and sh.revoked_at is null
        and (sh.expires_at is null or sh.expires_at > now())
        and s.deleted_at is null`,
    [token],
  );
  if (!row) return null;
  // View counting is best-effort; a failure must never break the shared page.
  void exec(`update shares set views = views + 1 where id = $1`, [row.id]).catch(() => {});
  return {
    siteId: row.site_id,
    siteTitle: row.title,
    versionId: row.version_id,
    entryPath: row.entry_path,
    kind: row.kind,
    needsRuntime: Boolean(row.needs_runtime),
    shareId: row.id,
    label: row.label,
  };
}

function toShare(row: ShareRow): ShareSummary {
  return {
    id: row.id,
    siteId: row.site_id,
    versionId: row.version_id,
    token: row.token,
    label: row.label,
    createdAt: asDate(row.created_at),
    expiresAt: row.expires_at ? asDate(row.expires_at) : null,
    revokedAt: row.revoked_at ? asDate(row.revoked_at) : null,
    views: asNumber(row.views),
  };
}
