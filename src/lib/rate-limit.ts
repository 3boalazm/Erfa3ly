import "server-only";
import { one } from "@/lib/db";
import { limits } from "@/lib/config";
import { tooMany } from "@/lib/http";
import { asNumber } from "@/lib/db";

/**
 * Per-owner write budget, counted in the database.
 *
 * The reference implementation used an in-process limiter; on Vercel that is
 * per-instance, so N concurrent functions allow N× the rate. A row count over a
 * time window costs one query and holds across instances.
 */
export async function consumeWriteBudget(ownerId: string): Promise<void> {
  const row = await one<{ count: string }>(
    `select count(*)::int as count from events
      where owner_id = $1 and kind like 'write:%' and created_at > now() - interval '1 hour'`,
    [ownerId],
  );
  if (asNumber(row?.count) >= limits.rateLimitPerHour) {
    throw tooMany(`too many write operations this hour (limit ${limits.rateLimitPerHour})`);
  }
}

export async function recordEvent(params: {
  ownerId?: string | null;
  siteId?: string | null;
  kind: string;
  detail?: string | null;
}): Promise<void> {
  const { exec } = await import("@/lib/db");
  await exec(`insert into events (owner_id, site_id, kind, detail) values ($1, $2, $3, $4)`, [
    params.ownerId ?? null,
    params.siteId ?? null,
    params.kind,
    params.detail ?? null,
  ]);
}
