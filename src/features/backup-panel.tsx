"use client";
import "./backup.css";
import { useRef, useState, type ChangeEvent } from "react";
import { ArchiveRestore, Download, FileJson, FileSpreadsheet, RotateCcw } from "lucide-react";
import { tableLabels, type Preview } from "@/lib/domain/backup";
import { AppError } from "@/lib/domain/library";
import { message } from "@/lib/client";

type Result = { preview: Preview; revision: string };
async function restoreRequest<T>(input: object): Promise<T> {
  const payload = JSON.stringify(input);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: BodyInit = payload;
  if (payload.length > 131072 && typeof CompressionStream !== "undefined") {
    body = await new Response(
      new Blob([payload]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    headers["X-Backup-Gzip"] = "1";
  }
  const response = await fetch("/api/backup", { method: "POST", headers, body, cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    if (response.status === 401) window.location.assign("/login?expired=1");
    throw new AppError(
      response.status,
      data?.error ??
        (response.status === 413
          ? "备份超过当前托管平台的上传限制，可在本地启动同一项目后恢复"
          : "恢复请求未完成，请重试"),
    );
  }
  return data;
}

export function BackupPanel({ onRestored }: { onRestored?: () => void } = {}) {
  const [file, setFile] = useState<{ name: string; data: unknown } | null>(null);
  const [plan, setPlan] = useState<Result | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const control = useRef<HTMLInputElement>(null),
    lock = useRef(false);

  async function preview(value: unknown) {
    setPlan(null);
    setSelected(new Set());
    const next = await restoreRequest<Result>({ action: "preview", file: value });
    setPlan(next);
  }
  async function work(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(message(e));
      if (e instanceof AppError && e.status === 409) setPlan(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const upload = event.target.files?.[0];
    if (!upload) return;
    void work(async () => {
      setPlan(null);
      setFile(null);
      setSelected(new Set());
      let data: unknown;
      try {
        data = JSON.parse((await upload.text()).replace(/^\uFEFF/, ""));
      } catch {
        throw new AppError(422, "文件不是有效的 JSON 备份");
      }
      setFile({ name: upload.name, data });
      await preview(data);
    });
  }
  function apply() {
    if (!file || !plan) return;
    void work(async () => {
      const done = await restoreRequest<{ written: number; kept: number; unchanged: number }>({
        action: "apply",
        file: file.data,
        revision: plan.revision,
        selected: [...selected],
      });
      setNotice(
        "恢复完成，写入 " +
          done.written +
          " 条，保留 " +
          done.kept +
          " 条本地冲突记录，" +
          done.unchanged +
          " 条内容相同。",
      );
      setPlan(null);
      setFile(null);
      if (control.current) control.current.value = "";
      onRestored?.();
    });
  }
  function toggle(key: string) {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const counts = plan?.preview;
  return (
    <section className="backup-panel" aria-labelledby="backup-title">
      <h2 id="backup-title">
        <ArchiveRestore size={21} />
        备份与恢复
      </h2>
      <div className="backup-downloads">
        <a className="btn neutral" href="/api/backup?format=json" download>
          <FileJson size={16} />
          完整 JSON
        </a>
        <a className="btn neutral" href="/api/backup?format=csv" download>
          <FileSpreadsheet size={16} />
          片单 CSV
        </a>
        <a className="btn neutral" href="/api/backup?format=zip" download>
          <Download size={16} />
          全部 CSV（ZIP）
        </a>
      </div>
      <label className="backup-upload">
        从 JSON 恢复
        <input
          ref={control}
          type="file"
          disabled={busy}
          accept=".json,application/json"
          onChange={choose}
        />
      </label>
      {busy && <p role="status">正在处理备份…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {file && !plan && !busy && (
        <button className="btn neutral" onClick={() => void work(() => preview(file.data))}>
          <RotateCcw size={15} />
          重新预览
        </button>
      )}
      {file && counts && (
        <div className="restore-preview">
          <h3>恢复预览</h3>
          <p>
            {file.name} · 新增 {counts.added} 条，冲突 {counts.conflicts.length} 条，相同{" "}
            {counts.unchanged} 条，无效 {counts.invalid.length} 条。
          </p>
          {!!counts.invalid.length && (
            <div role="alert">
              <p>请修正文件后重新选择。</p>
              <ul>
                {counts.invalid.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {!!counts.conflicts.length && (
            <fieldset disabled={busy}>
              <legend>勾选采用备份的记录，其余冲突保留本地内容</legend>
              <label>
                <input
                  type="checkbox"
                  checked={selected.size === counts.conflicts.length}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? new Set(counts.conflicts.map((c) => c.key)) : new Set(),
                    )
                  }
                />
                全部采用备份
              </label>
              <div className="backup-conflicts">
                {counts.conflicts.map((c) => (
                  <label key={c.key}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.key)}
                      onChange={() => toggle(c.key)}
                    />
                    <span>
                      {tableLabels[c.table]} · {c.label}
                      <small>{c.fields.join("、")}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <button
            className="btn primary"
            disabled={busy || !!counts.invalid.length}
            onClick={apply}
          >
            确认恢复
            {counts.added + selected.size > 0 ? " " + (counts.added + selected.size) + " 条" : ""}
          </button>
        </div>
      )}
    </section>
  );
}
