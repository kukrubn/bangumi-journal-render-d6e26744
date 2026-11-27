import type { Database } from "../../types/database.ts";
import { normalizeSubject, mergeSource, type SourceSubject } from "./bangumi.ts";
import { AppError, type Entry, type WatchStatus } from "./library.ts";

export type SyncRun = Database["public"]["Tables"]["sync_runs"]["Row"];
export const personalFields = [
  "watch_status",
  "watched_episodes",
  "personal_rating",
  "review",
] as const;
export type PersonalField = (typeof personalFields)[number];
type Personal = Pick<Entry, PersonalField>;
type CollectionItem = {
  source: SourceSubject;
  personal: Partial<Personal> & Pick<Personal, "watch_status">;
};
export type Difference = {
  field: PersonalField;
  local: string | number | null;
  remote: string | number | null;
};
export type PreviewRow = {
  id: number;
  title: string;
  status: WatchStatus;
  progress: number | null;
  existing: boolean;
  differences: Difference[];
};
export type PagePreview = {
  offset: number;
  total: number;
  count: number;
  skipped: number;
  digest: string;
  rows: PreviewRow[];
};
export type SyncReply = { run: SyncRun; preview?: PagePreview };
const statuses: Record<number, WatchStatus> = {
  1: "planned",
  2: "completed",
  3: "watching",
  4: "on_hold",
  5: "dropped",
};
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const validInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 2147483647;

export function cleanUsername(input: unknown) {
  if (typeof input !== "string") throw new AppError(422, "请填写 Bangumi 用户名或数字 ID");
  const username = input.trim();
  if (
    !username ||
    username.length > 128 ||
    /[\s/\\?#@\u0000-\u001f\u007f]/u.test(username) ||
    username === "." ||
    username === ".."
  )
    throw new AppError(422, "请填写 Bangumi 个人主页中的用户名或数字 ID");
  return username;
}

export function parseCollectionPage(raw: unknown, offset: number) {
  const page = object(raw);
  if (
    !validInt(page.total) ||
    page.offset !== offset ||
    !validInt(page.limit) ||
    page.limit === 0 ||
    page.limit > 20 ||
    !Array.isArray(page.data) ||
    page.data.length > page.limit
  )
    throw new AppError(502, "Bangumi 收藏分页格式异常，游标已保留");
  const items: CollectionItem[] = [];
  const seen = new Set<number>();
  for (const record of page.data) {
    const c = object(record),
      s = object(c.subject);
    if (
      c.private !== false ||
      c.subject_type !== 2 ||
      !validInt(c.type) ||
      !statuses[c.type] ||
      !validInt(c.subject_id) ||
      c.subject_id < 1 ||
      seen.has(c.subject_id) ||
      s.id !== c.subject_id ||
      (s.type !== undefined && s.type !== 2)
    )
      continue;
    if (![s.name, s.name_cn].some((n) => typeof n === "string" && n.trim())) continue;
    const source = normalizeSubject({ ...s, type: 2 });
    const personal: CollectionItem["personal"] = { watch_status: statuses[c.type] };
    if (validInt(c.ep_status)) personal.watched_episodes = c.ep_status;
    if (validInt(c.rate) && c.rate <= 10) personal.personal_rating = c.rate || null;
    if (typeof c.comment === "string") personal.review = c.comment.trim() || null;
    seen.add(c.subject_id);
    items.push({ source, personal });
  }
  return { items, count: page.data.length, total: page.total };
}

export function prepareCollectionItem(
  item: CollectionItem,
  old?: Entry,
  apply: PersonalField[] = [],
) {
  const differences: Difference[] = old
    ? personalFields.flatMap((field) => {
        const remote = item.personal[field];
        return remote !== undefined && old[field] !== remote
          ? [{ field, local: old[field], remote }]
          : [];
      })
    : [];
  const source = item.source;
  const patch: Record<string, string | number | null | string[]> = old
    ? { ...mergeSource(old, source) }
    : { ...source, ...item.personal };
  if (old) for (const d of differences) if (apply.includes(d.field)) patch[d.field] = d.remote;
  return {
    row: { id: source.bangumi_id, version: old?.version ?? null, patch },
    preview: {
      id: source.bangumi_id,
      title: source.title_cn || source.title_original || String(source.bangumi_id),
      existing: !!old,
      status: item.personal.watch_status,
      progress: item.personal.watched_episodes ?? null,
      differences,
    } satisfies PreviewRow,
  };
}
