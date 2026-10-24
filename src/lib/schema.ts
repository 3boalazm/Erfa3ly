// Schema, applied idempotently at startup. Additive only: every statement is
// IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so a deploy can add fields while the
// previous release is still serving traffic. No separate migration command.
export const SCHEMA_SQL = /* sql */ `
create table if not exists owners (
  id text primary key,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists sites (
  id text primary key,
  owner_id text not null,
  title text not null,
  kind text not null,
  entry_path text not null,
  current_version_id text,
  file_count integer not null default 0,
  byte_size bigint not null default 0,
  needs_runtime boolean not null default false,
  runtime_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists sites_owner_idx on sites (owner_id, created_at desc);

create table if not exists versions (
  id text primary key,
  site_id text not null,
  parent_version_id text,
  source text not null,
  entry_path text not null,
  root_prefix text not null default '',
  file_count integer not null default 0,
  byte_size bigint not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists versions_site_idx on versions (site_id, created_at desc);

create table if not exists files (
  version_id text not null,
  relpath text not null,
  byte_size bigint not null,
  mime text not null,
  primary key (version_id, relpath)
);

create table if not exists upload_sessions (
  id text primary key,
  owner_id text not null,
  site_id text not null,
  version_id text not null,
  kind text not null,
  state text not null default 'open',
  expected_files jsonb not null default '[]'::jsonb,
  declared_bytes bigint not null default 0,
  title text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  committed_at timestamptz,
  failed_reason text
);
create index if not exists upload_sessions_state_idx on upload_sessions (state, expires_at);
create index if not exists upload_sessions_owner_idx on upload_sessions (owner_id, created_at desc);

create table if not exists shares (
  id text primary key,
  site_id text not null,
  version_id text,
  token text not null unique,
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  views bigint not null default 0
);
create index if not exists shares_site_idx on shares (site_id);

create table if not exists events (
  id bigserial primary key,
  owner_id text,
  site_id text,
  kind text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists events_owner_idx on events (owner_id, created_at desc);
`;
