import { afterEach, describe, expect, it, vi } from "vitest";

// config.ts reads the environment at import time, so each case re-imports it
// with a fresh module registry after mutating process.env.
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return import("@/lib/config");
}

const KEYS = ["VERCEL", "BLOB_READ_WRITE_TOKEN", "DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "DATABASE_URL_UNPOOLED"];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

describe("runtimeProblems", () => {
  it("says nothing on a laptop with no configuration", async () => {
    const config = await load({});
    expect(config.runtimeProblems()).toEqual([]);
    expect(config.storageDriver).toBe("local");
  });

  it("refuses local storage on Vercel, which has no durable disk", async () => {
    const config = await load({ VERCEL: "1", DATABASE_URL: "postgres://x@y/z" });
    const problems = config.runtimeProblems();
    expect(problems).toHaveLength(1);
    expect(config.storageDriver).toBe("local");
    expect(problems[0]).toContain("BLOB_READ_WRITE_TOKEN");
    expect(config.storageDriver).toBe("local");
  });

  it("refuses a missing database on Vercel", async () => {
    const config = await load({ VERCEL: "1", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" });
    expect(config.runtimeProblems().join(" ")).toContain("Postgres");
  });

  it("is happy when both are present", async () => {
    const config = await load({
      VERCEL: "1",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x",
      DATABASE_URL: "postgres://u:p@h/db",
    });
    expect(config.runtimeProblems()).toEqual([]);
    expect(config.storageDriver).toBe("blob");
  });
});

describe("database url aliases", () => {
  it("accepts the names the Vercel/Neon integrations inject", async () => {
    const config = await load({ POSTGRES_URL: "postgres://a@b/c" });
    expect(config.databaseUrl).toBe("postgres://a@b/c");
    expect(config.databaseUrlSource()).toBe("POSTGRES_URL");
  });

  it("prefers DATABASE_URL over the rest", async () => {
    const config = await load({ DATABASE_URL: "postgres://a@b/c", POSTGRES_URL: "postgres://d@e/f" });
    expect(config.databaseUrl).toBe("postgres://a@b/c");
    expect(config.databaseUrlSource()).toBe("DATABASE_URL");
  });
});
