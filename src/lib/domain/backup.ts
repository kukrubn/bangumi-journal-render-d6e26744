import {
  AppError,
  cleanManual,
  httpUrl,
  isoDate,
  metadataFields,
  record,
  uuid,
} from "./library.ts";

const stamps = { created_at: "stamp", updated_at: "stamp", version: "positive64" };
const idRow = { id: "id", ...stamps };
const child = { ...idRow, entry_id: "id" };
const schema = {
  user_settings: { ...stamps, minutes_per_episode: "positive", theme: "text" },
  library_entries: {
    ...idRow,
    bangumi_id: "positive?",
    title_cn: "text?",
    title_original: "text?",
    cover_url: "text?",
    platform: "text?",
    meta_tags: "strings",
    community_tags: "strings",
    total_episodes: "positive?",
    premiere_date: "day?",
    end_date: "day?",
    air_weekday: "positive?",
    release_pattern: "text",
    airing_override: "text?",
    calendar_seen_on: "day?",
    metadata_fetched_at: "stamp?",
    schedule_fetched_at: "stamp?",
    locked_fields: "strings",
    watch_status: "text",
    watched_episodes: "nonnegative",
    personal_rating: "positive?",
    review: "text?",
    last_watched_at: "stamp?",
  },
  personal_tags: { ...idRow, name: "text" },
  episode_schedule: {
    ...child,
    bangumi_episode_id: "positive?",
    sort_no: "numeric",
    episode_no: "numeric?",
    title: "text?",
    air_date: "day?",
    manually_edited: "boolean",
  },
  notes: { ...child, body: "text?", episode_number: "positive?", position_seconds: "nonnegative?" },
  watch_links: { ...child, label: "text", url: "text" },
  entry_tags: { entry_id: "id", tag_id: "id" },
} satisfies Record<string, Record<string, string>>;

export type BackupTable = keyof typeof schema;
export const backupTables = Object.keys(schema) as BackupTable[];
export const tableLabels: Record<BackupTable, string> = {
  user_settings: "个人设置",
  library_entries: "番剧",
  personal_tags: "个人标签",
  episode_schedule: "本篇章节",
  notes: "笔记与书签",
  watch_links: "播放链接",
  entry_tags: "标签关联",
};
export type Cell = string | number | boolean | string[] | null;
export type BackupRow = Record<string, Cell>;
export type Tables = Record<BackupTable, BackupRow[]>;
export type BackupFile = { schemaVersion: 1; exportedAt: string; tables: Tables };
export type Snapshot = { revision: string; tables: Tables };
export type Conflict = { key: string; table: BackupTable; label: string; fields: string[] };
export type Preview = {
  added: number;
  unchanged: number;
  conflicts: Conflict[];
  invalid: string[];
};
export const fieldsFor = (table: BackupTable) => Object.keys(schema[table]);
export const emptyTables = (): Tables => ({
  user_settings: [],
  library_entries: [],
  personal_tags: [],
  episode_schedule: [],
  notes: [],
  watch_links: [],
  entry_tags: [],
});
function invalid(msg: string): never {
  throw new AppError(422, msg);
}
const validText = (v: unknown): v is string => typeof v === "string" && !v.includes("\0");
const stampPattern =
  /^(\d{4}-\d\d-\d\d)T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.(\d{1,6}))?(?:Z|[+-]\d\d:\d\d)$/i;
function timestamp(v: unknown) {
  if (typeof v !== "string") return null;
  const m = stampPattern.exec(v);
  if (!m || !isoDate(m[1]) || !Number.isFinite(Date.parse(v))) return null;
  return new Date(v).toISOString().slice(0, 23) + (m[2] ?? "").padEnd(6, "0").slice(3) + "Z";
}
function readCell(kind: string, v: unknown, key: string): Cell {
  if (kind.endsWith("?") && (v === null || (typeof v === "string" && !v.trim()))) return null;
  switch (kind.replace(/\?$/, "")) {
    case "id":
      return uuid(v).toLowerCase();
    case "text":
      if (validText(v)) return v;
      break;
    case "strings":
      if (Array.isArray(v) && v.every(validText)) return v;
      break;
    case "stamp":
      if (timestamp(v)) return v as string;
      break;
    case "day":
      if (isoDate(v)) return v as string;
      break;
    case "boolean":
      if (typeof v === "boolean") return v;
      break;
    case "numeric":
      if (typeof v === "number" && Number.isFinite(v)) return v;
      break;
    case "positive64":
      if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
      break;
    case "positive":
    case "nonnegative":
      if (
        typeof v === "number" &&
        Number.isInteger(v) &&
        v < 2147483648 &&
        v >= (kind.startsWith("positive") ? 1 : 0)
      )
        return v;
      break;
  }
  return invalid(key + " 缺失或格式无效");
}
function parseRow(table: BackupTable, raw: unknown): BackupRow {
  const source = record(raw),
    row: BackupRow = {};
  const definitions: Record<string, string> = schema[table];
  for (const key of Object.keys(source))
    if (key !== "owner_id" && !Object.hasOwn(definitions, key)) invalid("包含未知字段 " + key);
  for (const [key, kind] of Object.entries(definitions))
    row[key] = readCell(kind, source[key], key);
  switch (table) {
    case "user_settings":
      if (
        Number(row.minutes_per_episode) > 1440 ||
        !["system", "light", "dark"].includes(String(row.theme))
      )
        invalid("设置值超出范围");
      break;
    case "library_entries":
      cleanManual(row);
      if (!row.watch_status || !row.release_pattern || row.airing_override === "")
        invalid("状态或规律无效");
      if (
        !(row.locked_fields as string[]).every((s) =>
          (metadataFields as readonly string[]).includes(s),
        )
      )
        invalid("含未知的锁定字段");
      if (row.cover_url !== null) {
        if (!httpUrl(row.cover_url)) invalid("封面链接无效");
        row.cover_url = String(row.cover_url).trim();
      }
      break;
    case "personal_tags":
      if (!row.name || String(row.name).trim() !== row.name) invalid("标签名无效");
      break;
    case "episode_schedule":
      if (!row.bangumi_episode_id && !row.manually_edited) invalid("来源章节 ID 缺失");
      break;
    case "notes":
      if (
        !row.episode_number &&
        (!(row.body as string | null)?.trim() || row.position_seconds !== null)
      )
        invalid("笔记正文、集数或时间点无效");
      break;
    case "watch_links":
      if (!httpUrl(row.url, "播放地址") || !String(row.label).trim()) invalid("播放链接无效");
      row.url = String(row.url).trim();
      break;
  }
  return row;
}
function primary(table: BackupTable, r: BackupRow): string {
  if (table === "user_settings") return "settings";
  if (table === "entry_tags") return r.entry_id + "/" + r.tag_id;
  return String(r.id);
}
function natural(table: BackupTable, r: BackupRow): string | null {
  switch (table) {
    case "library_entries":
      return r.bangumi_id === null ? null : String(r.bangumi_id);
    case "personal_tags":
      return String(r.name).toLowerCase();
    case "episode_schedule":
      return r.bangumi_episode_id === null ? null : r.entry_id + "/" + r.bangumi_episode_id;
    default:
      return null;
  }
}
function comparable(field: string, v: Cell) {
  if (field.endsWith("_at") && v !== null) return timestamp(v);
  return JSON.stringify(v);
}
function description(table: BackupTable, r: BackupRow): string {
  const name = r.title_cn || r.title_original || r.name || r.label || r.body || r.title;
  return name ? String(name).slice(0, 100) : tableLabels[table] + " " + primary(table, r);
}

// Resolve parents first, then match child UUIDs within the resolved parent. A manual
// title is not an identity. One target cannot be claimed by two backup records.
export function planRestore(
  raw: unknown,
  local: Tables,
  selected: ReadonlySet<string> = new Set(),
) {
  const file = record(raw);
  if (file.schemaVersion !== 1 || !timestamp(file.exportedAt))
    invalid("请输入版本为 1 且带有效导出时间的番剧手账备份");
  const tables = record(file.tables);
  if (Object.keys(tables).some((k) => !Object.hasOwn(schema, k))) invalid("备份包含未知的数据表");
  const changes = emptyTables();
  const preview: Preview = { added: 0, unchanged: 0, conflicts: [], invalid: [] };
  const parents = new Map<string, string>(),
    tags = new Map<string, string>();
  for (const table of backupTables) {
    const incoming = tables[table];
    if (!Array.isArray(incoming)) invalid("缺少备份表 " + table);
    const byId = new Map(local[table].map((r) => [primary(table, r), r]));
    const byNatural = new Map<string, BackupRow>();
    for (const r of local[table]) {
      const k = natural(table, r);
      if (k !== null) byNatural.set(k, r);
    }
    const usedIds = new Set<string>(),
      usedNatural = new Set<string>(),
      sourceIds = new Set<string>();
    for (let i = 0; i < incoming.length; i++) {
      try {
        const r = parseRow(table, incoming[i]);
        if (r.entry_id) r.entry_id = parents.get(String(r.entry_id)) ?? invalid("条目引用缺失");
        if (r.tag_id) r.tag_id = tags.get(String(r.tag_id)) ?? invalid("标签引用缺失");
        const sourceId = primary(table, r),
          k = natural(table, r);
        const bySource = k === null ? undefined : byNatural.get(k);
        const byUuid = byId.get(sourceId);
        if (byUuid && bySource && byUuid.id !== bySource.id)
          invalid("UUID 与来源索引对应不同的本地记录");
        const match = byUuid ?? bySource;
        if (match && r.entry_id && match.entry_id !== r.entry_id)
          invalid("UUID 对应另一部番的子记录");
        if (byUuid && ["library_entries", "episode_schedule"].includes(table)) {
          const previous = natural(table, byUuid);
          if (previous !== null && k !== null && previous !== k)
            invalid("相同 UUID 指向不同的 Bangumi ID");
        }
        const targetId = match ? primary(table, match) : sourceId;
        if (sourceIds.has(sourceId) || usedIds.has(targetId) || (k !== null && usedNatural.has(k)))
          invalid("存在重复记录或重复的来源标识");
        sourceIds.add(sourceId);
        usedIds.add(targetId);
        if (k !== null) usedNatural.add(k);
        if (table === "library_entries") parents.set(sourceId, targetId);
        if (table === "personal_tags") tags.set(sourceId, targetId);
        if (r.id) r.id = targetId;
        if (!match) {
          changes[table].push(r);
          preview.added++;
          continue;
        }
        const fields = fieldsFor(table).filter(
          (f) =>
            !["created_at", "updated_at", "version"].includes(f) &&
            comparable(f, match[f]) !== comparable(f, r[f]),
        );
        if (!fields.length) {
          preview.unchanged++;
          continue;
        }
        const key = table + ":" + sourceId;
        preview.conflicts.push({ key, table, label: description(table, r), fields });
        if (selected.has(key)) changes[table].push(r);
      } catch (e) {
        preview.invalid.push(
          tableLabels[table] +
            " 第 " +
            (i + 1) +
            " 行：" +
            (e instanceof Error ? e.message : "格式无效"),
        );
      }
    }
  }
  return { changes, preview };
}
