import { airState, AppError, isoDate, title, type Entry } from "./library.ts";
import type { Episode } from "./journal.ts";

const dayMs = 86400000;
export function scheduleFresh(e: Entry, now: number) {
  if (!e.schedule_fetched_at) return false;
  const archived = e.end_date && Date.parse(e.end_date) < now - 14 * dayMs;
  return now - Date.parse(e.schedule_fetched_at) < (archived ? 7 * dayMs : 6 * 3600000);
}
const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / dayMs;
export const moveDay = (date: string, days: number) =>
  new Date(Date.parse(date) + days * dayMs).toISOString().slice(0, 10);
export const weekday = (day: string) => new Date(day + "T00:00:00Z").getUTCDay() || 7;
export const monday = (day: string) => moveDay(day, 1 - weekday(day));
export const localNumber = (ep: Episode) =>
  ep.episode_no && ep.episode_no > 0 ? ep.episode_no : ep.sort_no;
type ImportedEpisode = Episode & { id: number; title: string | null };

// A missing page must never turn a full previous schedule into a partial snapshot.
export async function collectEpisodes(
  subject: number,
  readPage: (offset: number) => Promise<unknown>,
) {
  const result: ImportedEpisode[] = [];
  const seen = new Set<number>();
  let offset = 0,
    expected: number | undefined;
  const incomplete = () => new AppError(502, "Bangumi 本篇章节分页不完整，请稍后重新同步");
  do {
    const page = (await readPage(offset)) as {
      total?: number;
      offset?: number;
      data?: unknown[];
    } | null;
    if (
      !page ||
      !Number.isSafeInteger(page.total) ||
      page.total! < 0 ||
      page.offset !== offset ||
      !Array.isArray(page.data) ||
      (expected !== undefined && page.total !== expected)
    )
      throw incomplete();
    expected = page.total!;
    if ((!page.data.length && offset < expected) || offset + page.data.length > expected)
      throw incomplete();
    for (const record of page.data) {
      const e = record as {
        id: number;
        subject_id: number;
        type: number;
        sort: number;
        ep?: number;
        airdate?: string;
        name_cn?: string;
        name?: string;
      } | null;
      if (
        !e ||
        e.type !== 0 ||
        (e.subject_id != null && e.subject_id !== subject) ||
        !Number.isSafeInteger(e.id) ||
        e.id <= 0 ||
        e.id > 2147483647 ||
        !Number.isFinite(e.sort) ||
        seen.has(e.id)
      )
        throw incomplete();
      seen.add(e.id);
      result.push({
        id: e.id,
        sort_no: e.sort,
        episode_no: Number.isFinite(e.ep) && e.ep! > 0 ? e.ep! : null,
        air_date: isoDate(e.airdate),
        title: [e.name_cn, e.name].find((x) => typeof x === "string" && x.trim())?.trim() || null,
      });
    }
    offset += page.data.length;
  } while (offset < expected);
  return result;
}

type Basis = "dated" | "minimum" | "estimated" | "unknown";
export type AirCount = { aired: number | null; debt: number | null; basis: Basis };
function weeklyAired(e: Entry, day: string) {
  if (!e.premiere_date || e.release_pattern !== "weekly") return null;
  if (e.airing_override === "upcoming" && day >= e.premiere_date) return null;
  if (e.airing_override === "finished" && !e.total_episodes && !e.end_date) return null;
  if (day < e.premiere_date) return 0;
  const through = e.end_date && e.end_date < day ? e.end_date : day;
  const n = 1 + Math.floor(daysBetween(e.premiere_date, through) / 7);
  return Math.min(e.total_episodes ?? Infinity, n);
}
export function airedCount(e: Entry, episodes: Episode[], today: string): AirCount {
  const value = (aired: number | null, basis: Basis): AirCount => ({
    aired,
    basis,
    debt: aired === null ? null : Math.max(0, aired - e.watched_episodes),
  });
  const dated = episodes.filter((ep) => ep.air_date !== null);
  if (dated.length) {
    const past = dated.filter((ep) => ep.air_date! <= today);
    const allDated = dated.length === episodes.length;
    // A consecutive local sequence through the next dated episode also settles today's count.
    const sequence = [...episodes].sort((a, b) => localNumber(a) - localNumber(b));
    const firstFuture = sequence.findIndex((ep) => ep.air_date !== null && ep.air_date > today);
    const bounded =
      allDated &&
      firstFuture >= 0 &&
      sequence
        .slice(0, firstFuture + 1)
        .every(
          (ep, i) =>
            localNumber(ep) === i + 1 &&
            ep.air_date !== null &&
            (!i || sequence[i - 1].air_date! <= ep.air_date!),
        ) &&
      past.length === firstFuture;
    const full = allDated && matchesPlan(e, sequence);
    return value(past.length, full || bounded ? "dated" : "minimum");
  }
  const weekly = weeklyAired(e, today);
  return weekly === null ? value(null, "unknown") : value(weekly, "estimated");
}
function matchesPlan(e: Entry, sequence: Episode[]) {
  if (!sequence.length || sequence.length !== e.total_episodes) return false;
  const start = sequence.every((ep) => ep.episode_no === null) ? sequence[0].sort_no : 1;
  return Number.isInteger(start) && sequence.every((ep, i) => localNumber(ep) === start + i);
}
export function debtLabel(count: AirCount) {
  if (count.debt === null || (count.basis === "minimum" && !count.debt)) return "欠番待定";
  return (
    (count.basis === "estimated" ? "预计" : count.basis === "minimum" ? "至少" : "") +
    "欠 " +
    count.debt +
    " 集"
  );
}
export function scheduleState(e: Entry, episodes: Episode[], today: string) {
  if (e.airing_override) return e.airing_override;
  const dated = episodes.flatMap((ep) => (ep.air_date ? [ep.air_date] : []));
  const past = dated.some((d) => d <= today),
    future = dated.some((d) => d > today);
  if (
    (past && e.premiere_date && e.premiere_date > today) ||
    (future && e.end_date && e.end_date <= today)
  )
    return "unknown";
  if (
    !future &&
    dated.length === episodes.length &&
    matchesPlan(
      e,
      [...episodes].sort((a, b) => localNumber(a) - localNumber(b)),
    )
  )
    return "finished";
  if (past && future) return "airing";
  if (!past && future && e.premiere_date && e.premiere_date > today) return "upcoming";
  const state = airState(e, today);
  if (state !== "unknown") return state;
  return "unknown";
}
export type Slot = { entry: Entry; episodes: Episode[]; estimated: boolean };
export function weekSchedule(
  entries: Entry[],
  index: Record<string, Episode[]>,
  anchor: string,
  today: string,
) {
  const start = monday(anchor),
    end = moveDay(start, 6);
  const days = Array.from({ length: 7 }, (_, i) => ({
    date: moveDay(start, i),
    slots: [] as Slot[],
  }));
  const undated: Entry[] = [],
    paused: Entry[] = [];
  for (const e of entries) {
    const episodes = index[e.id] ?? [];
    const inWeek = episodes.filter(
      (ep) => ep.air_date && ep.air_date >= start && ep.air_date <= end,
    );
    if (inWeek.length) {
      for (const day of days) {
        const group = inWeek.filter((ep) => ep.air_date === day.date);
        if (group.length) day.slots.push({ entry: e, episodes: group, estimated: false });
      }
      continue;
    }
    if ((e.premiere_date && e.premiere_date > end) || (e.end_date && e.end_date < start)) continue;
    const dated = episodes
      .filter((ep) => ep.air_date !== null)
      .sort((a, b) => a.air_date!.localeCompare(b.air_date!));
    const before = dated.filter((ep) => ep.air_date! < start).at(-1);
    const after = dated.find((ep) => ep.air_date! > end);
    const premiering = !!e.premiere_date && e.premiere_date >= start && e.premiere_date <= end;
    if (
      e.airing_override &&
      e.airing_override !== "airing" &&
      !(e.airing_override === "upcoming" && premiering)
    )
      continue;
    if (after && localNumber(after) === 1) continue;
    if (
      before &&
      after &&
      localNumber(after) === localNumber(before) + 1 &&
      !episodes.some(
        (ep) =>
          !ep.air_date &&
          localNumber(ep) >= localNumber(before) &&
          localNumber(ep) <= localNumber(after),
      )
    ) {
      paused.push(e);
      continue;
    }
    if (e.total_episodes && dated.filter((ep) => ep.air_date! < start).length >= e.total_episodes)
      continue;
    const state = scheduleState(e, episodes, today);
    const activeDuringWeek = !!(
      e.premiere_date &&
      e.end_date &&
      e.premiere_date <= end &&
      e.end_date >= start
    );
    const confirmedWeekly =
      !e.airing_override &&
      e.locked_fields.includes("release_pattern") &&
      e.release_pattern === "weekly" &&
      !!e.premiere_date &&
      !!e.total_episodes &&
      (weeklyAired(e, moveDay(start, -1)) ?? 0) < e.total_episodes;
    if (state !== "airing" && !premiering && !activeDuringWeek && !confirmedWeekly) continue;
    // A full dated plan already accounts for every installment. Do not invent additional slots.
    if (
      dated.length === episodes.length &&
      matchesPlan(
        e,
        [...episodes].sort((a, b) => localNumber(a) - localNumber(b)),
      )
    )
      continue;
    // A batch drop or interrupted recent cadence makes the next undated slot uncertain.
    const prior = dated.filter((ep) => ep.air_date! < start).slice(-2);
    if (
      prior.length === 2 &&
      Math.abs(daysBetween(prior[0].air_date!, prior[1].air_date!) - 7) > 2
    ) {
      undated.push(e);
      continue;
    }
    if (e.release_pattern !== "weekly" || (!e.air_weekday && !e.premiere_date)) {
      undated.push(e);
      continue;
    }
    const slot = e.air_weekday ?? weekday(e.premiere_date!);
    const day = premiering ? days.find((d) => d.date === e.premiere_date)! : days[slot - 1];
    if (
      (e.end_date && day.date > e.end_date) ||
      (e.total_episodes && (weeklyAired(e, moveDay(day.date, -1)) ?? 0) >= e.total_episodes)
    )
      continue;
    day.slots.push({ entry: e, episodes: [], estimated: true });
  }
  for (const day of days)
    day.slots.sort((a, b) => title(a.entry).localeCompare(title(b.entry), "zh-CN"));
  return {
    days,
    paused,
    undated: undated.sort((a, b) => title(a).localeCompare(title(b), "zh-CN")),
  };
}
