import "server-only";
import { asDate, asNumber, exec, one, rows, type Row } from "@/lib/db";
import { limits } from "@/lib/config";
import { createId } from "@/lib/ids";
import { mimeFor } from "@/lib/mime";
import { getStorage } from "@/lib/storage";
import { versionKey, versionPrefix } from "@/lib/paths";
import { ApiError, badRequest, conflict, notFound } from "@/lib/http";
import { recordEvent } from "@/lib/rate-limit";
import type { ArtifactKind } from "@/lib/tree";
import type { SiteDetail, SiteSummary, VersionSummary, ShareSummary } from "@/lib/types";

// Reads and metadata writes for published artifacts. The bytes are somebody
// else's problem (src/lib/storage.ts); this file owns the rows and the rules
// around them: quota, ownership, current version, soft delete.

interface SiteRow extends Row {
  id: string;
  owner_id: string;
  title: string;
  kind: string;
  entry_path: string;
  current_version_id: string | null;
  file_count: number | string;
  byte_size: number | string;
  needs_runtime: boolean;
  runtime_reason: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  share_count?: number | string;
}

interface VersionRow extends Row {
  id: string;
  site_id: string;
  parent_version_id: string | null;
  source: string;
  entry_path: string;
  root_prefix: string;
  file_count: number | string;
  byte_size: number | string;
  note: string | null;
  created_at: string | Date;
}

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

function toSite(row: SiteRow): SiteSummary {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as ArtifactKind,
    entryPath: row.entry_path,
    currentVersionId: row.current_version_id,
    fileCount: asNumber(row.file_count),
    byteSize: asNumber(row.byte_size),
    needsRuntime: Boolean(row.needs_runtime),
    runtimeReason: row.runtime_reason,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
    shareCount: asNumber(row.share_count),
  };
}

function toVersion(row: VersionRow): VersionSummary {
  return {
    id: row.id,
    siteId: row.site_id,
    parentVersionId: row.parent_version_id,
    source: row.source,
    entryPath: row.entry_path,
    rootPrefix: row.root_prefix,
    fileCount: asNumber(row.file_count),
    byteSize: asNumber(row.byte_size),
    note: row.note,
    createdAt: asDate(row.created_at),
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

/** Bytes an owner currently stores. Deleted sites are excluded: their bytes are queued for GC. */
export async function ownerUsageBytes(ownerId: string): Promise<number> {
  const row = await one<{ total: string | number }>(
    `select coalesce(sum(byte_size), 0)::bigint as total from sites where owner_id = $1 and deleted_at is null`,
    [ownerId],
  );
  return asNumber(row?.total);
}

/** Refuse a publish that would pass the per-owner quota. Checked twice: at session open and at commit. */
export async function assertQuota(ownerId: string, incomingBytes: number): Promise<void> {
  const used = await ownerUsageBytes(ownerId);
  if (used + incomingBytes > limits.quotaBytes) {
    throw new ApiError(
      413,
      `quota exceeded: ${Math.round(used / 1024 / 1024)} MB used of ${Math.round(limits.quotaBytes / 1024 / 1024)} MB`,
    );
  }
}

export async function listSites(ownerId: string): Promise<SiteSummary[]> {
  const result = await rows<SiteRow>(
    `select s.*, (select count(*)::int from shares sh
                    where sh.site_id = s.id and sh.revoked_at is null
                      and (sh.expires_at is null or sh.expires_at > now())) as share_count
       from sites s
      where s.owner_id = $1 and s.deleted_at is null
      order by s.updated_at desc
      limit 200`,
    [ownerId],
  );
  return result.map(toSite);
}

export async function getSiteDetail(siteId: string, ownerId: string): Promise<SiteDetail | null> {
  const siteRow = await one<SiteRow>(
    `select * from sites where id = $1 and owner_id = $2 and deleted_at is null`,
    [siteId, ownerId],
  );
  if (!siteRow) return null;
  const [versionRows, shareRows] = await Promise.all([
    rows<VersionRow>(`select * from versions where site_id = $1 order by created_at desc limit 100`, [siteId]),
    rows<ShareRow>(
      `select * from shares where site_id = $1 and revoked_at is null order by created_at desc limit 50`,
      [siteId],
    ),
  ]);
  const versions = versionRows.map(toVersion);
  const site = toSite(siteRow);
  return {
    ...site,
    versions,
    shares: shareRows.map(toShare),
    current: versions.find((version) => version.id === site.currentVersionId) ?? versions[0] ?? null,
  };
}

/**
 * Resolve what a preview request should read: a version id, or "current".
 * Public by design — the site id is the capability (unguessable, 16 chars) and a
 * share link has to work for a visitor who holds no cookie.
 */
export async function resolvePreviewTarget(
  siteId: string,
  versionRef: string,
): Promise<{ siteId: string; version: VersionSummary; title: string } | null> {
  const siteRow = await one<SiteRow>(`select * from sites where id = $1 and deleted_at is null`, [siteId]);
  if (!siteRow) return null;
  const versionRow = await one<VersionRow>(
    versionRef === "current"
      ? `select v.* from versions v join sites s on s.current_version_id = v.id where s.id = $1`
      : `select * from versions where id = $1 and site_id = $2`,
    versionRef === "current" ? [siteId] : [versionRef, siteId],
  );
  if (!versionRow) return null;
  return { siteId, version: toVersion(versionRow), title: siteRow.title };
}

export async function getVersionForSite(siteId: string, versionId: string): Promise<VersionSummary | null> {
  const row = await one<VersionRow>(`select * from versions where id = $1 and site_id = $2`, [versionId, siteId]);
  return row ? toVersion(row) : null;
}

export async function getFileList(versionId: string): Promise<{ path: string; size: number; mime: string }[]> {
  const result = await rows<{ relpath: string; byte_size: number | string; mime: string }>(
    `select relpath, byte_size, mime from files where version_id = $1 order by relpath`,
    [versionId],
  );
  return result.map((row) => ({ path: row.relpath, size: asNumber(row.byte_size), mime: row.mime }));
}

export interface NewVersionInput {
  siteId: string;
  ownerId: string;
  /** Pre-minted id, used by paths that already wrote bytes under a version prefix. */
  versionId?: string;
  source: "upload" | "zip" | "text" | "edit" | "rollback";
  entryPath: string;
  rootPrefix: string;
  kind: ArtifactKind;
  needsRuntime: boolean;
  runtimeReason: string | null;
  files: { path: string; size: number; mime: string }[];
  title?: string | null;
  note?: string | null;
  parentVersionId?: string | null;
}

/**
 * Persist a version (rows only — the bytes are already in storage) and, when the
 * site does not exist yet, create it in the same transaction-like sequence.
 */
export async function writeVersion(input: NewVersionInput): Promise<{ siteId: string; versionId: string }> {
  const versionId = input.versionId ?? createId("v");
  const byteSize = input.files.reduce((sum, file) => sum + file.size, 0);
  const existing = await one<SiteRow>(`select * from sites where id = $1 and owner_id = $2`, [
    input.siteId,
    input.ownerId,
  ]);
  if (existing && existing.deleted_at) throw conflict("site is deleted");

  await exec(
    `insert into versions (id, site_id, parent_version_id, source, entry_path, root_prefix, file_count, byte_size, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      versionId,
      input.siteId,
      input.parentVersionId ?? existing?.current_version_id ?? null,
      input.source,
      input.entryPath,
      input.rootPrefix,
      input.files.length,
      byteSize,
      input.note ?? null,
    ],
  );

  if (input.files.length > 0) {
    await exec(
      `insert into files (version_id, relpath, byte_size, mime)
       select $1, path, size, mime
         from unnest($2::text[], $3::bigint[], $4::text[]) as t(path, size, mime)
       on conflict (version_id, relpath) do update
         set byte_size = excluded.byte_size, mime = excluded.mime`,
      [versionId, input.files.map((f) => f.path), input.files.map((f) => f.size), input.files.map((f) => f.mime)],
    );
  }

  if (existing) {
    await exec(
      `update sites set current_version_id = $2, entry_path = $3, kind = $4, file_count = $5,
                        byte_size = $6, needs_runtime = $7, runtime_reason = $8,
                        title = coalesce($9, title), updated_at = now()
        where id = $1`,
      [
        input.siteId,
        versionId,
        input.entryPath,
        input.kind,
        input.files.length,
        byteSize,
        input.needsRuntime,
        input.runtimeReason,
        input.title ?? null,
      ],
    );
  } else {
    await exec(
      `insert into sites (id, owner_id, title, kind, entry_path, current_version_id, file_count, byte_size,
                          needs_runtime, runtime_reason, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [
        input.siteId,
        input.ownerId,
        input.title?.trim() || "Untitled",
        input.kind,
        input.entryPath,
        versionId,
        input.files.length,
        byteSize,
        input.needsRuntime,
        input.runtimeReason,
      ],
    );
  }

  await recordEvent({
    ownerId: input.ownerId,
    siteId: input.siteId,
    kind: `write:${input.source}`,
    detail: `${input.files.length} files, ${byteSize} bytes`,
  });
  return { siteId: input.siteId, versionId };
}

/** Inline HTML publish or edit. Only single-page artifacts can be edited this way. */
export async function publishHtml(input: {
  ownerId: string;
  siteId?: string | null;
  title?: string | null;
  html: string;
  source: "text" | "edit";
}): Promise<{ siteId: string; versionId: string }> {
  const bytes = new TextEncoder().encode(input.html);
  if (bytes.byteLength === 0) throw badRequest("the page is empty");
  if (bytes.byteLength > limits.maxTextBytes) {
    throw new ApiError(413, `pasted HTML is larger than ${Math.round(limits.maxTextBytes / 1024)} KB`);
  }

  let siteId = input.siteId ?? null;
  let entryPath = "index.html";
  let parentVersionId: string | null = null;

  if (siteId) {
    const site = await one<SiteRow>(`select * from sites where id = $1 and owner_id = $2 and deleted_at is null`, [
      siteId,
      input.ownerId,
    ]);
    if (!site) throw notFound("site not found");
    if (asNumber(site.file_count) > 1) {
      throw conflict("inline editing is only available for single-page artifacts; upload a new version instead");
    }
    entryPath = site.entry_path;
    parentVersionId = site.current_version_id;
    await assertQuota(input.ownerId, bytes.byteLength);
  } else {
    siteId = createId("s");
    await assertQuota(input.ownerId, bytes.byteLength);
  }

  const versionId = createId("v");
  const storage = getStorage();
  await storage.putObject(versionKey(siteId, versionId, entryPath), bytes, "text/html; charset=utf-8");

  const written = await writeVersion({
    siteId,
    ownerId: input.ownerId,
    source: input.source,
    entryPath,
    rootPrefix: "",
    kind: "single",
    needsRuntime: false,
    runtimeReason: null,
    files: [{ path: entryPath, size: bytes.byteLength, mime: "text/html; charset=utf-8" }],
    title: input.title ?? null,
    note: input.source === "edit" ? "inline edit" : "pasted page",
    parentVersionId,
    versionId,
  });
  return written;
}

export async function readVersionFile(
  siteId: string,
  version: VersionSummary,
  relpath: string,
): Promise<{ bytes: Uint8Array } | null> {
  const storage = getStorage();
  const object = await storage.getObject(versionKey(siteId, version.id, `${version.rootPrefix}${relpath}`));
  if (!object) return null;
  const buffer = new Uint8Array(await new Response(object.body).arrayBuffer());
  return { bytes: buffer };
}

/** Point the site back at an older immutable version. Files are never rewritten. */
export async function rollbackVersion(siteId: string, versionId: string, ownerId: string): Promise<void> {
  const site = await one<SiteRow>(`select * from sites where id = $1 and owner_id = $2 and deleted_at is null`, [
    siteId,
    ownerId,
  ]);
  if (!site) throw notFound("site not found");
  const version = await getVersionForSite(siteId, versionId);
  if (!version) throw notFound("version not found");

  await exec(
    `update sites set current_version_id = $2, entry_path = $3, file_count = $4, byte_size = $5, updated_at = now()
      where id = $1`,
    [siteId, version.id, version.entryPath, version.fileCount, version.byteSize],
  );
  await recordEvent({ ownerId, siteId, kind: "write:rollback", detail: version.id });
}

export async function softDeleteSite(siteId: string, ownerId: string): Promise<void> {
  const site = await one<SiteRow>(`select * from sites where id = $1 and owner_id = $2 and deleted_at is null`, [
    siteId,
    ownerId,
  ]);
  if (!site) throw notFound("site not found");
  await exec(`update sites set deleted_at = now() where id = $1`, [siteId]);
  await exec(`update shares set revoked_at = now() where site_id = $1 and revoked_at is null`, [siteId]);
  await recordEvent({ ownerId, siteId, kind: "write:delete" });
}

/** Used by the GC: hide nothing, reclaim everything. */
export async function purgeSite(siteId: string): Promise<void> {
  const storage = getStorage();
  const versionRows = await rows<{ id: string }>(`select id from versions where site_id = $1`, [siteId]);
  for (const version of versionRows) {
    await storage.removePrefix(versionPrefix(siteId, version.id));
  }
  await exec(`delete from files where version_id in (select id from versions where site_id = $1)`, [siteId]);
  await exec(`delete from shares where site_id = $1`, [siteId]);
  await exec(`delete from versions where site_id = $1`, [siteId]);
  await exec(`delete from sites where id = $1`, [siteId]);
  await recordEvent({ siteId, kind: "gc:purge" });
}

export async function countSites(ownerId: string): Promise<number> {
  const row = await one<{ count: string | number }>(
    `select count(*)::int as count from sites where owner_id = $1 and deleted_at is null`,
    [ownerId],
  );
  return asNumber(row?.count);
}

