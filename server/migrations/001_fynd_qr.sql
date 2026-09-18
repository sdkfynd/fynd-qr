-- Additive migration: no changes to the existing public/bin-count tables.
-- Run once as the project database administrator. Runtime must use fynd_qr_app.
begin;
create schema if not exists fynd_qr;
revoke all on schema fynd_qr from public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'fynd_qr_app') then
    create role fynd_qr_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;
grant usage on schema fynd_qr to fynd_qr_app;

create table if not exists fynd_qr.qr_codes (
  id text primary key check (id ~ '^[a-f0-9]{24}$'),
  owner_id text not null,
  request_key text not null,
  kind text not null check (kind in ('static', 'dynamic')),
  name text not null,
  content_type text not null,
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  design jsonb not null check (jsonb_typeof(design) = 'object'),
  slug text unique,
  scan_url text,
  destination text,
  payload text not null,
  status text not null check (status in ('active', 'paused', 'archived')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_scan_at timestamptz,
  total_scans bigint not null default 0 check (total_scans >= 0),
  revision integer not null default 1 check (revision > 0),
  unique (owner_id, request_key),
  check ((kind = 'static' and slug is null and scan_url is null) or
         (kind = 'dynamic' and slug is not null and slug ~ '^[A-Za-z0-9_-]{12}$' and scan_url is not null and destination is not null))
);
create index if not exists qr_codes_owner_updated on fynd_qr.qr_codes (owner_id, updated_at desc);
create table if not exists fynd_qr.logos (
  id text primary key check (id ~ '^[a-f0-9]{24}$'),
  owner_id text not null,
  name text not null,
  digest text not null,
  image text not null,
  thumbnail text not null,
  created_at timestamptz not null,
  unique (owner_id, digest)
);
create index if not exists logos_owner_created on fynd_qr.logos (owner_id, created_at desc);
create table if not exists fynd_qr.sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  account jsonb not null check (jsonb_typeof(account) = 'object'),
  expires_at timestamptz not null
);
create index if not exists sessions_expiry on fynd_qr.sessions (expires_at);
create table if not exists fynd_qr.login_challenges (
  id text primary key,
  nonce text not null,
  expires_at timestamptz not null
);
create index if not exists login_challenges_expiry on fynd_qr.login_challenges (expires_at);
create table if not exists fynd_qr.scan_events (
  id text primary key,
  code_id text not null references fynd_qr.qr_codes(id),
  at timestamptz not null,
  expires_at timestamptz not null,
  visitor text not null,
  automated boolean not null,
  device text not null,
  browser text not null,
  country text not null,
  referrer text not null
);
create index if not exists scan_events_code_at on fynd_qr.scan_events (code_id, at desc);
create index if not exists scan_events_expiry on fynd_qr.scan_events (expires_at);

-- Only the Node service role can access these tables. Google account ownership
-- is checked by the Node API; Supabase anon/authenticated roles get no access.
do $$ declare t text; r text; begin
  foreach t in array array['qr_codes','logos','sessions','login_challenges','scan_events'] loop
    execute format('revoke all on table fynd_qr.%I from public', t);
    execute format('alter table fynd_qr.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'fynd_qr' and tablename = t and policyname = 'node_service') then
      execute format('create policy node_service on fynd_qr.%I to fynd_qr_app using (true) with check (true)', t);
    end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema fynd_qr from %I', r);
      execute format('revoke all on all tables in schema fynd_qr from %I', r);
    end if;
  end loop;
end $$;
grant select, insert, update on fynd_qr.qr_codes to fynd_qr_app;
grant select, insert on fynd_qr.logos to fynd_qr_app;
grant select, insert, delete on fynd_qr.sessions, fynd_qr.login_challenges, fynd_qr.scan_events to fynd_qr_app;
-- No login password is embedded here. Provision an app-only login separately.
commit;
