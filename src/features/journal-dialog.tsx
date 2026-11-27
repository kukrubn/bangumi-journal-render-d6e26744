"use client";
import { useRef, useState, type FormEvent } from "react";
import {
  Bookmark,
  ExternalLink,
  Link2,
  NotebookPen,
  Pencil,
  RefreshCw,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/dialog";
import { message, operationId, request } from "@/lib/client";
import { AppError, title, type Entry } from "@/lib/domain/library";
import {
  cleanLink,
  cleanNote,
  playableUrl,
  timeLabel,
  type JournalIndex,
  type Note,
  type WatchLink,
} from "@/lib/domain/journal";
import { airedCount, debtLabel } from "@/lib/domain/schedule";

type Tab = "note" | "link" | "tag";
const tabs = {
  note: ["笔记与书签", NotebookPen],
  link: ["播放链接", Link2],
  tag: ["个人标签", Tags],
} as const;
export function JournalDialog({
  entry,
  index,
  today,
  onClose,
  onChange,
  onSync,
  syncing,
}: {
  entry: Entry;
  index: JournalIndex;
  today: string;
  onClose: () => void;
  onChange: () => Promise<void>;
  onSync: (e: Entry) => Promise<void>;
  syncing: boolean;
}) {
  const [tab, setTab] = useState<Tab>("note");
  const [editing, setEditing] = useState<Note | WatchLink | null>(null);
  const [removal, setRemoval] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [feedback, setFeedback] = useState("");
  const operation = useRef<string | null>(null),
    saving = useRef(false);
  const notes = index.notes[entry.id] ?? [],
    links = index.links[entry.id] ?? [];
  const tagged = index.assignments[entry.id] ?? [];
  const count = airedCount(entry, index.episodes[entry.id] ?? [], today);
  const note = editing && "body" in editing ? editing : null,
    link = editing && "url" in editing ? editing : null;
  function reset(next: Note | WatchLink | null = null) {
    setEditing(next);
    setRemoval(null);
    setFormKey((n) => n + 1);
    setError("");
    setFeedback("");
    operation.current = null;
  }
  async function save(method: string, data: Record<string, unknown>) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await request("/api/library/" + entry.id + "/journal", method, { kind: tab, ...data });
      await onChange();
      reset();
      setFeedback(method === "DELETE" ? (tab === "tag" ? "已移出本番" : "记录已删除") : "已保存");
    } catch (e) {
      setError(message(e));
      if (e instanceof AppError && e.status === 409) await onChange();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (tab === "note") cleanNote(fields);
      if (tab === "link") cleanLink(fields);
    } catch (e) {
      setError(message(e));
      return;
    }
    operation.current ??= operationId();
    void save(editing ? "PATCH" : "POST", {
      ...fields,
      id: editing?.id ?? operation.current,
      version: editing?.version,
    });
  }
  function controls(row: Note | WatchLink, name: string) {
    if (removal === row.id)
      return (
        <div className="record-actions">
          <button className="text-button" onClick={() => setRemoval(null)}>
            取消
          </button>
          <button
            className="text-button remove-action"
            onClick={() => void save("DELETE", { id: row.id, version: row.version })}
          >
            确认删除
          </button>
        </div>
      );
    return (
      <div className="record-actions">
        <button
          className="icon-btn"
          aria-label={"编辑" + name}
          onClick={() => {
            reset(row);
            document.getElementById("journal-fields")?.scrollIntoView({ block: "nearest" });
          }}
        >
          <Pencil size={15} />
        </button>
        <button className="icon-btn" aria-label={"删除" + name} onClick={() => setRemoval(row.id)}>
          <Trash2 size={15} />
        </button>
      </div>
    );
  }
  return (
    <Modal title={title(entry)} description="追番手记" wide busy={busy} onClose={onClose}>
      <div className="modal-body journal-body">
        <div className="schedule-summary">
          <div>
            <strong>{debtLabel(count)}</strong>
            <small>
              {count.aired === null
                ? "放送资料待补"
                : (count.basis === "estimated"
                    ? "按周更预计已播 "
                    : count.basis === "minimum"
                      ? "本篇日期已确认至少 "
                      : "按本篇日期已播 ") +
                  count.aired +
                  " 集"}{" "}
              · 已看 {entry.watched_episodes} 集
            </small>
            {entry.schedule_fetched_at && (
              <small>
                最近同步{" "}
                {new Intl.DateTimeFormat("zh-CN", {
                  timeZone: "Asia/Shanghai",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                }).format(new Date(entry.schedule_fetched_at))}
              </small>
            )}
          </div>
          {entry.bangumi_id && (
            <button
              className="btn neutral compact"
              disabled={syncing || busy}
              onClick={async () => {
                setError("");
                setFeedback("");
                try {
                  await onSync(entry);
                  setFeedback("本篇放送日期已刷新");
                } catch (e) {
                  setError(message(e));
                }
              }}
            >
              <RefreshCw size={14} className={syncing ? "spin" : ""} />
              {syncing ? "同步中" : "刷新章节"}
            </button>
          )}
        </div>
        {entry.review && (
          <p className="brief-review">
            <strong>个人短评</strong> {entry.review}
          </p>
        )}
        <div className="tabs journal-tabs" aria-label="手记栏目">
          {(Object.keys(tabs) as Tab[]).map((k) => {
            const [label, Icon] = tabs[k];
            return (
              <button
                key={k}
                disabled={busy}
                aria-pressed={tab === k}
                onClick={() => {
                  setTab(k);
                  reset();
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            );
          })}
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {feedback && (
          <p className="journal-feedback" role="status">
            {feedback}
          </p>
        )}
        <fieldset disabled={busy} className="journal-fieldset">
          <form id="journal-fields" key={formKey} className="fields journal-form" onSubmit={submit}>
            {tab === "note" && (
              <>
                <label>
                  碎片笔记
                  <textarea
                    name="body"
                    rows={2}
                    defaultValue={note?.body ?? ""}
                    placeholder="记下这一集的观感…"
                  />
                </label>
                <div className="form-pair">
                  <label>
                    书签集数
                    <input
                      type="number"
                      min="1"
                      step="1"
                      name="episode"
                      placeholder="如 6"
                      defaultValue={note?.episode_number ?? ""}
                    />
                  </label>
                  <label>
                    时间点
                    <input
                      name="time"
                      placeholder="如 14:20"
                      defaultValue={
                        note?.position_seconds != null ? timeLabel(note.position_seconds) : ""
                      }
                    />
                  </label>
                </div>
              </>
            )}
            {tab === "link" && (
              <>
                <label>
                  播放名称
                  <input
                    name="label"
                    required
                    placeholder="如 哔哩哔哩"
                    defaultValue={link?.label ?? ""}
                  />
                </label>
                <label>
                  播放地址
                  <input
                    name="url"
                    type="url"
                    required
                    placeholder="https://"
                    defaultValue={link?.url ?? ""}
                  />
                </label>
              </>
            )}
            {tab === "tag" && (
              <label>
                标签名称
                <input
                  name="name"
                  required
                  list="known-tags"
                  autoComplete="off"
                  placeholder="如 下饭"
                />
                <datalist id="known-tags">
                  {index.tags
                    .filter((t) => !tagged.includes(t.id))
                    .map((t) => (
                      <option value={t.name} key={t.id} />
                    ))}
                </datalist>
              </label>
            )}
            <div className="form-buttons">
              <button className="btn primary" type="submit">
                {editing
                  ? "保存修改"
                  : tab === "note"
                    ? "保存笔记或书签"
                    : tab === "link"
                      ? "添加播放链接"
                      : "添加标签"}
              </button>
              {editing && (
                <button className="btn neutral" type="button" onClick={() => reset()}>
                  取消编辑
                </button>
              )}
            </div>
          </form>
          {tab === "note" && (
            <div className="records">
              <h3>
                笔记与书签 <small>{notes.length}</small>
              </h3>
              {!notes.length && <p className="hint">还没有笔记或书签。</p>}
              {notes.map((n) => (
                <article key={n.id} className="journal-record">
                  <div>
                    {n.episode_number !== null && (
                      <span className="bookmark-label">
                        <Bookmark size={13} />第 {n.episode_number} 集
                        {n.position_seconds !== null && " · " + timeLabel(n.position_seconds)}
                      </span>
                    )}
                    {n.body && <p>{n.body}</p>}
                    <small>
                      {new Intl.DateTimeFormat("zh-CN", {
                        timeZone: "Asia/Shanghai",
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      }).format(new Date(n.created_at))}
                    </small>
                  </div>
                  {controls(n, "笔记")}
                </article>
              ))}
            </div>
          )}
          {tab === "link" && (
            <div className="records">
              <h3>
                观看直达 <small>{links.length}</small>
              </h3>
              {!links.length && <p className="hint">还没有播放链接。</p>}
              {links.map((l) => {
                const url = playableUrl(l.url);
                return (
                  <article key={l.id} className="journal-record">
                    <div>
                      {url ? (
                        <a
                          className="watch-anchor"
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {l.label}
                          <ExternalLink size={15} />
                        </a>
                      ) : (
                        <strong>{l.label}</strong>
                      )}
                      <small>{url ? new URL(url).hostname : "地址无效，请编辑"}</small>
                    </div>
                    {controls(l, "播放链接")}
                  </article>
                );
              })}
            </div>
          )}
          {tab === "tag" && (
            <div className="records">
              <h3>
                本番标签 <small>{tagged.length}</small>
              </h3>
              {!tagged.length && <p className="hint">还没有个人标签。</p>}
              <div className="tag-list">
                {index.tags
                  .filter((t) => tagged.includes(t.id))
                  .map((t) => (
                    <button
                      key={t.id}
                      className="tag-pill"
                      aria-label={"移出本番标签 " + t.name}
                      onClick={() => void save("DELETE", { id: t.id })}
                    >
                      {t.name}
                      <X size={14} />
                    </button>
                  ))}
              </div>
            </div>
          )}
        </fieldset>
      </div>
    </Modal>
  );
}
