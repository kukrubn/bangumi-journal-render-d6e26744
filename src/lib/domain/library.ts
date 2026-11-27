import type { Database } from "../../types/database.ts";

export type Entry = Database["public"]["Tables"]["library_entries"]["Row"];
export type WatchStatus = Entry["watch_status"];
export const watchLabels = {
  watching: "在看",
  planned: "想看",
  completed: "已看",
  on_hold: "搁置",
  dropped: "抛弃",
} as const;
export const airLabels = {
  upcoming: "未开播",
  airing: "连载中",
  finished: "已完结",
  unknown: "资料待补",
} as const;
export const releaseLabels = { weekly: "每周更新", irregular: "不定期", unknown: "未知" } as const;
export const metadataFields = [
  "title_cn",
  "title_original",
  "cover_url",
  "platform",
  "meta_tags",
  "community_tags",
  "total_episodes",
  "premiere_date",
  "end_date",
  "air_weekday",
  "release_pattern",
] as const;
export type MetadataField = (typeof metadataFields)[number];
export type Metadata = Pick<Entry, MetadataField>;
export type ManualValues = Metadata &
  Pick<
    Entry,
    "watch_status" | "watched_episodes" | "personal_rating" | "airing_override" | "review"
  >;
export const metaLabels: Record<MetadataField, string> = {
  title_cn: "中文名",
  title_original: "原名",
  cover_url: "封面",
  platform: "载体",
  meta_tags: "维基标签",
  community_tags: "社区标签",
  total_episodes: "总集数",
  premiere_date: "首播日",
  end_date: "结束日",
  air_weekday: "放送星期",
  release_pattern: "更新规律",
};
export class AppError extends Error {
  status: number;
  retryAfter?: number;
  constructor(status: number, message: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(400, "数据格式不正确");
  return value as Record<string, unknown>;
}
export function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new AppError(422, "文本字段格式不正确");
  return value.trim() || null;
}
export function integer(value: unknown, min: number, max: number, label: string): number | null {
  if (value == null || (typeof value === "string" && !value.trim())) return null;
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value.trim())))
    throw new AppError(422, label + "须为整数");
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new AppError(422, label + "超出有效范围");
  return n;
}
export function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value)
  )
    throw new AppError(400, "记录标识无效");
  return value;
}
export function version(value: unknown) {
  const v = integer(value, 1, Number.MAX_SAFE_INTEGER, "版本");
  if (v === null) throw new AppError(400, "缺少记录版本");
  return v;
}
export function httpUrl(value: unknown, label = "封面地址") {
  const text = optionalText(value);
  if (!text) return null;
  try {
    const u = new URL(text);
    if (
      !/^https?:\/\//i.test(text) ||
      !["http:", "https:"].includes(u.protocol) ||
      !u.hostname ||
      u.username ||
      u.password ||
      /\s/.test(text)
    )
      throw new Error();
    return u.href;
  } catch {
    throw new AppError(422, label + "须为有效的 HTTP 或 HTTPS 链接");
  }
}
export function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return null;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}
function formDate(value: unknown) {
  const s = optionalText(value);
  if (s && !isoDate(s)) throw new AppError(422, "请填写有效的日期");
  return s;
}
function choice<T extends string>(v: unknown, labels: Record<T, string>, fallback: T): T {
  if (v == null || v === "") return fallback;
  if (typeof v === "string" && Object.hasOwn(labels, v)) return v as T;
  throw new AppError(422, "所选状态无效");
}
function tags(v: unknown) {
  if (v == null) return [];
  const a: unknown[] = Array.isArray(v) ? v : (optionalText(v) ?? "").split(/[,，、\n]/);
  return [...new Set(a.map(optionalText).filter((s): s is string => Boolean(s)))];
}
export function cleanManual(value: unknown): ManualValues {
  const p = record(value);
  const title_cn = optionalText(p.title_cn),
    title_original = optionalText(p.title_original);
  if (!title_cn && !title_original) throw new AppError(422, "请至少填写中文名或原名");
  const premiere_date = formDate(p.premiere_date),
    end_date = formDate(p.end_date);
  if (premiere_date && end_date && end_date < premiere_date)
    throw new AppError(422, "结束日不能早于首播日");
  return {
    title_cn,
    title_original,
    premiere_date,
    end_date,
    cover_url: httpUrl(p.cover_url),
    platform: optionalText(p.platform),
    total_episodes: integer(p.total_episodes, 1, 2147483647, "总集数"),
    air_weekday: integer(p.air_weekday, 1, 7, "星期"),
    meta_tags: tags(p.meta_tags),
    community_tags: tags(p.community_tags),
    release_pattern: choice(p.release_pattern, releaseLabels, "unknown"),
    watch_status: choice(p.watch_status, watchLabels, "planned"),
    watched_episodes: integer(p.watched_episodes, 0, 2147483647, "已看集数") ?? 0,
    personal_rating: integer(p.personal_rating, 1, 10, "评分"),
    review: optionalText(p.review),
    airing_override: p.airing_override ? choice(p.airing_override, airLabels, "unknown") : null,
  };
}
export function hasValue(key: MetadataField, v: unknown) {
  return (
    v !== null &&
    v !== undefined &&
    (key !== "release_pattern" || v !== "unknown") &&
    (!Array.isArray(v) || v.length > 0)
  );
}
export function fieldEqual(a: unknown, b: unknown) {
  return Array.isArray(a)
    ? Array.isArray(b) && a.length === b.length && a.every((s, i) => s === b[i])
    : a === b;
}
export function manualLocks(values: ManualValues, old?: Entry, unlock: string[] = []) {
  if (!old) return metadataFields.filter((k) => hasValue(k, values[k]));
  const locks = new Set(old.locked_fields.filter((k) => !unlock.includes(k)));
  for (const k of metadataFields) if (!fieldEqual(old[k], values[k])) locks.add(k);
  return [...locks];
}
export function title(e: Pick<Entry, "title_cn" | "title_original">) {
  return e.title_cn || e.title_original || "未命名";
}
export function shanghaiDay(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function airState(e: Entry, today = shanghaiDay()): keyof typeof airLabels {
  if (e.airing_override) return e.airing_override;
  if (e.premiere_date && e.premiere_date > today) return "upcoming";
  if (e.end_date && e.end_date <= today) return "finished";
  if (e.premiere_date && e.end_date && e.premiere_date <= today) return "airing";
  if (
    e.calendar_seen_on &&
    e.calendar_seen_on <= today &&
    Date.parse(today) - Date.parse(e.calendar_seen_on) < 7 * 86400000
  )
    return "airing";
  return "unknown";
}
