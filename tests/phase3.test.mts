import test from "node:test";
import assert from "node:assert/strict";
import { cleanManual, shanghaiDay, type Entry } from "../src/lib/domain/library.ts";
import {
  cleanLink,
  cleanNote,
  parseTime,
  playableUrl,
  timeLabel,
  type Episode,
  type JournalIndex,
} from "../src/lib/domain/journal.ts";
import {
  airedCount,
  collectEpisodes,
  debtLabel,
  monday,
  scheduleState,
  weekSchedule,
} from "../src/lib/domain/schedule.ts";
import { emptyFacets, filterEntries } from "../src/lib/domain/filters.ts";

const today = "2026-11-27";
const entry = (patch: Partial<Entry> = {}): Entry => ({
  ...cleanManual({ title_cn: "日常" }),
  owner_id: "owner",
  id: "a",
  bangumi_id: 1,
  version: 1,
  metadata_fetched_at: null,
  schedule_fetched_at: null,
  calendar_seen_on: null,
  last_watched_at: null,
  locked_fields: [],
  created_at: "",
  updated_at: "",
  ...patch,
});
const ep = (n: number, d: string | null, sort = n): Episode => ({
  episode_no: n,
  sort_no: sort,
  air_date: d,
});
const weekly = entry({
  premiere_date: "2026-11-13",
  air_weekday: 5,
  release_pattern: "weekly",
  airing_override: "airing",
  total_episodes: 12,
  watched_episodes: 1,
});

test("短评、空正文书签、第 1 集零秒与长时标均能往返", () => {
  assert.deepEqual(cleanNote({ body: "  印象 " }), {
    body: "印象",
    episode_number: null,
    position_seconds: null,
  });
  assert.deepEqual(cleanNote({ episode: "6", time: "14:20", body: "  " }), {
    episode_number: 6,
    position_seconds: 860,
    body: null,
  });
  for (const raw of ["0:00", "14:20", "1:02:03"])
    assert.equal(parseTime(timeLabel(parseTime(raw)!)), parseTime(raw));
  assert.equal(cleanNote({ episode: "1" }).position_seconds, null);
  for (const v of [
    {},
    { time: "00:00" },
    { body: "x", time: "14:20" },
    { episode: 0 },
    { episode: 6, time: "9:60" },
    { episode: 6, time: "9999999999:00" },
  ])
    assert.throws(() => cleanNote(v));
});
test("播放链接校验、空值及不安全的旧链接", () => {
  assert.deepEqual(cleanLink({ label: " B站 ", url: " https://example.org/v " }), {
    label: "B站",
    url: "https://example.org/v",
  });
  for (const v of ["javascript:alert(1)", "file:///tmp/a", "https://user:pw@example.org/", ""])
    assert.equal(playableUrl(v), null);
  assert.throws(() => cleanLink({ label: "", url: "https://example.org" }));
});
test("按真实返回长度翻页，保留跨季、小数和缺日期的本篇", async () => {
  const calls: number[] = [];
  const rows = [
    { id: 10, ep: 1, sort: 26, airdate: "2026-11-20" },
    { id: 11, ep: 2, sort: 27, airdate: "" },
    { id: 13, ep: 2.5, sort: 27.5, airdate: "2026-02-30" },
  ];
  const data = await collectEpisodes(9, async (offset) => {
    calls.push(offset);
    return {
      offset,
      total: 3,
      data: rows.slice(offset, offset + 2).map((r) => ({ ...r, type: 0 })),
    };
  });
  assert.deepEqual(calls, [0, 2]);
  assert.deepEqual(
    data.map((e) => [e.episode_no, e.sort_no, e.air_date]),
    [
      [1, 26, "2026-11-20"],
      [2, 27, null],
      [2.5, 27.5, null],
    ],
  );
});
test("翻页中断、总数变化、非本篇、来源错位与重复 ID 均拒绝发布", async () => {
  const row = { id: 11, ep: 1, sort: 1, subject_id: 9, type: 0 };
  for (const next of [
    { offset: 1, total: 2, data: [] },
    { offset: 0, total: 2, data: [row] },
    { offset: 1, total: 3, data: [row] },
    { offset: 1, total: 2, data: [row] },
    { offset: 1, total: 2, data: [{ ...row, id: 12, type: 1 }] },
    { offset: 1, total: 2, data: [{ ...row, id: 12, subject_id: 8 }] },
  ])
    await assert.rejects(
      collectEpisodes(9, async (offset) => (offset ? next : { total: 2, offset: 0, data: [row] })),
    );
  await assert.rejects(
    collectEpisodes(9, async (offset) => {
      if (offset) throw Error("timeout");
      return { total: 2, offset, data: [row] };
    }),
  );
});
test("真实日期覆盖固定星期，跨季编号、延期与同日双更按本篇条数算", () => {
  const e = { ...weekly, total_episodes: 4 };
  const dates = [
    ep(1, "2026-11-13", 26),
    ep(2, "2026-11-26", 27),
    ep(3, "2026-11-26", 28),
    ep(4, "2026-12-04", 29),
  ];
  assert.deepEqual(airedCount(e, dates, today), { aired: 3, debt: 2, basis: "dated" });
  const { days } = weekSchedule([e], { a: dates }, today, today);
  assert.equal(days[3].slots[0].episodes.length, 2);
  assert.equal(days[4].slots.length, 0);
  assert.equal(debtLabel(airedCount({ ...e, watched_episodes: 8 }, dates, today)), "欠 0 集");
});
test("残缺日期和未知总数返回可证实下界，未知欠番不冒充零", () => {
  const part = [ep(1, "2026-11-13"), ep(2, null), ep(3, "2026-11-26")];
  assert.equal(debtLabel(airedCount(weekly, part, today)), "至少欠 1 集");
  assert.equal(debtLabel(airedCount({ ...weekly, watched_episodes: 7 }, part, today)), "欠番待定");
  assert.equal(
    debtLabel(airedCount({ ...weekly, total_episodes: 2 }, [ep(1, today), ep(3, today)], today)),
    "至少欠 1 集",
  );
  assert.equal(debtLabel(airedCount(entry(), [], today)), "欠番待定");
});
test("周更推算按上海自然日、总集数封顶，预计标识跟随所有数字", () => {
  assert.equal(shanghaiDay(new Date("2026-11-26T16:00:00Z")), today);
  assert.equal(shanghaiDay(new Date("2026-11-26T15:59:59Z")), "2026-11-26");
  assert.equal(debtLabel(airedCount(weekly, [], today)), "预计欠 2 集");
  assert.equal(airedCount({ ...weekly, total_episodes: 2 }, [], today).aired, 2);
  assert.equal(airedCount(weekly, [], "2026-10-01").aired, 0);
  assert.equal(airedCount({ ...weekly, release_pattern: "irregular" }, [], today).aired, null);
  assert.equal(monday("2027-01-03"), "2026-12-28");
});
test("日历列出当前真实/预计日期、停播与连载日期待定", () => {
  const unknown = { ...weekly, id: "b", release_pattern: "irregular" as const };
  const paused = { ...weekly, id: "p" };
  const {
    days,
    undated,
    paused: off,
  } = weekSchedule(
    [weekly, unknown, paused],
    { p: [ep(1, "2026-11-20"), ep(2, "2026-12-04")] },
    today,
    today,
  );
  assert.deepEqual(
    days.map((d) => d.slots.length),
    [0, 0, 0, 0, 1, 0, 0],
  );
  assert.equal(days[4].slots[0].estimated, true);
  assert.deepEqual(
    undated.map((e) => e.id),
    ["b"],
  );
  assert.deepEqual(
    off.map((e) => e.id),
    ["p"],
  );
});
test("放送状态尊重手动选择、已播与待播及来源矛盾", () => {
  const data = [ep(1, today), ep(2, "2026-12-01")];
  assert.equal(scheduleState(entry(), data, today), "airing");
  assert.equal(scheduleState(entry({ end_date: "2026-11-25" }), data, today), "unknown");
  assert.equal(scheduleState(entry({ airing_override: "finished" }), data, today), "finished");
  assert.equal(
    scheduleState(entry({ total_episodes: 2 }), [ep(1, today), ep(2, today)], today),
    "finished",
  );
});
test("手动确认的周更在计划区间可推算，最近批量放送则保留日期待定", () => {
  const confirmed = {
    ...weekly,
    airing_override: null,
    locked_fields: ["release_pattern", "air_weekday"],
  };
  assert.equal(weekSchedule([confirmed], {}, today, today).days[4].slots[0].estimated, true);
  const batch = [ep(1, "2026-11-18"), ep(2, "2026-11-18")];
  const week = weekSchedule([weekly], { a: batch }, today, today);
  assert.equal(week.days.flatMap((d) => d.slots).length, 0);
  assert.deepEqual(
    week.undated.map((e) => e.id),
    ["a"],
  );
});
test("组合筛选取交集、笔记关键词匹配、多个标签须全部包含、未知排序靠后", () => {
  const e = {
    ...weekly,
    watch_status: "watching" as const,
    meta_tags: ["科幻"],
    platform: "TV",
    personal_rating: 8,
  };
  const b = entry({ id: "b", platform: "OVA" });
  const idx: JournalIndex = {
    notes: {
      a: [
        {
          id: "n",
          body: "屋顶见",
          episode_number: 6,
          position_seconds: 0,
          version: 1,
          created_at: "",
        },
      ],
    },
    episodes: {},
    links: {},
    tags: [
      { id: "food", name: "下饭" },
      { id: "again", name: "二刷" },
    ],
    assignments: { a: ["food", "again"], b: ["again"] },
  };
  const facets = {
    air: "airing" as const,
    year: "2026",
    platform: "TV",
    genre: "科幻",
    tags: ["food", "again"],
  };
  const find = (f = facets) =>
    filterEntries([b, e], idx, today, "watching", f, "屋顶", "debt").map((r) => r.id);
  assert.deepEqual(find(), ["a"]);
  assert.deepEqual(find({ ...facets, tags: ["food", "missing"] }), []);
  assert.deepEqual(find({ ...facets, platform: "剧场版" }), []);
  for (const sort of ["rating", "debt", "premiere"])
    assert.deepEqual(
      filterEntries([b, e], idx, today, "all", emptyFacets, "", sort).map((r) => r.id),
      ["a", "b"],
    );
});
