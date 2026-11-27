-- Phase 2. 单独执行于已完成 Phase 1 的项目。已有请求回执继续有效。
begin;

create or replace function public.increment_progress(p_entry_id uuid, p_request_id uuid)
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
        update public.library_entries e
        set watched_episodes = e.watched_episodes + 1,
            watch_status = case when e.watch_status = 'planned' then 'watching'::public.watch_state else e.watch_status end,
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

commit;
