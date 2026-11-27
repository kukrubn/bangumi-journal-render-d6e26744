import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import pg from "pg";

// Called only inside the disposable PostgreSQL cluster provisioned by cloud-bootstrap.test.mts.
export async function checkInvitedAccounts(runtimeUrl: string, admin: pg.Client, owner: string) {
  const pool = new pg.Pool({ connectionString: runtimeUrl });
  const hash = "0".repeat(32) + ":" + "1".repeat(128);
  const issue = async () => {
    const token = randomBytes(32).toString("hex");
    const { rows } = await pool.query("select * from app_private.create_invite($1,$2,now()+interval '1 day')", [owner,token]);
    return { token, id: rows[0].id as string };
  };
  const redeem = async (token: string, mail: string) =>
    (await pool.query("select app_private.redeem_invite($1,$2,$3) as uid", [token,mail,hash])).rows[0].uid as string;
  const available = async (token: string) =>
    (await pool.query("select app_private.invite_available($1) as ok", [token])).rows[0].ok;
  const shelf = async (uid: string, work: (client: pg.PoolClient) => Promise<void>) => {
    const conn = await pool.connect();
    try {
      await conn.query("begin; set local role authenticated");
      await conn.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
      await work(conn);
      await conn.query("commit");
    } catch (error) {
      await conn.query("rollback");
      throw error;
    } finally {
      conn.release();
    }
  };
  try {
    // All five pre-membership rollback suites, including the original unmatched-subject and anon checks.
    const checks = new URL("../supabase/checks/", import.meta.url);
    for (const name of (await readdir(checks)).filter((x) => x.endsWith("_rollback.sql")).sort())
      await admin.query(await readFile(new URL(name, checks), "utf8"));

    const first = await issue();
    const revoked = await issue();
    assert(await available(revoked.token));
    await pool.query("select app_private.revoke_invite($1,$2)", [owner,revoked.id]);
    assert.equal(await available(revoked.token), false);
    await assert.rejects(redeem(revoked.token,"a@example.test"), { code:"P0002" });
    const expired = await issue();
    await admin.query("update app_private.invites set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1", [expired.id]);
    assert.equal(await available(expired.token), false);
    await assert.rejects(redeem(expired.token,"a@example.test"), { code:"P0002" });

    const race = await Promise.allSettled([redeem(first.token," A@example.test "),redeem(first.token," A@example.test ")]);
    const winner = race.find((x) => x.status === "fulfilled");
    assert(winner);
    assert.deepEqual(race.filter(x=>x.status==="rejected").map(x=>x.reason.code), ["P0002"]);
    const alice = winner.value;
    assert.equal(await available(first.token), false);
    assert.equal((await admin.query("select used_by from app_private.invites where id=$1", [first.id])).rows[0].used_by,alice);
    assert.equal((await pool.query("select * from app_private.account_by_email($1)",["A@EXAMPLE.test"])).rows[0].uid,alice);
    assert.equal((await pool.query("select * from app_private.account_by_uid($1)",[alice])).rows[0].password_hash,hash);
    const second = await issue();
    await assert.rejects(redeem(second.token,"A@example.test"), { code:"23505" });
    assert.equal(await available(second.token), true);
    const bob = await redeem(second.token, "bj-0123456789abcdef@members.invalid");
    await assert.rejects(pool.query("select * from app_private.list_invites($1)",[alice]),{code:"42501"});
    await assert.rejects(pool.query("select app_private.revoke_invite($1,$2)",[alice,first.id]),{code:"42501"});
    const {rows: listed} = await pool.query("select * from app_private.list_invites($1)",[owner]);
    assert.deepEqual(Object.keys(listed[0]).sort(),["id","created_at","expires_at","used_at","revoked_at"].sort());

    for (const role of ["anon","authenticated"]) {
      const permissions = await admin.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='app_private' and has_function_privilege($1,p.oid,'execute')`,[role]);
      assert.deepEqual(permissions.rows,[]);
      assert.equal((await admin.query("select has_table_privilege($1,'app_private.accounts','select') or has_table_privilege($1,'app_private.invites','select') as ok",[role])).rows[0].ok,false);
    }
    await assert.rejects(pool.query("select * from app_private.accounts"),{code:"42501"});

    // Reuse every identifier across three separate owners, including the same source ID and request receipt.
    const entry = randomUUID(), note = randomUUID(), run = randomUUID(), receipt = randomUUID();
    for (const uid of [owner,alice,bob]) {
      await shelf(uid, async (c) => {
        assert.equal((await c.query("select public.is_app_owner() as allowed")).rows[0].allowed,true);
        assert.equal((await c.query("select count(*)::int as n from public.library_entries")).rows[0].n,0);
        await c.query("insert into public.library_entries(id,bangumi_id,title_cn) values($1,123,$2)",[entry,uid]);
        await c.query("insert into public.notes(id,entry_id,body) values($1,$2,$3)",[note,entry,uid]);
        await c.query("select public.attach_entry_tag($1,$2)",[entry,uid]);
        await c.query("insert into public.sync_runs(id,username) values($1,'shared')",[run]);
        const page = JSON.stringify([{id:123,version:1,patch:{ review:uid }}]);
        const job = (await c.query("select public.apply_collection_page($1,0,1,1,$2) as val",[run,page])).rows[0].val;
        assert.equal(job.owner_id,uid);
        const progress = await c.query("select * from public.increment_progress($1,$2)",[entry,receipt]);
        assert.equal(progress.rows[0].replayed,false);
        assert.equal(progress.rows[0].watched_after,1);
      });
    }
    for (const uid of [alice,owner,bob]) {
      await shelf(uid, async (c) => {
        const index = (await c.query("select public.library_journal_index() as val")).rows[0].val;
        assert.equal(index.notes[entry][0].body,uid);
        assert.deepEqual(index.tags.map((x:{name:string})=>x.name),[uid]);
        const backup = (await c.query("select public.backup_snapshot() as val")).rows[0].val;
        assert.deepEqual(backup.tables.library_entries.map((x:{review:string})=>x.review),[uid]);
        const changes = Object.fromEntries(Object.keys(backup.tables).map(k=>[k,[] as Record<string,unknown>[]]));
        changes.notes.push({...backup.tables.notes[0],body:"changed",owner_id:randomUUID()});
        const restored = await c.query("select public.restore_backup($1,$2) as n",[JSON.stringify(changes),backup.revision]);
        assert.equal(restored.rows[0].n,1);
        assert.equal((await c.query("select * from public.notes")).rows[0].owner_id,uid);
      });
    }
    await shelf(randomUUID(),async (c) => {
      assert.equal((await c.query("select public.is_app_owner() as ok")).rows[0].ok,false);
      assert.equal((await c.query("select * from public.library_entries")).rowCount,0);
    });
  } finally { await pool.end(); }
}

export async function checkLegacyInviteMigration(url: string) {
  const pgAdmin = new pg.Client({ connectionString: url });
  await pgAdmin.connect();
  try {
    await pgAdmin.query(`create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      $$; grant usage on schema auth to authenticated,anon`);
    const migrations = new URL("../supabase/migrations/", import.meta.url);
    const filename = "20261128000500_invited_accounts.sql";
    for (const script of (await readdir(migrations)).filter((s) => s < filename && s.endsWith(".sql")).sort())
      await pgAdmin.query(await readFile(new URL(script,migrations),"utf8"));
    const original = randomUUID();
    await pgAdmin.query("insert into auth.users(id) values($1)", [original]);
    await pgAdmin.query("insert into app_private.app_owner(user_id) values($1)", [original]);
    await pgAdmin.query("insert into public.library_entries(owner_id,title_cn) values($1,'original shelf')", [original]);
    await pgAdmin.query(await readFile(new URL(filename,migrations),"utf8"));
    assert.equal((await pgAdmin.query("select has_function_privilege('journal_app','app_private.redeem_invite(text,text,text)','execute') as ok")).rows[0].ok,false);
    await pgAdmin.query("begin; set local role authenticated");
    await pgAdmin.query("select set_config('request.jwt.claim.sub',$1,true)", [original]);
    assert.equal((await pgAdmin.query("select title_cn from public.library_entries")).rows[0].title_cn,"original shelf");
    await pgAdmin.query("rollback");
  } finally { await pgAdmin.end(); }
}
