"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Clock3, Clapperboard, Film, SlidersHorizontal } from "lucide-react";
import { request, message } from "@/lib/client";
import { AppError } from "@/lib/domain/library";
import { durationText, minutesPerEpisode, type DashboardData } from "@/lib/domain/dashboard";
import { Modal } from "@/components/ui/dialog";

export function Dashboard({ initial }: { initial: DashboardData }) {
  const [data, setData] = useState(initial),
    [mode, setMode] = useState<"platforms" | "genres">("platforms");
  const [expanded, setExpanded] = useState(false),
    [warning, setWarning] = useState("");
  const [edit, setEdit] = useState<{ text: string; version: number | null } | null>(null);
  const [saving, setSaving] = useState(false),
    [editError, setEditError] = useState("");
  const reads = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++reads.current;
    try {
      const next = await request<DashboardData>("/api/dashboard");
      if (seq === reads.current) {
        setData(next);
        setWarning("");
      }
      return next;
    } catch (e) {
      if (seq === reads.current) setWarning(message(e));
      return null;
    }
  }, []);
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(visible, 45000);
    return () => {
      clearInterval(timer);
      ++reads.current;
      window.removeEventListener("focus", visible);
      window.removeEventListener("online", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (!edit || saving) return;
    setSaving(true);
    setEditError("");
    ++reads.current;
    try {
      const result = await request<Pick<DashboardData, "version" | "minutes">>(
        "/api/dashboard",
        "PATCH",
        { minutes: minutesPerEpisode(edit.text), version: edit.version },
      );
      ++reads.current;
      setData((old) => ({ ...old, ...result }));
      setEdit(null);
    } catch (e) {
      setEditError(message(e));
      if (e instanceof AppError && e.status === 409) {
        const next = await refresh();
        if (next) {
          setEdit((prev) => prev && { ...prev, version: next.version });
          setEditError("另一端已将时长设为 " + next.minutes + " 分钟。确认后可再次保存。");
        }
      }
    } finally {
      setSaving(false);
    }
  }
  const { stats, minutes } = data;
  const ranked = stats[mode];
  return (
    <section className="dashboard-page">
      <header className="dashboard-head">
        <div>
          <h1>统计看板</h1>
        </div>
        <button
          className="btn neutral"
          onClick={() => {
            setEdit({ text: String(minutes), version: data.version });
            setEditError("");
          }}
        >
          <SlidersHorizontal size={16} />
          单集时长
        </button>
      </header>
      {warning && (
        <div className="warn-line" role="alert">
          {warning}
          <button className="text-button" onClick={() => void refresh()}>
            重新加载
          </button>
        </div>
      )}
      <div className="dash-totals">
        <article className="dash-time">
          <span>
            <Clock3 size={17} />
            估算观看时长
          </span>
          <strong>{durationText(stats.episodes, minutes)}</strong>
          <small>按每集 {minutes} 分钟计算</small>
        </article>
        <article>
          <span>
            <Clapperboard size={17} />
            累计观看
          </span>
          <strong>
            {stats.episodes.toLocaleString("zh-CN")} <small>集</small>
          </strong>
        </article>
        <article>
          <span>
            <Film size={17} />
            片单总数
          </span>
          <strong>
            {stats.count.toLocaleString("zh-CN")} <small>部</small>
          </strong>
        </article>
      </div>
      <section className="dash-panel">
        <h2>观看状态</h2>
        <dl className="dash-states">
          {stats.states.map((row) => (
            <div key={row.name}>
              <dt>{row.name}</dt>
              <dd>
                {row.count} <small>部</small>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="dash-charts">
        <section className="dash-panel">
          <div className="chart-head">
            <h2>类型分布</h2>
            <div className="dash-switch">
              {(["platforms", "genres"] as const).map((k) => (
                <button
                  key={k}
                  aria-pressed={mode === k}
                  onClick={() => {
                    setMode(k);
                    setExpanded(false);
                  }}
                >
                  {k === "platforms" ? "载体" : "题材"}
                </button>
              ))}
            </div>
          </div>
          {mode === "genres" && <p className="chart-note">一部番可计入多个维基题材。</p>}
          {ranked.length ? (
            <ul className="rank-chart">
              {(expanded ? ranked : ranked.slice(0, 8)).map((row) => (
                <li key={row.name}>
                  <span>{row.name}</span>
                  <i aria-hidden="true">
                    <b style={{ width: (row.count / ranked[0].count) * 100 + "%" }} />
                  </i>
                  <strong>{row.count} 部</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="dash-empty">添加番剧后即可查看类型分布。</p>
          )}
          {ranked.length > 8 && (
            <button className="text-button" onClick={() => setExpanded(!expanded)}>
              {expanded ? "收起" : "查看全部 " + ranked.length + " 类"}
            </button>
          )}
        </section>
        <section className="dash-panel">
          <div className="chart-head">
            <h2>个人评分</h2>
            <span>未评分 {stats.unrated} 部</span>
          </div>
          {stats.count > stats.unrated ? (
            <>
              <div className="rating-plot">
                <ResponsiveContainer width="100%" height="100%" minWidth={1}>
                  <BarChart
                    data={stats.ratings}
                    margin={{ top: 10, right: 8, bottom: 0, left: 0 }}
                    accessibilityLayer
                  >
                    <CartesianGrid stroke="var(--line)" vertical={false} strokeDasharray="3 4" />
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tick={{ fill: "var(--muted)", fontSize: 12 }}
                    />
                    <YAxis
                      allowDecimals={false}
                      width={30}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: "var(--muted)", fontSize: 12 }}
                    />
                    <Tooltip
                      labelFormatter={(label) => label + " 分"}
                      contentStyle={{
                        background: "var(--surface)",
                        borderColor: "var(--line)",
                        color: "var(--ink)",
                      }}
                      cursor={{ fill: "var(--tint)" }}
                    />
                    <Bar
                      name="番剧数"
                      unit=" 部"
                      dataKey="count"
                      fill="var(--brand)"
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <details className="rating-table">
                <summary>查看各评分数量</summary>
                <dl>
                  {stats.ratings.map((r) => (
                    <div key={r.name}>
                      <dt>{r.name} 分</dt>
                      <dd>{r.count} 部</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </>
          ) : (
            <p className="dash-empty">给番剧打分后，这里会显示 1–10 分的分布。</p>
          )}
        </section>
      </div>
      {edit && (
        <Modal title="调整单集时长" onClose={() => setEdit(null)} busy={saving}>
          <form onSubmit={save}>
            <div className="modal-body fields">
              <label>
                每集分钟数
                <input
                  autoFocus
                  type="number"
                  required
                  min="1"
                  max="1440"
                  step="1"
                  value={edit.text}
                  onChange={(ev) => setEdit({ ...edit, text: ev.target.value })}
                />
              </label>
              {editError && (
                <p role="alert" className="error">
                  {editError}
                </p>
              )}
            </div>
            <div className="modal-foot">
              <button
                type="button"
                disabled={saving}
                className="btn neutral ml-auto"
                onClick={() => setEdit(null)}
              >
                取消
              </button>
              <button className="btn primary" disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
