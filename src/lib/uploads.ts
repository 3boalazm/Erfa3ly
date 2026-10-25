import "server-only";
import { asDate, asNumber, exec, one, rows, type Row } from "@/lib/db";
import { assertUsableRuntime, limits, storageDriver } from "@/lib/config";
import { createId } from "@/lib/ids";
import { ApiError, badRequest, conflict, notFound } from "@/lib/http";
import { isJunkPath, safeRelativePath, versionPrefix } from "@/lib/paths";
import { mimeFor } from "@/lib/mime";
import { getStorage } from "@/lib/storage";
import { extractZip, readZipEntry } from "@/lib/unzip";
import { planTree } from "@/lib/tree";
import { assertQuota, writeVersion } from "@/lib/sites";
import { consumeWriteBudget, recordEvent } from "@/lib/rate-limit";
import type { UploadKind, UploadSession, UploadTarget } from "@/lib/types";

/**
 * Upload sessions.
 *
 * The awkward fact this file exists for: a Vercel Function cannot receive a
 * large body (4.5 MB cap), and an artifact is often 20 MB. So the browser
 * uploads bytes **directly to storage** with a token, and the server's job is
 * reduced to three cheap steps:
 *
 *   1. open — validate paths, sizes, quota and rate, mint site/version ids so the
 *      object keys are already final (`sites/<site>/<version>/<path>`); no copy
 *      or move is needed at the end;
 *   2. (bytes flow past us);
 *   3. commit — list what actually arrived, enforce the real sizes, unpack a ZIP
 *      if there is one, detect the entry point, write metadata rows.
 *
 * Abandoned sessions are garbage collected, so a half-finished upload cannot
 * quietly eat the storage quota.
 */

interface SessionRow extends Row {
  id: string;
  owner_id: string;
  site_id: string;
  version_id: string;
  kind: string;
  state: string;
  expected_files: UploadTarget[] | string;
  declared_bytes: number | string;
  title: string | null;
  created_at: string | Date;
  expires_at: string | Date;
}

/** Compression ratio can be huge; never inflate more than this in one function. */
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

function toSession(row: SessionRow): UploadSession {
  const expected = typeof row.expected_files === "string" ? (JSON.parse(row.expected_files) as UploadTarget[]) : row.expected_files;
  return {
    id: row.id,
    ownerId: row.owner_id,
    siteId: row.site_id,
    versionId: row.version_id,
    kind: row.kind as UploadKind,
    state: row.state as UploadSession["state"],
    expectedFiles: expected,
    declaredBytes: asNumber(row.declared_bytes),
    title: row.title,
    createdAt: asDate(row.created_at),
    expiresAt: asDate(row.expires_at),
  };
}

function validateTargets(kind: UploadKind, raw: unknown): UploadTarget[] {
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("no files declared");
  const targets: UploadTarget[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") throw badRequest("invalid file entry");
    const path = safeRelativePath(String((item as { path?: unknown }).path ?? ""));
    const size = Number((item as { size?: unknown }).size ?? 0);
    if (!Number.isFinite(size) || size < 0) throw badRequest(`invalid size for ${path}`);
    if (isJunkPath(path) || seen.has(path)) continue;
    seen.add(path);
    targets.push({ path, size });
  }
  if (targets.length === 0) throw badRequest("no usable files declared");
  if (targets.length > limits.maxFiles) throw new ApiError(413, `too many files (limit ${limits.maxFiles})`);

  let total = 0;
  for (const target of targets) {
    if (target.size > limits.maxFileBytes) {
      throw new ApiError(413, `file too large: ${target.path} (limit ${Math.round(limits.maxFileBytes / 1024 / 1024)} MB)`);
    }
    total += target.size;
  }
  if (total > limits.maxVersionBytes) {
    throw new ApiError(413, `publish is larger than ${Math.round(limits.maxVersionBytes / 1024 / 1024)} MB`);
  }
  if (kind === "zip") {
    if (targets.length !== 1 || !/\.zip$/i.test(targets[0].path)) throw badRequest("a ZIP upload must contain exactly one .zip file");
    if (targets[0].size > MAX_ARCHIVE_BYTES) {
      throw new ApiError(413, `ZIP is larger than ${Math.round(MAX_ARCHIVE_BYTES / 1024 / 1024)} MB; upload the folder instead`);
    }
  }
  if (kind === "document" && targets.length !== 1) throw badRequest("a document upload takes one file");
  return targets;
}

export interface OpenSessionResult extends UploadSession {
  driver: "local" | "blob";
  /** Object-key prefix the client must write under. */
  prefix: string;
}

export async function createUploadSession(input: {
  ownerId: string;
  kind: UploadKind;
  files: unknown;
  title?: string | null;
}): Promise<OpenSessionResult> {
  // Fail before a byte moves: a deployment that cannot store files must say so
  // here, not after the browser has uploaded 40 MB to a route that will 413.
  assertUsableRuntime();
  const targets = validateTargets(input.kind, input.files);
  await consumeWriteBudget(input.ownerId);
  const declaredBytes = targets.reduce((sum, target) => sum + target.size, 0);
  await assertQuota(input.ownerId, declaredBytes);

  const sessionId = createId("u");
  const siteId = createId("s");
  const versionId = createId("v");

  await exec(
    `insert into upload_sessions (id, owner_id, site_id, version_id, kind, state, expected_files, declared_bytes, title, expires_at)
     values ($1, $2, $3, $4, $5, 'open', $6::jsonb, $7, $8, now() + ($9 || ' hours')::interval)`,
    [
      sessionId,
      input.ownerId,
      siteId,
      versionId,
      input.kind,
      JSON.stringify(targets),
      declaredBytes,
      input.title?.slice(0, 200) ?? null,
      String(limits.sessionTtlHours),
    ],
  );

  const row = await one<SessionRow>(`select * from upload_sessions where id = $1`, [sessionId]);
  if (!row) throw new ApiError(500, "session vanished");
  const session = toSession(row);
  return { ...session, driver: storageDriver, prefix: versionPrefix(siteId, versionId) };
}

export async function getOpenSession(sessionId: string, ownerId: string): Promise<OpenSessionResult> {
  const row = await one<SessionRow>(
    `select * from upload_sessions where id = $1 and owner_id = $2 and state = 'open' and expires_at > now()`,
    [sessionId, ownerId],
  );
  if (!row) throw notFound("upload session not found or expired");
  const session = toSession(row);
  return { ...session, driver: storageDriver, prefix: versionPrefix(session.siteId, session.versionId) };
}

/**
 * Local-driver upload: stream one declared file straight to disk.
 * Unused on Vercel (bytes never reach a function there), so it stays simple.
 */
export async function storeLocalUpload(input: {
  sessionId: string;
  ownerId: string;
  relpath: string;
  body: ReadableStream<Uint8Array>;
}): Promise<{ size: number }> {
  if (storageDriver !== "local") throw conflict("this deployment accepts direct-to-Blob uploads only");
  const session = await getOpenSession(input.sessionId, input.ownerId);
  const relpath = safeRelativePath(input.relpath);
  const declared = session.expectedFiles.find((target) => target.path === relpath);
  if (!declared) throw badRequest(`file was not declared: ${relpath}`);

  const storage = getStorage();
  const size = await storage.putStream(
    `${session.prefix}/${relpath}`,
    input.body,
    mimeFor(relpath),
    limits.maxFileBytes,
  );
  return { size };
}

/** Shared validation used by both the local and the Blob commit paths. */
async function actualObjects(prefix: string): Promise<Map<string, { key: string; size: number }>> {
  const storage = getStorage();
  const objects = await storage.listObjects(prefix);
  const map = new Map<string, { key: string; size: number }>();
  for (const object of objects) {
    const relpath = object.key.slice(prefix.length + 1);
    if (!relpath) continue;
    map.set(relpath, { key: object.key, size: object.size });
  }
  return map;
}

export async function commitUploadSession(sessionId: string, ownerId: string, titleOverride?: string | null) {
  // Claim the session atomically: two commits (double click, retry) must not
  // both write metadata for the same version.
  const claimed = await one<SessionRow>(
    `update upload_sessions set state = 'committing'
      where id = $1 and owner_id = $2 and state = 'open' and expires_at > now()
      returning *`,
    [sessionId, ownerId],
  );
  if (!claimed) throw conflict("upload session is not open (already committed, expired, or unknown)");
  const session = toSession(claimed);
  const storage = getStorage();

  try {
    const objects = await actualObjects(versionPrefix(session.siteId, session.versionId));
    if (objects.size === 0) throw badRequest("no files arrived — nothing to publish");

    let files: { path: string; size: number; mime: string }[] = [];
    let entryPath: string;
    let rootPrefix = "";
    let kind: "single" | "folder" | "document";
    let needsRuntime = false;
    let runtimeReason: string | null = null;
    let title = (titleOverride ?? session.title ?? "").trim().slice(0, 200);

    if (session.kind === "zip") {
      const [zipPath, zipObject] = [...objects.entries()][0];
      if (!/\.zip$/i.test(zipPath)) throw badRequest("the uploaded archive is not a .zip");
      if (zipObject.size > MAX_ARCHIVE_BYTES) throw new ApiError(413, "ZIP is too large");
      const downloaded = await storage.getObject(zipObject.key);
      if (!downloaded) throw badRequest("the uploaded ZIP disappeared before it could be unpacked");
      const archive = new Uint8Array(await new Response(downloaded.body).arrayBuffer());

      const entries = extractZip(archive, {
        maxFiles: limits.maxFiles,
        maxFileBytes: limits.maxFileBytes,
        maxTotalBytes: Math.min(limits.maxVersionBytes, MAX_EXTRACTED_BYTES),
      });
      const pack = planTree(
        entries.map((entry) => ({ path: entry.path, size: entry.size })),
        { packageJson: readZipEntry(archive, "package.json") },
      );
      await assertQuota(ownerId, pack.totalBytes);

      // Write the extracted tree next to the archive, then drop the archive:
      // what is published is the site, not the container.
      for (const entry of entries) {
        await access(
          `${versionPrefix(session.siteId, session.versionId)}/${entry.path}`,
          entry.bytes,
          mimeFor(entry.path),
        );
      }
      await storage.removeObject(zipObject.key);

      files = entries.map((entry) => ({
        path: entry.path.slice(pack.rootPrefix.length),
        size: entry.size,
        mime: mimeFor(entry.path),
      }));
      entryPath = pack.entryPath;
      rootPrefix = pack.rootPrefix;
      kind = pack.kind;
      needsRuntime = pack.needsRuntime;
      runtimeReason = pack.runtimeReason;
      if (!title) title = zipPath.replace(/\.zip$/i, "").split("/").pop() ?? "";
    } else {
      for (const target of session.expectedFiles) {
        const found = objects.get(target.path);
        if (!found) throw badRequest(`missing file: ${target.path}`);
        if (found.size > limits.maxFileBytes) throw new ApiError(413, `file too large: ${target.path}`);
      }
      const actual = [...objects.entries()].map(([path, object]) => ({ path, size: object.size }));
      // package.json decides "server app" vs "static build" when present.
      const packageEntry = actual.find((entry) => entry.path.split("/").pop() === "package.json");
      const packageJson = packageEntry
        ? await readSmallText(`${versionPrefix(session.siteId, session.versionId)}/${packageEntry.path}`)
        : null;

      const pack = planTree(actual, { packageJson });
      await assertQuota(ownerId, pack.totalBytes);

      files = actual.map((entry) => ({
        path: entry.path.slice(pack.rootPrefix.length),
        size: entry.size,
        mime: mimeFor(entry.path),
      }));
      entryPath = pack.entryPath;
      rootPrefix = pack.rootPrefix;
      kind = pack.kind;
      needsRuntime = pack.needsRuntime;
      runtimeReason = pack.runtimeReason;
      if (!title) {
        const top = session.expectedFiles[0]?.path.split("/")[0] ?? "";
        title = session.kind === "document" ? (session.expectedFiles[0]?.path.split("/").pop() ?? "") : top;
      }
    }

    if (files.length > limits.maxFiles) throw new ApiError(413, `too many files (limit ${limits.maxFiles})`);

    const written = await writeVersion({
      siteId: session.siteId,
      ownerId,
      versionId: session.versionId,
      source: session.kind === "zip" ? "zip" : "upload",
      entryPath,
      rootPrefix,
      kind,
      needsRuntime,
      runtimeReason,
      files,
      title: title || null,
      note: session.kind === "zip" ? "ZIP import" : "direct upload",
    });

    await exec(`update upload_sessions set state = 'committed', committed_at = now() where id = $1`, [sessionId]);
    return written;
  } catch (error) {
    // Leave the bytes in place: the GC sweeps the prefix of a failed session,
    // and leaving them lets an operator inspect what went wrong.
    await exec(`update upload_sessions set state = 'failed', failed_reason = $2 where id = $1`, [
      sessionId,
      error instanceof Error ? error.message.slice(0, 500) : "unknown",
    ]).catch(() => {});
    throw error;
  }
}

async function readSmallText(key: string): Promise<string | null> {
  const storage = getStorage();
  const head = await storage.headObject(key);
  if (!head || head.size > 256 * 1024) return null;
  const object = await storage.getObject(key);
  if (!object) return null;
  return new TextDecoder().decode(new Uint8Array(await new Response(object.body).arrayBuffer()));
}

async function access(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  await getStorage().putObject(key, bytes, contentType);
}

export interface GcReport {
  sessions: number;
  sites: number;
  objects: number;
}

/**
 * Reclaim what nobody will finish:
 *  - upload sessions past their TTL (the browser closed the tab mid-upload);
 *  - soft-deleted sites past the retention window.
 * Intended for `vercel.json` cron (daily) or the manual `npm run gc`.
 */
export async function collectGarbage(): Promise<GcReport> {
  const storage = getStorage();
  const report: GcReport = { sessions: 0, sites: 0, objects: 0 };

  const expired = await rows<SessionRow>(
    `select * from upload_sessions
      where state in ('open', 'failed') and expires_at < now()
      limit 200`,
  );
  for (const row of expired) {
    const session = toSession(row);
    report.objects += await storage.removePrefix(versionPrefix(session.siteId, session.versionId));
    await exec(`update upload_sessions set state = 'expired' where id = $1`, [session.id]);
    report.sessions += 1;
  }

  const dead = await rows<{ id: string }>(
    `select id from sites
      where deleted_at is not null
        and deleted_at < now() - ($1 || ' days')::interval
      limit 50`,
    [String(limits.deletedRetentionDays)],
  );
  const { purgeSite } = await import("@/lib/sites");
  for (const site of dead) {
    const versionRows = await rows<{ id: string }>(`select id from versions where site_id = $1`, [site.id]);
    for (const version of versionRows) {
      report.objects += await storage.removePrefix(versionPrefix(site.id, version.id));
    }
    await purgeSite(site.id);
    report.sites += 1;
  }

  return report;
}
