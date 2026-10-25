// TLS for the Postgres connection, decided here and *removed* from the URL.
//
// Why: `pg` parses a connection string's `sslmode` with `pg-connection-string`,
// which prints a loud SECURITY WARNING for `prefer` / `require` / `verify-ca`
// (they are being redefined in pg v9). Vercel surfaces that warning at `error`
// level, so a healthy deployment looked broken. The explicit `ssl` option we
// pass already decides the behaviour, so the parameter is redundant — strip it
// and make the intent legible in one place.
//
// Semantics used here, which match what this app did before, minus the warning:
//
//   sslmode=disable / allow        → no TLS
//   sslmode=verify-ca/verify-full  → TLS with certificate verification
//   sslmode=require / prefer / unset → TLS, no certificate verification
//   plain host (no sslmode)        → TLS unless the host is loopback
//   plain host on loopback         → no TLS
//
// `verify-ca` cannot be expressed by node-postgres (it verifies the chain and
// the hostname together, like verify-full); it is therefore treated as the
// stricter mode rather than silently weaker. Providers that use self-signed
// certificates keep working through the `require` → relaxed default.

export type TlsMode = "disable" | "relaxed" | "verify-full";

export interface ResolvedTls {
  /** Connection string with TLS parameters removed. */
  connectionString: string;
  /** Value for pg's `ssl` option. */
  ssl: false | { rejectUnauthorized: boolean };
  mode: TlsMode;
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/i;

/** Environment override, for providers whose behaviour must be pinned. */
function overrideFromEnv(env: Record<string, string | undefined>): TlsMode | null {
  const raw = (env.ERFA3LY_DB_SSL || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "disable" || raw === "off" || raw === "false") return "disable";
  if (raw === "verify-full" || raw === "strict" || raw === "true") return "verify-full";
  if (raw === "require" || raw === "relaxed") return "relaxed";
  return null;
}

export function resolveDatabaseTls(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): ResolvedTls {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    // Not a URL (a DSN with a socket path, for instance): hand it over untouched
    // and let pg decide, rather than rewriting something we do not understand.
    return { connectionString, ssl: false, mode: "disable" };
  }

  const declared = (url.searchParams.get("sslmode") || "").toLowerCase();
  // These are the parameters that make pg print the warning, or that change TLS
  // behaviour in ways this app does not implement.
  url.searchParams.delete("sslmode");
  url.searchParams.delete("ssl");
  url.searchParams.delete("uselibpqcompat");

  const loopback = LOOPBACK.test(url.hostname);
  const override = overrideFromEnv(env);

  let mode: TlsMode;
  if (override) {
    mode = override;
  } else if (declared === "disable" || declared === "allow") {
    mode = "disable";
  } else if (declared === "verify-ca" || declared === "verify-full") {
    mode = "verify-full";
  } else if (declared === "require" || declared === "prefer") {
    mode = "relaxed";
  } else {
    mode = loopback ? "disable" : "relaxed";
  }

  return {
    connectionString: url.toString(),
    ssl: mode === "disable" ? false : { rejectUnauthorized: mode === "verify-full" },
    mode,
  };
}
