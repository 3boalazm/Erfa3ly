import { describe, expect, it } from "vitest";
import { logLevel, redact } from "@/lib/log";

describe("logLevel", () => {
  it("defaults to quiet, so a healthy deployment is silent", () => {
    const saved = process.env.ERFA3LY_LOG;
    delete process.env.ERFA3LY_LOG;
    expect(logLevel()).toBe("error");
    if (saved !== undefined) process.env.ERFA3LY_LOG = saved;
  });

  it("accepts the documented levels and the boolean shorthand", () => {
    const saved = process.env.ERFA3LY_LOG;
    for (const [value, expected] of [
      ["debug", "debug"],
      ["info", "info"],
      ["off", "off"],
      ["true", "info"],
      ["nonsense", "error"],
    ] as const) {
      process.env.ERFA3LY_LOG = value;
      expect(logLevel()).toBe(expected);
    }
    if (saved === undefined) delete process.env.ERFA3LY_LOG;
    else process.env.ERFA3LY_LOG = saved;
  });
});

describe("redact", () => {
  it("never lets a connection string, blob token or bearer token through", () => {
    const line = [
      "postgresql://user:secret@db.example.com:5432/app?sslmode=require",
      "vercel_blob_rw_ABC123",
      "Authorization: Bearer eyJhbGciOi.xyz",
      "https://x.test/cb?token=shhh&ok=1",
    ].join(" | ");
    const safe = redact(line);
    expect(safe).not.toContain("secret");
    expect(safe).not.toContain("ABC123");
    expect(safe).not.toContain("eyJhbGciOi");
    expect(safe).not.toContain("shhh");
    expect(safe).toContain("ok=1");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("site s_abc version v_def 41 MB")).toBe("site s_abc version v_def 41 MB");
  });
});
