begin;
do $$
declare actor uuid;
begin
    select user_id into strict actor from app_private.app_owner;
    perform set_config('request.jwt.claim.sub',actor::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
end;
$$;
set local role authenticated;
do $$
declare e uuid; n uuid; other uuid := gen_random_uuid(); snap jsonb; patch jsonb; blank jsonb;
begin
    insert into public.library_entries(title_cn) values('备份验收') returning id into e;
    insert into public.notes(entry_id,body,episode_number,position_seconds) values(e,'天台',6,860) returning id into n;
    snap := public.backup_snapshot();
    select jsonb_object_agg(k,'[]'::jsonb) into blank from jsonb_object_keys(snap->'tables') k;
    if (select count(*) from jsonb_object_keys(blank)) <> 7 then raise exception '快照表数错误'; end if;
    select jsonb_set(blank,'{notes}',jsonb_build_array(rowdata || jsonb_build_object('body','重看','owner_id',other))) into patch
      from jsonb_array_elements(snap->'tables'->'notes') as rows(rowdata) where rowdata->>'id'=n::text;
    if public.restore_backup(patch,snap->>'revision') <> 1 then raise exception '未写入笔记'; end if;
    if not exists(select 1 from public.notes where id=n and owner_id=auth.uid() and body='重看' and position_seconds=860 and version=2) then raise exception '所有者或笔记字段错误'; end if;
    begin
        perform public.restore_backup(patch,snap->>'revision');
        raise exception '应用了过期预览';
    exception when serialization_failure then null;
    end;
    snap := public.backup_snapshot();
    -- A valid note followed by an invalid link must roll back the entire restore transaction.
    patch := jsonb_set(patch,'{notes,0,body}','"不应持久化"');
    patch := jsonb_set(patch,'{watch_links}',jsonb_build_array(jsonb_build_object(
        'id',gen_random_uuid(),'entry_id',e,'label','坏地址','url','file:///bad',
        'created_at',now(),'updated_at',now(),'version',1)));
    begin
        perform public.restore_backup(patch,snap->>'revision');
        raise exception '接纳了无效行';
    exception when check_violation then null;
    end;
    if not exists(select 1 from public.notes where id=n and body='重看') then raise exception '部分写入未回滚'; end if;
    perform set_config('request.jwt.claim.sub',other::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',other,'role','authenticated')::text,true);
    begin
        perform public.backup_snapshot(); raise exception '非所有者可读快照';
    exception when insufficient_privilege then null; end;
    begin
        perform public.restore_backup(blank,''); raise exception '非所有者可恢复快照';
    exception when insufficient_privilege then null; end;
end;
$$;
rollback;
select 'Phase 4 BACKUP PASS' as result;
