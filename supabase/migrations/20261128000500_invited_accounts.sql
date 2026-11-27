begin;

-- The original singleton / its auth.users row remain the administrator and keep their existing shelf.
create table app_private.accounts (
    uid uuid primary key references auth.users(id) on delete cascade,
    email text not null unique check (email = lower(btrim(email)) and length(email) <= 254
        and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        and (email not like '%@members.invalid' or email ~ '^bj-[0-9a-f]{16}@members\.invalid$')),
    password_hash text not null check (password_hash ~ '^[0-9a-f]{32}:[0-9a-f]{128}$'),
    created_at timestamptz not null default now()
);

create table app_private.invites (
    id uuid primary key default gen_random_uuid(),
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null check (expires_at > created_at and isfinite(expires_at)),
    used_at timestamptz,
    used_by uuid references auth.users(id) on delete set null,
    revoked_at timestamptz,
    check (used_at is null or revoked_at is null)
);
alter table app_private.accounts enable row level security;
alter table app_private.invites enable row level security;
revoke all on app_private.accounts, app_private.invites from public, anon, authenticated;

-- This legacy RPC signals whether *this subject* owns a shelf. Every table policy still
-- requires owner_id = auth.uid(); administration exclusively checks the original singleton below.
create or replace function public.is_app_owner() returns boolean
language sql stable security definer set search_path = '' as $$
    select exists (select from app_private.app_owner where user_id = (select auth.uid()))
        or exists (select from app_private.accounts where uid = (select auth.uid()));
$$;
revoke all on function public.is_app_owner() from public, anon, authenticated;
grant execute on function public.is_app_owner() to authenticated;

-- These functions are called only by the trusted server login, outside SET ROLE authenticated.
-- The server derives p_actor from a verified session, never from an HTTP argument.
create function app_private.require_invite_admin(p_actor uuid) returns void
language plpgsql stable security invoker set search_path = '' as $$
begin
    if not exists (select from app_private.app_owner where user_id = p_actor) then
        raise insufficient_privilege;
    end if;
end;
$$;

create function app_private.create_invite(p_actor uuid, p_token_hash text, p_expires_at timestamptz)
returns table (id uuid, created_at timestamptz, expires_at timestamptz, used_at timestamptz, revoked_at timestamptz)
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform app_private.require_invite_admin(p_actor);
    if p_expires_at is null or p_expires_at <= clock_timestamp() or not isfinite(p_expires_at) then
        raise exception 'Invalid invite expiry' using errcode='22023';
    end if;
    return query insert into app_private.invites as i(token_hash, expires_at) values (p_token_hash, p_expires_at)
        returning i.id, i.created_at, i.expires_at, i.used_at, i.revoked_at;
end;
$$;

create function app_private.list_invites(p_actor uuid)
returns table (id uuid, created_at timestamptz, expires_at timestamptz, used_at timestamptz, revoked_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
    perform app_private.require_invite_admin(p_actor);
    return query select i.id,i.created_at,i.expires_at,i.used_at,i.revoked_at from app_private.invites i
        order by i.created_at desc,i.id;
end;
$$;

create function app_private.revoke_invite(p_actor uuid, p_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform app_private.require_invite_admin(p_actor);
    update app_private.invites set revoked_at=clock_timestamp()
        where id=p_id and used_at is null and revoked_at is null and expires_at>clock_timestamp();
    return found;
end;
$$;

create function app_private.invite_available(p_token_hash text) returns boolean
language sql volatile security definer set search_path = '' as $$
    select exists(select from app_private.invites where token_hash=p_token_hash
        and used_at is null and revoked_at is null and expires_at>clock_timestamp());
$$;

create function app_private.redeem_invite(p_token_hash text, p_email text, p_password_hash text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
    account_uid uuid := gen_random_uuid();
    invite_id uuid;
begin
    -- Lock the invite before admitting the user. Conflicting emails/invalid hashes roll back
    -- the inventory, auth.users and membership changes as one unit.
    select id into invite_id from app_private.invites where token_hash=p_token_hash for update;
    if not found or not app_private.invite_available(p_token_hash) then raise no_data_found; end if;
    insert into auth.users(id) values(account_uid);
    update app_private.invites set used_at=clock_timestamp(),used_by=account_uid
        where id=invite_id and expires_at>clock_timestamp();
    if not found then raise no_data_found; end if;
    insert into app_private.accounts(uid,email,password_hash)
        values(account_uid,lower(btrim(p_email)),p_password_hash);
    return account_uid;
end;
$$;

create function app_private.account_by_email(p_email text)
returns table(uid uuid, email text, password_hash text)
language sql stable security definer set search_path = '' as $$
    select a.uid,a.email,a.password_hash from app_private.accounts a where a.email=lower(btrim(p_email));
$$;

create function app_private.account_by_uid(p_uid uuid)
returns table(uid uuid, email text, password_hash text)
language sql stable security definer set search_path = '' as $$
    select a.uid,a.email,a.password_hash from app_private.accounts a where a.uid=p_uid;
$$;

revoke all on function app_private.require_invite_admin(uuid),
    app_private.create_invite(uuid,text,timestamptz),app_private.list_invites(uuid),app_private.revoke_invite(uuid,uuid),
    app_private.invite_available(text),app_private.redeem_invite(text,text,text),app_private.account_by_email(text),app_private.account_by_uid(uuid)
    from public,anon,authenticated;

-- Local PostgREST and historical Supabase installations have no cloud installation record.
-- Never grant these functions to a shared gateway, anonymous role or ordinary account.
do $$
declare
    runtime name;
begin
    if to_regclass('journal_cloud.installation') is not null then
        select r.rolname into strict runtime from journal_cloud.installation i
            join pg_catalog.pg_roles r on r.oid=i.runtime_role where i.singleton
            and r.rolcanlogin and not r.rolsuper and not r.rolbypassrls and not r.rolinherit;
        execute format('grant usage on schema app_private to %I',runtime);
        execute format('grant execute on function app_private.create_invite(uuid,text,timestamptz),
            app_private.list_invites(uuid),app_private.revoke_invite(uuid,uuid),app_private.invite_available(text),app_private.redeem_invite(text,text,text),
            app_private.account_by_email(text),app_private.account_by_uid(uuid) to %I',runtime);
    end if;
end;
$$;
notify pgrst,'reload schema';
commit;
