-- 在已有所有者绑定的 SQL Editor 上运行，总事务结束回滚。
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
    run_id uuid;
    source_id integer:=2147483646;
    payload jsonb;
    job jsonb;
    v bigint;
    outsider uuid:=gen_random_uuid();
begin
    while exists(select 1 from public.library_entries where bangumi_id in (source_id,source_id+1)) loop
        source_id:=source_id-1;
    end loop;
    insert into public.sync_runs(username) values('sync-qa-'||gen_random_uuid()) returning id into run_id;
    payload:=jsonb_build_array(jsonb_build_object('id',source_id,'version',null,
        'patch',jsonb_build_object('title_cn','收藏验收','watch_status','watching','watched_episodes',5)));
    job:=public.apply_collection_page(run_id,0,2,5,payload);
    if (job->>'next_offset')::int<>2 or (job->>'added')::int<>1 or (job->>'skipped')::int<>1 then raise exception '首次分页失败'; end if;
    if exists(select 1 from public.library_entries where bangumi_id=source_id and metadata_fetched_at is not null)
      then raise exception '摘要误标为完整详情'; end if;
    job:=public.apply_collection_page(run_id,0,2,5,payload);
    if (job->>'next_offset')::int<>2 or (job->>'added')::int<>1 then raise exception '重复分页错误推进'; end if;
    update public.library_entries set review='保留短评',watched_episodes=7 where bangumi_id=source_id returning version into v;
    payload:=jsonb_build_array(
      jsonb_build_object('id',source_id,'version',v,'patch',jsonb_build_object('platform','TV')),
      jsonb_build_object('id',source_id+1,'version',999,'patch','{}'::jsonb));
    begin
        perform public.apply_collection_page(run_id,2,2,5,payload);
        raise exception '并发冲突漏检';
    exception when serialization_failure then null; end;
    if exists(select 1 from public.library_entries where bangumi_id=source_id and platform='TV') or
       (select next_offset from public.sync_runs where id=run_id)<>2 then raise exception '分页未原子回滚'; end if;
    job:=public.apply_collection_page(run_id,2,1,3,jsonb_build_array(payload->0));
    if job->>'state'<>'done' or (job->>'matched')::int<>1 or not exists(
        select 1 from public.library_entries where bangumi_id=source_id and platform='TV' and review='保留短评' and watched_episodes=7
    ) then raise exception '去重合并或个人数据保护失败'; end if;
    perform set_config('request.jwt.claim.sub',outsider::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
    begin
        perform public.apply_collection_page(run_id,0,0,0,'[]');
        raise exception '未绑定账户写入成功';
    exception when insufficient_privilege then null; end;
end;
$$;
rollback;
select 'Phase 4 sync PASS' as result;
