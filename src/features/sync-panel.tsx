"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { DownloadCloud, RefreshCw } from "lucide-react";
import { request, message, operationId } from "@/lib/client";
import { watchLabels } from "@/lib/domain/library";
import type { PagePreview, PersonalField, SyncReply, SyncRun } from "@/lib/domain/collection";
import "./sync-panel.css";

const endpoint = "/api/sync/bangumi";
const states: Record<string, string> = {
  running: "进行中",
  paused: "已暂停",
  done: "已完成",
  cancelled: "已结束",
};
const labels: Record<PersonalField, string> = {
  watch_status: "状态",
  watched_episodes: "进度",
  personal_rating: "评分",
  review: "短评",
};
function display(field: PersonalField, v: string | number | null) {
  if (v === null) return "空";
  if (field === "watch_status") return watchLabels[v as keyof typeof watchLabels];
  return field === "watched_episodes" ? v + " 集" : String(v);
}
export function SyncPanel({ onChange }: { onChange?: () => void } = {}) {
  const [username, setUsername] = useState("");
  const [run, setRun] = useState<SyncRun | null>(null);
  const [recent, setRecent] = useState<SyncRun[]>([]);
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [choices, setChoices] = useState<Record<string, PersonalField[]>>({});
  const [busy, setBusy] = useState(false),
    [batch, setBatch] = useState(false);
  const [error, setError] = useState(""),
    [pausing, setPausing] = useState(false);
  const alive = useRef(true),
    lock = useRef(false),
    stop = useRef(false),
    serial = useRef(0);
  const current = useRef<SyncRun | null>(null);
  useEffect(() => {
    alive.current = true;
    const at = serial.current;
    request<{ runs: SyncRun[] }>(endpoint)
      .then((r) => {
        if (alive.current && serial.current === at) setRecent(r.runs);
      })
      .catch((e) => {
        if (alive.current && serial.current === at) setError(message(e));
      });
    return () => {
      alive.current = false;
      stop.current = true;
    };
  }, []);
  function remember(next: SyncRun) {
    current.current = next;
    if (!alive.current) return;
    setRun(next);
    setRecent((prev) => [next, ...prev.filter((r) => r.id !== next.id)].slice(0, 12));
  }
  async function perform(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    serial.current++;
    stop.current = false;
    setBusy(true);
    setError("");
    setPausing(false);
    try {
      await work();
    } catch (e) {
      if (alive.current) {
        setError(message(e));
        setPreview(null);
        setChoices({});
        try {
          const r = await request<{ runs: SyncRun[] }>(endpoint);
          if (alive.current) {
            setRecent(r.runs);
            const fresh = r.runs.find((x) => x.id === current.current?.id);
            if (fresh) remember(fresh);
          }
        } catch {
          /* the next explicit retry reads the committed cursor */
        }
      }
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setBatch(false);
        setPausing(false);
      }
    }
  }
  async function step(job: SyncRun, action: string, extra: object = {}) {
    const reply = await request<SyncReply>(endpoint + "/" + job.id + "/step", "POST", {
      action,
      offset: job.next_offset,
      ...extra,
    });
    remember(reply.run);
    return reply;
  }
  async function inspect(job: SyncRun) {
    setPreview(null);
    setChoices({});
    remember(job);
    if (job.state === "paused") job = (await step(job, "resume")).run;
    if (job.state !== "running" || !alive.current) return;
    const result = await step(job, "preview");
    if (alive.current) setPreview(result.preview ?? null);
  }
  function start(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      setPreview(null);
      setChoices({});
      const result = await request<SyncReply>(endpoint, "POST", { id: operationId(), username });
      if (alive.current) await inspect(result.run);
    });
  }
  function apply(all: boolean) {
    if (!run || !preview) return;
    const initial = run,
      snapshot = preview;
    void perform(async () => {
      setBatch(all);
      let next = (await step(initial, "apply", { digest: snapshot.digest, choices })).run;
      if (alive.current) {
        setPreview(null);
        setChoices({});
      }
      while (all && alive.current && !stop.current && next.state === "running")
        next = (await step(next, "apply")).run;
      if (alive.current && stop.current && next.state === "running")
        next = (await step(next, "pause")).run;
      if (alive.current) {
        onChange?.();
        if (!all && next.state === "running") await inspect(next);
      }
    });
  }
  const openJob = run && (run.state === "running" || run.state === "paused");
  return (
    <section className="collection-sync" aria-label="Bangumi 收藏同步">
      <h2>
        <DownloadCloud size={21} /> 同步 Bangumi 收藏
      </h2>
      <form className="sync-form" onSubmit={start}>
        <label>
          Bangumi 用户名或数字 ID
          <input
            required
            maxLength={128}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="个人主页 /user/ 后的名称"
          />
        </label>
        <button className="btn primary" disabled={busy}>
          预览公开收藏
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {run && (
        <div className="sync-job">
          <div className="sync-caption">
            <strong>{run.username}</strong>
            <span>{states[run.state]}</span>
          </div>
          <p aria-live="polite">
            已处理 {run.next_offset}
            {(run.total_hint ?? preview?.total) != null
              ? " / " + (run.total_hint ?? preview?.total)
              : ""}{" "}
            项 · 新增 {run.added} · 匹配 {run.matched} · 跳过 {run.skipped}
          </p>
          {run.last_error && !error && <p>{run.last_error}</p>}
          {run.retry_at && (
            <small>
              可重试时间{" "}
              {new Date(run.retry_at).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </small>
          )}
          {preview && (
            <div className="sync-preview">
              <p>新条目采用该用户的观看记录。已有条目保留本地记录，勾选下方差异可覆盖对应字段。</p>
              <ul>
                {preview.rows.map((row) => (
                  <li key={row.id}>
                    <div>
                      <strong>{row.title}</strong>
                      <small>
                        {row.existing ? "已在片单" : "新增"} · {watchLabels[row.status]}
                        {row.progress !== null ? " · 已看 " + row.progress + " 集" : ""}
                      </small>
                    </div>
                    {row.differences.map((d) => (
                      <label className="sync-choice" key={d.field}>
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={(choices[row.id] ?? []).includes(d.field)}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setChoices((old) => ({
                              ...old,
                              [row.id]: checked
                                ? [...(old[row.id] ?? []), d.field]
                                : (old[row.id] ?? []).filter((f) => f !== d.field),
                            }));
                          }}
                        />
                        <span>
                          {labels[d.field]}
                          {d.field === "watched_episodes" && Number(d.remote) < Number(d.local)
                            ? "回退"
                            : ""}
                          ：{display(d.field, d.local)} → {display(d.field, d.remote)}
                        </span>
                      </label>
                    ))}
                  </li>
                ))}
              </ul>
              {preview.skipped > 0 && (
                <p>{preview.skipped} 项缺少有效公开动画资料或在本页重复，将跳过。</p>
              )}
              {preview.count === 0 && <p>本页没有公开动画收藏。</p>}
            </div>
          )}
          <div className="sync-actions">
            {preview && (
              <>
                <button className="btn primary" disabled={busy} onClick={() => apply(true)}>
                  同步本页及后续全部
                </button>
                <button className="btn neutral" disabled={busy} onClick={() => apply(false)}>
                  仅同步本页
                </button>
              </>
            )}
            {batch && busy && (
              <button
                className="btn neutral"
                disabled={pausing}
                onClick={() => {
                  stop.current = true;
                  setPausing(true);
                }}
              >
                {pausing ? "正在暂停…" : "本页后暂停"}
              </button>
            )}
            {openJob && !preview && !busy && (
              <button className="btn neutral" onClick={() => void perform(() => inspect(run))}>
                <RefreshCw size={15} />
                继续预览
              </button>
            )}
            {openJob && !busy && (
              <button
                className="btn neutral"
                onClick={() =>
                  void perform(async () => {
                    await step(run, "cancel");
                    setPreview(null);
                    setChoices({});
                  })
                }
              >
                结束任务
              </button>
            )}
          </div>
          {preview && <small>连续同步时，后续页已有条目的个人记录自动保留。</small>}
        </div>
      )}
      {recent.filter((r) => r.id !== run?.id).length > 0 && (
        <details className="sync-history">
          <summary>最近同步</summary>
          <ul>
            {recent
              .filter((r) => r.id !== run?.id)
              .map((r) => (
                <li key={r.id}>
                  <span>
                    {r.username} · {states[r.state]} · 已处理 {r.next_offset} 项
                  </span>
                  {(r.state === "running" || r.state === "paused") && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void perform(() => inspect(r))}
                    >
                      继续
                    </button>
                  )}
                </li>
              ))}
          </ul>
        </details>
      )}
    </section>
  );
}
