begin;

-- One page, including all accepted rows, counters and the next offset, is a single transaction.
create or replace function public.apply_collection_page(
    p_run_id uuid, p_offset integer, p_count integer, p_total integer, p_rows jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
    actor uuid := auth.uid();
    job public.sync_runs%rowtype;
    current_entry public.library_entries%rowtype;
    candidate public.library_entries%rowtype;
    item jsonb;
    changes jsonb;
    source_id integer;
    inserted integer := 0;
    matched_rows integer := 0;
begin
    if not public.is_app_owner() then raise insufficient_privilege; end if;
    select * into strict job from public.sync_runs where owner_id=actor and id=p_run_id for update;
    if job.state <> 'running' or job.next_offset <> p_offset then return to_jsonb(job); end if;
    if p_count is null or p_count not between 0 and 20 or p_total is null or p_total < 0
       or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>p_count then
        raise exception 'invalid page' using errcode='22023';
    end if;
    -- Lock in stable Bangumi ID order when two different usernames share titles.
    for item in select value from jsonb_array_elements(p_rows) order by (value->>'id')::integer loop
        source_id := (item->>'id')::integer;
        changes := item->'patch';
        select * into current_entry from public.library_entries
          where owner_id=actor and bangumi_id=source_id for update;
        if found then
            if current_entry.version is distinct from (item->>'version')::bigint then
                raise exception 'shelf changed' using errcode='40001';
            end if;
            if changes <> '{}'::jsonb then
                candidate := jsonb_populate_record(current_entry,changes);
                update public.library_entries set
                    title_cn=candidate.title_cn,title_original=candidate.title_original,cover_url=candidate.cover_url,
                    platform=candidate.platform,meta_tags=candidate.meta_tags,community_tags=candidate.community_tags,
                    total_episodes=candidate.total_episodes,premiere_date=candidate.premiere_date,end_date=candidate.end_date,
                    watch_status=candidate.watch_status,watched_episodes=candidate.watched_episodes,
                    personal_rating=candidate.personal_rating,review=candidate.review
                  where owner_id=actor and id=current_entry.id;
            end if;
            matched_rows:=matched_rows+1;
        else
            if item->>'version' is not null then raise exception 'shelf changed' using errcode='40001'; end if;
            candidate:=jsonb_populate_record(null::public.library_entries,changes);
            insert into public.library_entries(owner_id,bangumi_id,title_cn,title_original,cover_url,platform,meta_tags,
                community_tags,total_episodes,premiere_date,end_date,watch_status,watched_episodes,personal_rating,review)
            values(actor,source_id,candidate.title_cn,candidate.title_original,candidate.cover_url,candidate.platform,
                coalesce(candidate.meta_tags,'{}'),coalesce(candidate.community_tags,'{}'),candidate.total_episodes,
                candidate.premiere_date,candidate.end_date,candidate.watch_status,coalesce(candidate.watched_episodes,0),
                candidate.personal_rating,candidate.review)
            on conflict(owner_id,bangumi_id) do nothing;
            if not found then raise exception 'shelf changed' using errcode='40001'; end if;
            inserted:=inserted+1;
        end if;
    end loop;
    update public.sync_runs set next_offset=p_offset+p_count,total_hint=p_total,
        added=added+inserted,matched=matched+matched_rows,skipped=skipped+p_count-inserted-matched_rows,
        state=case when p_count=0 or p_offset+p_count>=p_total then 'done' else 'running' end,
        retry_at=null,last_error=null
    where owner_id=actor and id=p_run_id returning * into job;
    return to_jsonb(job);
end;
$$;
revoke all on function public.apply_collection_page(uuid,integer,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.apply_collection_page(uuid,integer,integer,integer,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
