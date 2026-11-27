import "server-only";
import { AppError, version } from "@/lib/domain/library";
import { minutesPerEpisode, summarize, type DashboardData } from "@/lib/domain/dashboard";
import { databaseError, type Owner } from "@/lib/supabase/server";
import { listEntries } from "./library";

export async function readDashboard(actor: Owner): Promise<DashboardData> {
  const [entries, settings] = await Promise.all([
    listEntries(actor),
    actor.db
      .from("user_settings")
      .select("minutes_per_episode,version")
      .eq("owner_id", actor.uid)
      .maybeSingle(),
  ]);
  if (settings.error) databaseError(settings.error);
  return {
    stats: summarize(entries),
    minutes: settings.data?.minutes_per_episode ?? 24,
    version: settings.data?.version ?? null,
  };
}
export async function saveMinutes(actor: Owner, input: Record<string, unknown>) {
  const minutes_per_episode = minutesPerEpisode(input.minutes);
  const table = actor.db.from("user_settings");
  const update =
    input.version === null
      ? table.insert({ owner_id: actor.uid, minutes_per_episode })
      : table
          .update({ minutes_per_episode })
          .eq("owner_id", actor.uid)
          .eq("version", version(input.version));
  const { data, error } = await update.select("minutes_per_episode,version").maybeSingle();
  if (error && error.code !== "23505") databaseError(error);
  if (!data) throw new AppError(409, "另一端已修改设置，请确认当前值后再保存");
  return { minutes: data.minutes_per_episode, version: data.version };
}
