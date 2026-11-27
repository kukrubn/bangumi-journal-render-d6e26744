import "server-only";
import { AppError, optionalText, shanghaiDay, uuid, version } from "@/lib/domain/library";
import { cleanLink, cleanNote, type JournalIndex } from "@/lib/domain/journal";
import { scheduleFresh } from "@/lib/domain/schedule";
import { databaseError, type Owner } from "@/lib/supabase/server";
import { calendarWeekday, mainEpisodes } from "./bangumi";
import { entryById, listEntries } from "./library";

async function journalIndex(a: Owner): Promise<JournalIndex> {
  const { data, error } = await a.db.rpc("library_journal_index");
  if (error) databaseError(error);
  return data as unknown as JournalIndex;
}
export async function readShelf(a: Owner) {
  const [entries, index] = await Promise.all([listEntries(a), journalIndex(a)]);
  return { entries, index };
}

const conflict = () => new AppError(409, "记录已在另一端更改或删除，请重新打开记录再编辑");
export async function changeJournal(
  a: Owner,
  entry: string,
  method: string,
  p: Record<string, unknown>,
) {
  await entryById(a, entry);
  if (p.kind === "tag") {
    if (method === "POST") {
      const name = optionalText(p.name);
      if (!name) throw new AppError(422, "请填写标签名称");
      const { error } = await a.db.rpc("attach_entry_tag", { p_entry_id: entry, p_name: name });
      if (error) databaseError(error);
    } else if (method === "DELETE") {
      const { error } = await a.db
        .from("entry_tags")
        .delete()
        .eq("owner_id", a.uid)
        .eq("entry_id", entry)
        .eq("tag_id", uuid(p.id));
      if (error) databaseError(error);
    } else throw new AppError(405, "不支持此标签操作");
    return { saved: true };
  }
  if (p.kind !== "note" && p.kind !== "link") throw new AppError(422, "记录类型无效");
  const id = uuid(p.id);
  const table = p.kind === "note" ? "notes" : "watch_links";
  if (method === "DELETE") {
    const { data, error } = await a.db
      .from(table)
      .delete()
      .eq("owner_id", a.uid)
      .eq("entry_id", entry)
      .eq("id", id)
      .eq("version", version(p.version))
      .select("id")
      .maybeSingle();
    if (error) databaseError(error);
    if (!data) throw conflict();
    return { saved: true };
  }
  const values = p.kind === "note" ? cleanNote(p) : cleanLink(p);
  if (method === "PATCH") {
    const { data, error } = await a.db
      .from(table)
      .update(values)
      .eq("owner_id", a.uid)
      .eq("entry_id", entry)
      .eq("id", id)
      .eq("version", version(p.version))
      .select("id")
      .maybeSingle();
    if (error) databaseError(error);
    if (!data) throw conflict();
  } else {
    const base = { id, entry_id: entry, owner_id: a.uid };
    const options = { onConflict: "owner_id,id", ignoreDuplicates: true };
    const created =
      "url" in values
        ? await a.db
            .from("watch_links")
            .upsert({ ...base, ...values }, options)
            .select("id")
        : await a.db
            .from("notes")
            .upsert({ ...base, ...values }, options)
            .select("id");
    if (created.error) databaseError(created.error);
    if (!created.data.length) {
      const { data, error } = await a.db
        .from(table)
        .select("*")
        .eq("owner_id", a.uid)
        .eq("entry_id", entry)
        .eq("id", id)
        .maybeSingle();
      if (error) databaseError(error);
      if (
        !data ||
        !Object.entries(values).every(([k, v]) => (data as Record<string, unknown>)[k] === v)
      )
        throw conflict();
    }
  }
  return { saved: true };
}

export async function syncSchedule(a: Owner, entry: string, force: boolean) {
  const e = await entryById(a, entry);
  if (!e.bangumi_id) throw new AppError(422, "手动条目没有可同步的 Bangumi 本篇章节");
  if (!force && scheduleFresh(e, Date.now())) return { saved: false };
  const episodes = await mainEpisodes(a.db, e.bangumi_id);
  const day =
    e.end_date && e.end_date <= shanghaiDay() ? null : await calendarWeekday(a.db, e.bangumi_id);
  const { data, error } = await a.db.rpc("replace_episode_schedule", {
    p_entry_id: entry,
    p_bangumi_id: e.bangumi_id,
    p_previous_fetch: e.schedule_fetched_at ?? undefined,
    p_episodes: episodes,
    p_calendar_weekday: day ?? undefined,
  });
  if (error) databaseError(error);
  return { saved: data };
}
