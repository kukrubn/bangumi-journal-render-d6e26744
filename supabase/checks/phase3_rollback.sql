-- 在 SQL Editor 中使用已绑定的所有者运行。测试行和临时 JWT 设置都会回滚。
begin;
do $$
declare actor uuid;
begin
    select user_id into strict actor from app_private.app_owner;
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub',actor,'role','authenticated')::text,true);
end;
$$;
set local role authenticated;
do $$
declare
    e uuid;
    source_id integer := 2147483647;
    outsider uuid := gen_random_uuid();
    t uuid;
    stamp timestamptz;
    snapshot jsonb;
    tag_name text := 'P3-' || gen_random_uuid();
    data jsonb := '[{"id":11,"episode_no":1,"sort_no":26,"air_date":"2026-11-10"},
                    {"id":12,"episode_no":2,"sort_no":27,"air_date":"2026-11-17"},
                    {"id":13,"episode_no":3,"sort_no":28,"air_date":null}]';
begin
    -- Pick an unused source ID even when running in an existing library.
    while exists(select 1 from public.library_entries where bangumi_id=source_id) loop
        source_id := source_id - 1;
    end loop;
    insert into public.library_entries(bangumi_id,title_cn,air_weekday,locked_fields)
       values(source_id,'Phase 3 验收',4,array['air_weekday']) returning id into e;
    t := public.attach_entry_tag(e,tag_name);
    if public.attach_entry_tag(e,'  '||lower(tag_name)||'  ') <> t then raise exception '重复标签未复用'; end if;
    insert into public.notes(entry_id,body,episode_number,position_seconds) values(e,'高能',6,860),(e,null,1,0);
    insert into public.watch_links(entry_id,label,url) values(e,'播放','https://example.org/watch');
    if not public.replace_episode_schedule(e,source_id,null,data,2) then raise exception '章节写入失败'; end if;
    select schedule_fetched_at into strict stamp from public.library_entries where id=e;
    if (select air_weekday from public.library_entries where id=e) <> 4 then raise exception '覆盖了锁定星期'; end if;
    update public.episode_schedule set manually_edited=true,air_date='2026-11-19' where entry_id=e and bangumi_episode_id=12;
    if public.replace_episode_schedule(e,source_id,null,'[]',null) then raise exception '旧快照覆盖了新排期'; end if;
    -- 本人用本季集号 1 建的手动排期，与来源的跨季排序号 26 对应。
    insert into public.episode_schedule(entry_id,sort_no,air_date,manually_edited) values(e,1,'2026-11-12',true);
    perform public.replace_episode_schedule(e,source_id,stamp,data,null);
    if (select count(*) from public.episode_schedule where entry_id=e) <> 3 or
       exists(select 1 from public.episode_schedule where entry_id=e and bangumi_episode_id=11) then
        raise exception '跨季手动排期被重复计数'; end if;
    select schedule_fetched_at into strict stamp from public.library_entries where id=e;
    if not public.replace_episode_schedule(e,source_id,stamp,'[{"id":12,"episode_no":2,"sort_no":27,"air_date":"2026-11-17"}]',null)
       then raise exception '新排期写入失败'; end if;
    if (select count(*) from public.episode_schedule where entry_id=e) <> 2 or
       (select air_date from public.episode_schedule where entry_id=e and bangumi_episode_id=12) is distinct from '2026-11-19'::date then raise exception '改期或手动修订未保留'; end if;
    snapshot := public.library_journal_index();
    if jsonb_array_length(snapshot->'notes'->e::text) is distinct from 2 or jsonb_array_length(snapshot->'links'->e::text) is distinct from 1 or
       jsonb_array_length(snapshot->'assignments'->e::text) is distinct from 1 or jsonb_array_length(snapshot->'episodes'->e::text) is distinct from 2
       then raise exception '手记索引内容错误'; end if;
    delete from public.library_entries where id=e;
    if (public.library_journal_index()->'notes') ? e::text or exists(select 1 from public.entry_tags where entry_id=e)
       or not exists(select 1 from public.personal_tags where id=t) then raise exception '删除关联处理失败'; end if;
    perform set_config('request.jwt.claim.sub',outsider::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
    if public.library_journal_index() <> '{"notes":{},"links":{},"tags":[],"assignments":{},"episodes":{}}'::jsonb then
        raise exception '非所有者能读到手记';
    end if;
    begin
        perform public.attach_entry_tag(e,'未授权');
        raise exception '非所有者能写入标签';
    exception when insufficient_privilege then null; end;
    begin
        perform public.replace_episode_schedule(e,source_id,null,'[]',null);
        raise exception '非所有者能写入放送日程';
    exception when insufficient_privilege then null; end;
    if has_function_privilege('anon','public.library_journal_index()','execute') then raise exception '匿名访问未被限制'; end if;
end;
$$;
rollback;
select 'Phase 3 PASS' as result;
