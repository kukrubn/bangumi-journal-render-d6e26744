import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanUsername,
  parseCollectionPage,
  prepareCollectionItem,
} from "../src/lib/domain/collection.ts";
import { cleanManual, type Entry } from "../src/lib/domain/library.ts";
const subject = {
  id: 253,
  type: 2,
  name: "カウボーイビバップ",
  name_cn: "星际牛仔",
  date: "1998-04-03",
  eps: 26,
  images: { common: "https://example.org/253.jpg" },
};
const row = {
  subject_id: 253,
  subject_type: 2,
  private: false,
  type: 3,
  ep_status: 5,
  rate: 0,
  subject,
  comment: "  重看  ",
};
const page = (data: unknown[], offset = 0, total = data.length) =>
  parseCollectionPage({ offset, total, limit: 20, data }, offset);
test("公开动画收藏映射全部五种状态，缺失评分与无效进度均安全", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((type) => page([{ ...row, type }]).items[0].personal.watch_status),
    ["planned", "completed", "watching", "on_hold", "dropped"],
  );
  const [item] = page([row]).items;
  assert.equal(item.personal.personal_rating, null);
  assert.equal(item.personal.review, "重看");
  assert.equal(item.personal.watched_episodes, 5);
  assert.equal(item.source.total_episodes, 26);
  const partial = page([
    {
      ...row,
      ep_status: -1,
      rate: 11,
      comment: null,
      subject: { ...subject, eps: 0, date: "2026-02-30" },
    },
  ]).items[0];
  assert.equal(partial.source.total_episodes, null);
  assert.equal(partial.source.premiere_date, null);
  assert.equal(partial.personal.watched_episodes, undefined);
  assert.equal(partial.personal.personal_rating, undefined);
});
test("分页按远端真实行数推进，重复/私有/非动画/无主体条目计入跳过", () => {
  const data = [
    row,
    row,
    { ...row, subject_type: 1 },
    { ...row, private: true },
    { ...row, subject_id: 88, subject: undefined },
    { ...row, type: 9 },
  ];
  const result = page(data, 40, 48);
  assert.equal(result.items.length, 1);
  assert.equal(result.count, 6);
  assert.equal(result.total, 48);
  assert.equal(page([], 50, 46).count, 0);
  for (const raw of [
    { total: 1, offset: 1, limit: 20, data: [row] },
    { total: -1, offset: 0, limit: 20, data: [] },
    { total: 2, offset: 0, limit: 1, data: [row, row] },
  ])
    assert.throws(() => parseCollectionPage(raw, 0));
});
test("重复同步保留本地个人字段、手动锁、总数及有效日期，显式勾选才回退", () => {
  const old: Entry = {
    ...cleanManual({
      title_cn: "私藏名称",
      watched_episodes: 12,
      personal_rating: 9,
      review: "我的短评",
      total_episodes: 30,
    }),
    owner_id: "actor",
    id: "entry",
    version: 7,
    bangumi_id: 253,
    calendar_seen_on: null,
    schedule_fetched_at: null,
    metadata_fetched_at: null,
    created_at: "",
    updated_at: "",
    last_watched_at: null,
    locked_fields: ["title_cn", "total_episodes"],
  };
  const item = page([row]).items[0];
  const defaulted = prepareCollectionItem(item, old);
  assert.equal(defaulted.row.version, 7);
  for (const field of [
    "title_cn",
    "total_episodes",
    "watched_episodes",
    "review",
    "personal_rating",
    "watch_status",
  ])
    assert.ok(!(field in defaulted.row.patch));
  assert.deepEqual(
    defaulted.preview.differences.map((d) => d.field),
    ["watch_status", "watched_episodes", "personal_rating", "review"],
  );
  const selected = prepareCollectionItem(item, old, ["watched_episodes", "personal_rating"]);
  assert.equal(selected.row.patch.watched_episodes, 5);
  assert.equal(selected.row.patch.personal_rating, null);
  assert.equal(selected.row.patch.review, undefined);
  assert.equal(prepareCollectionItem(item).row.patch.review, "重看");
});
test("用户名按单个路径段处理", () => {
  assert.equal(cleanUsername("  42  "), "42");
  for (const s of ["", "..", "../test", "https://bgm.tv/user/a", "a?type=5", "a\\b", "a\u0000b"])
    assert.throws(() => cleanUsername(s));
});
