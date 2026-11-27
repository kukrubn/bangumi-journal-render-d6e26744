import { AppError, integer, watchLabels, type Entry, type WatchStatus } from "./library.ts";

type StatEntry = Pick<
  Entry,
  "watch_status" | "personal_rating" | "platform" | "meta_tags" | "watched_episodes"
>;
export type Distribution = { name: string; count: number }[];
export type DashboardData = {
  stats: ReturnType<typeof summarize>;
  minutes: number;
  version: number | null;
};

export function minutesPerEpisode(input: unknown) {
  const value = integer(input, 1, 1440, "每集分钟数");
  if (value === null) throw new AppError(422, "请填写每集分钟数");
  return value;
}
export function durationText(episodes: number, minutes: number) {
  const total = episodes * minutes;
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (hours === 0) return total.toLocaleString("zh-CN") + " 分钟";
  return hours.toLocaleString("zh-CN") + " 小时" + (remainder ? " " + remainder + " 分钟" : "");
}
function ranked(counts: Map<string, number>): Distribution {
  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"),
  );
}
export function summarize(entries: StatEntry[]) {
  const states: Record<WatchStatus, number> = {
    watching: 0,
    planned: 0,
    completed: 0,
    on_hold: 0,
    dropped: 0,
  };
  const ratings = Array.from({ length: 10 }, (_, i) => ({ name: String(i + 1), count: 0 }));
  const platforms = new Map<string, number>(),
    genres = new Map<string, number>();
  let episodes = 0,
    unrated = 0;
  for (const e of entries) {
    states[e.watch_status]++;
    episodes += e.watched_episodes;
    const platform = e.platform?.trim() || "未分类";
    platforms.set(platform, (platforms.get(platform) ?? 0) + 1);
    const tags = new Set(e.meta_tags.map((t) => t.trim()).filter(Boolean));
    if (!tags.size) tags.add("未分类");
    for (const tag of tags) genres.set(tag, (genres.get(tag) ?? 0) + 1);
    if (e.personal_rating === null) unrated++;
    else ratings[e.personal_rating - 1].count++;
  }
  return {
    count: entries.length,
    episodes,
    states: (Object.keys(watchLabels) as WatchStatus[]).map((key) => ({
      name: watchLabels[key],
      count: states[key],
    })),
    platforms: ranked(platforms),
    genres: ranked(genres),
    ratings,
    unrated,
  };
}
