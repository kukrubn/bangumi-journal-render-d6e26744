import "server-only";
import {
  AppError,
  cleanManual,
  integer,
  manualLocks,
  metadataFields,
  uuid,
  version,
  type Entry,
} from "@/lib/domain/library";
import { mergeSource, parseSubjectId } from "@/lib/domain/bangumi";
import { databaseError, type Owner } from "@/lib/supabase/server";
import { getSubject } from "./bangumi";

const conflict = () => new AppError(409, "这条记录已在另一端修改，请刷新后再确认");
function shelf(a: Owner) {
  return a.db.from("library_entries");
}
export async function listEntries(a: Owner) {
  const rows: Entry[] = [];
  let cursor: string | undefined;
  for (;;) {
    let q = shelf(a).select("*").eq("owner_id", a.uid).order("id").limit(200);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q;
    if (error) databaseError(error);
    if (!data.length) return rows;
    rows.push(...data);
    cursor = data[data.length - 1].id;
  }
}
export async function entryById(a: Owner, id: string) {
  const { data, error } = await shelf(a)
    .select("*")
    .eq("owner_id", a.uid)
    .eq("id", id)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new AppError(404, "这部番已被移除");
  return data;
}
export async function addManual(a: Owner, p: Record<string, unknown>) {
  const values = cleanManual(p.values),
    id = uuid(p.id);
  const { data, error } = await shelf(a)
    .upsert(
      {
        ...values,
        id,
        owner_id: a.uid,
        locked_fields: manualLocks(values),
        last_watched_at: values.watched_episodes ? new Date().toISOString() : null,
      },
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    )
    .select("*");
  if (error) databaseError(error);
  const entry = data[0] ?? (await entryById(a, id));
  return {
    entry,
    suggestCompletion:
      entry.total_episodes !== null &&
      entry.watched_episodes === entry.total_episodes &&
      entry.watch_status !== "completed",
  };
}
export async function importSubject(a: Owner, input: unknown) {
  const id = parseSubjectId(input),
    source = await getSubject(a.db, id);
  const stamp = new Date().toISOString();
  const { data, error } = await shelf(a)
    .upsert(
      { ...source, owner_id: a.uid, metadata_fetched_at: stamp },
      { onConflict: "owner_id,bangumi_id", ignoreDuplicates: true },
    )
    .select("*");
  if (error) databaseError(error);
  if (data[0]) return { entry: data[0], created: true };
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await shelf(a)
      .select("*")
      .eq("owner_id", a.uid)
      .eq("bangumi_id", id)
      .maybeSingle();
    if (existing.error) databaseError(existing.error);
    if (!existing.data) throw conflict();
    const old = existing.data,
      patch: Partial<Entry> = mergeSource(old, source);
    if (source.calendar_seen_on && old.calendar_seen_on !== source.calendar_seen_on)
      patch.calendar_seen_on = source.calendar_seen_on;
    if (!Object.keys(patch).length) return { entry: old, created: false };
    const saved = await shelf(a)
      .update({ ...patch, metadata_fetched_at: stamp })
      .eq("owner_id", a.uid)
      .eq("id", old.id)
      .eq("version", old.version)
      .select("*")
      .maybeSingle();
    if (saved.error) databaseError(saved.error);
    if (saved.data) return { entry: saved.data, created: false };
  }
  throw conflict();
}
export async function editEntry(a: Owner, id: string, p: Record<string, unknown>) {
  const expected = version(p.version),
    old = await entryById(a, id);
  if (old.version !== expected) throw conflict();
  let patch: Partial<Entry>,
    suggestCompletion = false;
  if (p.intent === "complete") {
    if (old.total_episodes === null || old.watched_episodes !== old.total_episodes)
      throw conflict();
    patch = { watch_status: "completed", personal_rating: integer(p.rating, 1, 10, "评分") };
  } else {
    const values = cleanManual(p.values);
    const unlock = Array.isArray(p.unlock)
      ? metadataFields.filter((k) => (p.unlock as unknown[]).includes(k))
      : [];
    patch = { ...values, locked_fields: manualLocks(values, old, unlock) };
    if (values.watched_episodes !== old.watched_episodes) {
      patch.last_watched_at = new Date().toISOString();
      suggestCompletion =
        values.total_episodes !== null &&
        values.watched_episodes === values.total_episodes &&
        values.watch_status !== "completed";
    }
  }
  const { data, error } = await shelf(a)
    .update(patch)
    .eq("owner_id", a.uid)
    .eq("id", id)
    .eq("version", expected)
    .select("*")
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw conflict();
  return { entry: data, suggestCompletion };
}
export async function deleteEntry(a: Owner, id: string, expected: unknown) {
  const { data, error } = await shelf(a)
    .delete()
    .eq("owner_id", a.uid)
    .eq("id", id)
    .eq("version", version(expected))
    .select("id")
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw conflict();
  return { id: data.id };
}
export async function increment(a: Owner, id: string, requestId: unknown) {
  const result = await a.db
    .rpc("increment_progress", { p_entry_id: id, p_request_id: uuid(requestId) })
    .single();
  if (result.error) databaseError(result.error);
  const entry = await entryById(a, id);
  return {
    entry,
    advanced: result.data.advanced,
    replayed: result.data.replayed,
    suggestCompletion:
      result.data.suggest_completion && entry.version === result.data.version_after,
  };
}
