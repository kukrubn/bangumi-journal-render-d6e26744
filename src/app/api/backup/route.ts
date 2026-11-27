import { ownerApi } from "@/lib/server/api";
import { AppError, record } from "@/lib/domain/library";
import { libraryCsv, fullCsvZip } from "@/lib/domain/backup-csv";
import { planRestore, type BackupFile, type Snapshot } from "@/lib/domain/backup";
import { databaseError, type Owner } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
async function snapshot(a: Owner): Promise<Snapshot> {
  const { data, error } = await a.db.rpc("backup_snapshot");
  if (error) databaseError(error);
  return data as unknown as Snapshot;
}

export async function GET(req: Request) {
  const format = new URL(req.url).searchParams.get("format") ?? "json";
  let file: Blob | undefined,
    name = "";
  const response = await ownerApi(req, async (a) => {
    if (!["json", "csv", "zip"].includes(format)) throw new AppError(400, "备份格式无效");
    const { tables } = await snapshot(a);
    const date = new Date().toISOString();
    if (format === "csv") {
      file = new Blob([libraryCsv(tables)], { type: "text/csv;charset=utf-8" });
      name = "library.csv";
    } else if (format === "zip") {
      file = new Blob([new Uint8Array(fullCsvZip(tables))], { type: "application/zip" });
      name = "bangumi-csv-" + date.slice(0, 10) + ".zip";
    } else {
      const full: BackupFile = { schemaVersion: 1, exportedAt: date, tables };
      file = new Blob([JSON.stringify(full, null, 2)], { type: "application/json;charset=utf-8" });
      name = "bangumi-journal-" + date.slice(0, 10) + ".json";
    }
    return {};
  });
  if (!response.ok || !file) return response;
  const headers = new Headers(response.headers);
  headers.set("Content-Disposition", 'attachment; filename="' + name + '"');
  headers.set("Content-Type", file.type);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(file.stream(), { headers });
}

export function POST(req: Request) {
  return ownerApi(req, async (a) => {
    let input;
    try {
      const compressed = req.headers.get("x-backup-gzip") === "1" && req.body;
      input = record(
        await (
          compressed ? new Response(compressed.pipeThrough(new DecompressionStream("gzip"))) : req
        ).json(),
      );
    } catch {
      throw new AppError(400, "备份请求不是有效的 JSON");
    }
    if (input.action !== "preview" && input.action !== "apply")
      throw new AppError(400, "恢复操作无效");
    const local = await snapshot(a);
    if (input.action === "apply" && input.revision !== local.revision)
      throw new AppError(409, "片单自预览后已发生变化，请重新预览再恢复");
    if (
      input.selected !== undefined &&
      (!Array.isArray(input.selected) || !input.selected.every((k) => typeof k === "string"))
    )
      throw new AppError(422, "冲突选择无效");
    const selected = new Set<string>(input.selected as string[] | undefined);
    const { preview, changes } = planRestore(input.file, local.tables, selected);
    if (input.action === "preview") return { preview, revision: local.revision };
    if (preview.invalid.length) throw new AppError(422, preview.invalid[0]);
    const conflicts = new Set(preview.conflicts.map((c) => c.key));
    if ([...selected].some((k) => !conflicts.has(k)))
      throw new AppError(409, "冲突记录已变化，请重新预览");
    const { data, error } = await a.db.rpc("restore_backup", {
      p_changes: changes,
      p_revision: local.revision,
    });
    if (error) {
      if (["40001", "40P01"].includes(error.code))
        throw new AppError(409, "资料正在另一端更新，请重新预览");
      databaseError(error);
    }
    return {
      written: data,
      kept: preview.conflicts.length - selected.size,
      unchanged: preview.unchanged,
    };
  });
}
