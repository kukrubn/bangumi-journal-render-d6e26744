-- 在 SQL Editor 中，用项目管理员身份整份运行。前置条件为迁移成功且绑定了本人 Auth UUID。
-- 用事务内的模拟身份检查真实数据库策略。所有测试行、进度和限流变动在末尾回滚。
begin;

do $$
declare
    bound_id uuid;
begin
    select user_id into strict bound_id from app_private.app_owner;
    perform set_config('phase1.owner', bound_id::text, true);
    perform set_config('phase1.other', gen_random_uuid()::text, true);
    perform set_config('phase1.entry', gen_random_uuid()::text, true);
exception when no_data_found then
    raise exception '请先在 SQL Editor 中绑定自己的 Auth UUID，再运行本验收文件';
end;
$$;

set local role authenticated;
do $$
declare
    actor uuid := current_setting('phase1.owner')::uuid;
    outsider uuid := current_setting('phase1.other')::uuid;
    entry_id_test uuid := current_setting('phase1.entry')::uuid;
    manual_id uuid;
    tag_id_test uuid;
    request_id_test uuid := gen_random_uuid();
    external_id integer;
    result record;
    stored_version bigint;
    affected integer;
begin
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
    if not public.is_app_owner() then raise exception 'owner binding failed'; end if;

    select n into strict external_id from generate_series(2000000000, 2000001000) n
        where not exists (select 1 from public.library_entries e where e.bangumi_id = n) limit 1;
    insert into public.library_entries(id, bangumi_id, title_cn, total_episodes, watch_status)
        values (entry_id_test, external_id, '验收条目', 2, 'watching');
    begin
        insert into public.library_entries(bangumi_id, title_original) values (external_id, 'Other title');
        raise exception 'duplicate source id accepted';
    exception when unique_violation then null; end;
    insert into public.library_entries(title_cn) values ('同名手动条目') returning id into manual_id;
    insert into public.library_entries(title_cn) values ('同名手动条目');
    select * into strict result from public.increment_progress(manual_id, gen_random_uuid());
    if result.watched_after <> 1 or result.total_at_action is not null or result.suggest_completion then
        raise exception 'unknown total handled incorrectly';
    end if;

    select * into strict result from public.increment_progress(entry_id_test, request_id_test);
    if result.watched_after <> 1 or not result.advanced or result.suggest_completion or result.replayed then
        raise exception 'first increment failed';
    end if;
    select * into strict result from public.increment_progress(entry_id_test, request_id_test);
    if result.watched_after <> 1 or not result.replayed then raise exception 'retry incremented twice'; end if;
    select * into strict result from public.increment_progress(entry_id_test, gen_random_uuid());
    if result.watched_after <> 2 or not result.suggest_completion then raise exception 'finale prompt missing'; end if;
    stored_version := result.version_after;
    select * into strict result from public.increment_progress(entry_id_test, gen_random_uuid());
    if result.advanced or result.watched_after <> 2 or result.suggest_completion then raise exception 'cap failed'; end if;
    if (select e.watch_status from public.library_entries e where e.id = entry_id_test) <> 'watching' then
        raise exception 'progress changed watch state without confirmation';
    end if;
    update public.library_entries set watch_status = 'completed', personal_rating = 9
        where id = entry_id_test and version = stored_version;
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'confirmation failed'; end if;
    update public.library_entries set personal_rating = 5 where id = entry_id_test and version = stored_version;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'stale edit accepted'; end if;
    begin
        update public.library_entries set personal_rating = 11 where id = entry_id_test;
        raise exception 'accepted invalid rating';
    exception when check_violation then null; end;
    update public.library_entries set total_episodes = 1, locked_fields = array['total_episodes'] where id = entry_id_test;
    select * into strict result from public.increment_progress(entry_id_test, gen_random_uuid());
    if result.advanced or result.watched_after <> 2 then raise exception 'total correction lost history'; end if;
    begin
        update public.library_entries set owner_id = outsider where id = manual_id;
        raise exception 'owner could reassign record';
    exception when insufficient_privilege then null; end;

    insert into public.user_settings(owner_id) values (actor) on conflict do nothing;
    insert into public.episode_schedule(entry_id, sort_no, episode_no, air_date, manually_edited)
        values (entry_id_test, 1, 1, current_date, true);
    insert into public.notes(entry_id, episode_number, position_seconds, body)
        values (entry_id_test, 6, 860, '第 6 集 14:20');
    insert into public.watch_links(entry_id, label, url) values (entry_id_test, '验收播放页', 'https://example.org/watch');
    insert into public.personal_tags(name) values ('验收-' || entry_id_test) returning id into tag_id_test;
    insert into public.entry_tags(entry_id, tag_id) values (entry_id_test, tag_id_test);
    insert into public.sync_runs(username) values ('phase1-' || entry_id_test);
    select * into strict result from public.bangumi_request_slot(30);
    if result.granted then raise exception 'cooldown granted a slot'; end if;
    select * into strict result from public.bangumi_request_slot();
    if result.granted then raise exception 'cooldown ignored'; end if;
end;
$$;

-- 同样具有 authenticated 角色，换成另一个 sub 后，所有业务表都应为空。
do $$
declare
    outsider uuid := current_setting('phase1.other')::uuid;
    entry_id_test uuid := current_setting('phase1.entry')::uuid;
    target regclass;
    visible_rows bigint;
    affected integer;
begin
    perform set_config('request.jwt.claim.sub', outsider::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
    if public.is_app_owner() then raise exception 'outsider passed owner check'; end if;
    foreach target in array array[
        'public.user_settings'::regclass, 'public.library_entries'::regclass, 'public.episode_schedule'::regclass,
        'public.notes'::regclass, 'public.watch_links'::regclass, 'public.personal_tags'::regclass,
        'public.entry_tags'::regclass, 'public.sync_runs'::regclass, 'app_private.app_owner'::regclass,
        'app_private.progress_receipts'::regclass, 'app_private.bangumi_gate'::regclass
    ] loop
        execute format('select count(*) from %s', target) into visible_rows;
        if visible_rows <> 0 then raise exception 'outsider could read %', target; end if;
    end loop;
    begin
        insert into app_private.app_owner(user_id) values (outsider);
        raise exception 'outsider could bind an account';
    exception when insufficient_privilege then null; end;
    begin
        insert into public.library_entries(title_cn) values ('越权自建');
        raise exception 'outsider could create their own library';
    exception when insufficient_privilege then null; end;
    begin
        insert into public.notes(owner_id, entry_id, body) values (current_setting('phase1.owner')::uuid, entry_id_test, '越权');
        raise exception 'outsider could attach note';
    exception when insufficient_privilege then null; end;
    update public.library_entries set review = '越权' where id = entry_id_test;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'outsider could update entry'; end if;
    delete from public.library_entries where id = entry_id_test;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'outsider could delete entry'; end if;
    begin
        perform public.increment_progress(entry_id_test, gen_random_uuid());
        raise exception 'outsider could increment';
    exception when insufficient_privilege then null; end;
    begin
        perform public.bangumi_request_slot();
        raise exception 'outsider could reserve upstream traffic';
    exception when insufficient_privilege then null; end;
end;
$$;

reset role;
set local role anon;
do $$
begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);
    begin
        perform 1 from public.library_entries;
        raise exception 'anonymous could read';
    exception when insufficient_privilege then null; end;
    begin
        insert into public.library_entries(title_cn) values ('未登录');
        raise exception 'anonymous could insert';
    exception when insufficient_privilege then null; end;
    begin
        perform public.is_app_owner();
        raise exception 'anonymous could call owner RPC';
    exception when insufficient_privilege then null; end;
    begin
        perform public.increment_progress(gen_random_uuid(), gen_random_uuid());
        raise exception 'anonymous could increment';
    exception when insufficient_privilege then null; end;
end;
$$;

reset role;
set local role authenticated;
do $$
declare
    actor uuid := current_setting('phase1.owner')::uuid;
    entry_id_test uuid := current_setting('phase1.entry')::uuid;
    target regclass;
    remaining bigint;
begin
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', actor, 'role', 'authenticated')::text, true);
    delete from public.library_entries where id = entry_id_test;
    if not found then raise exception 'owner delete failed'; end if;
    foreach target in array array['public.notes'::regclass, 'public.watch_links'::regclass,
        'public.episode_schedule'::regclass, 'public.entry_tags'::regclass, 'app_private.progress_receipts'::regclass]
    loop
        execute format('select count(*) from %s where entry_id = $1', target) into remaining using entry_id_test;
        if remaining <> 0 then raise exception 'orphan rows in %', target; end if;
    end loop;
end;
$$;

rollback;
select 'Phase 1 PASS' as result;
