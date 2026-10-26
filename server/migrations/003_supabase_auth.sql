-- Additive: retain every QR id, slug, scan URL, event and legacy owner.
-- Run after 001 and 002. No public tables or project-wide Auth settings change.
begin;
alter table fynd_qr.password_accounts drop constraint if exists password_accounts_email_check;
alter table fynd_qr.password_accounts add constraint password_accounts_email_check
  check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$');

create table if not exists fynd_qr.auth_owner_links (
  owner_id text primary key,
  auth_user_id text not null check (auth_user_id ~ '^[a-f0-9-]{36}$'),
  created_at timestamptz not null default now()
);
create index if not exists auth_owner_links_user on fynd_qr.auth_owner_links(auth_user_id);
-- Administrators can approve a legacy manual owner after verifying current
-- ownership. The runtime may read approvals but cannot grant itself one.
create table if not exists fynd_qr.owner_claim_approvals (
  owner_id text primary key references fynd_qr.password_accounts(id),
  auth_user_id text not null,
  approved_at timestamptz not null default now()
);
create table if not exists fynd_qr.request_limits (
  bucket text primary key,
  starts_at timestamptz not null,
  uses integer not null
);

-- Called only after Supabase Auth has verified the user and Google subject.
-- Conflicting links abort atomically, rather than moving somebody else's data.
create or replace function fynd_qr.link_owner_identity(auth_user text, aliases text[])
returns void language plpgsql set search_path = '' as $$
declare linked integer;
begin
  if auth_user !~ '^[a-f0-9-]{36}$' or cardinality(aliases) not between 1 and 3 then
    raise exception 'Invalid identity';
  end if;
  insert into fynd_qr.auth_owner_links(owner_id, auth_user_id)
    select distinct a, auth_user from unnest(aliases) a
    on conflict(owner_id) do nothing;
  select count(*) into linked from fynd_qr.auth_owner_links
    where owner_id = any(aliases) and auth_user_id = auth_user;
  if linked <> (select count(distinct a) from unnest(aliases) a) then
    raise exception 'Identity already linked' using errcode = '23505';
  end if;
end $$;

create or replace function fynd_qr.take_rate_limit(key text, maximum integer, seconds integer)
returns boolean language sql set search_path = '' as $$
  insert into fynd_qr.request_limits(bucket, starts_at, uses) values(key, now(), 1)
  on conflict(bucket) do update set
    starts_at = case when fynd_qr.request_limits.starts_at <= now() - make_interval(secs => seconds)
      then now() else fynd_qr.request_limits.starts_at end,
    uses = case when fynd_qr.request_limits.starts_at <= now() - make_interval(secs => seconds)
      then 1 else fynd_qr.request_limits.uses + 1 end
  returning uses <= maximum;
$$;
revoke all on function fynd_qr.link_owner_identity(text,text[]) from public;
revoke all on function fynd_qr.take_rate_limit(text,integer,integer) from public;
grant execute on function fynd_qr.link_owner_identity(text,text[]),
  fynd_qr.take_rate_limit(text,integer,integer) to fynd_qr_app;
grant select, insert on fynd_qr.auth_owner_links to fynd_qr_app;
grant select on fynd_qr.owner_claim_approvals to fynd_qr_app;
grant select, insert, update, delete on fynd_qr.request_limits to fynd_qr_app;
do $$ declare t text; r text; begin
  foreach t in array array['auth_owner_links','request_limits','owner_claim_approvals'] loop
    execute format('alter table fynd_qr.%I enable row level security', t);
    execute format('revoke all on fynd_qr.%I from public', t);
    if not exists(select 1 from pg_policies where schemaname='fynd_qr' and tablename=t and policyname='node_service') then
      execute format('create policy node_service on fynd_qr.%I to fynd_qr_app using(true) with check(true)', t);
    end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if exists(select 1 from pg_roles where rolname=r) then
        execute format('revoke all on fynd_qr.%I from %I', t, r);
      end if;
    end loop;
  end loop;
end $$;
commit;
