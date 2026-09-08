-- P1 schema: users, devices, scripts, script_versions.

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

-- One row per issued refresh token (rotation = insert new + revoke old).
create table if not exists devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users(id) on delete cascade,
  refresh_hash  text unique not null,          -- sha256 hex of the opaque token
  device_name   text not null default 'Unknown',
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);
create index if not exists devices_user_idx on devices (user_id);

create table if not exists scripts (
  id              uuid primary key default gen_random_uuid(),
  owner_type      text not null default 'user' check (owner_type in ('user', 'group')),
  owner_id        uuid not null references users(id) on delete cascade,
  title           text not null default 'Untitled',
  visibility      text not null default 'private' check (visibility in ('private', 'group', 'public')),
  template_id     text,
  script_language text not null default 'en',
  latest_revision integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists scripts_owner_idx on scripts (owner_type, owner_id)
  where deleted_at is null;

-- Immutable version chain — the whole screenplay per revision.
create table if not exists script_versions (
  id              uuid primary key default gen_random_uuid(),
  script_id       uuid not null references scripts(id) on delete cascade,
  revision        integer not null,
  doc             jsonb not null,
  block_count     integer not null,
  author_id       uuid not null references users(id) on delete cascade,
  idempotency_key text,
  created_at      timestamptz not null default now(),
  unique (script_id, revision)
);
create index if not exists script_versions_key_idx on script_versions (idempotency_key)
  where idempotency_key is not null;
