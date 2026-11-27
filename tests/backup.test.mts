import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { cleanManual } from "../src/lib/domain/library.ts";
import {
  backupTables,
  emptyTables,
  planRestore,
  type BackupFile,
  type Tables,
} from "../src/lib/domain/backup.ts";
import { csvCell, fullCsvZip, libraryCsv } from "../src/lib/domain/backup-csv.ts";

const uid = (n: number) => "fc800023-64b8-4244-939a-" + String(n).padStart(12, "0");
const now = "2026-11-27T13:45:01.123450+00:00";
const stamps = { version: 3, created_at: now, updated_at: now };
function data(): Tables {
  const t = emptyTables(),
    entry_id = uid(1);
  t.user_settings.push({ ...stamps, minutes_per_episode: 28, theme: "dark" });
  t.library_entries.push({
    ...cleanManual({
      title_cn: " A,\n番 ",
      watch_status: "watching",
      watched_episodes: 6,
      total_episodes: 12,
    }),
    ...stamps,
    id: entry_id,
    bangumi_id: 25,
    locked_fields: ["title_cn"],
    last_watched_at: now,
    metadata_fetched_at: null,
    calendar_seen_on: null,
    schedule_fetched_at: null,
  });
  t.personal_tags.push({ ...stamps, id: uid(2), name: "Rewatch" });
  t.notes.push({
    ...stamps,
    id: uid(3),
    entry_id,
    body: '"屋顶"\r\n相逢',
    episode_number: 6,
    position_seconds: 860,
  });
  t.watch_links.push({
    ...stamps,
    id: uid(4),
    entry_id,
    label: "B站",
    url: "https://example.org/6",
  });
  t.episode_schedule.push({
    ...stamps,
    id: uid(5),
    entry_id,
    bangumi_episode_id: 258,
    sort_no: 26,
    episode_no: 1.5,
    air_date: null,
    title: null,
    manually_edited: true,
  });
  t.entry_tags.push({ entry_id, tag_id: uid(2) });
  return t;
}
function file(t: Tables): BackupFile {
  return { schemaVersion: 1, exportedAt: now, tables: t };
}
test("备份往返包括全部七张表、手动章节、资料锁和书签", () => {
  const t = data(),
    saved = JSON.parse(JSON.stringify(file(t)));
  const add = planRestore(saved, emptyTables());
  assert.equal(add.preview.added, 7);
  assert.equal(add.preview.invalid.length, 0);
  assert.deepEqual(add.changes, t);
  assert.equal(planRestore(saved, t).preview.unchanged, 7);
});
test("按来源与标签名映射父 UUID，子表重建且重放不产生副本", () => {
  const t = data(),
    local = structuredClone(t);
  const entry = local.library_entries[0],
    tag = local.personal_tags[0];
  entry.id = uid(11);
  tag.id = uid(12);
  tag.name = "rewatch";
  for (const table of ["entry_tags", "notes", "watch_links", "episode_schedule"] as const)
    local[table][0].entry_id = entry.id;
  local.entry_tags[0].tag_id = tag.id;
  local.episode_schedule[0].id = uid(15);
  local.notes = [];
  local.watch_links = [];
  const first = planRestore(file(t), local);
  assert.equal(first.preview.invalid.length, 0);
  assert.equal(first.preview.added, 2);
  assert.equal(first.preview.conflicts.length, 1);
  assert.equal(first.changes.notes[0].entry_id, entry.id);
  const merged = { ...local, notes: first.changes.notes, watch_links: first.changes.watch_links };
  assert.equal(planRestore(file(t), merged).preview.added, 0);
});
test("默认保留本地，逐条覆盖，比较忽略版本/创建时间和同一时刻的时区差异", () => {
  const t = data(),
    local = structuredClone(t);
  local.notes[0].body = "新观感";
  local.library_entries[0].watched_episodes = 7;
  local.library_entries[0].last_watched_at = "2026-11-27T21:45:01.123450+08:00";
  local.notes[0].version = 10;
  const { preview, changes } = planRestore(file(t), local);
  assert.equal(preview.conflicts.length, 2);
  assert.deepEqual(changes, emptyTables());
  assert.deepEqual(preview.conflicts[0].fields, ["watched_episodes"]);
  const next = planRestore(file(t), local, new Set(["notes:" + uid(3)]));
  assert.equal(next.changes.notes[0].body, t.notes[0].body);
  assert.deepEqual(next.changes.library_entries, []);
});
test("来源冲突、重复标识、孤儿和子记录换父条目均报告行号", () => {
  const t = data(),
    local = structuredClone(t);
  local.library_entries[0].bangumi_id = 99;
  assert.match(planRestore(file(t), local).preview.invalid.join(" "), /番剧 第 1 行.*Bangumi ID/);
  const orphan = data();
  orphan.watch_links[0].entry_id = uid(80);
  assert.match(
    planRestore(file(orphan), emptyTables()).preview.invalid.join(" "),
    /播放链接 第 1 行.*引用缺失/,
  );
  const duplicate = data();
  duplicate.notes.push({ ...duplicate.notes[0] });
  assert.match(
    planRestore(file(duplicate), emptyTables()).preview.invalid.join(" "),
    /笔记与书签 第 2 行/,
  );
  const reparent = data();
  reparent.notes[0].entry_id = uid(90);
  assert.match(planRestore(file(t), reparent).preview.invalid.join(" "), /另一部番/);
});
test("选择文件时标版本与字段均校验，owner_id 由当前会话赋予", () => {
  const t = data();
  t.notes[0].owner_id = uid(99);
  t.watch_links[0].url = "javascript:alert(1)";
  const { preview, changes } = planRestore(file(t), emptyTables());
  assert.equal(preview.invalid.length, 1);
  assert.ok(!("owner_id" in changes.notes[0]));
  assert.throws(() => planRestore({ ...file(t), schemaVersion: 2 }, emptyTables()));
  assert.throws(() => planRestore({ ...file(t), tables: {} }, emptyTables()));
});
test("两个同名手动番保存为不同记录", () => {
  const t = data();
  t.library_entries[0].bangumi_id = null;
  t.library_entries.push({ ...t.library_entries[0], id: uid(7) });
  assert.equal(planRestore(file(t), emptyTables()).changes.library_entries.length, 2);
});
test("CSV 防公式、保留内嵌引号换行，完整包逐表带 BOM", () => {
  assert.equal(csvCell(' =HYPERLINK("x")'), '"\' =HYPERLINK(""x"")"');
  assert.equal(csvCell("line1\r\nline2"), '"line1\r\nline2"');
  const t = data(),
    zip = unzipSync(fullCsvZip(t));
  assert.equal(Object.keys(zip).length, 7);
  for (const table of backupTables)
    assert.deepEqual(Array.from(zip[table + ".csv"].slice(0, 3)), [239, 187, 191]);
  assert.match(strFromU8(zip["notes.csv"]), /860/);
  assert.match(libraryCsv(t), /Rewatch/);
});
