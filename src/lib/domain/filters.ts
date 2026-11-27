import { title, type Entry, type WatchStatus, type airLabels } from "./library.ts";
import type { JournalIndex } from "./journal.ts";
import { airedCount, scheduleState } from "./schedule.ts";

export type Facets = {
  air: "" | keyof typeof airLabels;
  platform: string;
  genre: string;
  year: string;
  tags: string[];
};
export const emptyFacets: Facets = { air: "", platform: "", genre: "", year: "", tags: [] };
export function genres(e: Entry) {
  return [...new Set([...e.meta_tags, ...e.community_tags])];
}
const descending = (a: number | null, b: number | null) =>
  a === null ? (b === null ? 0 : 1) : b === null ? -1 : b - a;
export function filterEntries(
  entries: Entry[],
  index: JournalIndex,
  today: string,
  status: WatchStatus | "all",
  facets: Facets,
  query: string,
  sort: string,
) {
  const term = query.trim().toLocaleLowerCase();
  const results = entries.filter((e) => {
    const linked = index.assignments[e.id] ?? [];
    return (
      (status === "all" || e.watch_status === status) &&
      (!facets.air || scheduleState(e, index.episodes[e.id] ?? [], today) === facets.air) &&
      (!facets.platform || e.platform === facets.platform) &&
      (!facets.genre || genres(e).includes(facets.genre)) &&
      (!facets.year || e.premiere_date?.slice(0, 4) === facets.year) &&
      facets.tags.every((id) => linked.includes(id)) &&
      (!term ||
        [
          e.title_cn,
          e.title_original,
          e.review,
          e.platform,
          ...genres(e),
          ...(index.notes[e.id] ?? []).map((n) => n.body),
          ...index.tags.filter((t) => linked.includes(t.id)).map((t) => t.name),
        ].some((s) => s?.toLocaleLowerCase().includes(term)))
    );
  });
  const debt = new Map(
    sort === "debt"
      ? results.map((e) => {
          const c = airedCount(e, index.episodes[e.id] ?? [], today);
          return [e.id, c.basis === "minimum" && !c.debt ? null : c.debt] as const;
        })
      : [],
  );
  return results.sort((a, b) => {
    let cmp: number;
    switch (sort) {
      case "title":
        cmp = title(a).localeCompare(title(b), "zh-CN");
        break;
      case "added":
        cmp = b.created_at.localeCompare(a.created_at);
        break;
      case "premiere":
        cmp = (b.premiere_date ?? "").localeCompare(a.premiere_date ?? "");
        break;
      case "rating":
        cmp = descending(a.personal_rating, b.personal_rating);
        break;
      case "debt":
        cmp = descending(debt.get(a.id) ?? null, debt.get(b.id) ?? null);
        break;
      default:
        cmp = (b.last_watched_at ?? b.created_at).localeCompare(a.last_watched_at ?? a.created_at);
    }
    return cmp || a.id.localeCompare(b.id);
  });
}
