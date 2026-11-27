"use client";
import { Input } from "@/components/ui/input";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Download, Link2, Search } from "lucide-react";
import { Modal } from "@/components/ui/dialog";
import { parseSubjectId, type SourceSubject, type SubjectPreview } from "@/lib/domain/bangumi";
import { title } from "@/lib/domain/library";
import { request, message, type Saved } from "@/lib/client";
import { Cover } from "./cover";
type Page = { data: SubjectPreview[]; nextOffset: number | null };
export function ImportDialog({
  existing,
  onClose,
  onSave,
}: {
  existing: Set<number>;
  onClose: () => void;
  onSave: (s: Saved) => void;
}) {
  const [mode, setMode] = useState<"search" | "id">("search"),
    [query, setQuery] = useState(""),
    [link, setLink] = useState("");
  const [page, setPage] = useState<Page | null>(null),
    [subject, setSubject] = useState<SourceSubject | null>(null);
  const [searching, setSearching] = useState(false),
    [checking, setChecking] = useState(false),
    [more, setMore] = useState(false);
  const [saving, setSaving] = useState<number | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const generation = useRef(0),
    detailGen = useRef(0);
  useEffect(() => {
    const seq = ++generation.current,
      term = query.trim();
    const abort = new AbortController();
    setPage(null);
    setError("");
    setMore(false);
    if (mode !== "search" || !term) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const result = await request<Page>(
          "/api/bangumi/search",
          "POST",
          { keyword: term, offset: 0 },
          abort.signal,
        );
        if (seq === generation.current) setPage(result);
      } catch (e) {
        if (!abort.signal.aborted && seq === generation.current) setError(message(e));
      } finally {
        if (!abort.signal.aborted && seq === generation.current) setSearching(false);
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, mode, retry]);
  async function nextPage() {
    if (page?.nextOffset == null || more) return;
    const seq = generation.current;
    setMore(true);
    setError("");
    try {
      const next = await request<Page>("/api/bangumi/search", "POST", {
        keyword: query.trim(),
        offset: page.nextOffset,
      });
      if (seq === generation.current)
        setPage({
          data: [...new Map([...page.data, ...next.data].map((s) => [s.id, s])).values()],
          nextOffset: next.nextOffset,
        });
    } catch (e) {
      if (seq === generation.current) setError(message(e));
    } finally {
      if (seq === generation.current) setMore(false);
    }
  }
  async function lookup(e: FormEvent) {
    e.preventDefault();
    const seq = ++detailGen.current;
    setChecking(true);
    setError("");
    setSubject(null);
    try {
      const { subject: s } = await request<{ subject: SourceSubject }>(
        "/api/bangumi/subjects/" + parseSubjectId(link),
      );
      if (seq === detailGen.current) setSubject(s);
    } catch (err) {
      if (seq === detailGen.current) setError(message(err));
    } finally {
      if (seq === detailGen.current) setChecking(false);
    }
  }
  async function add(id: number) {
    if (saving !== null) return;
    setSaving(id);
    setError("");
    try {
      onSave(await request<Saved>("/api/library/import", "POST", { subjectId: id }));
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(null);
    }
  }
  function candidate(
    id: number,
    s: {
      title_cn: string | null;
      title_original: string | null;
      cover_url: string | null;
      platform: string | null;
    },
    date: string | null,
    total?: number | null,
  ) {
    return (
      <li className="candidate" key={id}>
        <div className="mini-cover">
          <Cover url={s.cover_url} name={title(s)} />
        </div>
        <div className="candidate-info">
          <strong>{title(s)}</strong>
          {s.title_cn && s.title_original && s.title_cn !== s.title_original && (
            <span>{s.title_original}</span>
          )}
          <small>
            {[s.platform, date?.slice(0, 4), total ? total + " 集" : null, "#" + id]
              .filter(Boolean)
              .join(" · ")}
          </small>
        </div>
        <button className="btn small neutral" disabled={saving !== null} onClick={() => add(id)}>
          {saving === id ? "保存中…" : existing.has(id) ? "刷新资料" : "导入"}
        </button>
      </li>
    );
  }
  function switchMode(v: "search" | "id") {
    detailGen.current++;
    setChecking(false);
    setMode(v);
    setSubject(null);
    setError("");
  }
  return (
    <Modal title="从 Bangumi 导入" onClose={onClose} busy={saving !== null}>
      <div className="modal-body fields">
        <div className="tabs">
          <button
            aria-pressed={mode === "search"}
            disabled={saving !== null}
            onClick={() => switchMode("search")}
          >
            <Search size={16} />
            关键词搜索
          </button>
          <button
            aria-pressed={mode === "id"}
            disabled={saving !== null}
            onClick={() => switchMode("id")}
          >
            <Link2 size={16} />
            ID / 链接
          </button>
        </div>
        {mode === "search" ? (
          <>
            <label>
              番剧名称
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={160}
                placeholder="输入中文名或原名"
                autoFocus
              />
            </label>
            {searching && (
              <p role="status" className="hint">
                正在搜索…
              </p>
            )}
            {page && (
              <>
                <ul className="candidates">{page.data.map((s) => candidate(s.id, s, s.date))}</ul>
                {!page.data.length && (
                  <p className="hint">没有匹配的动画，可以尝试原名或条目 ID。</p>
                )}
                {page.nextOffset !== null && (
                  <button className="btn neutral" disabled={more} onClick={nextPage}>
                    {more ? "加载中…" : "更多结果"}
                  </button>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <form onSubmit={lookup} className="fields">
              <label>
                条目 ID 或链接
                <Input
                  value={link}
                  onChange={(e) => {
                    detailGen.current++;
                    setChecking(false);
                    setSubject(null);
                    setLink(e.target.value);
                  }}
                  placeholder="253 或 https://bgm.tv/subject/253"
                />
              </label>
              <button
                className="btn neutral"
                disabled={checking || !link.trim() || saving !== null}
              >
                <Download size={16} />
                {checking ? "读取中…" : "预览条目"}
              </button>
            </form>
            {subject && (
              <ul className="candidates">
                {candidate(
                  subject.bangumi_id,
                  subject,
                  subject.premiere_date,
                  subject.total_episodes,
                )}
              </ul>
            )}
          </>
        )}
        {error && (
          <div role="alert" className="error">
            {error}{" "}
            {mode === "search" && !page && (
              <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
                重试
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
