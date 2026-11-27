import test from "node:test";
import assert from "node:assert/strict";
import { airState, cleanManual, manualLocks, type Entry } from "../src/lib/domain/library.ts";
import {
  calendarDays,
  mergeSource,
  normalizeSubject,
  parseSubjectId,
  preview,
} from "../src/lib/domain/bangumi.ts";
import { isProjectAuthCookie, projectConfig } from "../src/lib/supabase/config.ts";

const base = {
  type: 2,
  id: 253,
  name: "カウボーイビバップ",
  name_cn: "星际牛仔",
  eps: 26,
  total_episodes: 31,
  date: "1998-04-03",
};
test("切换开发者账号只清当前 Supabase 项目的会话及分片", () => {
  const url = "https://journal.example.com";
  for (const name of [
    "sb-journal-auth-token",
    "sb-journal-auth-token.0",
    "sb-journal-auth-token.12",
  ])
    assert.equal(isProjectAuthCookie(url, name), true);
  for (const name of [
    "sb-other-auth-token.0",
    "sb-journal-auth-token-test",
    "sb-journal-auth-token.other",
  ])
    assert.equal(isProjectAuthCookie(url, name), false);
});
test("环境模板只接受 publishable 或旧版 anon 公开键", () => {
  const cfg = (key: string) =>
    projectConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key,
    });
  assert.ok(cfg("sb_publishable_example"));
  assert.equal(cfg("sb_secret_example"), null);
  const legacy = (role: string) =>
    "header." + Buffer.from(JSON.stringify({ role })).toString("base64url") + ".signature";
  assert.ok(cfg(legacy("anon")));
  assert.equal(cfg(legacy("service_role")), null);
});
const row = (patch: Partial<Entry> = {}): Entry => ({
  ...cleanManual({ title_cn: "星际牛仔" }),
  owner_id: "owner",
  id: "entry",
  bangumi_id: 253,
  calendar_seen_on: null,
  schedule_fetched_at: null,
  metadata_fetched_at: null,
  last_watched_at: null,
  created_at: "",
  updated_at: "",
  version: 1,
  locked_fields: [],
  ...patch,
});
test("手动空值、整数、来源锁和评分范围", () => {
  const v = cleanManual({
    title_cn: "  测试  ",
    cover_url: " ",
    total_episodes: "",
    personal_rating: "",
    review: " ",
    meta_tags: "日常，日常,校园",
  });
  assert.equal(v.title_cn, "测试");
  assert.equal(v.cover_url, null);
  assert.equal(v.review, null);
  assert.equal(v.total_episodes, null);
  assert.equal(v.personal_rating, null);
  assert.deepEqual(v.meta_tags, ["日常", "校园"]);
  assert.deepEqual(manualLocks(v), ["title_cn", "meta_tags"]);
  assert.throws(() => cleanManual({ title_cn: "a", personal_rating: 11 }));
  assert.throws(() => cleanManual({ title_cn: "a", watched_episodes: -1 }));
  assert.throws(() => cleanManual({ title_cn: "　" }));
  assert.throws(() => cleanManual({ title_cn: "a", cover_url: "file:///a" }));
});
test("手动的无效日期可见报错，来源脏日期自动置空", () => {
  assert.throws(() => cleanManual({ title_original: "a", premiere_date: "2025-02-29" }));
  assert.throws(() =>
    cleanManual({ title_original: "a", premiere_date: "2001-01-01", end_date: "1999-02-03" }),
  );
  const source = normalizeSubject({
    ...base,
    infobox: [{ key: "播放结束", value: "1997年4月2日" }],
  });
  assert.equal(source.end_date, null);
  assert.equal(source.total_episodes, 26);
  assert.equal(normalizeSubject({ ...base, eps: 0, date: "0000-00-00" }).total_episodes, null);
  assert.equal(
    normalizeSubject({ ...base, infobox: [{ key: "播放结束", value: "1999年4月23日" }] }).end_date,
    "1999-04-23",
  );
});
test("只接受官方条目路径和可存入 integer 的正 ID", () => {
  for (const v of [
    253,
    "253",
    "bgm.tv/subject/253",
    "https://bangumi.tv/subject/253/?x=1",
    "https://chii.in/subject/253#ep",
  ])
    assert.equal(parseSubjectId(v), 253);
  for (const v of [
    "0",
    "-1",
    "2147483648",
    "https://bgm.tv.example.com/subject/253",
    "https://bgm.tv/ep/253",
    "https://x@bgm.tv/subject/253",
  ])
    assert.throws(() => parseSubjectId(v));
});
test("候选中文名与坏封面可回退，非动画不入库", () => {
  const p = preview({
    ...base,
    name_cn: " ",
    images: { common: "broken", medium: "https://example.org/x.jpg" },
  });
  assert.equal(p?.title_cn, null);
  assert.equal(p?.cover_url, "https://example.org/x.jpg");
  assert.equal(preview({ ...base, type: 1 }), null);
  assert.throws(() => normalizeSubject({ ...base, type: 1 }));
});
test("重复导入不改资料锁、个人进度和评分，合并后起止日仍有效", () => {
  const old = row({
    title_cn: "我起的名字",
    total_episodes: 27,
    premiere_date: "2025-01-01",
    watched_episodes: 7,
    personal_rating: 9,
    locked_fields: ["title_cn", "total_episodes", "premiere_date"],
  });
  const source = normalizeSubject({ ...base, infobox: [{ key: "播放结束", value: "1999-04-23" }] });
  const patch = mergeSource(old, source);
  for (const k of [
    "end_date",
    "title_cn",
    "total_episodes",
    "premiere_date",
    "watched_episodes",
    "personal_rating",
  ])
    assert.ok(!Object.hasOwn(patch, k));
  const lockedEnd = row({ end_date: "1990-01-01", locked_fields: ["end_date"] });
  assert.ok(!Object.hasOwn(mergeSource(lockedEnd, source), "premiere_date"));
  const staleEnd = row({ end_date: "1990-01-01" });
  assert.equal(mergeSource(staleEnd, normalizeSubject(base)).end_date, null);
});
test("清空与解除手动锁分别处理", () => {
  const original = row({ cover_url: "https://example.org/a", locked_fields: ["title_cn"] });
  const v = cleanManual({ ...original, cover_url: "" });
  assert.deepEqual(manualLocks(v, original, ["title_cn"]), ["cover_url"]);
});
test("近期周表匹配可推断连载，旧匹配回退为待补", () => {
  assert.deepEqual(calendarDays([{ weekday: { id: 4 }, items: [{ id: 253 }] }]), { 253: 4 });
  assert.equal(airState(row({ calendar_seen_on: "2026-11-25" }), "2026-11-27"), "airing");
  assert.equal(airState(row({ calendar_seen_on: "2026-10-02" }), "2026-11-27"), "unknown");
});
