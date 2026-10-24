# Architecture

```
                       ┌──────────────────── Next.js 16 (App Router) ─────────────────────┐
 browser  ────────────▶ │  src/app/**        server components + client components       │
 agent / curl ────────▶ │  src/app/api/**    thin route handlers: parse, guard, shape   │
                       │  src/lib/**        the actual rules: sessions, tree, storage  │
                       │        │                                                       │
                       │        ├── Postgres (pg in prod, PGlite locally)  src/lib/db.ts│
                       │        └── Storage seam  src/lib/storage.ts                    │
                       │              ├── LocalStorage  → $ERFA3LY_DATA_DIR/blobs       │
                       │              └── BlobStorage   → Vercel Blob                    │
                       └────────────────────────────────────────────────────────────────┘
```

## One seam for bytes, one for rows

`Storage` (`src/lib/storage.ts`) has five operations — put, stream-put, get with
range, head, list, remove — and two implementations. Everything above it
(sessions, unzip, previews, shares) is backend-agnostic. Because version trees are
immutable (`sites/<siteId>/<versionId>/<path>`), no key is ever rewritten, so
both backends can cache reads and version URLs can be cached forever.

Metadata lives in Postgres: `owners`, `sites`, `versions`, `files`,
`upload_sessions`, `shares`, `events`. The schema (`src/lib/schema.ts`) is applied
idempotently at startup (`if not exists`), so a deploy never needs a migration
step. Local development uses PGlite — a real Postgres compiled to wasm — so the
SQL below is the SQL production runs. Nothing is written against a toy store.

## The upload path, and why it looks like this

```
browser ──① open session──▶ server   (validate paths/sizes/quota/rate, mint site+version ids)
browser ──② bytes────────▶ storage   (direct to Blob with a scoped token, or streamed PUT locally)
browser ──③ commit──────▶ server     (list what arrived, unpack ZIP, detect entry, write rows)
```

A Vercel Function accepts at most **4.5 MB** per request, so ② cannot pass
through the server if artifacts are to be useful. Direct-to-storage also makes
the free tier usable: bytes uploaded from the browser never count as function
data transfer.

The ids are minted in ①, so object keys are already final (`sites/<site>/<version>/…`)
and ③ has nothing to copy or move — it is metadata plus validation. A session
that is opened and abandoned is swept by the GC after its TTL.

## Tree planning

`src/lib/tree.ts` decides what was uploaded:

1. drop junk (`__MACOSX`, `.DS_Store`, `._*`), normalise paths;
2. if all files sit under one folder and it has an `index.html`, that folder is
   the root (this is what `zip -r site.zip site/` and every "download as ZIP"
   button produce) — the root prefix is stored on the version, so stripping does
   not move any bytes;
3. otherwise the shallowest `index.html` wins; a lone `report.html` is a
   single page; a lone PDF/DOCX is a document;
4. look for runtime markers (`server.js`, `package.json` scripts, `requirements.txt`,
   `Dockerfile`, …). If found, the artifact is still published — but the UI says
   plainly that it needs a server, and an archive with no static entry is
   rejected with that explanation rather than "no index.html".

## Serving

`/api/raw/<siteId>/<version|current>/<path>` streams from `Storage` with sandbox
headers, content types from a fixed table, byte ranges for PDFs and video, and an
in-memory `localStorage` shim injected into HTML. `/d/<id>` is the owner's
dashboard; `/v/<token>` is the reader's page. Both embed the raw route in a
sandboxed frame.

## Access

There is no login in v1: the owner is an HttpOnly cookie holding a random id
(`src/lib/auth.ts`). Share links (`/v/<token>`) are random 32-character
capabilities, optionally expiring and revocable, optionally pinned to a version.
Replacing the cookie with an OIDC provider touches one file — everything else
takes `ownerId: string`.

## Rendering model

Pages are server components (`force-dynamic`) so a share link is never served
from a stale cache; the dashboard's interactive parts (uploader, workspace) are
client components that call the JSON API and `router.refresh()`. The server stays
the source of truth: two tabs cannot disagree about which version is current.
