begin;

-- One MVCC snapshot for every table. Stable row ordering makes the revision reproducible.
create or replace function public.backup_snapshot() returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
    snapshot jsonb;
    actor uuid := auth.uid();
begin
    if not public.is_app_owner() then raise insufficient_privilege; end if;
    select jsonb_build_object(
        'user_settings', coalesce((select jsonb_agg(to_jsonb(r)-'owner_id') from public.user_settings r where owner_id=actor),'[]'),
        'library_entries',coalesce((select jsonb_agg(to_jsonb(r)-'owner_id' order by id) from public.library_entries r where owner_id=actor),'[]'),
        'personal_tags', coalesce((select jsonb_agg(to_jsonb(r)-'owner_id' order by id) from public.personal_tags r where owner_id=actor),'[]'),
        'episode_schedule', coalesce((select jsonb_agg(to_jsonb(r)-'owner_id' order by id) from public.episode_schedule r where owner_id=actor),'[]'),
        'notes', coalesce((select jsonb_agg(to_jsonb(r)-'owner_id' order by id) from public.notes r where owner_id=actor),'[]'),
        'watch_links', coalesce((select jsonb_agg(to_jsonb(r)-'owner_id' order by id) from public.watch_links r where owner_id=actor),'[]'),
        'entry_tags', coalesce((select jsonb_agg(to_jsonb(r)-'owner_id' order by entry_id,tag_id) from public.entry_tags r where owner_id=actor),'[]')
    ) into snapshot;
    return jsonb_build_object('tables',snapshot,'revision',md5(snapshot::text));
end;
$$;

-- The private shelf has one owner. Block competing ordinary writes for the short
-- verification / merge transaction; a concurrent view can continue to read its snapshot.
create or replace function public.restore_backup(p_changes jsonb, p_revision text) returns integer
language plpgsql volatile security invoker set search_path = '' as $$
declare
    actor uuid := auth.uid();
    target text;
    dataset jsonb;
    columns_to_update text;
    conflict_clause text;
    count_table integer;
    count_total integer := 0;
begin
    if not public.is_app_owner() then raise insufficient_privilege; end if;
    lock table public.library_entries, public.user_settings, public.personal_tags, public.episode_schedule,
        public.notes, public.watch_links, public.entry_tags in share row exclusive mode;
    if public.backup_snapshot()->>'revision' is distinct from p_revision then
        raise exception 'Backup preview is stale' using errcode='40001';
    end if;
    foreach target in array array['user_settings','library_entries','personal_tags','episode_schedule','notes','watch_links','entry_tags'] loop
        dataset := p_changes->target;
        if jsonb_typeof(dataset) is distinct from 'array' then raise exception 'Invalid restore table %',target using errcode='22023'; end if;
        if jsonb_array_length(dataset)=0 then continue; end if;
        if target = 'entry_tags' then
            conflict_clause := 'on conflict (owner_id,entry_id,tag_id) do nothing';
        else
            -- All identifiers derive from the fixed table list and the local catalog.
            select string_agg(format('%1$I=excluded.%1$I',attname),',' order by attnum)
                into columns_to_update from pg_catalog.pg_attribute
                where attrelid=format('public.%I',target)::regclass and attnum>0 and not attisdropped
                  and attname not in ('owner_id','id','entry_id','created_at','updated_at','version');
            conflict_clause := format('on conflict (%s) do update set %s',
                case when target='user_settings' then 'owner_id' else 'owner_id,id' end,columns_to_update);
        end if;
        execute format(
            'insert into public.%1$I select rowdata.* from jsonb_array_elements($1) as src(item)
             cross join lateral jsonb_populate_record(null::public.%1$I,src.item || jsonb_build_object(''owner_id'',$2)) rowdata %2$s',
            target, conflict_clause) using dataset,actor;
        get diagnostics count_table=row_count;
        count_total := count_total+count_table;
    end loop;
    return count_total;
end;
$$;
revoke all on function public.backup_snapshot(), public.restore_backup(jsonb,text) from public,anon,authenticated;
grant execute on function public.backup_snapshot(), public.restore_backup(jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;
