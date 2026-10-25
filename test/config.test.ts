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

const KEYS = [
  "VERCEL",
  "BLOB_READ_WRITE_TOKEN",
  "BLOB_STORE_ID",
  "VERCEL_OIDC_TOKEN",
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "DATABASE_URL_UNPOOLED",
];

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

describe("blob authentication", () => {
  it("uses a read-write token when present", async () => {
    const config = await load({ VERCEL: "1", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x", DATABASE_URL: "postgres://u@h/d" });
    expect(config.blobAuth).toBe("token");
    expect(config.runtimeProblems()).toEqual([]);
  });

  it("accepts a store connected through OIDC: BLOB_STORE_ID is enough on Vercel", async () => {
    const config = await load({ VERCEL: "1", BLOB_STORE_ID: "store_abc", DATABASE_URL: "postgres://u@h/d" });
    expect(config.blobAuth).toBe("oidc");
    expect(config.storageDriver).toBe("blob");
    expect(config.runtimeProblems()).toEqual([]);
  });

  it("explains a store that cannot authenticate instead of asking for a token", async () => {
    // Off Vercel, an imported BLOB_STORE_ID alone cannot authenticate (no OIDC),
    // so local disk remains the legitimate local default.
    const local = await load({ BLOB_STORE_ID: "store_abc", DATABASE_URL: undefined });
    expect(local.storageDriver).toBe("local");
    expect(local.runtimeProblems()).toEqual([]);

    // On Vercel the same env is a complete storage setup: the only thing left to
    // report is the missing database, not a missing token.
    const vercel = await load({ VERCEL: "1", BLOB_STORE_ID: "store_abc", DATABASE_URL: undefined });
    expect(vercel.blobAuth).toBe("oidc");
    expect(vercel.storageDriver).toBe("blob");
    const problems = vercel.runtimeProblems();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Postgres|DATABASE_URL/);
  });

  it("uses OIDC locally only when a token was pulled into the environment", async () => {
    const config = await load({ BLOB_STORE_ID: "store_abc", VERCEL_OIDC_TOKEN: "oidc_x" });
    expect(config.blobAuth).toBe("oidc");
  });
});

describe("upload mode", () => {
  it("maps the three supported combinations", async () => {
    expect((await load({})).blobUploadMode).toBe("local");
    expect((await load({ VERCEL: "1", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" })).blobUploadMode).toBe("blob-token");
    expect(
      (await load({ VERCEL: "1", BLOB_STORE_ID: "store_abc", BLOB_READ_WRITE_TOKEN: undefined })).blobUploadMode,
    ).toBe("blob-presigned");
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
