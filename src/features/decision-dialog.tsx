"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/dialog";
import { title, type Entry } from "@/lib/domain/library";
import { message, request, type Saved } from "@/lib/client";
export function DecisionDialog({
  entry,
  deleting,
  onClose,
  onSaved,
  onRemoved,
  onConflict,
}: {
  entry: Entry;
  deleting: boolean;
  onClose: () => void;
  onSaved: (s: Saved) => void;
  onRemoved: (id: string) => void;
  onConflict: () => void;
}) {
  const [rating, setRating] = useState<number | null>(entry.personal_rating),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const path = "/api/library/" + entry.id;
      if (deleting) {
        const res = await request<{ id: string }>(path, "DELETE", { version: entry.version });
        onRemoved(res.id);
      } else
        onSaved(
          await request<Saved>(path, "PATCH", {
            version: entry.version,
            intent: "complete",
            rating,
          }),
        );
    } catch (e) {
      setError(message(e));
      onConflict();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={deleting ? "删除这部番？" : "看完最后一集了"} onClose={onClose} busy={busy}>
      <div className="modal-body fields">
        <p>
          {deleting
            ? "删除《" + title(entry) + "》会同时移除它的个人观看记录。"
            : "《" + title(entry) + "》已看到第 " + entry.watched_episodes + " 集，要标为已看吗？"}
        </p>
        {!deleting && (
          <fieldset className="rating">
            <legend>个人评分（选填）</legend>
            <div className="scores">
              {Array.from({ length: 10 }, (_, i) => (
                <button
                  key={i}
                  aria-pressed={rating === i + 1}
                  onClick={() => setRating(rating === i + 1 ? null : i + 1)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
      <footer className="modal-foot">
        <button className="btn neutral ml-auto" disabled={busy} onClick={onClose}>
          {deleting ? "保留" : "稍后"}
        </button>
        <button
          className={"btn " + (deleting ? "danger" : "primary")}
          disabled={busy}
          onClick={confirm}
        >
          {busy ? "处理中…" : deleting ? "确认删除" : "标为已看"}
        </button>
      </footer>
    </Modal>
  );
}
