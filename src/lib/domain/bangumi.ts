import {
  AppError,
  fieldEqual,
  hasValue,
  httpUrl,
  isoDate,
  metadataFields,
  type Entry,
  type Metadata,
} from "./library.ts";

export type SubjectPreview = {
  id: number;
  title_cn: string | null;
  title_original: string | null;
  cover_url: string | null;
  date: string | null;
  platform: string | null;
};
export type SourceSubject = Metadata & { bangumi_id: number; calendar_seen_on: string | null };
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown) => (typeof v === "string" ? v.trim() || null : null);
const positive = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647 ? v : null;
export function parseSubjectId(input: unknown): number {
  let raw = typeof input === "number" ? String(input) : (text(input) ?? "");
  if (!/^\d+$/.test(raw)) {
    try {
      const u = new URL(raw.includes("://") ? raw : "https://" + raw);
      if (
        !["https:", "http:"].includes(u.protocol) ||
        !["bgm.tv", "bangumi.tv", "chii.in"].includes(u.hostname) ||
        u.port ||
        u.username ||
        u.password
      )
        throw new Error();
      raw = /^\/subject\/(\d+)\/?$/.exec(u.pathname)?.[1] ?? "";
    } catch {
      raw = "";
    }
  }
  const n = positive(Number(raw));
  if (!n) throw new AppError(422, "请输入正整数 ID 或 Bangumi 条目链接，例如 bgm.tv/subject/253");
  return n;
}
function safeCover(v: unknown) {
  for (const k of ["common", "large", "medium", "small", "grid"]) {
    try {
      const url = httpUrl(text(object(v)[k]));
      if (url) return url;
    } catch {
      /* next image size */
    }
  }
  return null;
}
function date(v: unknown) {
  const raw = text(v);
  if (!raw) return null;
  const m = /^(\d{4})(?:年|[-/.])(\d{1,2})(?:月|[-/.])(\d{1,2})日?$/.exec(raw);
  return m ? isoDate([m[1], m[2].padStart(2, "0"), m[3].padStart(2, "0")].join("-")) : null;
}
export function preview(raw: unknown): SubjectPreview | null {
  const v = object(raw),
    id = positive(v.id);
  const title_cn = text(v.name_cn),
    title_original = text(v.name);
  if (v.type !== 2 || !id || (!title_cn && !title_original)) return null;
  return {
    id,
    title_cn,
    title_original,
    cover_url: safeCover(v.images),
    date: date(v.date),
    platform: text(v.platform),
  };
}
function list(v: unknown, names: boolean) {
  return Array.isArray(v)
    ? [...new Set(v.map((x) => text(names ? object(x).name : x)).filter((x): x is string => !!x))]
    : [];
}
export function calendarDays(raw: unknown) {
  const result: Record<number, number> = {};
  if (!Array.isArray(raw)) return result;
  for (const day of raw) {
    const g = object(day),
      n = positive(object(g.weekday).id);
    if (!n || n > 7 || !Array.isArray(g.items)) continue;
    for (const item of g.items) {
      const id = positive(object(item).id);
      if (id) result[id] = n;
    }
  }
  return result;
}
export function normalizeSubject(raw: unknown, weekday?: number, today?: string): SourceSubject {
  const v = object(raw),
    p = preview(raw);
  if (v.type !== 2) throw new AppError(422, "这不是动画条目");
  if (!p) throw new AppError(502, "Bangumi 返回的条目资料缺少有效 ID 或名称");
  const info = Array.isArray(v.infobox) ? v.infobox.map(object) : [];
  const end = date(
    info.find((x) =>
      ["播放结束", "放送结束", "放送終了", "播放結束", "上映结束"].includes(String(x.key)),
    )?.value,
  );
  return {
    bangumi_id: p.id,
    title_cn: p.title_cn,
    title_original: p.title_original,
    cover_url: p.cover_url,
    platform: p.platform,
    meta_tags: list(v.meta_tags, false),
    community_tags: list(v.tags, true),
    total_episodes: positive(v.eps),
    premiere_date: p.date,
    end_date: end && (!p.date || end >= p.date) ? end : null,
    air_weekday: weekday ?? null,
    release_pattern: weekday ? "weekly" : "unknown",
    calendar_seen_on: weekday ? (today ?? null) : null,
  };
}
export function mergeSource(old: Entry, incoming: SourceSubject): Partial<Metadata> {
  const change: Partial<Metadata> = {};
  for (const k of metadataFields) {
    if (
      !old.locked_fields.includes(k) &&
      hasValue(k, incoming[k]) &&
      !fieldEqual(old[k], incoming[k])
    )
      Object.assign(change, { [k]: incoming[k] });
  }
  const start = change.premiere_date ?? old.premiere_date,
    end = change.end_date ?? old.end_date;
  if (start && end && end < start) {
    if (change.end_date) delete change.end_date;
    else if (old.locked_fields.includes("end_date")) delete change.premiere_date;
    else change.end_date = null;
  }
  return change;
}
