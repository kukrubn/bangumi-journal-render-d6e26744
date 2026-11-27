import { strToU8, zipSync } from "fflate";
import { fieldsFor, backupTables, type BackupRow, type Tables } from "./backup.ts";
import { watchLabels } from "./library.ts";

// Quote every cell. Keep embedded CR/LF and quotes and neutralize spreadsheet formulas.
export function csvCell(value: unknown): string {
  let s =
    value === null || value === undefined
      ? ""
      : Array.isArray(value)
        ? JSON.stringify(value)
        : String(value);
  if (typeof value === "string" && (/^[\t\r\n]/.test(s) || /^\s*[=+\-@＝＋－＠]/u.test(s)))
    s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
function csv(headers: string[], rows: unknown[][]) {
  return (
    "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n"
  );
}
function values(row: BackupRow, cols: string[]) {
  return cols.map((c) => row[c]);
}
export function libraryCsv(tables: Tables) {
  const tagNames = new Map(tables.personal_tags.map((t) => [t.id, t.name]));
  const tags = new Map<string, string[]>();
  for (const t of tables.entry_tags) {
    const id = String(t.entry_id);
    if (!tags.has(id)) tags.set(id, []);
    tags.get(id)!.push(String(tagNames.get(t.tag_id) ?? ""));
  }
  return csv(
    [
      "本地 UUID",
      "Bangumi ID",
      "中文名",
      "原名",
      "观看状态",
      "已看集数",
      "计划集数",
      "个人评分",
      "首播日",
      "载体",
      "维基标签",
      "社区标签",
      "个人标签",
      "个人短评",
    ],
    tables.library_entries.map((r) => [
      ...values(r, ["id", "bangumi_id", "title_cn", "title_original"]),
      watchLabels[r.watch_status as keyof typeof watchLabels],
      ...values(r, [
        "watched_episodes",
        "total_episodes",
        "personal_rating",
        "premiere_date",
        "platform",
        "meta_tags",
        "community_tags",
      ]),
      (tags.get(String(r.id)) ?? []).join("、"),
      r.review,
    ]),
  );
}
export function fullCsvZip(tables: Tables) {
  const files: Record<string, Uint8Array> = {};
  for (const table of backupTables) {
    const columns = fieldsFor(table);
    files[table + ".csv"] = strToU8(
      csv(
        columns,
        tables[table].map((r) => values(r, columns)),
      ),
    );
  }
  return zipSync(files);
}
