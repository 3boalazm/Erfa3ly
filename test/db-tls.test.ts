import { describe, expect, it } from "vitest";
import { resolveDatabaseTls } from "@/lib/db-tls";

const env = {} as Record<string, string | undefined>;

describe("resolveDatabaseTls", () => {
  it("strips sslmode so pg stops printing its deprecation warning", () => {
    const resolved = resolveDatabaseTls("postgresql://u:p@db.example.com/erfa3ly?sslmode=require", env);
    expect(resolved.connectionString).not.toContain("sslmode");
    expect(resolved.connectionString).toContain("postgresql://u:p@db.example.com/erfa3ly");
    expect(resolved.mode).toBe("relaxed");
    expect(resolved.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("keeps unrelated parameters", () => {
    const resolved = resolveDatabaseTls(
      "postgres://u:p@h/db?sslmode=require&channel_binding=require&uselibpqcompat=true",
      env,
    );
    expect(resolved.connectionString).toContain("channel_binding=require");
    expect(resolved.connectionString).not.toContain("sslmode");
    expect(resolved.connectionString).not.toContain("uselibpqcompat");
  });

  it("honours an explicit disable", () => {
    expect(resolveDatabaseTls("postgres://u:p@h/db?sslmode=disable", env).ssl).toBe(false);
    expect(resolveDatabaseTls("postgres://u:p@h/db?sslmode=allow", env).mode).toBe("disable");
  });

  it("verifies certificates when asked, and treats verify-ca as the stricter mode", () => {
    expect(resolveDatabaseTls("postgres://u:p@h/db?sslmode=verify-full", env).ssl).toEqual({ rejectUnauthorized: true });
    expect(resolveDatabaseTls("postgres://u:p@h/db?sslmode=verify-ca", env).mode).toBe("verify-full");
  });

  it("defaults sensibly: TLS for a remote host, none for loopback", () => {
    expect(resolveDatabaseTls("postgres://u:p@db.example.com/db", env).mode).toBe("relaxed");
    expect(resolveDatabaseTls("postgres://u:p@localhost:5432/db", env).mode).toBe("disable");
    expect(resolveDatabaseTls("postgres://u:p@127.0.0.1:5432/db", env).mode).toBe("disable");
  });

  it("lets an operator pin the mode with ERFA3LY_DB_SSL", () => {
    expect(resolveDatabaseTls("postgres://u:p@db.example.com/db?sslmode=require", { ERFA3LY_DB_SSL: "verify-full" }).mode).toBe(
      "verify-full",
    );
    expect(resolveDatabaseTls("postgres://u:p@db.example.com/db", { ERFA3LY_DB_SSL: "disable" }).ssl).toBe(false);
  });

  it("leaves something that is not a URL untouched", () => {
    const dsn = "host=/var/run/postgresql dbname=erfa3ly";
    expect(resolveDatabaseTls(dsn, env).connectionString).toBe(dsn);
  });
});
