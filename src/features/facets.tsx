import { ListFilter } from "lucide-react";
import { airLabels, type Entry } from "@/lib/domain/library";
import { genres, type Facets } from "@/lib/domain/filters";
import type { Tag } from "@/lib/domain/journal";

export function LibraryFacets({
  value,
  change,
  entries,
  tags,
  clear,
  sidebar = false,
}: {
  value: Facets;
  change: (f: Facets) => void;
  entries: Entry[];
  tags: Tag[];
  clear: () => void;
  sidebar?: boolean;
}) {
  const kinds = [...new Set(entries.flatMap(genres))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const years = [
    ...new Set(entries.flatMap((e) => (e.premiere_date ? [e.premiere_date.slice(0, 4)] : []))),
  ]
    .sort()
    .reverse();
  const platforms = [...new Set(entries.flatMap((e) => (e.platform ? [e.platform] : [])))].sort();
  const count = [value.air, value.platform, value.genre, value.year, ...value.tags].filter(
    Boolean,
  ).length;
  return (
    <details
      className={"facets " + (sidebar ? "facet-side" : "facet-mobile")}
      open={sidebar || undefined}
    >
      <summary>
        <ListFilter size={16} />
        组合筛选{count > 0 && <b>{count}</b>}
      </summary>
      <div className="facet-grid">
        <label>
          放送状态
          <select
            value={value.air}
            onChange={(e) => change({ ...value, air: e.target.value as Facets["air"] })}
          >
            <option value="">全部放送状态</option>
            {Object.entries(airLabels).map(([k, s]) => (
              <option key={k} value={k}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          载体
          <select
            value={value.platform}
            onChange={(e) => change({ ...value, platform: e.target.value })}
          >
            <option value="">全部载体</option>
            {platforms.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          类型
          <select value={value.genre} onChange={(e) => change({ ...value, genre: e.target.value })}>
            <option value="">全部类型</option>
            {kinds.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </label>
        <label>
          开播年份
          <select value={value.year} onChange={(e) => change({ ...value, year: e.target.value })}>
            <option value="">全部年份</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="facet-tags">
        <legend>个人标签（同时匹配）</legend>
        {tags.length === 0 && <span className="hint">在番剧手记中添加标签后可筛选。</span>}
        {tags.map((t) => (
          <button
            className="tag-pill"
            key={t.id}
            aria-pressed={value.tags.includes(t.id)}
            onClick={() =>
              change({
                ...value,
                tags: value.tags.includes(t.id)
                  ? value.tags.filter((id) => id !== t.id)
                  : [...value.tags, t.id],
              })
            }
          >
            {t.name}
          </button>
        ))}
      </fieldset>
      <button className="text-button facet-clear" onClick={clear}>
        清空全部筛选
      </button>
    </details>
  );
}
