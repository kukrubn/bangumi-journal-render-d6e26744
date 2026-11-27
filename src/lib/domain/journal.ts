import type { Database } from "../../types/database.ts";
import { AppError, httpUrl, integer, optionalText } from "./library.ts";
type Tables = Database["public"]["Tables"];
export type Note = Pick<
  Tables["notes"]["Row"],
  "id" | "body" | "episode_number" | "position_seconds" | "created_at" | "version"
>;
export type WatchLink = Pick<Tables["watch_links"]["Row"], "id" | "label" | "url" | "version">;
export type Tag = Pick<Tables["personal_tags"]["Row"], "id" | "name">;
export type Episode = Pick<
  Tables["episode_schedule"]["Row"],
  "sort_no" | "episode_no" | "air_date"
>;
export type JournalIndex = {
  notes: Record<string, Note[]>;
  links: Record<string, WatchLink[]>;
  tags: Tag[];
  assignments: Record<string, string[]>;
  episodes: Record<string, Episode[]>;
};
export function parseTime(value: unknown): number | null {
  const s = optionalText(value);
  if (!s) return null;
  if (!/^(?:\d+:[0-5]\d|\d+:[0-5]\d:[0-5]\d)$/.test(s))
    throw new AppError(422, "时间点请使用 分:秒 或 时:分:秒，例如 14:20");
  return integer(
    s.split(":").reduce((n, x) => n * 60 + Number(x), 0),
    0,
    2147483647,
    "时间点",
  );
}
export function timeLabel(seconds: number) {
  const ss = String(seconds % 60).padStart(2, "0");
  const mins = Math.floor(seconds / 60);
  return mins < 60
    ? mins + ":" + ss
    : Math.floor(mins / 60) + ":" + String(mins % 60).padStart(2, "0") + ":" + ss;
}
export function cleanNote(p: Record<string, unknown>) {
  const body = optionalText(p.body);
  const episode_number = integer(p.episode, 1, 2147483647, "集数");
  const position_seconds = parseTime(p.time);
  if (position_seconds !== null && episode_number === null)
    throw new AppError(422, "记录时间点时请同时填写集数");
  if (!body && episode_number === null) throw new AppError(422, "请写下笔记或填写书签集数");
  return { body, episode_number, position_seconds };
}
export function cleanLink(p: Record<string, unknown>) {
  const label = optionalText(p.label);
  const url = httpUrl(p.url, "播放地址");
  if (!url || !label) throw new AppError(422, "请填写播放名称与完整链接");
  return { label, url };
}
export function playableUrl(url: string) {
  try {
    return httpUrl(url, "播放地址");
  } catch {
    return null;
  }
}
