"use client";
import { Input } from "@/components/ui/input";
import { useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/dialog";
import { request, message, operationId, type Saved } from "@/lib/client";
import {
  airLabels,
  cleanManual,
  metaLabels,
  metadataFields,
  releaseLabels,
  watchLabels,
  type Entry,
} from "@/lib/domain/library";

export function EntryEditor({
  entry,
  onClose,
  onSave,
  onDelete,
  onConflict,
}: {
  entry?: Entry;
  onClose: () => void;
  onSave: (result: Saved) => void;
  onDelete: (e: Entry) => void;
  onConflict: () => void;
}) {
  const [id] = useState(() => entry?.id ?? operationId());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (busy) return;
    const fd = new FormData(ev.currentTarget);
    try {
      setError("");
      const values = cleanManual(Object.fromEntries(fd));
      setBusy(true);
      const path = entry ? "/api/library/" + entry.id : "/api/library";
      const result = await request<Saved>(path, entry ? "PATCH" : "POST", {
        id,
        values,
        version: entry?.version,
        unlock: fd.getAll("unlock"),
      });
      onSave(result);
    } catch (e) {
      setError(message(e));
      onConflict();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={entry ? "编辑番剧" : "手动添加番剧"} onClose={onClose} wide busy={busy}>
      <form onSubmit={submit}>
        <div className="modal-body fields">
          <div className="form-pair">
            <label>
              中文名
              <Input
                name="title_cn"
                defaultValue={entry?.title_cn ?? ""}
                placeholder="与原名至少填写一项"
              />
            </label>
            <label>
              原名
              <Input name="title_original" defaultValue={entry?.title_original ?? ""} />
            </label>
          </div>
          <div className="form-pair">
            <label>
              观看状态
              <select name="watch_status" defaultValue={entry?.watch_status ?? "planned"}>
                {Object.entries(watchLabels).map(([v, s]) => (
                  <option key={v} value={v}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              个人评分
              <select name="personal_rating" defaultValue={entry?.personal_rating ?? ""}>
                <option value="">未评分</option>
                {Array.from({ length: 10 }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1} 分
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-pair">
            <label>
              已看集数
              <Input
                name="watched_episodes"
                type="number"
                min="0"
                max="2147483647"
                defaultValue={entry?.watched_episodes ?? 0}
              />
            </label>
            <label>
              计划总集数
              <Input
                name="total_episodes"
                type="number"
                min="1"
                max="2147483647"
                defaultValue={entry?.total_episodes ?? ""}
                placeholder="未知可留空"
              />
            </label>
          </div>
          <label>
            封面链接
            <Input
              name="cover_url"
              type="url"
              defaultValue={entry?.cover_url ?? ""}
              placeholder="https://…"
            />
          </label>
          <details className="extra-fields">
            <summary>放送资料与标签</summary>
            <div className="fields">
              <div className="form-pair">
                <label>
                  载体
                  <Input
                    name="platform"
                    defaultValue={entry?.platform ?? ""}
                    placeholder="TV、OVA、剧场版…"
                  />
                </label>
                <label>
                  放送状态
                  <select name="airing_override" defaultValue={entry?.airing_override ?? ""}>
                    <option value="">自动判断</option>
                    {Object.entries(airLabels).map(([v, s]) => (
                      <option key={v} value={v}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-pair">
                <label>
                  首播日期
                  <Input
                    type="date"
                    name="premiere_date"
                    defaultValue={entry?.premiere_date ?? ""}
                  />
                </label>
                <label>
                  结束日期
                  <Input type="date" name="end_date" defaultValue={entry?.end_date ?? ""} />
                </label>
              </div>
              <div className="form-pair">
                <label>
                  放送星期
                  <select name="air_weekday" defaultValue={entry?.air_weekday ?? ""}>
                    <option value="">待定</option>
                    {Array.from("一二三四五六日", (s, i) => (
                      <option key={s} value={i + 1}>
                        周{s}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  更新规律
                  <select name="release_pattern" defaultValue={entry?.release_pattern ?? "unknown"}>
                    {Object.entries(releaseLabels).map(([v, s]) => (
                      <option value={v} key={v}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                维基标签
                <Input
                  name="meta_tags"
                  defaultValue={entry?.meta_tags.join("，") ?? ""}
                  placeholder="多个标签以逗号分隔"
                />
              </label>
              <label>
                社区标签
                <Input
                  name="community_tags"
                  defaultValue={entry?.community_tags.join("，") ?? ""}
                  placeholder="多个标签以逗号分隔"
                />
              </label>
            </div>
          </details>
          <label>
            个人短评
            <textarea
              name="review"
              rows={2}
              defaultValue={entry?.review ?? ""}
              placeholder="记下这部番给你的印象"
            />
          </label>
          {entry?.bangumi_id && entry.locked_fields.length > 0 && (
            <details className="extra-fields">
              <summary>恢复字段跟随 Bangumi</summary>
              <p className="hint">勾选后，下次导入同一条目会刷新这些字段。</p>
              <div className="checks">
                {metadataFields
                  .filter((k) => entry.locked_fields.includes(k))
                  .map((k) => (
                    <label key={k}>
                      <input name="unlock" value={k} type="checkbox" />
                      {metaLabels[k]}
                    </label>
                  ))}
              </div>
            </details>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
        <footer className="modal-foot">
          {entry && (
            <button
              className="btn danger-ghost"
              type="button"
              disabled={busy}
              onClick={() => onDelete(entry)}
            >
              <Trash2 size={16} />
              删除
            </button>
          )}
          <button className="btn neutral ml-auto" type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? "保存中…" : "保存番剧"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
