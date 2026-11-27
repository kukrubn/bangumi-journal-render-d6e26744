import "server-only";
import { createHash } from "node:crypto";
import {
  cleanUsername,
  parseCollectionPage,
  personalFields,
  prepareCollectionItem,
  type PersonalField,
  type SyncReply,
  type SyncRun,
} from "@/lib/domain/collection";
import { AppError, integer, record, uuid, type Entry } from "@/lib/domain/library";
import { databaseError, type Owner } from "@/lib/supabase/server";
import { collectionPage, getSubjectMetadata } from "./bangumi";
import { mergeSource } from "@/lib/domain/bangumi";
import { entryById } from "./library";

export async function completeCollectionMetadata(a: Owner, id: string) {
  let entry = await entryById(a, id);
  if (!entry.bangumi_id || entry.metadata_fetched_at) return { saved: false };
  const source = await getSubjectMetadata(a.db, entry.bangumi_id);
  for (let attempt = 0; attempt < 2; attempt++) {
    if (entry.bangumi_id !== source.bangumi_id || entry.metadata_fetched_at)
      return { saved: false };
    const { data, error } = await a.db
      .from("library_entries")
      .update({
        ...mergeSource(entry, source),
        metadata_fetched_at: new Date().toISOString(),
      })
      .eq("owner_id", a.uid)
      .eq("id", id)
      .eq("version", entry.version)
      .select("id")
      .maybeSingle();
    if (error) databaseError(error);
    if (data) return { saved: true };
    entry = await entryById(a, id);
  }
  throw new AppError(409, "其他设备刚修改了本番，请稍后重试详情补全");
}

async function runById(a: Owner, id: string) {
  const { data, error } = await a.db
    .from("sync_runs")
    .select("*")
    .eq("owner_id", a.uid)
    .eq("id", id)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new AppError(404, "没有找到这次同步记录");
  return data;
}

export async function recentRuns(a: Owner) {
  const { data, error } = await a.db
    .from("sync_runs")
    .select("*")
    .eq("owner_id", a.uid)
    .order("updated_at", { ascending: false })
    .limit(12);
  if (error) databaseError(error);
  return { runs: data };
}

export async function startRun(a: Owner, input: Record<string, unknown>): Promise<SyncReply> {
  const username = cleanUsername(input.username),
    id = uuid(input.id);
  const result = await a.db
    .from("sync_runs")
    .upsert(
      { owner_id: a.uid, id, username },
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    )
    .select("*");
  if (!result.error) {
    const run = result.data[0] ?? (await runById(a, id));
    if (run.username !== username) throw new AppError(409, "同步标识已用于其他用户，请重试");
    return { run };
  }
  if (result.error.code !== "23505") databaseError(result.error);
  const { data, error } = await a.db
    .from("sync_runs")
    .select("*")
    .eq("owner_id", a.uid)
    .eq("username", username)
    .in("state", ["running", "paused"])
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new AppError(409, "同步任务刚刚更新，请再试一次");
  return { run: data };
}

async function changeState(a: Owner, run: SyncRun, state: "paused" | "running" | "cancelled") {
  const { data, error } = await a.db
    .from("sync_runs")
    .update({ state, last_error: null, retry_at: null })
    .eq("owner_id", a.uid)
    .eq("id", run.id)
    .in("state", ["paused", "running"])
    .select("*")
    .maybeSingle();
  if (error) databaseError(error);
  return { run: data ?? (await runById(a, run.id)) };
}

function choicesFrom(input: unknown) {
  if (input === undefined) return new Map<number, PersonalField[]>();
  const choices = new Map<number, PersonalField[]>();
  for (const [key, fields] of Object.entries(record(input))) {
    const id = integer(key, 1, 2147483647, "条目 ID");
    if (
      id === null ||
      !Array.isArray(fields) ||
      fields.length > 4 ||
      !fields.every((f) => personalFields.includes(f))
    )
      throw new AppError(422, "个人字段选项有误");
    if (fields.length) choices.set(id, fields);
  }
  return choices;
}

export async function stepRun(
  a: Owner,
  id: string,
  input: Record<string, unknown>,
): Promise<SyncReply> {
  const run = await runById(a, id),
    mode = input.action;
  if (run.state === "done" || run.state === "cancelled") return { run };
  if (mode === "pause" || mode === "cancel")
    return changeState(a, run, mode === "cancel" ? "cancelled" : "paused");
  if (run.retry_at && Date.parse(run.retry_at) > Date.now()) {
    throw new AppError(
      429,
      "Bangumi 正在冷却，请稍后继续",
      Math.ceil((Date.parse(run.retry_at) - Date.now()) / 1000),
    );
  }
  if (mode === "resume") return changeState(a, run, "running");
  if (mode !== "preview" && mode !== "apply") throw new AppError(400, "未知的同步操作");
  if (run.state !== "running" || input.offset !== run.next_offset) return { run };
  const choices = choicesFrom(input.choices);
  if (choices.size && typeof input.digest !== "string")
    throw new AppError(409, "请先预览要覆盖的个人字段");
  let page;
  try {
    page = parseCollectionPage(
      await collectionPage(a.db, run.username, run.next_offset),
      run.next_offset,
    );
  } catch (err) {
    if (err instanceof AppError) {
      const { error } = await a.db
        .from("sync_runs")
        .update({
          state: "paused",
          last_error: err.message,
          retry_at: err.retryAfter
            ? new Date(Date.now() + err.retryAfter * 1000).toISOString()
            : null,
        })
        .eq("owner_id", a.uid)
        .eq("id", id)
        .eq("version", run.version);
      if (error) databaseError(error);
    }
    throw err;
  }
  const existing = new Map<number, Entry>();
  if (page.items.length) {
    const { data, error } = await a.db
      .from("library_entries")
      .select("*")
      .eq("owner_id", a.uid)
      .in(
        "bangumi_id",
        page.items.map((item) => item.source.bangumi_id),
      );
    if (error) databaseError(error);
    for (const entry of data) existing.set(entry.bangumi_id!, entry);
  }
  const prepared = page.items.map((item) =>
    prepareCollectionItem(
      item,
      existing.get(item.source.bangumi_id),
      choices.get(item.source.bangumi_id),
    ),
  );
  // Bind explicit overrides to the remote page and the local versions the owner actually previewed.
  const digest = createHash("sha256")
    .update(
      JSON.stringify([id, run.next_offset, page, prepared.map((x) => [x.row.id, x.row.version])]),
    )
    .digest("hex");
  if (mode === "preview")
    return {
      run,
      preview: {
        offset: run.next_offset,
        total: page.total,
        count: page.count,
        skipped: page.count - prepared.length,
        digest,
        rows: prepared.map((x) => x.preview),
      },
    };
  if (input.digest !== undefined && input.digest !== digest)
    throw new AppError(409, "收藏或本地条目已经变化，请重新预览本页并确认");
  const { data, error } = await a.db.rpc("apply_collection_page", {
    p_run_id: id,
    p_offset: run.next_offset,
    p_count: page.count,
    p_total: page.total,
    p_rows: prepared.map((x) => x.row),
  });
  if (error?.code === "40001") throw new AppError(409, "片单已在其他设备更新，请重新预览本页");
  if (error) databaseError(error);
  return { run: data as unknown as SyncRun };
}
