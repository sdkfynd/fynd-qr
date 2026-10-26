-- Apply after 001_fynd_qr.sql. Only modifies the Fynd QR schema.
begin;
create table if not exists fynd_qr.password_accounts (
  id text primary key,
  email text not null unique check (email = lower(email) and email ~ '^[^@[:space:]]+@gofynd\.com$'),
  name text not null,
  password_hash text not null,
  version integer not null default 1 check (version > 0),
  must_change_password boolean not null default true,
  disabled boolean not null default false,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
alter table fynd_qr.sessions add column if not exists credential_version integer;
alter table fynd_qr.password_accounts enable row level security;
revoke all on fynd_qr.password_accounts from public;
do $$ declare r text; begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on fynd_qr.password_accounts from %I', r);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname='fynd_qr' and tablename='password_accounts' and policyname='node_service') then
    create policy node_service on fynd_qr.password_accounts to fynd_qr_app using (true) with check (true);
  end if;
end $$;
grant select, insert, update on fynd_qr.password_accounts to fynd_qr_app;
commit;
