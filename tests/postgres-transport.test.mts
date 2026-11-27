import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { postgresTransport } from "../src/lib/server/postgres-transport.ts";
import { projectConfig } from "../src/lib/supabase/config.ts";
import type { Database } from "../src/types/database.ts";

const owner = "e2296fa6-53e2-469a-8ba0-035126c76541";
const id = "b3304e33-04d7-418c-9dec-8463e99d873a";
test("shared developer deployments cannot accidentally switch to an old Supabase environment", () => {
  assert.equal(projectConfig({
    JOURNAL_DATABASE_URL: "postgresql://db.invalid/journal",
    NEXT_PUBLIC_SUPABASE_URL: "https://old-project.invalid",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
  }), null);
});
function fixture(rows: unknown[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const transport = postgresTransport(owner, async (q) => { calls.push(q); return rows; });
  const db = createClient<Database>("https://journal.invalid", "journal", {
    accessToken: async () => "journal", global: { fetch: transport },
  });
  return { calls, db, transport };
}

test("developer account queries bind owner, version, text and arrays through the real client", async () => {
  const { db, calls } = fixture([]);
  const entries = db.from("library_entries");
  const title = "O'Brien (OVA)";
  const result = await entries.upsert({ id, owner_id: owner, title_cn: title, meta_tags: ["喜剧", "二刷"] }, { onConflict: "owner_id,id", ignoreDuplicates: true }).select("*");
  assert.ifError(result.error);
  assert.deepEqual(result.data, []);
  assert.match(calls[0].text, /ON CONFLICT \(owner_id,id\) DO NOTHING RETURNING \*/);
  assert(!calls[0].text.includes(title));
  assert.deepEqual(calls[0].values, [id, owner, title, ["喜剧", "二刷"]]);

  const updated = await entries.update({ review: title }).eq("owner_id", owner).eq("id", id).eq("version", 17).select("id").maybeSingle();
  assert.ifError(updated.error);
  assert.equal(updated.data, null);
  assert.match(calls[1].text, /SET review = \$4 WHERE owner_id = \$1 AND id = \$2 AND version = \$3/);

  await entries.select("*").eq("owner_id", owner).gt("id", id).order("id").limit(200);
  assert.match(calls[2].text, /id > \$2\) AS result ORDER BY id asc LIMIT \$3/);
  await entries.select("*").eq("owner_id", owner).in("bangumi_id", [8,17]);
  assert.deepEqual(calls[3].values, [owner, "8", "17"]);
  const active = await db.from("sync_runs").select("*").eq("owner_id", owner).eq("username", "alice").in("state", ["running", "paused"]).maybeSingle();
  assert.ifError(active.error);
  await db.from("entry_tags").delete().eq("owner_id", owner).eq("entry_id", id).eq("tag_id", id);
  assert.match(calls[5].text, /^DELETE FROM public.entry_tags/);
});

test("RPC default arguments, JSON arrays and scalar/table responses match the database API", async () => {
  const auth = fixture([true]);
  const ownerResult = await auth.db.rpc("is_app_owner");
  assert.equal(ownerResult.data, true);
  const progress = fixture([{ advanced: true, replayed: false, suggest_completion: true, version_after: 2 }]);
  const result = await progress.db.rpc("increment_progress", { p_entry_id: id, p_request_id: id }).single();
  assert.ifError(result.error);
  assert.equal(result.data?.version_after, 2);
  assert.match(progress.calls[0].text, /p_entry_id => \$1::uuid, p_request_id => \$2::uuid/);
  const episode = [{ sort_no: 1, title: "第一集" }];
  await auth.db.rpc("replace_episode_schedule", { p_entry_id: id, p_bangumi_id: 1, p_episodes: episode });
  assert.match(auth.calls[1].text, /p_episodes => \$3::jsonb/);
  assert(!auth.calls[1].text.includes("p_previous_fetch"));
  assert.equal(auth.calls[1].values[2], JSON.stringify(episode));
  const backup = fixture([{ revision: "1", tables: {} }]);
  assert.deepEqual((await backup.db.rpc("backup_snapshot")).data, { revision: "1", tables: {} });
  const settings = await auth.db.from("user_settings").insert({ owner_id: owner, minutes_per_episode: 24 }).select("minutes_per_episode,version").maybeSingle();
  assert.ifError(settings.error);
});

test("unrecognized relations, columns, conflict keys and owners never reach PostgreSQL", async () => {
  const { calls, transport } = fixture([]);
  for (const path of ["pg_catalog.pg_authid?select=*", "library_entries?select=now()", "library_entries?select=*&owner_id=eq.someone-else", `library_entries?select=*&owner_id=eq.${owner}&id);x=eq.1`, "rpc/no_such_function"]) {
    const result = await transport("https://journal.invalid/rest/v1/" + path);
    assert.equal(result.status, 400);
  }
  const badConflict = await transport("https://journal.invalid/rest/v1/library_entries?on_conflict=id", { method: "POST", body: JSON.stringify({ owner_id: owner, title_cn: "Test" }) });
  assert.equal(badConflict.status, 400);
  assert.equal(calls.length, 0);
});
