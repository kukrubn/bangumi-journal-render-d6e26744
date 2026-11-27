begin;

-- All three functions run with the caller's privileges and the existing owner RLS.
create or replace function public.attach_entry_tag(p_entry_id uuid, p_name text) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
    actor uuid := auth.uid();
    tag uuid;
begin
    if not public.is_app_owner() then raise insufficient_privilege; end if;
    perform 1 from public.library_entries where owner_id=actor and id=p_entry_id for key share;
    if not found then raise no_data_found; end if;
    insert into public.personal_tags(owner_id, name) values (actor, btrim(p_name))
    on conflict (owner_id, (lower(name))) do nothing returning id into tag;
    if tag is null then
        select id into strict tag from public.personal_tags
        where owner_id=actor and lower(name)=lower(btrim(p_name)) for key share;
    end if;
    insert into public.entry_tags(owner_id,entry_id,tag_id) values (actor,p_entry_id,tag)
    on conflict (owner_id,entry_id,tag_id) do nothing;
    return tag;
end;
$$;

-- Publish only a complete source snapshot. A slow request cannot replace a newer snapshot.
create or replace function public.replace_episode_schedule(
    p_entry_id uuid, p_bangumi_id integer, p_previous_fetch timestamptz default null,
    p_episodes jsonb default null, p_calendar_weekday integer default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
    actor uuid := auth.uid();
    entry public.library_entries%rowtype;
begin
    if not public.is_app_owner() then raise insufficient_privilege; end if;
    select * into strict entry from public.library_entries where owner_id=actor and id=p_entry_id for update;
    if entry.bangumi_id is null or entry.bangumi_id is distinct from p_bangumi_id
       or entry.schedule_fetched_at is distinct from p_previous_fetch then return false; end if;
    if jsonb_typeof(p_episodes) is distinct from 'array' or p_calendar_weekday not between 1 and 7 then
        raise exception 'Invalid schedule snapshot' using errcode='22023';
    end if;

    with source as materialized (
        select ep.* from jsonb_to_recordset(p_episodes) as ep(id integer,sort_no numeric,episode_no numeric,title text,air_date date)
        where not exists (select 1 from public.episode_schedule m
            where m.owner_id=actor and m.entry_id=p_entry_id and m.manually_edited and m.bangumi_episode_id is null
              and (m.sort_no=ep.sort_no or coalesce(m.episode_no,m.sort_no)=ep.episode_no))
    ), obsolete as (
        delete from public.episode_schedule s
        where s.owner_id=actor and s.entry_id=p_entry_id and not s.manually_edited
          and not exists (select 1 from source where source.id=s.bangumi_episode_id)
    )
    insert into public.episode_schedule as s(owner_id,entry_id,bangumi_episode_id,sort_no,episode_no,title,air_date)
    select actor,p_entry_id,ep.id,ep.sort_no,ep.episode_no,ep.title,ep.air_date
    from source ep
    on conflict (owner_id,entry_id,bangumi_episode_id) do update
    set sort_no=excluded.sort_no, episode_no=excluded.episode_no, title=excluded.title, air_date=excluded.air_date
    where not s.manually_edited and (s.sort_no,s.episode_no,s.title,s.air_date)
             is distinct from (excluded.sort_no,excluded.episode_no,excluded.title,excluded.air_date);

    update public.library_entries set
        schedule_fetched_at=clock_timestamp(),
        calendar_seen_on=case when p_calendar_weekday is not null then (now() at time zone 'Asia/Shanghai')::date else calendar_seen_on end,
        air_weekday=case when p_calendar_weekday is not null and not ('air_weekday'=any(locked_fields))
                         then p_calendar_weekday else air_weekday end,
        release_pattern=case when p_calendar_weekday is not null and not ('release_pattern'=any(locked_fields))
                             then 'weekly'::public.release_pattern else release_pattern end
    where owner_id=actor and id=p_entry_id;
    return true;
end;
$$;

-- One consistent, owner-scoped index for the private shelf, including collections over the REST row limit.
create or replace function public.library_journal_index() returns jsonb
language sql stable security invoker set search_path = '' as $$
    select jsonb_build_object(
        'notes', coalesce((select jsonb_object_agg(entry_id,items) from (
            select entry_id,jsonb_agg(jsonb_build_object('id',id,'body',body,'episode_number',episode_number,
                  'position_seconds',position_seconds,'created_at',created_at,'version',version) order by created_at desc,id) items
            from public.notes where owner_id=(select auth.uid()) group by entry_id) n),'{}'),
        'links', coalesce((select jsonb_object_agg(entry_id,items) from (
            select entry_id,jsonb_agg(jsonb_build_object('id',id,'label',label,'url',url,'version',version) order by created_at,id) items
            from public.watch_links where owner_id=(select auth.uid()) group by entry_id) l),'{}'),
        'tags', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by lower(name),id)
            from public.personal_tags where owner_id=(select auth.uid())),'[]'),
        'assignments', coalesce((select jsonb_object_agg(entry_id,items) from (
            select entry_id,jsonb_agg(tag_id order by tag_id) items from public.entry_tags
            where owner_id=(select auth.uid()) group by entry_id) t),'{}'),
        'episodes', coalesce((select jsonb_object_agg(entry_id,items) from (
            select entry_id,jsonb_agg(jsonb_build_object('sort_no',sort_no,'episode_no',episode_no,'air_date',air_date)
                   order by sort_no,id) items
            from public.episode_schedule where owner_id=(select auth.uid()) group by entry_id) s),'{}')
    );
$$;

revoke all on function public.attach_entry_tag(uuid,text),
    public.replace_episode_schedule(uuid,integer,timestamptz,jsonb,integer),
    public.library_journal_index() from public,anon,authenticated;
grant execute on function public.attach_entry_tag(uuid,text),
    public.replace_episode_schedule(uuid,integer,timestamptz,jsonb,integer),
    public.library_journal_index() to authenticated;
notify pgrst,'reload schema';
commit;
