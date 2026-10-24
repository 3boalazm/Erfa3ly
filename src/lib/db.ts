import "server-only";
import path from "node:path";
import { dataDir, databaseUrl, isVercel } from "@/lib/config";
import { SCHEMA_SQL } from "@/lib/schema";

/**
 * One tiny SQL seam. Two drivers speak it:
 *
 *  - `pg`        — production (Neon, Supabase, RDS, ...).
 *  - `@electric-sql/pglite` — a real Postgres compiled to wasm, kept in the
 *    local data directory. It exists so `npm run dev` needs no services and so
 *    development exercises the *same* SQL as production instead of a toy store.
 *
 * Rows come back untyped; the repository layer narrows them.
 */
export type Row = Record<string, unknown>;

export interface SqlClient {
  query(text: string, params?: unknown[]): Promise<Row[]>;
}

const globalForDb = globalThis as unknown as { __erfa3lyDb?: Promise<SqlClient> };

async function connect(): Promise<SqlClient> {
  if (databaseUrl) {
    const { Pool } = await import("pg");
    const needsSsl = !/localhost|127\.0\.0\.1|::1/.test(databaseUrl) && !/[?&]sslmode=disable/.test(databaseUrl);
    const pool = new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.ERFA3LY_PG_POOL_MAX || 5),
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    return {
      async query(text, params) {
        const result = await pool.query(text, params as unknown[] | undefined);
        return result.rows as Row[];
      },
    };
  }
  if (isVercel) {
    throw new Error("DATABASE_URL is not set: metadata needs Postgres in production (the PGlite fallback is local-only).");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdir } = await import("node:fs/promises");
  const pgDir = path.join(dataDir, "pgdata");
  await mkdir(dataDir, { recursive: true });
  const db = await PGlite.create(pgDir);
  return {
    async query(text, params) {
      const result = await db.query(text, params as unknown[] | undefined);
      return result.rows as Row[];
    },
  };
}

async function migrate(client: SqlClient): Promise<void> {
  // PGlite's exec runs multiple statements; pg needs them one at a time.
  const statements = SCHEMA_SQL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) await client.query(`${statement};`);
}

export function getDb(): Promise<SqlClient> {
  if (!globalForDb.__erfa3lyDb) {
    globalForDb.__erfa3lyDb = (async () => {
      const client = await connect();
      await migrate(client);
      return client;
    })().catch((error) => {
      // Never cache a failed connection: the next request retries cleanly.
      globalForDb.__erfa3lyDb = undefined;
      throw error;
    });
  }
  return globalForDb.__erfa3lyDb;
}

export async function rows<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = await getDb();
  return (await client.query(text, params)) as T[];
}

export async function one<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const list = await rows<T>(text, params);
  return list[0] ?? null;
}

export async function exec(text: string, params: unknown[] = []): Promise<void> {
  const client = await getDb();
  await client.query(text, params);
}

/** Postgres returns int8 as a string; the UI wants a number. */
export function asNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

export function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
