# Security model — Erfa3ly

Erfa3ly stores **files strangers produced** and serves them back to other people.
The threat model is therefore: the uploader is hostile, and the platform must not
be harmed by hosting their page, nor the viewer by opening it.

## The boundary: an opaque origin

Every artifact is served from `/api/raw/<siteId>/<version>/<path>` with:

```
Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups
                         allow-modals allow-downloads allow-pointer-lock
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Robots-Tag: noindex, nofollow, noarchive
```

and embedded in an `<iframe sandbox="…">` **without `allow-same-origin`**. Two
locks, not one: the attribute is the normal path, the header is the backstop when
someone opens the raw URL directly.

Consequences the design relies on:

- Hosted JavaScript runs in a unique origin: it cannot read the platform's
  cookies, `localStorage`, `IndexedDB`, or the DOM of the dashboard, and cannot
  call `/api/*` with credentials. A share page has no forms or controls, so a
  page inside the frame cannot impersonate one.
- The dashboard is never framed (`X-Frame-Options: DENY`) and artifacts never
  share an origin with it. A phishing page lives behind `/api/raw/...`, a URL
  shape that cannot be mistaken for the dashboard.
- `localStorage`/`sessionStorage` in the opaque origin throw in Chrome, so the
  preview injects an in-memory shim. Nothing is persisted; nothing crosses
  between two artifacts.
- Unknown file types are served as `attachment` with `nosniff`, so a file named
  `invoice.pdf` that is really HTML is never rendered as HTML.

The preview network is **open by default** (dashboards fetch APIs). Restricting
it means adding `connect-src` to the CSP in
`src/app/api/raw/[siteId]/[versionRef]/[[...path]]/route.ts`.

## Uploads

- Paths pass through `safeRelativePath` (`src/lib/paths.ts`): no `..`, no absolute
  paths, no drive letters or `:` segments, no control characters, no `.git` or
  `node_modules`, ≤1024 bytes, ≤255 bytes per segment.
- ZIPs are never extracted to disk. Entries are inflated in memory after their
  **declared** sizes are checked (`src/lib/unzip.ts`), so a zip bomb is refused
  before it allocates and zip-slip has no directory to escape.
- Limits are enforced twice: when a session opens (declared sizes) and when it
  commits (the sizes that actually arrived). A session that never commits leaves
  no site and is garbage-collected.
- The DB stores no secrets about artifacts; there are no credentials in the repo.

## Write API

- Cookie-authenticated mutations must carry an `Origin` that matches the
  deployment (`assertSameOrigin`). Browsers always send `Origin` on cross-site
  POST, so a third-party page cannot publish or delete on a victim's behalf.
  Non-browser clients (curl, agents) that send no `Origin` are unaffected because
  they are not riding an ambient cookie.
- Writes are rate limited per owner in the database (not in process memory, which
  on Vercel would reset per instance).
- Quota and per-file/version caps are checked server-side before a token is
  issued; the Blob token itself is scoped to one session prefix and one declared
  file, so it cannot be replayed elsewhere.

## Blob storage and public objects

The production backend stores objects `public` (see `src/lib/storage-blob.ts`),
because a private object would need a signed URL per request and the preview must
stream range requests. A blob URL lives on the provider's own hostname
(`*.public.blob.vercel-storage.com`), carries none of the platform's cookies and
cannot reach its API. Everything served from the platform's own origin goes
through `/api/raw`, which always adds the sandbox CSP. If you consider the raw
blob hostname itself a leak (it bypasses the platform's access checks for
*direct* links), use private blobs and accept signed-URL reads.

## Known limits

- **The site id is a capability.** 16 random characters; unlisted, not
  authenticated. A leaked dashboard URL is not enough to read artifacts (the
  cookie is not in the URL), but a leaked artifact URL is.
- **Share tokens are stored in plaintext** so owners can copy an existing link
  again. A database dump therefore contains working links; rotate by revoking.
- View counting is best-effort and per-database, not analytics-grade.
- The app does not run uploads' code: no build steps, no `npm install`, no
  server-side rendering of user code. A ZIP that contains an application is
  served for its static files only, and flagged in the UI.
- Rate limiting is per owner, not per IP; add an edge rate limiter if the write
  API is exposed to the open internet.

## Reporting

Open a private security advisory on the repository, or email the maintainers
listed in `package.json`. Please do not file a public issue for a vulnerability.
