"use client";
import { displayLoginName } from "@/lib/domain/member-login";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceNav } from "@/components/workspace-frame";
import {
  ExternalLink,
  NotebookPen,
  Bookmark,
  Check,
  CircleCheck,
  CirclePause,
  CircleX,
  Clapperboard,
  Download,
  FolderOpen,
  LayoutGrid,
  ListVideo,
  LogOut,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  airLabels,
  shanghaiDay,
  AppError,
  title,
  watchLabels,
  type Entry,
  type WatchStatus,
} from "@/lib/domain/library";
import { request, message, operationId, type Saved } from "@/lib/client";
import { playableUrl, type JournalIndex } from "@/lib/domain/journal";
import { emptyFacets, filterEntries } from "@/lib/domain/filters";
import { airedCount, debtLabel, scheduleState } from "@/lib/domain/schedule";
import { LibraryFacets } from "./facets";
import { JournalDialog } from "./journal-dialog";
import { WeekCalendar } from "./week-calendar";
import { useScheduleSync } from "./use-schedule-sync";
import { Cover } from "./cover";
import { EntryEditor } from "./entry-editor";
import { ImportDialog } from "./import-dialog";
import { DecisionDialog } from "./decision-dialog";

type Dialog =
  | { type: "new" | "import" }
  | { type: "edit" | "complete" | "delete" | "journal"; entry: Entry };
const groups = { all: "全部番剧", ...watchLabels };
const icons = {
  all: LayoutGrid,
  watching: Play,
  planned: Bookmark,
  completed: CircleCheck,
  on_hold: CirclePause,
  dropped: CircleX,
};
type Filter = keyof typeof groups;
type Props = {
  initial: Entry[];
  initialIndex: JournalIndex;
  initialDay: string;
  view: "library" | "calendar";
  ownerId: string;
  email: string;
};
export function Library({ initial, initialIndex, initialDay, view, ownerId, email }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [today, setToday] = useState(initialDay);
  const [facets, setFacets] = useState(emptyFacets);
  const [entries, setEntries] = useState(initial),
    [filter, setFilter] = useState<Filter>("all"),
    [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent"),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set()),
    [pending, setPending] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState(""),
    [warning, setWarning] = useState(""),
    [loggingOut, setLoggingOut] = useState(false);
  const mutation = useRef(0),
    readSeq = useRef(0),
    inFlight = useRef(new Set<string>()),
    pendingRef = useRef<Record<string, string>>({});
  const storage = "bangumi-progress:" + ownerId;
  const latest = useRef(entries);
  useEffect(() => {
    latest.current = entries;
  }, [entries]);
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storage) ?? "{}");
      if (saved && typeof saved === "object") {
        pendingRef.current = saved;
        setPending(saved);
      }
    } catch {}
  }, [storage]);
  function remember(id: string, token?: string) {
    const next = { ...pendingRef.current };
    if (token) next[id] = token;
    else delete next[id];
    pendingRef.current = next;
    setPending(next);
    try {
      sessionStorage.setItem(storage, JSON.stringify(next));
    } catch {}
  }
  const refresh = useCallback(async () => {
    const seq = ++readSeq.current,
      epoch = mutation.current;
    try {
      setToday(shanghaiDay());
      const result = await request<{ entries: Entry[]; index: JournalIndex }>("/api/library");
      if (seq === readSeq.current && epoch === mutation.current) {
        setEntries(result.entries);
        setIndex(result.index);
        setWarning("");
      }
    } catch (e) {
      if (seq === readSeq.current) setWarning(message(e));
    }
  }, []);
  const schedule = useScheduleSync(entries, !!dialog || busy.size > 0, refresh);
  async function journalChanged() {
    mutation.current++;
    await refresh();
  }
  useEffect(() => {
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    visible();
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    const t = setInterval(visible, 45000);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4200);
    return () => clearTimeout(t);
  }, [notice]);
  function accept(result: Saved, text: string, close: boolean) {
    mutation.current++;
    const old = latest.current.find((e) => e.id === result.entry.id);
    if (old && old.version > result.entry.version) {
      if (close) setDialog(null);
      return;
    }
    setEntries((rows) => {
      const current = rows.find((e) => e.id === result.entry.id);
      if (current && current.version > result.entry.version) return rows;
      return [result.entry, ...rows.filter((e) => e.id !== result.entry.id)];
    });
    if (result.suggestCompletion) setDialog({ type: "complete", entry: result.entry });
    else if (close) setDialog(null);
    setNotice(text);
    setWarning("");
  }
  async function plus(entry: Entry) {
    if (inFlight.current.has(entry.id)) return;
    inFlight.current.add(entry.id);
    setBusy(new Set(inFlight.current));
    const token = pendingRef.current[entry.id] || operationId();
    remember(entry.id, token);
    try {
      const result = await request<Saved>("/api/library/" + entry.id + "/progress", "POST", {
        requestId: token,
      });
      remember(entry.id);
      accept(
        result,
        result.advanced
          ? "已记录第 " +
              result.entry.watched_episodes +
              " 集" +
              (entry.watch_status === "planned" && result.entry.watch_status === "watching"
                ? "，已移至在看"
                : "")
          : "已达到当前总集数",
        false,
      );
    } catch (e) {
      if (e instanceof AppError && [400, 403, 404, 422].includes(e.status)) remember(entry.id);
      setWarning(
        message(e) + (pendingRef.current[entry.id] ? "。点击卡片上的重试可确认这次进度。" : ""),
      );
    } finally {
      inFlight.current.delete(entry.id);
      setBusy(new Set(inFlight.current));
    }
  }
  async function logout() {
    setLoggingOut(true);
    try {
      await request("/api/auth/logout", "POST", {});
      window.location.replace("/login");
    } catch (e) {
      setWarning(message(e));
      setLoggingOut(false);
    }
  }
  const counts = useMemo(() => {
    const c = {
      all: entries.length,
      watching: 0,
      planned: 0,
      completed: 0,
      on_hold: 0,
      dropped: 0,
    };
    for (const e of entries) c[e.watch_status]++;
    return c;
  }, [entries]);
  const visible = useMemo(
    () => filterEntries(entries, index, today, filter, facets, query, sort),
    [entries, index, today, filter, facets, query, sort],
  );
  function clearFilters() {
    setFilter("all");
    setQuery("");
    setFacets(emptyFacets);
  }
  function openJournal(entry: Entry) {
    setDialog({ type: "journal", entry });
  }
  const existing = new Set(entries.flatMap((e) => (e.bangumi_id ? [e.bangumi_id] : [])));
  function newEntry(s: Saved) {
    clearFilters();
    accept(
      s,
      s.created === false ? "已核对并刷新条目资料" : "已保存《" + title(s.entry) + "》",
      true,
    );
  }
  const groupButtons = (Object.keys(groups) as Filter[]).map((k) => {
    const Icon = icons[k];
    return (
      <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
        <Icon size={17} />
        <span>{groups[k]}</span>
        <small>{counts[k]}</small>
      </button>
    );
  });
  return (
    <div className="library-page">
      <header className="shell-head">
        <div className="head-inner">
          <Brand />
          <div className="header-tools">
            {email && <span className="account">{displayLoginName(email)}</span>}
            <ThemeToggle />
            <button
              className="icon-btn"
              onClick={logout}
              disabled={loggingOut}
              title="退出登录"
              aria-label="退出登录"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <div className="shell">
        <aside className="side">
          <WorkspaceNav view={view} />
          {view === "library" && (
            <>
              <h2>片单分组</h2>
              <nav aria-label="片单状态">{groupButtons}</nav>
              <LibraryFacets
                sidebar
                value={facets}
                change={setFacets}
                entries={entries}
                tags={index.tags}
                clear={clearFilters}
              />
            </>
          )}
        </aside>
        <main className="library-main">
          {warning && (
            <div className="warn-line" role="alert">
              <span>{warning}</span>
              <button className="text-button" onClick={() => void refresh()}>
                刷新片单
              </button>
            </div>
          )}
          {schedule.failure && entries.some((e) => e.id === schedule.failure?.id) && (
            <div className="warn-line" role="status">
              <span>
                《{title(entries.find((e) => e.id === schedule.failure!.id)!)}》章节同步失败。
                {schedule.failure.text}
              </span>
              <button
                className="text-button"
                disabled={!!schedule.active}
                onClick={() => {
                  const e = entries.find((row) => row.id === schedule.failure?.id);
                  if (e) void schedule.sync(e).catch(() => {});
                }}
              >
                重试同步
              </button>
            </div>
          )}
          {view === "calendar" ? (
            <WeekCalendar entries={entries} index={index} today={today} open={openJournal} />
          ) : (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <h1>我的片单</h1>
                  <p>
                    {counts.all} 部番剧 <span>·</span> {counts.watching} 部在看
                  </p>
                  <div className="actions">
                    <button
                      className="btn hero-primary"
                      onClick={() => setDialog({ type: "import" })}
                    >
                      <Download size={17} />从 Bangumi 导入
                    </button>
                    <button
                      className="btn hero-secondary"
                      onClick={() => setDialog({ type: "new" })}
                    >
                      <Plus size={17} />
                      手动添加
                    </button>
                  </div>
                </div>
              </section>
              <div className="mobile-add-actions">
                <button className="btn primary" onClick={() => setDialog({ type: "import" })}>
                  <Download size={16} />从 Bangumi 导入
                </button>
                <button className="btn neutral" onClick={() => setDialog({ type: "new" })}>
                  <Plus size={16} />
                  手动添加
                </button>
              </div>
              <nav className="mobile-groups" aria-label="移动端片单状态">
                {groupButtons}
              </nav>
              <section aria-label="片单">
                <div className="collection-toolbar">
                  <h2>
                    <ListVideo size={21} />
                    {groups[filter]} <small>{visible.length}</small>
                  </h2>
                  <div className="filter-tools">
                    <label className="search-box">
                      <Search size={16} />
                      <input
                        aria-label="搜索片单"
                        placeholder="搜索片单"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button aria-label="清空搜索" onClick={() => setQuery("")}>
                          <X size={14} />
                        </button>
                      )}
                    </label>
                    <select
                      aria-label="片单排序"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="recent">最近观看</option>
                      <option value="added">最近添加</option>
                      <option value="title">名称排序</option>
                      <option value="premiere">开播日期</option>
                      <option value="rating">个人评分</option>
                      <option value="debt">欠番最多</option>
                    </select>
                  </div>
                </div>
                <LibraryFacets
                  value={facets}
                  change={setFacets}
                  entries={entries}
                  tags={index.tags}
                  clear={clearFilters}
                />
                {visible.length ? (
                  <div className="card-grid">
                    {visible.map((e) => (
                      <EntryCard
                        key={e.id}
                        entry={e}
                        index={index}
                        today={today}
                        onOpen={() => openJournal(e)}
                        pending={!!pending[e.id]}
                        busy={busy.has(e.id)}
                        onEdit={() => setDialog({ type: "edit", entry: e })}
                        onPlus={() => void plus(e)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <div className="empty-icon">
                      {entries.length ? <FolderOpen size={31} /> : <Clapperboard size={32} />}
                    </div>
                    <h3>{entries.length ? "没有匹配的番剧" : "片单还是空的"}</h3>
                    <p>
                      {entries.length
                        ? "可以调整分组、关键词或组合筛选。"
                        : "导入一部想看的番剧，或手动记录你的第一部。"}
                    </p>
                    <button
                      className="btn neutral"
                      onClick={() =>
                        entries.length ? clearFilters() : setDialog({ type: "import" })
                      }
                    >
                      {entries.length ? "查看全部番剧" : "导入第一部番剧"}
                    </button>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>
      <WorkspaceNav
        view={view}
        mobile
        onCurrent={() => {
          clearFilters();
          window.scrollTo({ top: 0 });
        }}
      />
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      {dialog?.type === "journal" && entries.some((e) => e.id === dialog.entry.id) && (
        <JournalDialog
          key={dialog.entry.id}
          entry={entries.find((e) => e.id === dialog.entry.id)!}
          index={index}
          today={today}
          onClose={() => setDialog(null)}
          onChange={journalChanged}
          onSync={schedule.sync}
          syncing={schedule.active === dialog.entry.id}
        />
      )}
      {dialog?.type === "import" && (
        <ImportDialog existing={existing} onClose={() => setDialog(null)} onSave={newEntry} />
      )}
      {(dialog?.type === "new" || dialog?.type === "edit") && (
        <EntryEditor
          key={dialog.type === "edit" ? dialog.entry.id : "new"}
          entry={dialog.type === "edit" ? dialog.entry : undefined}
          onClose={() => setDialog(null)}
          onSave={dialog.type === "new" ? newEntry : (s) => accept(s, "修改已保存", true)}
          onDelete={(e) => setDialog({ type: "delete", entry: e })}
          onConflict={() => void refresh()}
        />
      )}
      {(dialog?.type === "complete" || dialog?.type === "delete") && (
        <DecisionDialog
          key={dialog.type + dialog.entry.id}
          deleting={dialog.type === "delete"}
          entry={dialog.entry}
          onClose={() => setDialog(null)}
          onConflict={() => void refresh()}
          onSaved={(s) => accept(s, "已标为已看", true)}
          onRemoved={(id) => {
            mutation.current++;
            remember(id);
            setEntries((x) => x.filter((e) => e.id !== id));
            setDialog(null);
            setNotice("已删除番剧");
          }}
        />
      )}
    </div>
  );
}
function EntryCard({
  entry: e,
  index,
  today,
  onOpen,
  pending,
  busy,
  onEdit,
  onPlus,
}: {
  entry: Entry;
  index: JournalIndex;
  today: string;
  onOpen: () => void;
  pending: boolean;
  busy: boolean;
  onEdit: () => void;
  onPlus: () => void;
}) {
  const cap = e.total_episodes !== null && e.watched_episodes >= e.total_episodes;
  const episodes = index.episodes[e.id] ?? [];
  const debt = airedCount(e, episodes, today);
  const tags = index.tags.filter((t) => index.assignments[e.id]?.includes(t.id));
  const firstLink = index.links[e.id]?.find((l) => playableUrl(l.url));
  const meta = [
    e.platform,
    e.premiere_date?.slice(0, 4),
    airLabels[scheduleState(e, episodes, today)],
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="entry-card">
      <div className="poster">
        <Cover url={e.cover_url} name={title(e)} />
        <span className={"status-label " + e.watch_status}>{watchLabels[e.watch_status]}</span>
        <button className="edit-btn" onClick={onEdit} aria-label={"编辑 " + title(e)}>
          <Pencil size={15} />
        </button>
      </div>
      <div className="card-body">
        <h3>
          <button onClick={onOpen}>{title(e)}</button>
        </h3>
        <p className="card-meta">{meta}</p>
        <span className="card-debt">{debtLabel(debt)}</span>
        {tags.length > 0 && (
          <div className="card-tags">
            {tags.map((t) => (
              <span key={t.id}>{t.name}</span>
            ))}
          </div>
        )}
        {e.personal_rating !== null && (
          <span className="card-score">
            <Star size={13} />
            {e.personal_rating} 分
          </span>
        )}
        <div className="progress-row">
          <div className="progress-info">
            <span>
              已看 <b>{e.watched_episodes}</b>
              {e.total_episodes ? " / " + e.total_episodes : ""} 集
            </span>
            {e.total_episodes ? (
              <progress
                max={e.total_episodes}
                value={Math.min(e.total_episodes, e.watched_episodes)}
                aria-label="观看进度"
              />
            ) : (
              <small>总集数待定</small>
            )}
          </div>
          <button
            className="plus-btn"
            aria-label={(pending ? "重试进度 " : "进度加一 ") + title(e)}
            disabled={busy || (cap && !pending)}
            onClick={onPlus}
          >
            {busy ? <RefreshCw size={15} className="spin" /> : pending ? "重试" : "+1"}
          </button>
        </div>
        <div className="card-shortcuts">
          <button onClick={onOpen} aria-label={"打开手记 " + title(e)}>
            <NotebookPen size={14} />
            手记{index.notes[e.id]?.length ? " " + index.notes[e.id].length : ""}
          </button>
          {firstLink && (
            <a href={playableUrl(firstLink.url)!} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} />
              {firstLink.label}
            </a>
          )}
        </div>
        {e.total_episodes && e.watched_episodes > e.total_episodes ? (
          <small className="caution">计划集数已调低，请核对进度</small>
        ) : null}
      </div>
    </article>
  );
}
