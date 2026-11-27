-- SQL Editor 中以管理员执行。使用已绑定的 UID，所有测试数据在末尾回滚。
begin;
do $$
declare actor uuid;
begin
    select user_id into strict actor from app_private.app_owner;
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub',actor,'role','authenticated')::text, true);
end;
$$;
set local role authenticated;
do $$
declare
    film uuid;
    op uuid := gen_random_uuid();
    result record;
    state public.watch_state;
begin
    insert into public.library_entries(title_cn,total_episodes) values ('单集番验收',1) returning id into film;
    select * into strict result from public.increment_progress(film,op);
    select watch_status into state from public.library_entries where id=film;
    if state <> 'watching' or result.watched_after <> 1 or not result.advanced or not result.suggest_completion then
        raise exception '单集想看番的首次观看或完结提示失败';
    end if;
    select * into strict result from public.increment_progress(film,op);
    if not result.replayed or result.watched_after <> 1 or not result.suggest_completion then raise exception '原回执重放失败'; end if;
    update public.library_entries set watch_status='planned' where id=film;
    select * into strict result from public.increment_progress(film,gen_random_uuid());
    if result.advanced or result.suggest_completion or (select watch_status from public.library_entries where id=film)<>'planned' then
        raise exception '封顶时不应改变状态';
    end if;
    foreach state in array array['planned','watching','completed','on_hold','dropped']::public.watch_state[] loop
        insert into public.library_entries(title_cn,watch_status) values ('未知集数验收',state) returning id into film;
        select * into strict result from public.increment_progress(film,gen_random_uuid());
        if not result.advanced or result.suggest_completion or result.total_at_action is not null
           or (select watch_status from public.library_entries where id=film) <> (case when state='planned' then 'watching'::public.watch_state else state end)
        then raise exception '未知总数或其他观看状态处理失败'; end if;
    end loop;
end;
$$;
rollback;
select 'Phase 2 PASS' as result;
