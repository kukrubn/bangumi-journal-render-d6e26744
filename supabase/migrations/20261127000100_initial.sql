-- 番剧手账 · 初始迁移。目标为新 Supabase 项目，通过 SQL Editor 或迁移工具执行一次。
-- 建表后由项目管理员在 README 的步骤中绑定本人 Auth UUID。绑定前业务数据默认不可访问。
begin;

create schema app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private, public to authenticated;

create type public.watch_state as enum ('watching', 'planned', 'completed', 'on_hold', 'dropped');
create type public.airing_state as enum ('upcoming', 'airing', 'finished', 'unknown');
create type public.release_pattern as enum ('weekly', 'irregular', 'unknown');

-- 最多一位所有者。客户端只能通过自己的 JWT 检查自己的绑定。
create table app_private.app_owner (
    singleton boolean primary key default true check (singleton),
    user_id uuid not null unique references auth.users(id) on delete cascade
);
alter table app_private.app_owner enable row level security;
revoke all on table app_private.app_owner from public, anon, authenticated;
grant select on table app_private.app_owner to authenticated;
create policy read_own_binding on app_private.app_owner for select to authenticated
    using (user_id = (select auth.uid()));

create function public.is_app_owner() returns boolean
language sql stable security invoker set search_path = '' as $$
    select exists (select 1 from app_private.app_owner where user_id = (select auth.uid()));
$$;
revoke all on function public.is_app_owner() from public, anon, authenticated;
grant execute on function public.is_app_owner() to authenticated;

create table public.user_settings (
    owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    minutes_per_episode smallint not null default 24 check (minutes_per_episode between 1 and 1440),
    theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0)
);

create table public.library_entries (
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    id uuid not null default gen_random_uuid(),
    bangumi_id integer check (bangumi_id > 0),
    title_cn text,
    title_original text,
    cover_url text check (cover_url ~* '^https?://[^/[:space:]?#]+[^[:space:]]*$'),
    platform text,
    meta_tags text[] not null default '{}',       -- Bangumi 维基标签
    community_tags text[] not null default '{}',  -- Bangumi 条目上的社区标签
    total_episodes integer check (total_episodes > 0),
    premiere_date date,
    end_date date,
    air_weekday smallint check (air_weekday between 1 and 7),  -- ISO，周一 = 1
    release_pattern public.release_pattern not null default 'unknown',
    airing_override public.airing_state,          -- NULL 时用日期、章节、周表推导
    calendar_seen_on date,
    metadata_fetched_at timestamptz,
    schedule_fetched_at timestamptz,
    locked_fields text[] not null default '{}',   -- 手动改过的来源字段，可逐项恢复跟随来源
    watch_status public.watch_state not null default 'planned',
    watched_episodes integer not null default 0 check (watched_episodes >= 0),
    personal_rating smallint check (personal_rating between 1 and 10),
    review text,
    last_watched_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    primary key (owner_id, id),
    unique (owner_id, bangumi_id),                -- NULL 允许多次出现，手动条目可以同名
    check (nullif(btrim(title_cn), '') is not null or nullif(btrim(title_original), '') is not null),
    check (end_date is null or premiere_date is null or end_date >= premiere_date),
    check (array_position(locked_fields, null) is null and locked_fields <@ array[
        'title_cn', 'title_original', 'cover_url', 'platform', 'meta_tags', 'community_tags',
        'total_episodes', 'premiere_date', 'end_date', 'air_weekday', 'release_pattern'
    ]::text[])
);
create index library_status_idx on public.library_entries(owner_id, watch_status, last_watched_at desc nulls last);
create index library_premiere_idx on public.library_entries(owner_id, premiere_date);
create index library_meta_tags_idx on public.library_entries using gin(meta_tags);

-- 只收本篇章节。sort 和 ep 都可能是小数，也可能使用跨季序号。
create table public.episode_schedule (
    owner_id uuid not null default auth.uid(),
    id uuid not null default gen_random_uuid(),
    entry_id uuid not null,
    bangumi_episode_id integer check (bangumi_episode_id > 0),
    sort_no numeric not null,
    episode_no numeric,
    title text,
    air_date date,
    manually_edited boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    primary key (owner_id, id),
    unique (owner_id, entry_id, bangumi_episode_id),
    foreign key (owner_id, entry_id) references public.library_entries(owner_id, id) on delete cascade,
    check (bangumi_episode_id is not null or manually_edited)
);
create index schedule_entry_date_idx on public.episode_schedule(owner_id, entry_id, air_date);

create table public.notes (
    owner_id uuid not null default auth.uid(),
    id uuid not null default gen_random_uuid(),
    entry_id uuid not null,
    body text,
    episode_number integer check (episode_number > 0),
    position_seconds integer check (position_seconds >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    primary key (owner_id, id),
    foreign key (owner_id, entry_id) references public.library_entries(owner_id, id) on delete cascade,
    check (nullif(btrim(body), '') is not null or episode_number is not null),
    check (position_seconds is null or episode_number is not null)
);
create index notes_entry_idx on public.notes(owner_id, entry_id, created_at desc);

create table public.watch_links (
    owner_id uuid not null default auth.uid(),
    id uuid not null default gen_random_uuid(),
    entry_id uuid not null,
    label text not null check (btrim(label) <> ''),
    url text not null check (url ~* '^https?://[^/[:space:]?#]+[^[:space:]]*$'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    primary key (owner_id, id),
    foreign key (owner_id, entry_id) references public.library_entries(owner_id, id) on delete cascade
);
create index links_entry_idx on public.watch_links(owner_id, entry_id);

create table public.personal_tags (
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    id uuid not null default gen_random_uuid(),
    name text not null check (btrim(name) <> '' and name = btrim(name)),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    primary key (owner_id, id)
);
create unique index tags_name_idx on public.personal_tags(owner_id, lower(name));

create table public.entry_tags (
    owner_id uuid not null default auth.uid(),
    entry_id uuid not null,
    tag_id uuid not null,
    primary key (owner_id, entry_id, tag_id),
    foreign key (owner_id, entry_id) references public.library_entries(owner_id, id) on delete cascade,
    foreign key (owner_id, tag_id) references public.personal_tags(owner_id, id) on delete cascade
);
create index tags_entries_idx on public.entry_tags(owner_id, tag_id, entry_id);

-- 下一次调用从已提交的 offset 继续。个人内容和该页游标由同一个事务提交。
create table public.sync_runs (
    owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    id uuid not null default gen_random_uuid(),
    username text not null check (btrim(username) <> '' and username = btrim(username)),
    state text not null default 'running' check (state in ('running', 'paused', 'done', 'cancelled')),
    next_offset integer not null default 0 check (next_offset >= 0),
    total_hint integer check (total_hint >= 0),
    added integer not null default 0 check (added >= 0),
    matched integer not null default 0 check (matched >= 0),
    skipped integer not null default 0 check (skipped >= 0),
    retry_at timestamptz,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    version bigint not null default 1 check (version > 0),
    primary key (owner_id, id)
);
create unique index sync_active_idx on public.sync_runs(owner_id, username) where state in ('running', 'paused');

-- 两张运行表留在未暴露给 Data API 的 schema 中。
create table app_private.progress_receipts (
    owner_id uuid not null default auth.uid(),
    entry_id uuid not null,
    request_id uuid not null,
    watched_after integer not null,
    total_at_action integer,
    version_after bigint not null,
    advanced boolean not null,
    suggest_completion boolean not null,
    primary key (owner_id, entry_id, request_id),
    foreign key (owner_id, entry_id) references public.library_entries(owner_id, id) on delete cascade
);

create table app_private.bangumi_gate (
    owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
    next_allowed_at timestamptz not null default '-infinity'
);

-- 每张业务表同时检查“绑定的本人”和“行的所有者”。WITH CHECK 也覆盖更新后的行。
do $$
declare
    target regclass;
begin
    foreach target in array array[
        'public.user_settings'::regclass, 'public.library_entries'::regclass,
        'public.episode_schedule'::regclass, 'public.notes'::regclass,
        'public.watch_links'::regclass, 'public.personal_tags'::regclass,
        'public.entry_tags'::regclass, 'public.sync_runs'::regclass,
        'app_private.progress_receipts'::regclass, 'app_private.bangumi_gate'::regclass
    ] loop
        execute format('alter table %s enable row level security', target);
        execute format('revoke all on table %s from public, anon, authenticated', target);
        execute format('create policy owner_rows on %s for all to authenticated
            using ((select public.is_app_owner()) and owner_id = (select auth.uid()))
            with check ((select public.is_app_owner()) and owner_id = (select auth.uid()))', target);
    end loop;
end;
$$;

grant select, insert, update, delete on table public.user_settings, public.library_entries,
    public.episode_schedule, public.notes, public.watch_links, public.personal_tags,
    public.entry_tags, public.sync_runs to authenticated;
grant select, insert on table app_private.progress_receipts to authenticated;
grant select, insert, update on table app_private.bangumi_gate to authenticated;

create function app_private.touch_version() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
    new.created_at := old.created_at;
    new.updated_at := clock_timestamp();
    new.version := old.version + 1;
    return new;
end;
$$;
revoke all on function app_private.touch_version() from public, anon, authenticated;

do $$
declare
    target regclass;
begin
    foreach target in array array[
        'public.user_settings'::regclass, 'public.library_entries'::regclass,
        'public.episode_schedule'::regclass, 'public.notes'::regclass,
        'public.watch_links'::regclass, 'public.personal_tags'::regclass, 'public.sync_runs'::regclass
    ] loop
        execute format('create trigger touch_version before update on %s
                        for each row execute function app_private.touch_version()', target);
    end loop;
end;
$$;

-- 同一条目的不同设备点击串行化。网络重试复用 request_id 后返回原回执。
create function public.increment_progress(p_entry_id uuid, p_request_id uuid)
returns table (watched_after integer, total_at_action integer, version_after bigint,
               advanced boolean, suggest_completion boolean, replayed boolean)
language plpgsql volatile security invoker set search_path = '' as $$
declare
    actor uuid := auth.uid();
    entry public.library_entries%rowtype;
    receipt app_private.progress_receipts%rowtype;
begin
    if not public.is_app_owner() then
        raise exception 'owner access required' using errcode = '42501';
    end if;
    if p_request_id is null or p_entry_id is null then
        raise exception 'entry_id and request_id are required' using errcode = '22004';
    end if;
    select e.* into entry from public.library_entries e
    where e.owner_id = actor and e.id = p_entry_id for update;
    if not found then
        raise exception 'entry not found' using errcode = 'P0002';
    end if;

    select r.* into receipt from app_private.progress_receipts r
    where r.owner_id = actor and r.entry_id = p_entry_id and r.request_id = p_request_id;
    if found then
        return query select receipt.watched_after, receipt.total_at_action, receipt.version_after,
                            receipt.advanced, receipt.suggest_completion, true;
        return;
    end if;

    receipt.advanced := entry.total_episodes is null or entry.watched_episodes < entry.total_episodes;
    if receipt.advanced then
        update public.library_entries e set watched_episodes = e.watched_episodes + 1,
                                             last_watched_at = clock_timestamp()
        where e.owner_id = actor and e.id = p_entry_id returning e.* into entry;
    end if;
    receipt.suggest_completion := receipt.advanced and entry.total_episodes is not null
        and entry.watched_episodes = entry.total_episodes and entry.watch_status <> 'completed';

    insert into app_private.progress_receipts
        (owner_id, entry_id, request_id, watched_after, total_at_action, version_after, advanced, suggest_completion)
    values (actor, p_entry_id, p_request_id, entry.watched_episodes, entry.total_episodes,
            entry.version, receipt.advanced, receipt.suggest_completion);
    return query select entry.watched_episodes, entry.total_episodes, entry.version,
                        receipt.advanced, receipt.suggest_completion, false;
end;
$$;
revoke all on function public.increment_progress(uuid, uuid) from public, anon, authenticated;
grant execute on function public.increment_progress(uuid, uuid) to authenticated;

-- 同一所有者的所有 Vercel 实例共享一次出站机会。传正秒数登记上游要求的冷却时间。
create function public.bangumi_request_slot(p_backoff_seconds integer default 0)
returns table (granted boolean, retry_at timestamptz)
language plpgsql volatile security invoker set search_path = '' as $$
declare
    actor uuid := auth.uid();
    next_at timestamptz;
    checked_at timestamptz;
begin
    if not public.is_app_owner() then
        raise exception 'owner access required' using errcode = '42501';
    end if;
    if p_backoff_seconds is null or p_backoff_seconds < 0 then
        raise exception 'backoff_seconds must be nonnegative' using errcode = '22023';
    end if;
    insert into app_private.bangumi_gate(owner_id) values (actor) on conflict do nothing;
    select g.next_allowed_at into strict next_at from app_private.bangumi_gate g
    where g.owner_id = actor for update;
    checked_at := clock_timestamp();

    if p_backoff_seconds > 0 then
        next_at := greatest(next_at, checked_at + make_interval(secs => p_backoff_seconds));
        update app_private.bangumi_gate set next_allowed_at = next_at where owner_id = actor;
        return query select false, next_at;
    elsif next_at > checked_at then
        return query select false, next_at;
    else
        next_at := checked_at + interval '1 second';
        update app_private.bangumi_gate set next_allowed_at = next_at where owner_id = actor;
        return query select true, next_at;
    end if;
end;
$$;
revoke all on function public.bangumi_request_slot(integer) from public, anon, authenticated;
grant execute on function public.bangumi_request_slot(integer) to authenticated;

commit;
