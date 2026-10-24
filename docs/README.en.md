# Erfa3ly — English summary

A self-hosted publisher for what AI agents produce: an HTML page, a build folder, a
ZIP, or a PDF. Drop it in, get a **sandboxed** preview link, immutable versions and a
revocable share link. Arabic-first UI (RTL) with an English toggle; the code and
comments are in English.

**Scope, stated plainly:** static artifacts only. No build steps, no `npm install`,
no servers, no databases for your app. A ZIP that looks like an application is
published for its static files and flagged in the UI.

## What it does

- **Browser → Blob uploads.** A Vercel Function body caps at 4.5 MB, so bytes never
  pass through the server: the browser gets a session-scoped token from
  `/api/blob/upload` and uploads directly (multipart above 100 MB). Locally, the same
  UI streams to `/api/uploads/<id>/files` so it works with no cloud account.
- **Two-layer sandbox.** `Content-Security-Policy: sandbox …` on every artifact
  response *and* an `<iframe sandbox>` without `allow-same-origin`. No cookies, no
  platform API, no shared origin with the dashboard.
- **Safe ZIPs.** Declared sizes are checked before inflation, zip-slip entries are
  refused, nothing is written to disk, then the entry point is detected — including
  the "one folder wraps the site" shape every `zip -r` produces.
- **Versions and share links.** Every edit or rollback creates an immutable version;
  share tokens are random, revocable, expirable and can be pinned to a version.
- **Local-first development.** No services: local disk plus PGlite (Postgres in wasm)
  running the same SQL as production.

## Run it

```bash
npm install
cp .env.example .env
npm run dev     # http://localhost:3000
npm test        # paths, tree planning, ZIP safety (24 cases)
npm run build
```

## Deploy

Requires Postgres and a Vercel Blob store; the app refuses to boot on Vercel without
them. `vercel.json` schedules `/api/cron/gc` daily (protected by `CRON_SECRET`).
See [deploy-vercel.md](deploy-vercel.md) (Arabic) for the numbers and the four
corrections the original plan needed.

## Docs

- [architecture.md](architecture.md) — storage/metadata seams, upload path, tree planning.
- [../SECURITY.md](../SECURITY.md) — threat model and known limits.
